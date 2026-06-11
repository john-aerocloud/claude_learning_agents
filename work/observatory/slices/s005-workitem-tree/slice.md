---
slice: s005-workitem-tree
chunk: CHK-4
status: defined
created: 2026-06-09
value: HIGH
cost: L   # ~14h estimated across 6 UCs
vc_ratio: HIGH/L
---

# s005 — Work-item tree & zoom/drill

## Job served

**J2 — Navigate and interrogate the flow.**
When the operator asks "where is work X and why is it stuck?", they want to traverse
the REQ→CHK→SLC→UC tree, drill into any item for full artifact + history + dependency
detail, and navigate back to the pipeline map — so they can move between the whole
picture and the part in one click rather than opening multiple files.

_Functional:_ replace multi-file navigation with a zoom/drill model; answer provenance
questions instantly.
_Emotional:_ feel oriented, not lost, inside a multi-slice, multi-agent flow.

## Thin scope (what this slice delivers)

1. **Ledger-by-item-id endpoint** (`GET /api/projects/:id/ledger?item_id=<id>`):
   reads `process/dora/ledger.csv` using the tolerant parser built for UC-S004-1
   (not a fresh csv.js parse — reuse the existing aggregator's resilience) and returns
   all ledger rows whose `item_id` column matches the requested id. This is the
   missing capability flagged in the CHK-4 brief; nothing else in the detail pane can
   show item history without it.

2. **Work-item tree render** (REQ→CHK→SLC→UC hierarchy from `items.csv`):
   a collapsible tree in the SPA sidebar/panel showing all items with per-node
   state, value, cost, and vc_ratio. `/process` items (none in items.csv, but the
   source badge distinguishes space) vs `/work` items are visually distinct via a
   persistent space-tag badge and colour band — satisfying §8 separation requirement.
   Nodes are colour-coded by state (colour always redundant with text label per §8
   rule). Node types REQ/CHK/SLC/UC/DEF are structurally distinct (indent level +
   type glyph + label).

3. **Drill-down / detail pane**: clicking a tree node opens a side panel (or replaces
   a bottom panel) showing:
   - Slice artifacts rendered for SLC and UC nodes (markdown rendered as HTML;
     `.mmd` rendered as live Mermaid diagrams) — sourced from the existing
     `GET /api/projects/:id/slices/:slug/:artifact` endpoint (UC-S001-4, already
     delivered).
   - Item history panel: all ledger rows for this item_id, newest-first, from the
     new ledger-by-item-id endpoint.
   - Dependency edges from `use-case-deps.mmd` (existing `deps` endpoint, UC-S001-3),
     filtered/highlighted to the selected node where possible.

4. **Explicit zoom-out**: a breadcrumb + "back to map" control so the operator can
   return to the value-stream map in one click. The drill model is pipeline → tree →
   item → artifact; each level has an escape path.

5. **Markdown + .mmd rendering in the detail pane**: markdown rendered as styled HTML
   (via a lightweight client-side library — no server-side parse); Mermaid diagrams
   rendered client-side via the Mermaid JS library (already referenced in CHK-4
   requirements; consistent with §5 architecture). Fails soft if content is null
   (absent artifact → "not yet available" placeholder, no crash).

6. **Live refresh via SSE**: the tree and detail pane re-fetch on SSE file-change
   events (reusing the existing SSE channel from UC-S001-5 / UC-S004-6 hook). A
   selected item's history and artifacts update automatically within the configured
   window.

## Explicitly NOT in scope

- Creating or editing items — the UI is read-only; no write affordances.
- The steer prompt-handoff affordances from CHK-5 (those are Phase 2).
- Per-item dependency-edge drill (interactive graph click-navigation) — the deps
  `.mmd` diagram renders as a static Mermaid diagram, not an interactive graph.
- `/process` space items (process improvement slices, IMP-* etc.) — the space-tag
  distinguishes source but this slice does not add a process-space browser.
- Filtering or searching across items — the tree renders all items; filter is
  a follow-on improvement.
- Mobile / responsive layout optimisation.
- Full DORA panel (CHK-3, parallel track, not this slice).
- The DORA four-metric panel, stage cards, time-thief ranking — those are CHK-3.

## Missing capability flag — new endpoint required

**`GET /api/projects/:id/ledger?item_id=<id>`** does NOT exist yet. The current
read layer has no endpoint that filters ledger.csv by item_id. This is the foundational
new server capability in this slice. It MUST reuse the tolerant CSV parser already
built for UC-S004-1's ledger aggregator (`server/lib/ledgerAggregator.js` or
equivalent) — do not introduce a second ledger parser. The same resilience rules
apply: tolerate extra/missing columns, blank rows, comment lines (the ledger uses
`# comment` lines that strict CSV parsers choke on).

