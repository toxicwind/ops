#!/usr/bin/env python3
"""test_typo_fix.py — TDD the typo-tolerant model/repo search correction
(max-plan 5.30 typo-fix docket). Pins REAL behavior of bin/typo-fix.py."""

import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.abspath(os.path.join(HERE, "..", "..", "bin", "typo-fix.py"))

spec = importlib.util.spec_from_file_location("typo_fix", BIN)
assert spec is not None and spec.loader is not None
MOD = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MOD)


class TypoFixTest(unittest.TestCase):
    def test_transposition_corrects_nemotron(self) -> None:
        # Docket prove-case: 'nemoctron' is a distance-1 swap of 'nemotron'.
        self.assertEqual(MOD.correct("nemoctron"), "nemotron")

    def test_exact_member_unchanged(self) -> None:
        # Correct names must never be mangled.
        self.assertEqual(MOD.correct("nemotron"), "nemotron")
        self.assertEqual(MOD.correct("qwen3.5"), "qwen3.5")

    def test_substitution_corrects_qwen(self) -> None:
        self.assertEqual(MOD.correct("qwen3.6"), "qwen3.5")

    def test_insertion_corrects_flash(self) -> None:
        self.assertEqual(MOD.correct("deepseek-v4-flsh"), "deepseek-v4-flash")

    def test_unknown_within_distance_uses_tiebreak_embed(self) -> None:
        # 'bge-m4' is distance-1 from BOTH 'bge-m3' and 'nomic-embed-text'
        # (no); embed tiebreak must pick the semantic winner without network.
        self.assertEqual(MOD.correct("bge-m4"), "bge-m3")

    def test_no_candidate_returns_query_unchanged(self) -> None:
        self.assertEqual(MOD.correct("completely-unknown-model-xyz"), "completely-unknown-model-xyz")

    def test_empty_query_passthrough(self) -> None:
        self.assertEqual(MOD.correct(""), "")
        self.assertEqual(MOD.correct("  "), "  ")

    def test_custom_catalog_respected(self) -> None:
        cat = ["foo-model", "bar-model"]
        self.assertEqual(MOD.correct("fo-model", catalog=cat), "foo-model")
        self.assertEqual(MOD.correct("bar-model", catalog=cat), "bar-model")


if __name__ == "__main__":
    unittest.main(verbosity=2)