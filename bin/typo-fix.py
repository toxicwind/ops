#!/usr/bin/env python3
"""
typo-fix.py — typo-tolerant model/repo name correction (estate-ops).

Reuses the landed cosmic local embed lane (ops 9f7fb4d, MiniLM-L6-v2 384-dim
from HF cache) for the tiebreak, plus Levenshtein edit-distance for candidates.
Runs fully in-process: no network, no keys, mobile-friendly (Pixel/termux).

Contract:
  correct(query, catalog=None, max_dist=1) -> str
    - If the query is already an exact catalog member: return it unchanged.
    - Else collect distance-<=max_dist candidates; embed the query + each
      candidate; return the candidate with the highest cosine similarity to
      the query. Ties resolve to the lexicographically first candidate.
    - No candidate within max_dist: return the query unchanged.
"""

import sys
from pathlib import Path

# Default catalog: known estate + common model/repo names (extend freely).
DEFAULT_CATALOG = [
    "nemotron",
    "nemotron-3.5-super-vl",
    "nemotron-3.5-lightning-30b-a3b",
    "qwen3.5",
    "qwen3.6-35b",
    "qwen2.5",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "bge-m3",
    "all-MiniLM-L6-v2",
    "nomic-embed-text",
    "anthropic",
    "openrouter",
    "freeinference",
    "rhodochrosite",
    "mimetite",
]


def levenshtein(a: str, b: str) -> int:
    """Iterative Levenshtein edit distance (pure, no deps)."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(
                min(
                    prev[j] + 1,          # deletion
                    cur[j - 1] + 1,       # insertion
                    prev[j - 1] + (ca != cb),  # substitution
                )
            )
        prev = cur
    return prev[-1]


def _embed(texts: list[str]) -> list[list[float]]:
    """Load MiniLM (HF cache) and produce normalized 384-dim vectors."""
    from transformers import AutoModel, AutoTokenizer
    import torch

    cache = "/home/toxic/.cache/huggingface/hub/models--sentence-transformers--all-MiniLM-L6-v2/snapshots/1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
    tok = AutoTokenizer.from_pretrained(cache)
    model = AutoModel.from_pretrained(cache)
    model.eval()
    out: list[list[float]] = []
    with torch.no_grad():
        for t in texts:
            enc = tok(t, return_tensors="pt", padding=True, truncation=True)
            hidden = model(**enc).last_hidden_state
            masked = enc["attention_mask"].unsqueeze(-1) * hidden
            mean = masked.sum(1) / enc["attention_mask"].sum(1, keepdim=True)
            v = torch.nn.functional.normalize(mean, p=2, dim=1)[0].detach().numpy()
            out.append([float(x) for x in v])
    return out


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def correct(query: str, catalog: list[str] | None = None, max_dist: int = 1) -> str:
    q = query.strip()
    if not q:
        return query
    cat = catalog if catalog is not None else DEFAULT_CATALOG
    if q in cat:
        return q
    candidates = [c for c in cat if levenshtein(q.lower(), c.lower()) <= max_dist]
    if not candidates:
        return q
    if len(candidates) == 1:
        return candidates[0]
    # Embed-rank tiebreak: the candidate most similar to the query wins.
    try:
        vecs = _embed([q, *candidates])
    except Exception:
        return sorted(candidates)[0]
    qv = vecs[0]
    scored = sorted(
        ((_cosine(qv, v), c) for v, c in zip(vecs[1:], candidates)),
        key=lambda pair: (-pair[0], pair[1]),
    )
    return scored[0][1]


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("usage: typo-fix.py <query> [max_dist=1]", file=sys.stderr)
        return 2
    query = args[0]
    dist = int(args[1]) if len(args) > 1 else 1
    print(correct(query, max_dist=dist))
    return 0


if __name__ == "__main__":
    sys.exit(main())