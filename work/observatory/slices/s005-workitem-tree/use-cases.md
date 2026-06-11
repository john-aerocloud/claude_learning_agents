---
slice: s005-workitem-tree
chunk: CHK-4
produced-by: product
date: 2026-06-10
---

# Use cases — s005 Work-item tree & zoom/drill

All UCs serve **J2 — Navigate and interrogate the flow** (CORE).
Ordered thinnest-first (dependency-safe build order).

---

## UC-S005-1 — Ledger-by-item-id endpoint (foundational)

**One-line JTBD:** When an operator selects a work item, the server must return all ledger
rows for that item so the detail pane can show real event history.

**Actor:** SPA (calls on behalf of the operator)

**Trigger:** `GET /api/projects/:id/ledger?item_id=<id>` request

**Observable outcome:** Server responds with a JSON array of matching ledger rows
(timestamp, event, agent, outcome, note) in descending timestamp order; unknown or absent
`item_id` returns an empty array, not a 4xx/5xx.

**Data source:** `process/dora/ledger.csv` — parsed with the TOLERANT parser already built
for UC-S004-1 (`server/lib/ledgerAggregator.js` or equivalent). Must handle `# comment`
lines, blank rows, extra/missing columns. MUST NOT introduce a second ledger parser.

**Seams / paths owned:**
- `server/routes/ledger.js` — new route file; reuses existing aggregator module
- `server/lib/ledgerAggregator.js` — READ-only reuse; extract to shared if not already shared

**Value:** HIGH (nothing in the detail pane can show item history without this endpoint)
**Cost estimate:** 1.5 h

**Dependencies:** none — independently buildable against the existing server

**Done condition:** `GET /api/projects/observatory/ledger?item_id=UC-S001-1` returns at
least one row matching a real ledger row from `process/dora/ledger.csv`; response is JSON;
absent id returns `[]`; no crash on empty/header-only ledger.

---

## UC-S005-2 — Work-item tree render

**One-line JTBD:** When the operator opens the work-item panel, they want to see the
full REQ→CHK→SLC→UC hierarchy with per-node state, value, and cost so they can navigate
to any item without opening a file.

**Actor:** Pipeline operator

**Trigger:** Operator navigates to the work-item tree view (or it opens as a sidebar panel
alongside the value-stream map)

**Observable outcome:** A collapsible tree renders with:
- All items from `items.csv` in correct parent→child indentation (REQ at root,
  CHK under REQ, SLC under CHK, UC under SLC, DEF anywhere applicable)
- Per-node badge: type glyph + state label + value + cost (not colour-only)
- Space-tag badge on every node (`/work` vs `/process`) with a visually distinct
  colour band for each space
- Colour-coding by state (colour always redundant with the text state label per §8)
- Node count on render matches `items.csv` row count

**Data source:** `GET /api/projects/:id/items` (existing endpoint, items.csv → typed records
with id, type, parent, children, state, value, cost, vc_ratio)

**Seams / paths owned:**
- `src/app/components/WorkItemTree.jsx` (new)
- `src/app/hooks/useItemTree.js` (new)

**Value:** HIGH
**Cost estimate:** 3 h

**Dependencies:** none (the `/items` endpoint is already delivered by CHK-1)

**Done condition:** Tree visible; node count matches live items.csv; REQ-OBSERVATORY at
root with CHK-1..CHK-4 as children; CHK-1 shows state=done; CHK-4 shows state=backlog;
space-tag badge present on every node with distinct colour for `/work`.

---

## UC-S005-3 — Drill-down detail pane (shell + artifact render)

**One-line JTBD:** When the operator clicks a tree node, they want a side panel to open
showing the item's slice artifacts rendered — so they can read slice.md and see diagrams
without leaving the UI.

**Actor:** Pipeline operator

**Trigger:** Click on any tree node

**Observable outcome:**
- A detail pane opens (`data-testid="detail-pane"`)
- For SLC and UC nodes: slice.md content rendered as styled HTML (not raw `<pre>`)
- For nodes with a `.mmd` artifact: Mermaid SVG rendered (`data-testid="mmd-render"`
  contains `<svg>`)
- Absent artifact (null from server) renders a "not yet available" placeholder — no crash,
  no console error
- A breadcrumb at the top of the pane shows the zoom path (e.g.
  "Pipeline → CHK-4 → UC-S005-3") and a "Back to map" button

**Data source:**
- Artifact text: `GET /api/projects/:id/slices/:slug/:artifact` (existing endpoint,
  delivered UC-S001-4)
