#!/usr/bin/env bash
# argos-pens-sweep — index EVERY product repo in the pens tree into argos.
#
# Why per-product: pens/<pen>/.gitignore kitchen-sinks (`*` ignores
# everything; product checkouts are auto-ignored peers, never submodules),
# so a pen-level autoindex respects gitignore and starves to ~nothing.
# Product repos have sane .gitignore + argos's built-in vendor ignores
# (node_modules/, target/, dist/, build/, ...) apply — no flag games needed.
#
# One --prefix per product: pens-<pen>-<product> (argos prefixes are
# [a-z0-9-]). The shared node at 127.0.0.1:25254 (mcp argos URL).
#
# Data-file poison guard: .har/.pcap/.parquet/.sqlite/.db become existence-only
# stubs (the v1 sweep wedged 13+ minutes parsing a 10MB HAR).
# Embedding lane: freeinference.org bge-m3 → 1024-dim. The argos node (proxy
# backend, ARGOS_EMBEDDING_API_KEY injected by pitchfork) confirms width 1024,
# but `argos autoindex` creates the semantic_text `body` field with NO explicit
# dimensions → server hardcodes 384 → mapping mismatch (engine rejects ingest).
# So: pre-create each product's `-docs` index with `body semantic_text
# dimensions:1024` (freeinference's fixed width) before autoindex, and use
# --fresh so a stale 384-dim resume journal never poisons the run. Verified
# 2026-11-08: autoindex --fresh over a pre-created 1024 index → 56 records live.
# Per-repo timeout: 240s hard ceiling so one repo can't stall 325.
#
# Idempotent: re-running refreshes unchanged-file ids in place.
set -u
URL="${ARGOS_URL:-http://127.0.0.1:25254}"
BIN="${ARGOS_BIN:-$HOME/.local/bin/argos}"
LIST="${1:-/tmp/products.txt}"
LOG="${ARGOS_SWEEP_LOG:-$HOME/.argos-data/pens-sweep.log}"
mkdir -p "$(dirname "$LOG")"
n=0; ok=0; fail=0
while IFS= read -r repo; do
	[ -d "$repo" ] || continue
	case "$repo" in
		*/archive/*|*/.archive*) continue ;;
	esac
	if [ "$repo" = "/home/toxic/pens" ]; then pen="root"; else pen=$(printf '%s' "$repo" | sed 's|/home/toxic/pens/||; s|/.*||'); fi
	name=$(basename "$repo")
	prefix=$(printf 'pens-%s-%s' "$pen" "$name" | tr '[:upper:]_' '-' | tr -s '-' | sed 's/[^a-z0-9-]//g; s/-*$//')
	# Pre-create the semantic_text field at freeinference's 1024 width (see header).
	# autoindex targets `<prefix>-docs`; ensure it exists at 1024 so the server
	# does not fall back to its built-in 384.
	curl -sS -X PUT "$URL/${prefix}-docs" \
		-H 'Content-Type: application/json' \
		-d '{"mappings":{"properties":{"body":{"type":"semantic_text","dimensions":1024}}},"settings":{"index":{"argos_ingest_shards":1}}}' \
		>> "$LOG" 2>&1
	n=$((n + 1))
	if timeout 240 "$BIN" autoindex "$repo" --url "$URL" --prefix "$prefix" --fresh \
		--stub '*.har' --stub '*.pcap' --stub '*.parquet' --stub '*.sqlite' --stub '*.db' \
		>> "$LOG" 2>&1
	then
		ok=$((ok + 1)); printf 'OK   %s\n' "$repo" >> "$LOG"
	else
		fail=$((fail + 1)); printf 'TIMEOUT/FAIL %s\n' "$repo" >> "$LOG"
	fi
done < "$LIST"
printf 'sweep done: %d repos, %d ok, %d fail\n' "$n" "$ok" "$fail" >> "$LOG"
