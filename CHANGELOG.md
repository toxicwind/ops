# Changelog

Auto-backfilled from git history 2026-11-02 (real commits only).

## 2026-11-02
- kairos shim: fix stale KAIROS_DIR -> olympus/products/kairos (dead ranch path, anomaly #73) (f8bbca6)

## 2026-11-01
- chore(pens-sweep): fold forward uncommitted tree state (2026-11-01T22:48:04-07:00) (a4d0bd5)
- feat(typo-fix): typo-tolerant model/repo search correction — edit-distance-1 + embed tiebreak (MiniLM, no new  (9748634)
- feat(cosmic): default search consumer — cosmic-search.py (Phase 2.9) (9f7fb4d)
- test(cosmic): Phase 2.8 TDD — search index path pinned (4/4 pass) (b3450a6)
- hashline: TDD suite (9 tests) — missing-manifest verify crashed (uncaught parse traceback); parse now yields e (456be98)
- feat(cosmic): local embed→qdrant ingest lane — MiniLM-L6-v2 (384-dim, HF cache, no external keys) (e1fc150)
- estate-tools MCP: estate_paper_search wired to canonical paper-poller race_papers.py (real pens path, not ghos (0df4c24)
- maximal-audit.sh: estate lease canary — exit 1 pages when ghost /home/toxic/estate exists (anomaly 48/85) (8098fff)
- manifest: regenerate to register netlink-listen (bin-verify ok; 36 pre-existing broken links unchanged) (a6a1576)
- chore: fold forward 75 dirty files onto main (parallel-writer WIP + estate-ops tooling) (1acda44)
- Merge remote-tracking branch 'origin/main' (80c59b9)
- netlink-listen: kernel TCP LISTEN probe (AF_NETLINK SOCK_DIAG, no ss); wire port-audit to it (4869193)

## 2026-10-31
- fix: lease guard loop event-driven (fs.watch, no sleep/timer) — kills unpaced fork-storm class (0e39454)

## 2026-10-30
- chore(eidos): commit-first — scaffold bunfig + infra drop-in env + rename sweep (everything is state; backup r (565e9d8)
- chore(eidos): apply bun-scaffold bunfig + infra drop-in env (qdrant/hindsight/kafka/redis) — eidos is the pare (1f2bc00)
- chore(eidos): apply bun-scaffold bunfig + infra drop-in env (qdrant/hindsight/kafka/redis) — eidos is the pare (7ca1a2d)

## 2026-10-29
- fix(maximal-audit): ESTATE default -> pens/estate (single-truth lease) + MAX -> barn/src (20e0b5b)
- fix(maximal-audit): MAX default -> barn/src canonical (ghost estate/src lease) (4e719d7)
- feat(estate-ops): reconcile fork — port barn copy uniques into canonical repo (a5a7957)
- chore(estate-ops): fold forward openfang->rig rename WIP (anomaly-49 cutover comment layer) (5e63b61)
- fix(estate-ops): self-locating bin-verify + manifest-gen paths post pen-reorg (355f872)

## 2026-10-28
- fix(manifest): secretsmith bin -> kryptos master (3600f56)
- refactor(estate): unify agent identity on rig (zero openfang) (8235abc)
- nim-kimi-sidecar: keyring-first NIM/NVIDIA key lookup (secretsmith SSOT) (da5879d)
- manifest: morphe links to pens/estate bridge (estate path retired) (cc94e0c)
- reconcile(estate): ESTATE_ROOT default -> pens/estate (estate is ABSENT per lease) (ed4d73e)
- lease(estate): /home/toxic/estate must be ABSENT (no symlink) — SSOT is pens/estate (c03a728)

## 2026-10-27
- feat(ops): fleet-audit-mcp — the estate's audit surfaces as MCP tools (87b6fae)
- feat(ops): fleet-tui — the estate fleet dashboard, terminal edition (234174b)
- feat(ops): estate-probe toolkit — direct-DNS, dork matrix, magic-byte sniffing (808920d)

## 2026-10-26
- retire(stoplight): delete the floaty HUD + all stoplight scripts from the canonical tree (b773055)
- fix(manifest): regenerate the bin manifest after the relocation relinks (695e8ba)
- fix(git-credential): dispatch the credential-helper protocol BEFORE wrapper mode (7bcbc58)
- chore: fold untracked pairs-gen.ts (rename-roundup pair generation helper) (b8512a2)
- fix(bins): hephaistos canonical home is ergasterion/hephaistos — third path layer (f70a0a4)
- fix(bins): delendai inner dir renamed hephaistos — second path layer (0b6a547)
- fix(bins): repoint delend-* family at ergane/hephaistos (corral moved to olympus workshop org) (b7ce71e)
- feat(eval-shim): agentic — escalate unknown command failures to a corral agent (diagnose+fix+retry once); sing (bde64f8)
- feat: eval-shim self-healing wrapper (stale-lock, unborn-repo, credential-pure) + git-credential.ts canonical  (ae5ceaa)
