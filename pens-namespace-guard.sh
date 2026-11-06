#!/usr/bin/env bash
# pens-namespace-guard — every pen with a pitchfork.toml MUST be a registered
# pitchfork namespace in ~/.config/pitchfork/config.toml.
#
# Why: the supervisor discovers pens from ITS config's [namespaces.*] table.
# A pen with pitchfork.toml but no namespace entry is invisible to pitchfork —
# its daemons can't be started/stopped/observed by the normal toolchain, and
# stale snapshots (e.g. a /tmp config copy) become the only truth (anomaly #6
# class; found 2026-11-05 when agentic-moment was invisible and a tmp ghost
# served old daemon definitions).
#
# Exit 0 = all pens registered (or config file missing = not our supervisor).
# Exit 1 = drift: lists the unregistered pens.
set -uo pipefail

CONFIG="${PITCHFORK_CONFIG:-$HOME/.config/pitchfork/config.toml}"
PENS_ROOT="${PENS_ROOT:-$HOME/pens}"

[ -f "$CONFIG" ] || { echo "pens-namespace-guard: no supervisor config at $CONFIG — skipping"; exit 0; }
[ -d "$PENS_ROOT" ] || { echo "pens-namespace-guard: no pens root at $PENS_ROOT — skipping"; exit 0; }

fail=0
for pen_toml in "$PENS_ROOT"/*/pitchfork.toml; do
  [ -f "$pen_toml" ] || continue
  pen=$(basename "$(dirname "$pen_toml")")
  if ! grep -qE "^\[namespaces\.$pen\]" "$CONFIG"; then
    echo "DRIFT: pen '$pen' has pitchfork.toml but no [namespaces.$pen] in $CONFIG"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "pens-namespace-guard: OK — all pens registered"
fi
exit $fail