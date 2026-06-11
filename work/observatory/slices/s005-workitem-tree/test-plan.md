---
slice: s005-workitem-tree
chunk: CHK-4
produced-by: tester
sha: 1f235cb
date: 2026-06-10
---

# Test plan — s005 Work-item tree & zoom/drill

## Scope

Derived from acceptance.md (UC-S005-1 through UC-S005-6 + GEO + A11Y conditions).

## Impacted specs

| Spec | Covers | Run |
|------|--------|-----|
| server/__tests__/ledger-by-item-api.test.js | UC-S005-1 ledger endpoint | unit |
| src/components/__tests__/WorkItemTree.test.jsx | UC-S005-2 tree render | unit |
| src/components/__tests__/WorkItemTreeContainer.test.jsx | UC-S005-2 container | unit |
| src/components/__tests__/DetailPane.test.jsx | UC-S005-3 pane | unit |
| src/components/__tests__/DetailPaneContainer.test.jsx | UC-S005-3 container | unit |
| src/components/__tests__/ArtifactView.test.jsx | UC-S005-4 markdown+mermaid | unit |
| src/components/__tests__/ItemHistoryPanel.test.jsx | UC-S005-5 history | unit |
| src/state/__tests__/workItemTree.test.js | UC-S005-2 domain | unit |
| src/state/__tests__/itemDetail.test.js | UC-S005-3 state | unit |
| e2e/work-item-tree.spec.js | UC-S005-2 GEO+A11Y browser | browser |
| e2e/detail-pane.spec.js | UC-S005-3/4/5 browser | browser |
| e2e/detail-pane-geometry.spec.js | DEFECT-006 no-reflow browser | browser |
| e2e/s005-real-data.spec.js | EXP-033 real-data | browser-real-data |

## Acceptance case tick-off

| Case | Status | Evidence |
|------|--------|----------|
| AC-S005-1-1 [REAL-DATA] | PASS | API returns 14 rows for UC-S001-1 (matches hand-count) |
| AC-S005-1-2 | PASS | Returns [] for NONEXISTENT-999 |
| AC-S005-1-3 | PASS | newest-first verified (2026-06-09T14:36:00Z first) |
| AC-S005-1-4 | PASS | unit test: ledger-by-item-api.test.js |
| AC-S005-1-5 | PASS | unit test: ledger-by-item-api.test.js |
| AC-S005-1-6 | PASS | parseLedger imported from ledgerAggregator.js; no second csv-parse in route |
| AC-S005-2-1 [REAL-DATA] | PASS | items.csv=32 rows; tree rendered 32 nodes |
| AC-S005-2-2 | PASS | REQ-OBSERVATORY → CHK-1..4 → UC hierarchy verified in browser |
| AC-S005-2-3 [REAL-DATA] | PASS | CHK-1=done, CHK-4=in-progress in live browser |
| AC-S005-2-4 | PASS | e2e/work-item-tree.spec.js (data-space attribute) |
| AC-S005-2-5 | PASS | e2e/work-item-tree.spec.js (space-tag text) |
| AC-S005-2-6 | PASS | unit tests + state-badge text assertion |
| AC-S005-2-7 | PASS | unit test WorkItemTree (data-value/data-cost) |
| AC-S005-3-1 | PASS | e2e/detail-pane.spec.js |
| AC-S005-3-2 | PASS | e2e/detail-pane.spec.js (h1 present, no raw pre) |
| AC-S005-3-3 | PASS | e2e/detail-pane.spec.js (svg role=img aria-label) |
| AC-S005-3-4 | PASS | e2e/detail-pane.spec.js (not yet available placeholder) |
| AC-S005-3-5 | PASS | e2e/detail-pane.spec.js (breadcrumb contains UC-S004-1) |
| AC-S005-3-6 | PASS | e2e/detail-pane.spec.js (back-to-map returns to map, DEFECT-006) |
| AC-S005-3-7 [DEFECT-006] | PASS | e2e/detail-pane-geometry.spec.js (map height delta=0, scroll delta=0) |
| AC-S005-4-1 | PASS | e2e/detail-pane.spec.js (table element present) |
| AC-S005-4-2 | PASS | e2e/detail-pane.spec.js (code element present) |
| AC-S005-4-3 | PASS | unit test ArtifactView (null md no throw) |
| AC-S005-4-4 | PASS | unit test ArtifactView (null mmd no throw) |
| AC-S005-5-1 [REAL-DATA] | PASS | 14 rows rendered for UC-S001-1; MATCH=yes |
| AC-S005-5-2 | PASS | e2e + real-data (first ts >= last ts) |
| AC-S005-5-3 | PASS | e2e (agent + event readable, not row:N) |
| AC-S005-5-4 | PASS | e2e/detail-pane.spec.js (no history placeholder) |
| AC-S005-5-5 | NOTE | Depends on UC-S005-6 SSE wiring (blocked) |
| AC-S005-6-1 | PARTIAL | Breadcrumb shows item id + back-to-map; full path (CHK>SLC>UC) is UC-S005-6 scope (blocked) |
| AC-S005-6-2 [REAL-DATA] | DEFERRED | UC-S005-6 blocked; SSE tree refresh not yet wired |
| AC-S005-6-3 | DEFERRED | UC-S005-6 blocked |
| AC-S005-6-4 | PASS | e2e back-to-map keyboard Enter tested |
| A11Y-S005-1 | PASS | e2e/work-item-tree.spec.js (one tabbable, ArrowDown moves focus) |
| A11Y-S005-2 | PASS | unit tests (state text label, data-state) |
| A11Y-S005-3 | PASS | e2e/detail-pane.spec.js (role=region aria-label; focus on open; focus returns on close) |
| A11Y-S005-4 | PASS | e2e (Esc + back-to-map both keyboard operable) |
| A11Y-S005-5 | PASS | detail-pane.jsx: nav aria-label="Zoom path" aria-current on crumb |
| A11Y-S005-6 | PASS | work space-tag text verified in e2e |
| A11Y-S005-7 | PASS | a11y-contrast.spec.js (axe zero violations) |
| A11Y-S005-8 | PASS | unit test target-size; node hit area verified |
| A11Y-S005-9 | PASS | e2e/value-stream-live.spec.js (0s reduced-motion) |
| A11Y-S005-10 | PASS | e2e (svg role=img aria-label present) |
| GEO-S005-1 | PASS | e2e/work-item-tree.spec.js (child.left - parent.left >= 16px) |
| GEO-S005-2 | PASS | unit test ItemHistoryPanel (rows stack vertically) |
| GEO-S005-3 | PASS | e2e/detail-pane.spec.js (pane.left >= rail.right - 1) |
| GEO-S005-3b | PASS | e2e/detail-pane-geometry.spec.js (mapHeight delta=0, scroll=0) |
| GEO-S005-4 | PASS | e2e (aria-selected=true while pane open) |

## Uncovered changed nodes

None within scope (UC-S005-6 is blocked/deferred; acceptance deferral noted above).
