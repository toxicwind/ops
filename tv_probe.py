#!/usr/bin/env python3
"""tv_probe — reusable CDP probe helper for the LG webOS TV (Nuvio).

Usage from any eval/REPL session:

    %load /home/toxic/pens/estate/products/estate-ops/tv_probe.py
    await tv("document.readyState")                 # one-shot eval
    await tv(EXPR, wait_s=10)                       # eval after a settle delay
    async with session() as c: await c.ev(EXPR)     # multi-step session
    await session_shot("/tmp/tv.png")               # screenshot

Env knobs:
    LG_CDP_PORT_FILE (default /tmp/lg-cdp.port) — lg-cdp tunnel port
    NUVIO_URL_MATCH (default "nuvio")           — page matcher in /json/list

Requires the lg-cdp keeper tunnel: `~/.local/bin/lg-cdp ensure` first.
Chrome 68-safe expressions only: NO optional chaining, NO nullish coalescing.
"""
import asyncio, base64, json, os, subprocess

import websockets

PORT_FILE = os.environ.get("LG_CDP_PORT_FILE", "/tmp/lg-cdp.port")
URL_MATCH = os.environ.get("NUVIO_URL_MATCH", "nuvio")


def _tunnel_port():
    # lg-cdp writes the live port; fall back to file content if ensure is a no-op
    try:
        r = subprocess.run(["/home/toxic/.local/bin/lg-cdp", "ensure"],
                           capture_output=True, text=True, timeout=30)
        port = (r.stdout or "").strip().splitlines()[-1]
        if port.isdigit():
            return port
    except Exception:
        pass
    return open(PORT_FILE).read().strip()


def nuvio_page_id():
    port = _tunnel_port()
    lst = subprocess.run(["curl", "-s", "--max-time", "8",
                          f"http://localhost:{port}/json/list"],
                         capture_output=True, text=True, timeout=15).stdout
    pages = json.loads(lst or "[]")
    hit = [p for p in pages if URL_MATCH in p.get("url", "")]
    if not hit:
        raise RuntimeError("no nuvio page: " + str([p.get("url") for p in pages]))
    return port, hit[0]["id"]


class CDP:
    def __init__(self, url):
        self.url = url
        self.seq = 0

    async def __aenter__(self):
        # ping_interval=None: webOS CDP shim never answers pings; close_timeout
        # keeps __aexit__ fast when the TV dropped the socket.
        self.ws = await websockets.connect(self.url, open_timeout=12,
                                           ping_interval=None, close_timeout=5)
        await self.send("Runtime.enable")
        return self

    async def __aexit__(self, *exc):
        try:
            await self.ws.close()
        except Exception:
            pass

    async def send(self, method, params=None):
        self.seq += 1
        await self.ws.send(json.dumps({"id": self.seq, "method": method,
                                       "params": params or {}}))
        while True:
            # Events interleave; skip until the matching id. 30s cap so a dead
            # page fails fast instead of hanging the cell.
            d = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=30))
            if d.get("id") == self.seq:
                return d

    async def ev(self, expr, timeout=30):
        r = await self.send("Runtime.evaluate",
                            {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("result", {}).get("value")

    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        data = r.get("result", {}).get("data", "")
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return len(data)


async def session():
    port, pid = nuvio_page_id()
    return CDP(f"ws://localhost:{port}/devtools/page/{pid}")


async def session_shot(path):
    async with await session() as c:
        return await c.shot(path)


async def tv(expr, wait_s=0):
    """One-shot: eval `expr` on the live Nuvio page (after `wait_s` settle)."""
    async with await session() as c:
        if wait_s:
            await asyncio.sleep(wait_s)
        return await c.ev(expr)


def sync_tv(expr, wait_s=0, timeout=60):
    """Blocking wrapper for shell contexts (no running loop)."""
    return asyncio.run(tv(expr, wait_s=wait_s)) if not _in_loop() else None


def _in_loop():
    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False