- `.mmd` render: Mermaid JS library (client-side); add as SPA dependency in this slice;
  confirm version + bundle-size at architect gate before build

**Seams / paths owned:**
- `src/app/components/DetailPane.jsx` (new — also touched by UC-S005-4 and UC-S005-5;
  those UCs are serialised behind this one within the DetailPane seam)
- `src/app/hooks/useItemDetail.js` (new)

**Value:** HIGH
**Cost estimate:** 2.5 h

**Dependencies:** UC-S005-2 (tree must render for a node to be clickable)

**Done condition:** Clicking UC-S001-1 node opens pane; slice.md renders as HTML with at
least one `<h1>` or `<p>`; clicking a node with a `.mmd` artifact produces an `<svg>`
inside `data-testid="mmd-render"`; clicking a REQ node with no slice artifacts shows
"not yet available"; "Back to map" returns focus to value-stream map.

---

## UC-S005-4 — Markdown + Mermaid rendering in the detail pane

**One-line JTBD:** When the detail pane shows a slice artifact, markdown must render
as styled HTML and `.mmd` files must render as live Mermaid diagrams so the operator
reads structured content, not raw text.

**Actor:** Pipeline operator (reads rendered content in the pane)

**Trigger:** Detail pane populates artifact text (from UC-S005-3)

**Observable outcome:**
- Markdown headings, lists, tables, code blocks render with appropriate HTML styling
  (via a lightweight client-side markdown library — no server-side parse)
- `.mmd` content produces a Mermaid SVG; render is client-side
- Both renderers fail soft: null/empty input → "not yet available" placeholder, no throw

**Data source:** artifact text already in pane (passed from UC-S005-3 hook)

**Seams / paths owned:**
- `src/app/components/MarkdownRenderer.jsx` (new)
- `src/app/components/MmdRenderer.jsx` (new)
- Both are composed inside `DetailPane.jsx` — serialised within the DetailPane seam
  (build after UC-S005-3 shell exists)

**Value:** MEDIUM (pane is not useful without readable rendering)
**Cost estimate:** 2 h

**Dependencies:** UC-S005-3 (DetailPane.jsx shell must exist before these components
are composed into it)

**Done condition:** Selecting a node whose slice.md contains a markdown table: table
renders as `<table>`, not raw `|` characters. Selecting a node with a `.mmd` artifact:
`<svg>` present in `data-testid="mmd-render"`. Null artifact: no JS exception thrown.

---

## UC-S005-5 — Item history panel (ledger rows in the pane)

**One-line JTBD:** When the operator drills into an item, they want to see its full
ledger event history — task_start/task_end, gates, failures — so they can understand
exactly how the item moved through the pipeline without grepping the ledger.

**Actor:** Pipeline operator

**Trigger:** Detail pane opens for any item (triggered by node click, UC-S005-3)

**Observable outcome:**
- Item history sub-panel renders inside the detail pane showing all ledger rows for
  the item's id, newest-first
- Each row shows: timestamp, event type, agent, duration_s (if present), outcome, note
- Real item UC-S001-1: at least one real task_start/task_end row visible, row count
  matches manual count from `process/dora/ledger.csv`
- Empty history (no rows for this item_id): shows "no history yet" placeholder, no crash

**Data source:** `GET /api/projects/:id/ledger?item_id=<id>` (UC-S005-1 — the foundational
ledger endpoint)

**Seams / paths owned:**
- `src/app/components/ItemHistory.jsx` (new, composed inside DetailPane.jsx)
- `src/app/hooks/useItemHistory.js` (new)

**Value:** HIGH (this is the primary interrogation affordance — the SM1 answer mechanism)
**Cost estimate:** 2 h

**Dependencies:** UC-S005-1 (ledger endpoint must exist); UC-S005-3 (DetailPane shell)

**Done condition (real-data — EXP-033 policy):** Tester selects UC-S001-1 node in the
live app; history panel shows rows matching `item_id=UC-S001-1` in `process/dora/ledger.csv`;
hand-count of expected rows matches rendered row count; result.md names the item_id,
expected count, actual count, and match: yes/no. Default view must show real non-zero
data — acceptance does NOT pass on fixture data alone.

---

## UC-S005-6 — Zoom-out breadcrumb + SSE live refresh

**One-line JTBD:** When the operator navigates deep into a node, they want a clear
path back to the map and automatic refresh when items or ledger change — so they stay
oriented and always see current state.

**Actor:** Pipeline operator

**Trigger (zoom-out):** Operator clicks "Back to map" breadcrumb control

