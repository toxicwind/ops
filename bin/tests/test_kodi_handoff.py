#!/usr/bin/env python3
"""Tests for hestia-handoff box_port() — the port SSOT resolution.

Proves the 2026-11-05 port migration (hestia 246 -> 25270, athena 225 -> 8080):
  - hestia by IP (10.0.0.246)  -> 25270
  - hestia by name (hestia)    -> 25270
  - athena by IP (10.0.0.225)  -> 8080
  - any other host             -> 8080 (legacy default)

Stdlib unittest only. Run on yote:
    python3 bin/tests/test_hestia_handoff.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

BIN = Path(__file__).resolve().parent.parent  # estate-ops/bin
ROOT = BIN.parent  # estate-ops
TOOL = ROOT / "kodi-handoff"


def load_tool():
    from importlib.machinery import SourceFileLoader
    loader = SourceFileLoader("kodi_handoff", str(TOOL))
    spec = importlib.util.spec_from_loader("kodi_handoff", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


kodi_handoff = load_tool()


class BoxPortTest(unittest.TestCase):
    def test_hestia_by_ip_uses_25270(self):
        self.assertEqual(kodi_handoff.box_port("10.0.0.246"), 25270)

    def test_hestia_by_name_uses_25270(self):
        self.assertEqual(kodi_handoff.box_port("hestia"), 25270)

    def test_athena_by_ip_uses_8080(self):
        self.assertEqual(kodi_handoff.box_port("10.0.0.225"), 8080)

    def test_unknown_host_defaults_to_8080(self):
        self.assertEqual(kodi_handoff.box_port("10.0.0.77"), 8080)


if __name__ == "__main__":
    unittest.main()