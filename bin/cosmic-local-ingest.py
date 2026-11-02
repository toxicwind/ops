#!/usr/bin/env python3
"""
cosmic-local-ingest.py — local embed→qdrant ingest lane (estate-ops).

Fleet ticket 20261102T020500Z blocked bge-m3→qdrant on a dead freeinference
embed key (401) — external rotation required. This tool proves and runs the
SAME pipeline with the locally cached embedder (sentence-transformers
all-MiniLM-L6-v2, 384-dim, zero external keys), so the ingest machinery is
usable today while the 1024-dim bge-m3 collections wait for key rotation.

  embed   MiniLM-L6-v2 (384-dim, local HF cache, deterministic mean-pool).
  upsert  qdrant collection <COLLECTION> (384-dim cosine), created on demand.
  verify  query → search → top hit + similarity; then points_count.

Modes:
  demo (default)  embed a small inline corpus, upsert, search, assert.
  probe           embed a single query and print its dim (lane sanity check).

Run: python3 cosmic-local-ingest.py [demo|probe] [--query "…"]
Env:  QDRANT_URL (default http://127.0.0.1:25133)
      COSMIC_COLLECTION (default cosmic_local_384)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

QDRANT = os.environ.get("QDRANT_URL", "http://127.0.0.1:25133")
COLLECTION = os.environ.get("COSMIC_COLLECTION", "cosmic_local_384")
MINILM_CACHE = (
    "/home/toxic/.cache/huggingface/hub/models--sentence-transformers--"
    "all-MiniLM-L6-v2/snapshots/1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
)

CORPUS = [
    "The browser-keeper supervises one persistent headed Chromium on the :99 Xvnc desktop, exposed over CDP at 127.0.0.1:25233.",
    "the tauvisor advisor reviews the executor transcript per request, is main-aware via the async git-state hook, and is sandboxed read-only by default.",
    "Paper-poller races arXiv, alphaXiv, HuggingFace, OpenAlex and Semantic Scholar legs for a scholarly query via race_papers.py.",
    "The thresher MCP gateway federates 81 upstream servers behind one authenticated HTTP JSON-RPC surface on :25127.",
    "Qdrant stores dense vector collections at 1024-dim cosine for bge-m3 embeddings, with healthz on :25133.",
]


def _request(method: str, path: str, payload: dict | None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{QDRANT}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path}: HTTP {e.code}: {e.read()[:300]!r}")


def _load_embedder():
    from transformers import AutoModel, AutoTokenizer
    import torch

    tok = AutoTokenizer.from_pretrained(MINILM_CACHE)
    model = AutoModel.from_pretrained(MINILM_CACHE)
    model.eval()

    def embed(texts: list[str]) -> list[list[float]]:
        with torch.no_grad():
            inp = tok(texts, padding=True, truncation=True, return_tensors="pt")
            last = model(**inp).last_hidden_state
            mask = inp["attention_mask"].unsqueeze(-1).float()
            pooled = (last * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
            vecs = torch.nn.functional.normalize(pooled, p=2, dim=1)
        return vecs.tolist()

    return embed


def ensure_collection(dim: int) -> None:
    try:
        _request(
            "PUT",
            f"/collections/{COLLECTION}",
            {"vectors": {"size": dim, "distance": "Cosine"}, "optimizers_config": {"indexing_threshold": 10}},
        )
    except RuntimeError as e:
        # Already exists → fine; anything else re-raises.
        if "already exists" not in str(e):
            raise


def demo() -> int:
    print("[1/4] loading local embedder all-MiniLM-L6-v2 (from HF cache)…")
    embed = _load_embedder()
    vectors = embed(CORPUS)
    dim = len(vectors[0])
    print(f"[1/4] embed OK: {len(CORPUS)} docs x {dim}-dim (normalized cosine)")

    print(f"[2/4] ensuring qdrant collection {COLLECTION} @ {dim}-dim cosine…")
    ensure_collection(dim)
    print(f"[2/4] collection ready")

    print(f"[3/4] upserting {len(CORPUS)} points…")
    _request(
        "PUT",
        f"/collections/{COLLECTION}/points?wait=true",
        {"points": [{"id": i + 1, "vector": vectors[i], "payload": {"text": t}} for i, t in enumerate(CORPUS)]},
    )
    print(f"[3/4] upsert OK")

    print("[4/4] verifying: search 'chromium CDP supervisor' + point count…")
    qv = embed(["chromium CDP supervisor"])[0]
    hits = _request("POST", f"/collections/{COLLECTION}/points/search", {"vector": qv, "limit": 2, "with_payload": True})
    top = hits["result"][0]
    print(f"[4/4] top hit: {top['payload']['text'][:80]}… score={top['score']:.4f}")
    info = _request("GET", f"/collections/{COLLECTION}", None)
    count = info["result"]["points_count"]
    print(f"[4/4] points_count = {count}")

    if count != len(CORPUS):
        print("FAIL: points_count mismatch")
        return 1
    if top["score"] < 0.3:
        print(f"FAIL: top score implausibly low ({top['score']:.4f})")
        return 1
    print("PASS: local ingest lane verified end-to-end")
    return 0


def probe(query: str) -> int:
    print("[probe] loading local embedder…")
    embed = _load_embedder()
    qv = embed([query])[0]
    print(f"[probe] query='{query}' dim={len(qv)} (384 = MiniLM-L6-v2 contract)")
    return 0


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "demo"
    if mode == "probe":
        q = sys.argv[sys.argv.index("--query") + 1] if "--query" in sys.argv else "estate"
        return probe(q)
    if mode == "demo":
        return demo()
    print(f"unknown mode {mode!r}; use demo|probe")
    return 2


if __name__ == "__main__":
    sys.exit(main())