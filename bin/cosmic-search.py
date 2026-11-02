#!/usr/bin/env python3
"""
cosmic-search.py — query the local cosmic index (default search consumer).

Pairs with bin/cosmic-local-ingest.py: the local MiniLM-L6-v2 lane (384-dim,
HF cache, zero external keys) is the DEFAULT estate search index until the
freeinference bge-m3 key rotates (fleet 20261102T020500Z). This is the query
half: embed the query locally, search the qdrant collection, print top hits.

Contract (env overrides):
  COSMIC_COLLECTION  collection to search (default cosmic_local_384)
  COSMIC_EMBEDDER    "minilm" (default) | "bge-m3" (when key rotates; then
                     the caller supplies FREEINFERENCE_API_KEY + the 1024-dim
                     collections become searchable instead)
  QDRANT_URL         qdrant base (default http://127.0.0.1:25133)

Run: python3 cosmic-search.py "headed chromium automation" [--top 3]
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.request

QDRANT = os.environ.get("QDRANT_URL", "http://127.0.0.1:25133")
COLLECTION = os.environ.get("COSMIC_COLLECTION", "cosmic_local_384")
EMBEDDER = os.environ.get("COSMIC_EMBEDDER", "minilm")
HERE = os.path.dirname(os.path.abspath(__file__))
INGEST = os.path.join(HERE, "cosmic-local-ingest.py")


def _load_minilm():
    spec = importlib.util.spec_from_file_location("cosmic_local_ingest", INGEST)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._load_embedder()


def search(query: str, top: int) -> list[dict]:
    if EMBEDDER == "minilm":
        qv = _load_minilm()([query])[0]
    elif EMBEDDER == "bge-m3":
        raise RuntimeError(
            "bge-m3 embedder not wired yet — set COSMIC_EMBEDDER=minilm, or "
            "rotate FREEINFERENCE_API_KEY then wire /v1/embeddings here"
        )
    else:
        raise RuntimeError(f"unknown COSMIC_EMBEDDER={EMBEDDER!r}; use minilm|bge-m3")

    req = urllib.request.Request(
        f"{QDRANT}/collections/{COLLECTION}/points/search",
        data=json.dumps({"vector": qv, "limit": top, "with_payload": True}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        hits = json.loads(res.read())["result"]
    return hits


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: cosmic-search.py \"<query>\" [--top N]", file=sys.stderr)
        return 2
    query = sys.argv[1]
    top = 3
    if "--top" in sys.argv:
        top = int(sys.argv[sys.argv.index("--top") + 1])
    try:
        hits = search(query, top)
    except Exception as e:  # noqa: BLE001 — clear CLI error
        print(f"search failed: {e}", file=sys.stderr)
        return 1
    if not hits:
        print("no hits")
        return 0
    for i, h in enumerate(hits):
        print(f"{i + 1}. score={h['score']:.4f}  {h['payload'].get('text', '')[:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())