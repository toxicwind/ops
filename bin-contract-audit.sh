#!/usr/bin/env bash
# bin-contract-audit.sh — periodic canary for the AGENTS.md Layout contract.
# Runs both verifiers; FAIL exits nonzero so the pitchfork daemon goes unhealthy
# and (with alerting) pages. This is the "boot-time audit hook" for bins:
# products must own entrypoints; bins must point at them; nothing may drift.
set -uo pipefail
Pens="${ESTATE_ROOT:-/home/toxic/pens/Pens}"
PENS="${PENS_ROOT:-/home/toxic/pens}"
fails=0

# Pens single-truth lease (2026-10-28, hardened): /home/toxic/pens/Pens must
# NOT exist in ANY form (no symlink, no dir, no file). pens/Pens is the
# only Pens path; everything resolves through paths/re-points, never a
# compat shim. If it's ever re-cloned/symlinked, edits land in a ghost path
# while the supervisor loads pens/Pens — daemons silently go down.
if [ -L "$Pens" ] || [ -e "$Pens" ] || [ -d "$Pens" ]; then
  echo "LEASE FAIL: $Pens exists (form: $(stat -c %F "$Pens" 2>/dev/null || echo unknown)) — must be absent; SSOT is $PENS/Pens"
  fails=1
else
  echo "lease ok: $Pens absent (single-truth pens/Pens)"
fi
echo "[bin-contract] $(date -Is)"
if ! bash "$PENS/barn/Pens-ops/bin/bin-verify.sh" >/tmp/bin-contract-Pens.log 2>&1; then
  echo "Pens FAIL — see /tmp/bin-contract-Pens.log"
  grep '^FAIL' /tmp/bin-contract-Pens.log | head -5
  fails=1
else
  echo "Pens/bin-verify: $(grep -c '^ok' /tmp/bin-contract-Pens.log) ok"
fi
if ! bash "$PENS/audit-links.sh" >/tmp/bin-contract-pens.log 2>&1; then
  echo "PENS FAIL — see /tmp/bin-contract-pens.log"
  grep '^FAIL' /tmp/bin-contract-pens.log | head -5
  fails=1
else
  echo "pens/audit-links: $(grep -c '^ok' /tmp/bin-contract-pens.log) ok"
fi
exit "$fails"