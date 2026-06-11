---
slice: s013-defects-view
chunk: CHK-8
uc: UC-S013-1
produced-by: tester
date: 2026-06-11
sha-under-test: 86c12eb
---

# Test plan — UC-S013-1 (defects read endpoint)

## Scope

UC-S013-1 is in scope for this validation (the foundational backend endpoint).
UC-S013-2, UC-S013-3, UC-S013-4 (frontend panel, drawer, SSE) are not yet
delivered and are out of scope.

## Change map

Changed nodes per `work/observatory/architecture/dependencies/class-deps.mmd`
and `component-map.mmd` (sha 86c12eb, marked `s013changed`):

| Node | Change | Covering spec |
|------|--------|---------------|
| R_DEFECTS | new: HTTP adapter `server/routes/defects.js` | `server/__tests__/defects-api.test.js @covers R_DEFECTS` |
| LIB_DEFECTS | new: domain aggregator `server/lib/defectsAggregator.js` | `server/__tests__/defects-api.test.js @covers LIB_DEFECTS` |

No uncovered changed nodes.

## Impacted specs

| Spec file | Test suite | Covers |
|-----------|-----------|--------|
| `server/__tests__/defects-api.test.js` | 14 fixture unit tests + 3 EXP-033 real-data tests | R_DEFECTS, LIB_DEFECTS |
| `e2e/s013-defects-api-real-data.spec.js` | 9 live-server browser-context tests (REUSE_SERVER=1) | R_DEFECTS, LIB_DEFECTS |

## Test plan tick-off

| AC | Description | Status |
|----|-------------|--------|
| AC-S013-1-1 | 200 + application/json + array | PASS |
| AC-S013-1-2 | Array length = 12 (ground-truth; acceptance.md says 10 — known data drift per task brief) | PASS |
| AC-S013-1-3 | DEFECT-001: status=CLOSED, severity=HIGH | PASS |
| AC-S013-1-4 | DEFECT-001: reported_ts = 2026-06-10T06:17:47Z | PASS |
| AC-S013-1-5 | DEFECT-001: recovered_ts = 2026-06-10T06:31:22Z | PASS |
| AC-S013-1-6 | DEFECT-001: mttr_s in [810,820] = 815 | PASS |
| AC-S013-1-7 | DEFECT-012 (CONFIRMED/open): recovered_ts=null, mttr_s=null | PASS |
| AC-S013-1-8 | ?id=DEFECT-999 returns [] | PASS |
| AC-S013-1-9 | Malformed stub file degrades gracefully; no 5xx | PASS (unit test) |
| EXP-033 DEFECT-011 | Ledger-only record, 667 s MTTR, human title | PASS |
| EXP-033 DEFECT-001 | Human title, fix_sha present | PASS |
| ERROR-SURFACE | Unknown project id → 200 + [], no observatory defects leaked | PASS |
| SCOPING | Array sorted ascending DEFECT-001..DEFECT-012 | PASS |

## Suites run

1. `npm --prefix work/observatory/src/app run test:ci` (vitest, 538 tests, 42 files)
2. `REUSE_SERVER=1 npm --prefix ... run test:browser -- e2e/s013-defects-api-real-data.spec.js` (Playwright, 9 tests, live :5173)
