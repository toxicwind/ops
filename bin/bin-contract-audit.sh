#!/usr/bin/env bash
# bin-contract-audit.sh — periodic canary for the AGENTS.md Layout contract.
# Runs both verifiers; FAIL exits nonzero so the pitchfork daemon goes unhealthy
# and (with alerting) pages. This is the "boot-time audit hook" for bins:
# products must own entrypoints; bins must point at them; nothing may drift.
set -uo pipefail
Pens="${ESTATE_ROOT:-/home/toxic/pens/Pens}"
PENS="${PENS_ROOT:-/home/toxic/pens}"
fails=0
echo "[bin-contract] $(date -Is)"
if ! bash "$Pens/bin/bin-verify.sh" >/tmp/bin-contract-Pens.log 2>&1; then
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