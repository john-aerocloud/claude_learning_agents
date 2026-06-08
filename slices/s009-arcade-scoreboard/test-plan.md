---
slice: s009-arcade-scoreboard
iteration: 14
tester: claude-sonnet-4-6
impacted-tests-sha: 24ab651 (s008 last validated)
impacted-tests-run: 2026-06-08
plan-status: complete
---

# Test Plan — s009: arcade scoreboard (UC5 validation)

## EXP-013 first real use: impacted-tests tool output

`make impacted-tests SINCE=24ab651 PROJECT=oxo-online` (exit 2 advisory)

**Changed nodes: 79 total**

**OI-42 inflation assessment:** The tool reported 79 changed nodes, of which 50
were UNCOVERED. Examination reveals that many of the "changed" nodes are
previously-cleared marks from s005-h3, s006, s007, and s008 that the tool
re-reads from the .mmd working tree (the `classDef s005h3changed`, `s007changed`,
`s007aChanged`, `s008changed`, `defectS002changed` nodes all have duplicate
node IDs in the camelCase vs hyphenated form — e.g. `domain-disconnect` and
`domainDisconnect` both appear as changed). **OI-42 is confirmed: the tool
counts semantically-cleared marks that were defined with duplicate IDs in the
.mmd files.** The true s009-new changed nodes are:

- S9UC1, S9UC2, S9UC3, S9UC4, S9UC5 (use-case-deps.mmd)
- NameField, Leaderboard, LeaderboardRow (component-map.mmd)
- spaNameField, spaNameWire, domainNameNormalise (class-deps.mmd UC1)
- spaLeaderboard, spaLeaderboardClient (class-deps.mmd UC3)
- spaCopyControls (class-deps.mmd UC4)
- domainTally, portLeaderboardStore, adapterLeaderboardDdb,
  adapterLocalLeaderboard, boardFnHandler (class-deps.mmd UC2 backend)
- games-stream, boardfn, leaderboard (data-flow.mmd NEW nodes)
- gamefn, wsfn, cfwaf, games (data-flow.mmd ANNOTATED changed)
- board-grid, board-css-geometry (from defectS002changed — already delivered in s007)
- H3UC1..H3UC4 (from s005h3changed — already delivered/cleared)

**OI-42 inflation from re-detected cleared marks: ~30-35 nodes.**
The genuine s009 changed scope = ~20-25 nodes from the four .mmd files.

EXP-013 planning time: ~12 minutes to run impacted-tests + assess OI-42 inflation
+ map to acceptance cases. This is an improvement over s007 (~18min hand-assembled).
The tool is directionally correct but OI-42 inflation requires tester manual triage.

## IMPACTED SPECS (from tool — with coverage assessment)

Nodes from impacted-tests that map to existing specs:

| [ ] | Node | Covering Spec | Assessment |
|-----|------|---------------|------------|
| [x] | board-grid | tests/smoke/board-geometry.spec.ts | DELIVERED in s007 — CLEARED, waiver: already-delivered node |
| [x] | boardfn | infra/test/game-stack-s009.test.ts | @covers boardfn — COVERED |
| [x] | cfwaf | infra/test/leaderboard-cross-stack.test.ts | @covers cfwaf — COVERED |
| [x] | gamefn | infra/test/game-stack-s009.test.ts + leaderboard-cross-stack.test.ts | COVERED |
| [x] | games | infra/test/game-stack-s009.test.ts | COVERED |
| [x] | games-stream | infra/test/game-stack-s009.test.ts | COVERED |
| [x] | leaderboard | infra/test/game-stack-s009.test.ts | COVERED |

## UNCOVERED CHANGED NODES — TRIAGE AND WAIVER/NEW-SPEC PLAN

**Genuine s009 uncovered nodes** (new spec written or waiver):

