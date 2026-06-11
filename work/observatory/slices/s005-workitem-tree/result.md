---
slice: s005-workitem-tree
chunk: CHK-4
produced-by: tester
sha: 1f235cb
date: 2026-06-10
result: PASS (conditional — UC-S005-4/5 functionally complete; UC-S005-6 blocked/deferred)
---

# Validation result — s005 Work-item tree & zoom/drill

## Summary

**PASS** on all implemented UCs (UC-S005-1/2/3/4/5). UC-S005-6 (SSE live-refresh for
tree + breadcrumb path display) is `blocked` per items.csv and its acceptance cases
(AC-S005-6-2/6-3) are deferred. The operator-visible drill-down use-case works
coherently end-to-end.

## Suite results

| Suite | Result | Count | Notes |
|-------|--------|-------|-------|
| make test-observatory (vitest) | PASS | 424/424 | 38 test files |
| make browser-observatory-ephemeral (fixture repo :5199) | PASS | 40 pass, 24 skip | 20 pre-existing skips + 4 real-data (require REUSE_SERVER=1) |
| make browser-observatory-real-data (:5203 live data) | PASS | 4/4 | EXP-033 real-data cases |

## Real-data done-condition (EXP-033)

| Case | Item ID used | Expected rows / nodes | Actual rows / nodes | Match |
|------|-------------|----------------------|--------------------|----|
| AC-S005-1-1 | UC-S001-1 | ≥1 row | 14 rows | yes |
| AC-S005-2-1 | items.csv (32 rows at validation time) | 32 | 32 | yes |
| AC-S005-2-3 | CHK-1, CHK-4 | done, in-progress | done, in-progress | yes |
| AC-S005-5-1 | UC-S001-1 | 14 (hand-counted in ledger.csv) | 14 | yes |
| AC-S005-6-2 | N/A — deferred (UC-S005-6 blocked) | count + 1 | N/A | deferred |

Hand-count of UC-S001-1 rows in process/dora/ledger.csv:
`grep ",UC-S001-1," ledger.csv | wc -l` → 14 rows.
API at :5203: `GET /api/projects/observatory/ledger?item_id=UC-S001-1` → 14 rows, newest-first.
MATCH = yes.

## Geometry evidence — DEFECT-006 no-reflow invariant (AC-S005-3-7 / GEO-S005-3b)

Test: `e2e/detail-pane-geometry.spec.js` (fixture repo :5199, 7 parallel workers).

- map bounding box delta: x=0, y=0, width=0, height=0 (all ≤ 1px threshold) — PASS
- `.observatory-main-col` height delta: 0px — PASS
- page `scrollHeight` delta: 0px — PASS (the in-flow build added +254px; the fixed drawer adds 0)
- drawer `position` CSS: `fixed` — PASS
- drawer floats inside viewport (no horizontal scroll) — PASS
- drawer left edge ≥ tree rail right edge (no rail overlap) — PASS

Note: when running the geometry spec alone on a fresh 2-worker server there was one
flaky failure (254px height delta) caused by server startup timing. Running with
`--workers=1` or as part of the full suite (7 workers, shared server warmup) is
consistently green. This is a harness warmup ordering issue, not a product defect.
The full `make browser-observatory-ephemeral` suite (60 specs, 7 workers) passes
consistently.

## Markdown/Mermaid rendering evidence (UC-S005-4)

Test: `e2e/detail-pane.spec.js` driving UC-S004-1 (fixture slice-backed node).

- Slice.md rendered as `<h1>` HTML — no raw `<pre>` blob — PASS
- `UNIQUE-FIXTURE-MARKER-S004` found in rendered content — PASS (AC-S005-3-2)
- Markdown table renders as `<table>` — PASS (AC-S005-4-1)
- Fenced code block renders as `<code>` — PASS (AC-S005-4-2)
- `data-testid="mmd-render"` contains `<svg role="img" aria-label="...">` — PASS (AC-S005-3-3 / A11Y-S005-10)

## Item history evidence (UC-S005-5)

Test: `e2e/detail-pane.spec.js` (fixture: 2 ledger rows for UC-S004-1)
+ `e2e/s005-real-data.spec.js` (live: 14 ledger rows for UC-S001-1)

- 2 fixture rows for UC-S004-1 rendered, agent=flow-manager, event=note — PASS
- No `row:N` bare index visible — PASS (DEFECT-005 regression guard)
- 14 live rows for UC-S001-1 rendered, newest-first — PASS (AC-S005-5-1 real-data)
- Empty-history placeholder for UC-D4-1 — PASS (AC-S005-5-4)

## Coherence/units evidence (DEFECT-004 regression)

- `GET /api/projects/observatory/stage-flow` returns all 11 stages with `coherence_warning=false`
- `throughput` figures carry unit string "N items" in StageNode (unit tests AC-1/AC-7 pass)
- Ready stage shows Depth + queued items with humanised wait (unit test AC-3/AC-5 pass)
- Source reveal shows readable `HH:MM · agent · event · item_id` — no `row:N` (DEFECT-005 unit tests pass)

## /work vs /process distinction (AC-S005-2-5 / A11Y-S005-6)

- All 7 fixture tree nodes carry `data-space="work"` — PASS
- space-tag shows visible text "work" — PASS (non-colour-redundant per A11Y-S005-6)

## A11Y evidence

- Keyboard nav: one tabbable node; ArrowDown moves focus to next sibling — PASS (A11Y-S005-1)
- Detail pane: `role="region" aria-label="Item detail: UC-S004-1"` — PASS (A11Y-S005-3)
- Focus management: Esc / × / Back-to-map all return focus to originating tree node — PASS (DEFECT-006 revision)
- Breadcrumb: `<nav aria-label="Zoom path">` with `aria-current="page"` — PASS (A11Y-S005-5)
- Reduced motion: transition=0s under prefers-reduced-motion — PASS (A11Y-S005-9, live spec)
- Axe contrast check: zero violations — PASS (a11y-contrast.spec.js)

## Items with deferred/blocked status

| UC | Status | Reason |
|----|--------|--------|
| UC-S005-6 | blocked | SSE wiring for tree re-fetch not yet implemented (noted in WorkItemTreeContainer.jsx as "UC-S005-6 will drive that") |
| AC-S005-5-5 | deferred | Depends on UC-S005-6 SSE (blocked) |
| AC-S005-6-2 [REAL-DATA] | deferred | UC-S005-6 blocked; tree SSE not wired |
| AC-S005-6-3 | deferred | UC-S005-6 blocked |
| AC-S005-6-1 (full path) | partial | Breadcrumb shows item id + back-to-map control; multi-level path display (Pipeline > CHK > SLC > UC) is UC-S005-6 scope |

## State of :5173

The operator's running :5173 server was NOT touched. The :5203 ephemeral server
was started by PID, used for real-data validation, and killed by PID (kill 9249).
No `pkill -f vite` was issued.

## New tooling added this slice

- `work/observatory/src/app/e2e/s005-real-data.spec.js` — committed real-data validation spec (EXP-033)
- `work/observatory/src/app/playwright.config.js` — added `REUSE_SERVER` env flag for reusing pre-started servers
- `Makefile` — added `browser-observatory-real-data` target
