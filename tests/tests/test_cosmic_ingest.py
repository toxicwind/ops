#!/usr/bin/env python3
"""test_cosmic_ingest.py — TDD the cosmic search index path (max-plan 2.8).

Pins the REAL behavior of the local embed→qdrant ingest lane
(bin/cosmic-local-ingest.py): corpus is embedded with the locally cached
MiniLM-L6-v2 (384-dim), upserted to a 384-dim cosine qdrant collection, and a
semantic query returns the correct document. Runs against the live qdrant
(:25133, healthz verified) with an isolated test collection so it never
touches the bge-m3 1024-dim collections.

Uses a distinct collection name per run (timestamp) and drops it on teardown
— deterministic, isolated, full-suite-safe.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import unittest
import urllib.request

QDRANT = os.environ.get("QDRANT_URL", "http://127.0.0.1:25133")
BIN = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "bin", "cosmic-local-ingest.py")
)

COLLECTION = f"cosmic_test_{int(time.time())}"

# Distinct, clearly-different topics so recall is a real test:
# question about the browser-keeper must NOT return the NNTP doc first.
CORPUS = [
    "The browser-keeper supervises one persistent headed Chromium on the :99 Xvnc desktop, exposed over CDP at 127.0.0.1:25233.",
    "The thresher MCP gateway federates 81 upstream servers behind one authenticated HTTP JSON-RPC surface on :25127.",
    "Paper-poller races arXiv, alphaXiv, HuggingFace, OpenAlex and Semantic Scholar legs for a scholarly query via race_papers.py.",
    "Qdrant stores dense vector collections at 1024-dim cosine for bge-m3 embeddings, with healthz on :25133.",
    "NNTP indexer creds live in the secretsmith keyring as TorBox host/user/pass service-app attributes.",
]

QUERY = "headed chromium browser desktop automation"
EXPECT_ID = 1  # the browser-keeper doc


def _request(method: str, path: str, payload: dict | None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{QDRANT}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())


def _embed(texts: list[str]) -> list[list[float]]:
    """Reuse the tool's embedder by invoking its machinery via import path."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("cosmic_local_ingest", BIN)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._load_embedder()(texts)


def _ensure_alive() -> None:
    with urllib.request.urlopen(f"{QDRANT}/healthz", timeout=10) as res:
        if res.status != 200:
            raise RuntimeError("qdrant healthz not 200")


class CosmicIngestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _ensure_alive()
        # (Re)create isolated 384-dim cosine collection.
        try:
            _request(
                "DELETE",
                f"/collections/{COLLECTION}",
                None,
            )
        except Exception:
            pass
        _request(
            "PUT",
            f"/collections/{COLLECTION}",
            {"vectors": {"size": 384, "distance": "Cosine"}, "optimizers_config": {"indexing_threshold": 10}},
        )

    @classmethod
    def tearDownClass(cls) -> None:
        try:
            _request("DELETE", f"/collections/{COLLECTION}", None)
        except Exception:
            pass

    def test_embedder_is_384_dim(self) -> None:
        vec = _embed(["probe"])[0]
        self.assertEqual(len(vec), 384)

    def _seed(self) -> list[list[float]]:
        """Upsert the corpus; tests call this so ordering never matters."""
        vectors = _embed(CORPUS)
        _request(
            "PUT",
            f"/collections/{COLLECTION}/points?wait=true",
            {"points": [{"id": i + 1, "vector": vectors[i], "payload": {"text": t}} for i, t in enumerate(CORPUS)]},
        )
        return vectors

    def test_search_returns_correct_doc(self) -> None:
        self._seed()
        qv = _embed([QUERY])[0]
        hits = _request(
            "POST",
            f"/collections/{COLLECTION}/points/search",
            {"vector": qv, "limit": 1, "with_payload": True},
        )
        self.assertEqual(hits["result"][0]["id"], EXPECT_ID)
        self.assertGreater(hits["result"][0]["score"], 0.3)
        self.assertIn("browser-keeper", hits["result"][0]["payload"]["text"])

    def test_points_count_matches_corpus(self) -> None:
        self._seed()
        info = _request("GET", f"/collections/{COLLECTION}", None)
        self.assertEqual(info["result"]["points_count"], len(CORPUS))

    def test_cli_probe_mode_runs(self) -> None:
        res = subprocess.run(
            [sys.executable, BIN, "probe", "--query", "estate"],
            capture_output=True,
            text=True,
            timeout=180,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("dim=384", res.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)