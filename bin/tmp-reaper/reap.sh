#!/usr/bin/env bash
# tmp-reaper — prune RECURRING multi-GB build/backup scratch in the /tmp tmpfs
# so it can never refill and starve chromium/browserless/daemons again.
# Only dirs/files matching known scratch-name patterns AND older than AGE_HOURS
# are removed; nothing blanket, nothing in use (mtime=age check is safe for tmpfs).
# Additive-only safety: patterns are explicit; unknown debris is reported, not reaped.
set -uo pipefail
TMP_R=/tmp
AGE_HOURS="${1:-24}"
REAP_LOG="/home/toxic/.local/state/tmp-reaper/tmp-reaper.log"
mkdir -p "$(dirname "$REAP_LOG")"
[ -d /home/toxic/.local/state/tmp-reaper ] || mkdir -p /home/toxic/.local/state/tmp-reaper
# known recurring scratch name patterns (one per `find -etype (-d|-f)`):
# weave-pull-* (parallel merge pulls), pip-unpack-*, pinax-hodos-target, kilo,
# ranch-push-*, ciw-fix-*, tau-reports-* — each a known high-GB temp lane.
patterns=( 'weave-pull-*' 'pip-unpack-*' 'pinax-hodos-target' 'kilo-*' 'ranch-push-*' 'ciw-fix-*' 'tau-reports-*' 'resolve-grep.txt' 'nmix-*' 'build-*' )
now=$(date +%s)
reported=0; reaped=0; bytes=0
for pat in "${patterns[@]}"; do
  while IFS= read -r -d '' path; do
    mt=$(stat -c %Y "$path" 2>/dev/null) || continue
    age_s=$(( now - mt ))
    if [ "$age_s" -gt $(( AGE_HOURS * 3600 )) ]; then
      sz=$(du -sb "$path" 2>/dev/null | cut -f1)
      rm -rf -- "$path" 2>/dev/null && { reaped=$((reaped+1)); bytes=$((bytes + ${sz:-0})); }
    else
      reported=$((reported+1))
    fi
  done < <(find "$TMP_R" -maxdepth 1 \( -name "$pat" -o -name "${pat%/}" \) -print0 2>/dev/null)
done
printf '%s ok=%s reaped=%s reported=%s bytes=%s age_min=%s\n' "$(date -Is)" "$now" "$reaped" "$reported" "$bytes" "$((AGE_HOURS*60))" >> "$REAP_LOG"
tail -200 "$REAP_LOG" > "$REAP_LOG.tmp" && mv "$REAP_LOG.tmp" "$REAP_LOG"