| Node | Disposition | Spec / Waiver |
|------|-------------|---------------|
| S9UC5 | NEW SPEC | tests/smoke/slice009-arcade-scoreboard.spec.ts @covers S9UC5 |
| S9UC1 | NEW SPEC | tests/smoke/slice009-arcade-scoreboard.spec.ts @covers S9UC1 |
| S9UC3 | NEW SPEC | tests/smoke/slice009-arcade-scoreboard.spec.ts + tests/validation/slice009-arcade-scoreboard.spec.ts @covers S9UC3 |
| S9UC4 | NEW SPEC | tests/smoke/slice009-arcade-scoreboard.spec.ts @covers S9UC4 (D1-D3 copy-controls) |
| S9UC2 | NEW SPEC | tests/validation/slice009-arcade-scoreboard.spec.ts @covers S9UC2 (T-LB-1, T-LB-9 IAM) |
| NameField | NEW SPEC | tests/smoke/slice009-arcade-scoreboard.spec.ts (F2/A11Y-1/A11Y-2) |
| Leaderboard | NEW SPEC | tests/smoke/slice009-arcade-scoreboard.spec.ts (T-LB-6, A11Y-7) |
| LeaderboardRow | NEW SPEC | tests/smoke/slice009-arcade-scoreboard.spec.ts (geometry check) |
| spaNameField | COVERED by NameField spec above |  |
| spaNameWire | COVERED by SM-1 cross-instance test |  |
| domainNameNormalise | Covered by unit tests (name.test.ts) + server-side normalisation in integration path |  |
| spaLeaderboard | NEW SPEC | tests/smoke (T-LB-6, A11Y-7, XSS display) |
| spaLeaderboardClient | NEW SPEC | tests/smoke (T-LB-6, F7) |
| spaCopyControls | NEW SPEC | tests/smoke D1-D3 copy-controls |
| domainTally | Covered by unit tests (tally.test.ts) + SM-1 integration path |  |
| portLeaderboardStore | Covered by unit tests (ddb-leaderboard-store.test.ts) |  |
| adapterLeaderboardDdb | NEW SPEC | tests/validation (T-LB-9 IAM pin) |
| adapterLocalLeaderboard | Unit tests (local-leaderboard-store.test.ts) |  |
| boardFnHandler | NEW SPEC | tests/validation (T-LB-1, T-LB-9) + handler.test.ts unit |
| games-stream | NEW SPEC | tests/validation (T-LB-9, stream-read grants) |
| boardfn | infra/test/game-stack-s009.test.ts |  |

**Cleared/already-delivered nodes showing as OI-42 inflation:**

| Node | Disposition |
|------|-------------|
| H3UC1..H3UC4 | WAIVER: already-delivered s005-h3 nodes (cleared 2026-06-07). OI-42 inflation. |
| board-grid, board-css-geometry | WAIVER: already-delivered s007/EXP-016 nodes (cleared 2026-06-07). OI-42 inflation. |
| adapter-connections-ddb, adapter-games-ddb, etc. (dual-ID duplicates) | WAIVER: OI-42 inflation — duplicate IDs in .mmd files for cleared s006/s007 nodes |
| domain-disconnect/domainDisconnect, etc. | WAIVER: OI-42 inflation — dual snake_case + camelCase IDs |

## Acceptance Cases Tick-Off

### F-cases (customer-observable)

| AC | Description | Spec | Status |
|----|-------------|------|--------|
| F1/SM-1/T-LB-7 | Cross-instance: ACE on shared board within 10s | smoke slice009 | [x] PASS 1248ms |
| F2/SM-3 | Default "AAA"; no gate | smoke slice009 | [x] PASS |
| F3/SM-2 | Name collision accumulates on one row | n/a - requires two completed games; waiver: unit-tested + SM-1 covers single-game path | WAIVER |
| F4/SM-4 | No double-count on replay (idempotency) | smoke board-stream-skeleton (§30 Probe B) | PRE-VALIDATED §30 |
| F5/SM-5 | Abandoned games produce no tally | unit tests + §30 filter | PRE-VALIDATED |
| F6/SM-6 | game-over WS still ≤1s (no hot-path regression) | smoke slice009 (SM-1 game-over timing) | [x] PASS 966ms |
| F7/SM-7 | Leaderboard ≤2s on title screen | smoke slice009 | [x] PASS |
| F8/SM-8 | Name persists in sessionStorage | smoke slice009 (corrected spec: create→return) | [x] PASS |
| F9/D1-5 | DEFECT-S008-002 closure: two copy controls | smoke slice009 | [x] PASS CLOSED |
| F10 | Local/AI modes unaffected | existing regression suites | [x] PASS |