## Success measures (basis for acceptance)

| # | Measure | How observed |
|---|---------|--------------|
| SM-TREE-1 | Tree renders all items from live items.csv in correct REQ→CHK→SLC→UC hierarchy with state/value/cost visible on each node | Visual review + automation: node count matches items.csv row count; parent-child indentation correct |
| SM-TREE-2 | /process vs /work items are visually distinct — space-tag badge present on every node, colour band differs | DOM assertion: `[data-space]` attribute present + distinct value on /work nodes |
| SM-TREE-3 | Clicking any SLC or UC node opens the detail pane and renders its slice.md as styled HTML (not raw text) | Automation: `data-testid="detail-pane"` present; contains rendered `<h1>` or `<p>` — not a `<pre>` of raw markdown |
| SM-TREE-4 | Clicking a node with a .mmd artifact renders a Mermaid SVG, not a raw text blob | Automation: `data-testid="mmd-render"` contains an `<svg>` element |
| SM-TREE-5 | Item history panel shows ledger rows filtered by item_id from the live ledger — at least one real item (e.g. UC-S001-1) shows its real task_start/task_end events | Tester selects UC-S001-1 node; confirms history panel shows rows matching `item_id=UC-S001-1` from ledger.csv; hand-counts rows agree |
| SM-TREE-6 | "Back to map" control returns the operator to the value-stream map view in one click | Click the control; assert value-stream map is the primary visible region |
| SM-TREE-7 | Absent artifact (null from server) renders as a graceful placeholder, not a crash | Automation: request an item with no result.md; detail pane shows "not yet available" text; no console error |
| SM-TREE-8 | Tree re-renders within N seconds of items.csv change without manual reload | Append a test row to items.csv; tree updates without reload |

**Real-data done-condition (EXP-033 — mirroring s004 policy):** the slice is NOT done
if acceptance passes only against fixture data. The tester MUST validate SM-TREE-5
against the live `process/dora/ledger.csv` and `work/observatory/items/items.csv` in
this repo, confirming item history for at least one real item (e.g. UC-S001-1 or
CHK-1) shows correct, non-empty, hand-verifiable ledger rows. Result.md must contain
an explicit verification row naming the item_id, number of rows expected vs returned,
and match: yes/no.

Real-data tree validation (EXP-033 extension): the tester MUST also confirm the live
REQ-OBSERVATORY → CHK-1..CHK-4.. → UC-S001-1.. tree renders with the correct item
count (matching the live items.csv) and that CHK-1 shows state=done and CHK-4 shows
state=backlog.

## Architecture notes for solution-architect / cicd

**Seam co-declarations (for flow-manager path registry):**
- UC-S005-1 owns: `server/routes/ledger.js` (new route), reuses `server/lib/ledgerAggregator.js`
- UC-S005-2 owns: `src/app/components/WorkItemTree.jsx` (new), `src/app/hooks/useItemTree.js`
- UC-S005-3 owns: `src/app/components/DetailPane.jsx` (new), `src/app/hooks/useItemDetail.js`
- UC-S005-4 owns: `src/app/components/MarkdownRenderer.jsx`, `src/app/components/MmdRenderer.jsx`
- UC-S005-5 owns: `src/app/components/ItemHistory.jsx`, `src/app/hooks/useItemHistory.js`
- UC-S005-6 owns: `src/app/components/ZoomBreadcrumb.jsx` + SSE re-fetch wiring in tree/detail hooks

UC-S005-3 and UC-S005-4 both touch `DetailPane.jsx` — serialised within that seam.
UC-S005-5 is independently buildable once UC-S005-1 (ledger endpoint) is done.

**Tolerant ledger parser:** this slice MUST NOT duplicate the ledger CSV parsing logic.
The parser introduced for UC-S004-1 (which handles `# comment` lines, blank rows, and
extra columns) must be extracted into a shared module if it is not already. Flag to
the architect at gate if not yet extracted.

**Mermaid JS:** the client-side Mermaid library (mermaid.js or mermaid-js/mermaid)
should be added as a SPA dependency in this slice. Confirm version + bundle-size impact
at architect gate before build starts.

## Process-gap correction

Every acceptance run for this slice MUST include at least one assertion against the
live repo data (items.csv + ledger.csv). The tester result.md must explicitly state
which item_id was used for the history check and whether the item count in the tree
matched the live items.csv row count at validation time.
