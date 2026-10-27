#!/usr/bin/env python3
"""Tests for estate-probe.

Live-world coverage: every technique is exercised against the REAL
network / the REAL filesystem, not a mock. The DNS test talks to 8.8.8.8,
the sweep test opens a real socket, the dork test asserts the matrix
shape, and the magic test writes real files with lying extensions.
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(HERE, "..", "bin", "estate-probe")

sys.path.insert(0, os.path.join(HERE, "..", "bin"))
import importlib.util

spec = importlib.util.spec_from_loader(
    "estate_probe",
    importlib.machinery.SourceFileLoader("estate_probe", PROBE),
)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class TestMagic(unittest.TestCase):
    def test_mp3_id3_header_detected(self):
        self.assertTrue(probe.sniff_mp3(b"ID3\x03\x00\x00\x00\x00\x00\x00"))

    def test_mp3_frame_sync_detected(self):
        self.assertTrue(probe.sniff_mp3(b"\xff\xfb\x90\x00"))

    def test_not_mp3(self):
        self.assertFalse(probe.sniff_mp3(b"hello world"))
        self.assertFalse(probe.sniff_mp3(b""))

    def test_magic_kinds(self):
        self.assertEqual(probe.sniff(b"ID3\x03\x00"), "audio/mpeg")
        self.assertEqual(probe.sniff(b"\x89PNG\r\n\x1a\n"), "image/png")
        self.assertEqual(probe.sniff(b"%PDF-1.7"), "application/pdf")
        self.assertEqual(probe.sniff(b"\x7fELF\x02"), "application/x-elf")
        self.assertEqual(probe.sniff(b"plain text"), "text/plain (utf-8)")
        self.assertEqual(probe.sniff(b""), "empty")

    def test_live_scan_flags_mislabeled_file(self):
        with tempfile.TemporaryDirectory() as d:
            liar = os.path.join(d, "notes.txt")
            with open(liar, "wb") as fh:
                fh.write(b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + b"\x00" * 512)
            rc = probe.magic_scan([liar])
            self.assertEqual(rc, 1, "a lying extension must be reported")

    def test_live_scan_accepts_honest_files(self):
        with tempfile.TemporaryDirectory() as d:
            honest = os.path.join(d, "readme.txt")
            with open(honest, "w") as fh:
                fh.write("hello\n")
            self.assertEqual(probe.magic_scan([honest]), 0)


class TestDork(unittest.TestCase):
    def test_matrix_shape(self):
        m = probe.dork_matrix("toxicwind ranch", list(probe.DORK_DATES))
        self.assertEqual(len(m), len(probe.DORK_TEMPLATES) * len(probe.DORK_DATES))
        self.assertEqual(len(m), 32)

    def test_matrix_is_distinct(self):
        m = probe.dork_matrix("toxicwind ranch", list(probe.DORK_DATES))
        self.assertEqual(len(set(m)), len(m), "every query must be distinct")

    def test_every_query_carries_the_base(self):
        for q in probe.dork_matrix("toxicwind ranch", list(probe.DORK_DATES)):
            self.assertIn("toxicwind ranch", q)

    def test_cli_emits_matrix(self):
        out = subprocess.run(
            [sys.executable, PROBE, "dork", "--base", "toxicwind ranch"],
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(out.returncode, 0)
        self.assertEqual(len(out.stdout.strip().splitlines()), 32)


class TestDns(unittest.TestCase):
    def test_live_resolution_against_public_resolver(self):
        # A real query to 8.8.8.8 — no mocks.
        res = probe._dns_query("github.com", "8.8.8.8", timeout=5.0)
        self.assertTrue(res["answers"], "no answer from 8.8.8.8")
        for a in res["answers"]:
            self.assertRegex(a, r"^\d+\.\d+\.\d+\.\d+$")

    def test_live_sweep_banner(self):
        rc = probe.dns_sweep(["127.0.0.1:1"])  # closed port: must not raise
        self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
