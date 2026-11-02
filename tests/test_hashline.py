#!/usr/bin/env python3
"""hashline TDD suite — deterministic manifest contract.

Covers: emit→verify round-trip, drift detection, cat reconstruction,
root final-hash, SKIP_DIRS, CRLF normalization, deterministic re-emit,
missing-manifest errors.
"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

HASHLINE = Path(__file__).resolve().parent.parent / "hashline"

def run(*args, cwd=None, ok=True):
    r = subprocess.run([sys.executable, str(HASHLINE), *args],
                       capture_output=True, text=True, cwd=cwd)
    if ok and r.returncode != 0:
        raise AssertionError(f"hashline {' '.join(args)} failed ({r.returncode}):\n{r.stderr}")
    return r

class TestHashline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "tree"
        self.root.mkdir()
        (self.root / "a.txt").write_text("hello\nworld\n")
        (self.root / "b.py").write_text("def f():\n    return 1\n")
        self.manifest = Path(self.tmp.name) / "m.manifest"

    def tearDown(self):
        self.tmp.cleanup()

    def test_emit_verify_roundtrip_ok(self):
        r = run("emit", str(self.root), str(self.manifest))
        self.assertIn("final:", r.stdout)
        self.assertIn("files:", r.stdout)
        self.assertIn("lines:", r.stdout)
        rv = run("verify", str(self.manifest), str(self.root))
        self.assertIn("verify: OK", rv.stdout)

    def test_drift_detection_after_edit(self):
        run("emit", str(self.root), str(self.manifest))
        (self.root / "a.txt").write_text("hello\nchanged\n")
        rv = run("verify", str(self.manifest), str(self.root), ok=False)
        self.assertEqual(rv.returncode, 1)
        self.assertIn("DRIFT", rv.stdout)
        self.assertIn("old final:", rv.stdout)
        self.assertIn("new final:", rv.stdout)

    def test_cat_reconstructs_file(self):
        run("emit", str(self.root), str(self.manifest))
        r = run("cat", str(self.manifest), "a.txt")
        self.assertEqual(r.stdout, "hello\nworld\n")

    def test_cat_missing_path_errors(self):
        run("emit", str(self.root), str(self.manifest))
        r = run("cat", str(self.manifest), "nope.txt", ok=False)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no L records", r.stderr)

    def test_root_returns_final_hash(self):
        r = run("emit", str(self.root), str(self.manifest))
        final = next(l for l in r.stdout.splitlines() if l.startswith("final:")).split()[1]
        rr = run("root", str(self.manifest))
        self.assertEqual(rr.stdout.strip(), final)

    def test_skip_dirs_excluded(self):
        (self.root / "node_modules").mkdir()
        (self.root / "node_modules" / "junk.js").write_text("x\n")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "config").write_text("repo\n")
        run("emit", str(self.root), str(self.manifest))
        rr = run("cat", str(self.manifest), "node_modules/junk.js", ok=False)
        self.assertEqual(rr.returncode, 1)

    def test_crlf_normalized_but_raw_hash_distinct(self):
        (self.root / "crlf.txt").write_bytes(b"a\r\nb\r\n")
        run("emit", str(self.root), str(self.manifest))
        rv = run("verify", str(self.manifest), str(self.root))
        self.assertIn("verify: OK", rv.stdout)

    def test_reemit_is_deterministic(self):
        m2 = Path(self.tmp.name) / "m2.manifest"
        run("emit", str(self.root), str(self.manifest))
        run("emit", str(self.root), str(m2))
        r1 = run("root", str(self.manifest))
        r2 = run("root", str(m2))
        self.assertEqual(r1.stdout, r2.stdout)

    def test_verify_missing_manifest_errors(self):
        r = run("verify", str(self.manifest), str(self.root), ok=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no F record", r.stderr)

if __name__ == "__main__":
    unittest.main()