**Trigger (live refresh):** SSE file-change event fires (reusing existing SSE channel
from UC-S001-5 / UC-S004-6)

**Observable outcome:**
- Breadcrumb renders the current zoom path at all drill levels
  (e.g. "Pipeline → CHK-4 → s005 → UC-S005-3")
- "Back to map" at any level returns the operator to the value-stream map as the
  primary visible region
- On SSE file-change event: tree re-fetches items; detail pane re-fetches the selected
  item's history and artifact; visible data updates without manual reload
- Tree re-renders within the configured SSE window (≤ N seconds) after items.csv is
  appended-to in a test

**Data source:**
- Breadcrumb state: client-side router/navigation state
- SSE re-fetch: existing SSE channel (`/api/projects/:id/events` or equivalent,
  delivered UC-S001-5); wired into `useItemTree.js` and `useItemHistory.js` hooks

**Seams / paths owned:**
- `src/app/components/ZoomBreadcrumb.jsx` (new)
- SSE re-fetch wiring added to `src/app/hooks/useItemTree.js` and
  `src/app/hooks/useItemHistory.js`

**Value:** MEDIUM (orientation + freshness; without it the tree is static)
**Cost estimate:** 1.5 h

**Dependencies:** UC-S005-2 (tree), UC-S005-3 (pane), UC-S005-5 (history)

**Done condition:** Clicking "Back to map" from a drilled node returns to the
value-stream map view. Appending a test row to items.csv triggers a tree re-render
without manual reload. Selected item history re-fetches on SSE event.

---

## Dependency edges

```
UC-S005-1  ──────────────────────────────────────► UC-S005-5
UC-S005-2  ──► UC-S005-3 ──► UC-S005-4
                         ──► UC-S005-5 (also needs UC-S005-1)
                         ──► UC-S005-6 (also needs UC-S005-2, UC-S005-5)
```

Ordered build sequence:
1. UC-S005-1 (ledger endpoint) — no dependencies; parallelisable with UC-S005-2
2. UC-S005-2 (tree render) — no dependencies; parallelisable with UC-S005-1
3. UC-S005-3 (pane shell + artifact render) — needs UC-S005-2
4. UC-S005-4 (markdown/mmd renderers) — needs UC-S005-3 (DetailPane seam); serialised
5. UC-S005-5 (item history panel) — needs UC-S005-1 + UC-S005-3; parallelisable with UC-S005-4
6. UC-S005-6 (breadcrumb + SSE) — needs UC-S005-2, UC-S005-3, UC-S005-5

UC-S005-1 and UC-S005-2 can be built in parallel (different seams, no collision).
UC-S005-4 and UC-S005-5 can be built in parallel once UC-S005-3 shell exists (different
component files within DetailPane.jsx; coordinate seam hand-off with architect).

---

## Shared-seam notes (for flow-manager path registry)

- `DetailPane.jsx` is a shared seam for UC-S005-3, UC-S005-4, UC-S005-5. UC-S005-3
  creates the shell; UC-S005-4 and UC-S005-5 compose into it. False-edge risk: if
  UC-S005-4 and UC-S005-5 touch different sub-components of the pane they may run
  in parallel — architect to confirm at gate.
- `server/lib/ledgerAggregator.js` is a READ-ONLY dependency for UC-S005-1. If not
  already a shared module it must be extracted; flag at architect gate if extraction
  is needed (extraction is an enabler, not a new UC).
- SSE channel is a READ-ONLY reuse seam — no collision with tree or pane writers.

---

## Value / cost summary

| UC | Job served | Value | Cost (h) | Dependencies |
|----|-----------|-------|----------|--------------|
| UC-S005-1 | Ledger-by-item-id endpoint | HIGH | 1.5 | none |
| UC-S005-2 | Work-item tree render | HIGH | 3.0 | none |
| UC-S005-3 | Detail pane shell + artifact render | HIGH | 2.5 | UC-S005-2 |
| UC-S005-4 | Markdown + Mermaid rendering | MEDIUM | 2.0 | UC-S005-3 |
| UC-S005-5 | Item history panel | HIGH | 2.0 | UC-S005-1, UC-S005-3 |
| UC-S005-6 | Zoom breadcrumb + SSE refresh | MEDIUM | 1.5 | UC-S005-2, UC-S005-3, UC-S005-5 |
| **Total** | | | **12.5 h** | |

_Estimate is within the L (~14h) band in slice.md; delta covered by architect-gate
confirmation of mermaid bundle size and ledger-aggregator extraction scope._
