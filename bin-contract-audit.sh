#!/usr/bin/env bash
# bin-contract-audit.sh — periodic canary for the AGENTS.md Layout contract.
# Runs both verifiers; FAIL exits nonzero so the pitchfork daemon goes unhealthy
# and (with alerting) pages. This is the "boot-time audit hook" for bins:
# products must own entrypoints; bins must point at them; nothing may drift.
set -uo pipefail
ESTATE="${ESTATE_ROOT:-/home/toxic/estate}"
PENS="${PENS_ROOT:-/home/toxic/pens}"
fails=0

# Estate single-truth lease (2026-10-28, hardened): /home/toxic/estate must
# NOT exist in ANY form (no symlink, no dir, no file). pens/estate is the
# only estate path; everything resolves through paths/re-points, never a
# compat shim. If it's ever re-cloned/symlinked, edits land in a ghost path
# while the supervisor loads pens/estate — daemons silently go down.
if [ -L "$ESTATE" ] || [ -e "$ESTATE" ] || [ -d "$ESTATE" ]; then
  echo "LEASE FAIL: $ESTATE exists (form: $(stat -c %F "$ESTATE" 2>/dev/null || echo unknown)) — must be absent; SSOT is $PENS/estate"
  fails=1
else
  echo "lease ok: $ESTATE absent (single-truth pens/estate)"
fi
echo "[bin-contract] $(date -Is)"
if ! bash "$PENS/barn/estate-ops/bin/bin-verify.sh" >/tmp/bin-contract-estate.log 2>&1; then
  echo "ESTATE FAIL — see /tmp/bin-contract-estate.log"
  grep '^FAIL' /tmp/bin-contract-estate.log | head -5
  fails=1
else
  echo "estate/bin-verify: $(grep -c '^ok' /tmp/bin-contract-estate.log) ok"
fi
if ! bash "$PENS/audit-links.sh" >/tmp/bin-contract-pens.log 2>&1; then
  echo "PENS FAIL — see /tmp/bin-contract-pens.log"
  grep '^FAIL' /tmp/bin-contract-pens.log | head -5
  fails=1
else
  echo "pens/audit-links: $(grep -c '^ok' /tmp/bin-contract-pens.log) ok"
fi
exit "$fails"