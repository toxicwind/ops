# Pens/bin → pens Classification Map (Phase 2a — Final)

**Source**: /home/toxic/pens/Pens/products/Pens-ops/ (162 entries, 0 remaining after move)
**Target**: /home/toxic/pens/Pens/products/Pens-ops/ (161 files + 4 subdirs moved)
**Branch**: reorg/phase-0-1

## Summary

| Category | Count |
|---|---|
| Files moved to Pens-ops | 157 |
| Directories moved (tests/, tmp-reaper/) | 2 |
| Archive backups preserved | 0 (all moved then deleted from Pens/bin) |
| Directories removed (empty) | 5 (__pycache__, model-audit.out, model-audit-max.out, tests, tmp-reaper) |
| Pens/bin entries remaining | 0 |
| ~/.local/bin entries repointed | 13 |

## Phase 2a Actions Taken

### 1. Created pens/Pens/products/Pens-ops/ product holding
- Structure: `Pens-ops/` with scratch/, tests/, tmp-reaper/ subdirs
- All 157 Pens/bin files copied here with preserved permissions

### 2. Removed Pens/bin/ contents
- All files deleted from /home/toxic/pens/Pens/products/Pens-ops/
- All subdirectories (tests/, tmp-reaper/, __pycache__, model-audit.out/, model-audit-max.out/) removed
- /home/toxic/pens/Pens/products/Pens-ops/ is now an empty directory (ready for deletion in Phase 3)

### 3. Repointed ~/.local/bin entries (13 total)
| Entry | Old Target | New Target |
|---|---|---|
| audio-probe | Pens/bin/audio-probe | pens/Pens/products/Pens-ops/audio-probe |
| pitchfork | Pens/bin/pitchfork | pens/Pens/products/Pens-ops/pitchfork |
| set-audio | Pens/bin/set-audio | pens/Pens/products/Pens-ops/set-audio |
| ffs | copy (Pens/bin) | pens/Pens/products/Pens-ops/ffs |
| hashline | copy (Pens/bin) | pens/Pens/products/Pens-ops/hashline |
| io-rate-reaper | copy (Pens/bin) | pens/Pens/products/Pens-ops/io-rate-reaper |
| iowait-gate | copy (Pens/bin) | pens/Pens/products/Pens-ops/iowait-gate |
| isleep | copy (Pens/bin) | pens/Pens/products/Pens-ops/isleep |
| kappa-config-audit | copy (Pens/bin) | pens/Pens/products/Pens-ops/kappa-config-audit |
| oracle-judge | copy (Pens/bin) | pens/Pens/products/Pens-ops/oracle-judge |
| orphan-reaper | copy (Pens/bin) | pens/Pens/products/Pens-ops/orphan-reaper |
| safe-rg | copy (Pens/bin) | pens/Pens/products/Pens-ops/safe-rg |
| saturation-watchdog | copy (Pens/bin) | pens/Pens/products/Pens-ops/saturation-watchdog |

### 4. Updated pitchfork.toml
- 8 `exec /home/toxic/pens/Pens/products/Pens-ops/...` → `exec /home/toxic/pens/Pens/products/Pens-ops/...`
- 1 comment reference updated
- 0 remaining Pens/bin references

### 5. Updated manifest.yaml
- Header updated: Pens/bin → pens/Pens/products/Pens-ops
- Paths repointed throughout

## Gate Verification

```
Pens/bin remaining entries: 0
Pens-ops file count: 161
pitchfork.toml Pens/bin refs: 0
```

## Stubs
No deliberate stubs left at Pens/bin paths — all entries moved to Pens-ops.
The empty Pens/bin/ directory remains for deletion in Phase 3.

## Dependencies
- pitchfork.toml daemon `run` directives updated for:
  - Pens-reconcile (line 306)
  - bin-contract-audit.sh (line 522)
  - maximal-audit.sh (line 529)
  - kappa-serve.sh (line 564)
  - skopos-floaty.sh (line 572)
  - claim-port (line 644)
  - kitty-mcp-instance.sh (line 681)
  - nim-kimi-sidecar.py (line 836)
  - tmp-reaper/reap-loop.sh (line 1197)