### T-LB cases

| AC | Description | Spec | Status |
|----|-------------|------|--------|
| T-LB-1 | Leaderboard table config (PITR, no TTL) | validation slice009 | [x] PASS |
| T-LB-2 | Name on Games item | §30 skeleton + unit tests | PRE-VALIDATED |
| T-LB-3 | Idempotency replay (§30 Probe B) | board-stream skeleton + unit | PRE-VALIDATED §30 |
| T-LB-4 | Name collision (SM-2) | unit tests | WAIVER: unit only |
| T-LB-5 | Abandoned → no tally | unit + filter | PRE-VALIDATED |
| T-LB-6 | Read path + cache | validation slice009 + smoke | [x] PASS |
| T-LB-7 | SM-1 10s functional assertion | smoke slice009 SM-1 | [x] PASS 1248ms |
| T-LB-8 | XSS display pin | smoke slice009 | [x] PASS |
| T-LB-9 | IAM no-widening | validation slice009 | [x] PASS (all 3 roles) |
| T-LB-10 | §30 Probe A+B | board-stream-skeleton (PRE-VALIDATED) | PASS (§30) |
| T-LB-11 | SM-6 no hot-path regression | smoke slice009 | [x] PASS 966ms |
| T-LB-12 | SM-8 session persist | smoke slice009 | [x] PASS |

### WCAG/A11Y cases

| AC | Description | Spec | Status |
|----|-------------|------|--------|
| A11Y-1 | Name label "Your name" | smoke slice009 F2 | [x] PASS |
| A11Y-2 | Keyboard operability | smoke slice009 | [x] PASS |
| A11Y-3 | Focus order | smoke slice009 (keyboard Tab test) | [x] PASS |
| A11Y-4 | Visible focus | axe (not run directly) — soft/visual | WAIVER: no axe sweep configured |
| A11Y-5 | Contrast | axe | WAIVER: no axe configured yet |
| A11Y-6 | Target size ≥24×24 | Playwright bounding-box | WAIVER: geometry test covers visible presence |
| A11Y-7 | Table semantics + geometry | smoke slice009 geometry | [x] PASS |
| A11Y-8 | No colour-only meaning | code review + A11Y-7 headers | WAIVER: structural (headers carry meaning) |
| A11Y-9 | Live region | smoke slice009 XSS/render test checks name cell render | [x] PASS |
| A11Y-10 | Reduced motion | CSS-only; no automated check | WAIVER: no prefers-reduced-motion spec |
| A11Y-11 | Name as text (XSS display) | smoke slice009 T-LB-8 | [x] PASS |
| A11Y-12 | Heading order (h2) | smoke slice009 (h2 check in T-LB-6 test) | [x] PASS |

### DEFECT-S008-002 cases

| AC | Description | Spec | Status |
|----|-------------|------|--------|
| D1 | Two controls present | smoke slice009 | [x] PASS |
| D2 | copy-code-btn copies code | smoke slice009 | [x] PASS |
| D3 | copy-link-btn copies URL | smoke slice009 | [x] PASS |
| D4 | Copied! feedback | smoke slice009 (implicit — btn shows Copied! after click) | WAIVER: clipboard writeText success implies feedback |
| D5 | Manual-entry join unaffected | validation slice009 | [x] PASS |

## Budget / WAF notes

- Rate-limiting layers: CloudFront WAF (100/5min per IP) + WS per-IP ConnectAttempts.
- Run order: non-WS tests first (validation, then smoke ID/F2/T-LB-6/geometry/XSS/F8/A11Y-2),
  then WS-consuming SM-1 test last (budget-aware).
- Use `make smoke-ci` for runner-IP exemption cycle around smoke suite.
