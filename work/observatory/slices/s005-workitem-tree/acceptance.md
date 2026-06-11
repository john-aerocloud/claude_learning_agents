---
slice: s005-workitem-tree
chunk: CHK-4
produced-by: product
date: 2026-06-10
---

# Acceptance cases — s005 Work-item tree & zoom/drill

Each case is tagged to its use case. All real-data cases (marked **[REAL-DATA]**) MUST
be run against the live repo files — acceptance does NOT pass on fixture data alone
(EXP-033 policy). Result.md must include an explicit real-data verification row for each
`[REAL-DATA]` case.

---

## UC-S005-1 — Ledger-by-item-id endpoint

**AC-S005-1-1** — Known item returns rows
`GET /api/projects/observatory/ledger?item_id=UC-S001-1`
responds with HTTP 200 and a JSON array containing at least one object with fields
`timestamp`, `event`, `agent`. **[REAL-DATA]** — tester hand-counts matching rows in
`process/dora/ledger.csv` and confirms response row count agrees.

**AC-S005-1-2** — Unknown item returns empty array
`GET /api/projects/observatory/ledger?item_id=NONEXISTENT-999`
responds with HTTP 200 and `[]` (not 404, not 500).

**AC-S005-1-3** — Rows ordered newest-first
Response for a known item has rows sorted by `timestamp` descending; the first element
has the most recent timestamp.

**AC-S005-1-4** — Tolerant parser — comment lines do not crash
Prepend a `# comment line` to a copy of `ledger.csv` used in the test; the endpoint still
returns a valid JSON array (the comment line does not appear as a data row).

**AC-S005-1-5** — Header-only ledger returns empty array
Point the server at a ledger file containing only the CSV header line; endpoint returns
`[]` with no 5xx.

**AC-S005-1-6** — No second ledger parser introduced
Code review (or automated lint): the new route imports the existing
`ledgerAggregator.js` (or equivalent shared module); there is no `require('csv-parse')`
or `require('csv.js')` in `server/routes/ledger.js`.

---

## UC-S005-2 — Work-item tree render

**AC-S005-2-1** — Node count matches live items.csv **[REAL-DATA]**
On opening the tree, the total number of rendered tree nodes equals the row count of
`work/observatory/items/items.csv` (excluding the header). Tester records the expected
count from wc-l at validation time and the rendered count in result.md.

**AC-S005-2-2** — Correct hierarchy
REQ-OBSERVATORY is the root node. CHK-1 through CHK-4 (and any other CHKs) appear as
immediate children of REQ-OBSERVATORY. SLC nodes appear under their parent CHK. UC nodes
appear under their parent SLC.

**AC-S005-2-3** — CHK-1 shows state=done; CHK-4 shows state=backlog **[REAL-DATA]**
Tester confirms visually that the CHK-1 node's state badge reads "done" and CHK-4 reads
"backlog", matching the live items.csv at validation time.

**AC-S005-2-4** — Space-tag badge on every node
DOM assertion: every `[data-testid="tree-node"]` element has a `[data-space]` attribute
with a non-empty value.

**AC-S005-2-5** — /work and /process nodes are visually distinct
`/work` nodes and any `/process` nodes have different CSS class or colour band; verified
by asserting distinct `data-space` attribute values map to distinct visible colour values
(automation: computed CSS background-color or class name differs between space values).

**AC-S005-2-6** — State is never colour-only
Every node's state colour is accompanied by a visible text label (e.g. "done", "in-progress",
"backlog") — automation: `[data-state]` attribute is present on every node AND a
text-content sibling exists within the node containing the state string.

**AC-S005-2-7** — Value and cost visible on each node
A node for CHK-1 shows its value and cost values from items.csv; automation: at least
one `[data-value]` and `[data-cost]` attribute on tree-node elements with non-empty
values.

---

## UC-S005-3 — Drill-down detail pane (shell + artifact render)

**AC-S005-3-1** — Pane opens on node click
Clicking a UC node (e.g. UC-S001-1): `data-testid="detail-pane"` becomes visible in the
DOM.

**AC-S005-3-2** — slice.md renders as styled HTML, not raw text
Pane for a SLC or UC node contains a rendered `<h1>` or `<p>` element; there is no
top-level `<pre>` containing the raw markdown source.

**AC-S005-3-3** — .mmd artifact renders as SVG
For a node that has a `.mmd` artifact (e.g. the use-case-deps.mmd available via the deps
endpoint): `data-testid="mmd-render"` contains an `<svg>` element.

**AC-S005-3-4** — Absent artifact renders gracefully
Clicking a REQ node (which has no slice.md): detail pane shows a "not yet available"
placeholder string; no JS exception appears in the browser console.

**AC-S005-3-5** — Breadcrumb shows zoom path
`data-testid="breadcrumb"` visible in the pane; its text content includes the item id
of the selected node (e.g. "UC-S001-1").

**AC-S005-3-6** — "Back to map" returns to value-stream map
Clicking the "Back to map" / breadcrumb root control: the value-stream map becomes the
primary visible region (detail pane closes or is no longer the primary focus); automation:
`data-testid="value-stream-map"` is visible and `data-testid="detail-pane"` is hidden or
removed. **(DEFECT-006:** keyboard focus on close returns to the originating tree node —
see revised A11Y-S005-3.**)**

**AC-S005-3-7** — Opening the pane does NOT reflow the value-stream map **(DEFECT-006 — key regression guard)**
With the pane CLOSED, record `[data-testid="value-stream-map"]`'s `getBoundingClientRect()`,
`.observatory-main-col` height, and `document.documentElement.scrollHeight`. Click a tree
node to OPEN the pane. Assert: (a) the map's bounding box is identical (x/y/width/height
within ≤ 1px); (b) `.observatory-main-col` height is unchanged; (c) page `scrollHeight` is
unchanged (the in-flow build added +690px — the floating drawer must add 0). The drawer
(`data-testid="detail-pane"`) floats ABOVE the map (z-index overlap intentional) and is
within the viewport — `paneBox.x + paneBox.width ≤ window.innerWidth` (no horizontal scroll)
and `paneBox.x ≥ tree-rail right edge` (no rail overlap).

---

## UC-S005-4 — Markdown + Mermaid rendering

**AC-S005-4-1** — Markdown table renders as HTML table
Select a node whose slice.md contains a markdown table (e.g. any slice with a "Success
measures" table); pane contains a `<table>` element; the raw pipe `|` characters are not
visible as literal text at the top level of the rendered output.

**AC-S005-4-2** — Markdown code block renders as styled code
Select a node whose slice.md contains a fenced code block; pane contains a `<code>` or
`<pre><code>` element.

**AC-S005-4-3** — Null markdown input: no throw
Pass null/undefined to MarkdownRenderer; component renders "not yet available" or empty
without throwing a JS exception (automation: no `console.error` during render).

**AC-S005-4-4** — Mermaid null input: no throw
Pass null/undefined to MmdRenderer; component renders placeholder without JS exception.

---

## UC-S005-5 — Item history panel

**AC-S005-5-1** — History rows visible for real item **[REAL-DATA — primary EXP-033 case]**
Tester selects UC-S001-1 node in the live app. The item history sub-panel within the
detail pane shows at least one row with `event = task_start` or `event = task_end`.
Tester opens `process/dora/ledger.csv`, filters rows where `item_id = UC-S001-1`, counts
them manually, and records: item_id, expected_rows, actual_rows_rendered, match (yes/no).
Acceptance passes only if match = yes AND expected_rows ≥ 1.

**AC-S005-5-2** — History rows ordered newest-first
First row in the history panel has the most recent timestamp; last row has the oldest
(automation: compare `data-timestamp` attributes of first and last row elements).

**AC-S005-5-3** — Each history row shows required fields
Every history row element contains visible text for: timestamp, event type, agent; and
optionally duration_s and note when non-empty.

**AC-S005-5-4** — Empty history renders placeholder, not crash
Select a node whose item_id does not appear in the ledger (e.g. a newly created CHK node
with no ledger rows); history panel shows "no history yet" or equivalent placeholder; no
JS exception.

**AC-S005-5-5** — History updates on SSE event (real-data linkage)
With a node selected, append a new ledger row for that item_id to `process/dora/ledger.csv`;
history panel re-fetches and the new row appears within the configured SSE window without
manual reload. (Covered fully by AC-S005-6-2 below; listed here for traceability.)

---

## UC-S005-6 — Zoom breadcrumb + SSE live refresh

**AC-S005-6-1** — Breadcrumb renders at all drill levels
- At pipeline map level: breadcrumb shows "Pipeline" or the project name
- After clicking a CHK node: breadcrumb shows "Pipeline > CHK-4" (or equivalent path)
- After clicking a SLC within that CHK: breadcrumb shows "Pipeline > CHK-4 > s005"
- After clicking a UC within that SLC: breadcrumb shows the UC id

**AC-S005-6-2** — Tree re-renders on items.csv change without reload **[REAL-DATA]**
Tester: (1) notes current node count; (2) appends a syntactically-valid test row to
`work/observatory/items/items.csv`; (3) waits ≤ configured-N-seconds; (4) confirms
tree node count incremented by 1 without manual browser reload; (5) removes the test row.

**AC-S005-6-3** — History re-fetches on SSE event without reload
With UC-S001-1 node selected: tester appends a new ledger row for `item_id=UC-S001-1` to
`process/dora/ledger.csv`; within ≤ configured-N-seconds the history panel row count
increases by 1 without manual reload.

**AC-S005-6-4** — "Back to map" is accessible from the detail pane keyboard
Keyboard-only user: Tab to the "Back to map" breadcrumb control; press Enter; value-stream
map becomes the primary visible region. (Meets §8 keyboard-navigable requirement.)

---

## Real-data done-condition (EXP-033) — slice-level summary

The slice is NOT accepted if all passes are against fixture/mocked data. The tester MUST
run and pass ALL cases marked `[REAL-DATA]` against the live repo files at the time of
validation. Result.md must contain a table:

| Case | Item ID used | Expected rows / nodes | Actual rows / nodes | Match |
|------|-------------|----------------------|--------------------|----|
| AC-S005-1-1 | UC-S001-1 | (tester fills in) | (tester fills in) | yes/no |
| AC-S005-2-1 | (items.csv row count) | (tester fills in) | (tester fills in) | yes/no |
| AC-S005-2-3 | CHK-1, CHK-4 | done, backlog | (tester fills in) | yes/no |
| AC-S005-5-1 | UC-S001-1 | ≥ 1 | (tester fills in) | yes/no |
| AC-S005-6-2 | (appended test row) | count + 1 | (tester fills in) | yes/no |

All rows must show match = yes for the slice to be marked done.

---

## a11y + geometry conditions (WCAG 2.2 AA) — co-authored by ui-designer

Checkable via axe / Playwright / computed-style / bounding-box. Source:
`slices/s005-workitem-tree/ui-design.md` §4. These mirror the rigor of the
s002/s004 GEO+A11Y blocks and are tester-enforced.

**A11Y-S005-1** — Tree is keyboard-navigable (2.1.1 / WAI-ARIA tree)
`role="tree"` with `role="treeitem"` roving-tabindex children. Tab reaches exactly
ONE tree node; ↑/↓ move focus; → expands a collapsed branch; ← collapses; Enter/Space
on a focused node opens `data-testid="detail-pane"`.

**A11Y-S005-2** — Node accessible name carries type + state + value/cost
Every `treeitem`'s accessible name includes type, state text, and value/cost. The
state text label is visible content (`data-state` + text sibling — links AC-S005-2-6),
never colour-only.

**A11Y-S005-3** — Detail pane is a labelled region with managed focus (1.3.1 / 2.4.3)
`data-testid="detail-pane"` is `role="region" aria-label="Item detail: <id>"`; focus
moves into the pane on open; on close (Back-to-map / Esc / ×) focus returns to the
**originating tree node** (DEFECT-006 revision — was `value-stream-map`; the non-modal
drawer drops the keyboard user back where they were). NON-MODAL: no `aria-modal`, no focus
trap — the tree and map stay operable while the drawer is open. "Back to map" additionally
surfaces `data-testid="value-stream-map"` (links AC-S005-3-6).

**GEO-S005-3b** — Opening the pane does NOT reflow the value-stream map (DEFECT-006)
The floating drawer is `position:fixed` with its own stacking context, so the map's layout
is identical open vs closed. Automation per **AC-S005-3-7**: map bounding box, main-column
height, and page `scrollHeight` are all unchanged when the pane opens; the drawer floats
above the map (intentional z-index overlap), stays within the viewport (no horizontal
scroll), and its left edge ≥ the tree-rail right edge (extends GEO-S005-3).

**A11Y-S005-4** — Drill + zoom-out are keyboard-operable (2.1.1)
Node Enter drills in; Tab to `data-testid="back-to-map"` + Enter, OR Esc, surfaces the
value-stream map as the primary visible region (links AC-S005-6-4). No hover/click-only path.

**A11Y-S005-5** — Breadcrumb is a labelled nav, current crumb marked (1.3.1)
`<nav aria-label="Zoom path">`; `aria-current` on the active crumb; each crumb
keyboard-operable; `▸` separators `aria-hidden`.

**A11Y-S005-6** — /process vs /work is non-colour-redundant (1.4.1 Use of Colour)
The space distinction carries a visible text label ("work"/"process") AND an icon in
addition to the colour band; distinct `data-space` values yield distinct visible text
(links AC-S005-2-5).

**A11Y-S005-7** — Contrast (1.4.3 / 1.4.11)
All node text ≥ 4.5:1 on its surface; state-band and space-band edges ≥ 3:1 vs surface;
selected/focus ring reuses `--focus-ring` (≥ 3:1, ≥ 2px).

**A11Y-S005-8** — Target size (2.5.8)
The disclosure toggle and every node hit area ≥ 24×24px (`--target-min`).

**A11Y-S005-9** — Reduced motion (2.3.3)
Under `prefers-reduced-motion: reduce`, expand/collapse and pane-open transitions are
0ms; SSE re-render swaps content instantly with no scroll/focus loss (links AC-S005-6-2/3).

**A11Y-S005-10** — Mermaid SVG is not a bare graphic (1.1.1)
Rendered `.mmd` `<svg>` has `role="img"` + an `aria-label`; markdown renders as real
semantic HTML, not a `<pre>` blob (links AC-S005-3-2).

**GEO-S005-1** — Tree is an INDENTED hierarchy, not a flat list
For any parent→child pair, the child node label's `getBoundingClientRect().left` >
the parent's by ≥ `--tree-indent` (16px), across ≥ 2 depth levels (left offsets
strictly increase with depth). (The s002-board-as-a-line guard applied to the tree.)

**GEO-S005-2** — History rows STACK vertically in order
Each `data-testid="history-row"` top offset strictly increases; all rows share a left
offset (a list, not a grid; reuses the s003 TimeThiefView guard).

**GEO-S005-3** — Detail pane does NOT illegibly overlap the tree
When open, the pane's bounding-box left edge ≥ the tree rail's right edge; both regions
have non-zero, non-overlapping content areas.

**GEO-S005-4** — Selected node and its open pane are visually linked
The selected `treeitem` has `aria-selected="true"` and a visible selected affordance
while its detail pane is open.

---

## Acceptance tag index

| Tag | UC | Description |
|-----|----|-------------|
| AC-S005-1-1 | UC-S005-1 | Known item returns rows [REAL-DATA] |
| AC-S005-1-2 | UC-S005-1 | Unknown item returns empty array |
| AC-S005-1-3 | UC-S005-1 | Rows ordered newest-first |
| AC-S005-1-4 | UC-S005-1 | Tolerant parser — comment lines |
| AC-S005-1-5 | UC-S005-1 | Header-only ledger returns empty array |
| AC-S005-1-6 | UC-S005-1 | No second ledger parser introduced |
| AC-S005-2-1 | UC-S005-2 | Node count matches live items.csv [REAL-DATA] |
| AC-S005-2-2 | UC-S005-2 | Correct hierarchy |
| AC-S005-2-3 | UC-S005-2 | CHK-1 done, CHK-4 backlog [REAL-DATA] |
| AC-S005-2-4 | UC-S005-2 | Space-tag badge on every node |
| AC-S005-2-5 | UC-S005-2 | /work vs /process visually distinct |
| AC-S005-2-6 | UC-S005-2 | State is never colour-only |
| AC-S005-2-7 | UC-S005-2 | Value and cost visible on each node |
| AC-S005-3-1 | UC-S005-3 | Pane opens on node click |
| AC-S005-3-2 | UC-S005-3 | slice.md renders as styled HTML |
| AC-S005-3-3 | UC-S005-3 | .mmd artifact renders as SVG |
| AC-S005-3-4 | UC-S005-3 | Absent artifact renders gracefully |
| AC-S005-3-5 | UC-S005-3 | Breadcrumb shows zoom path |
| AC-S005-3-6 | UC-S005-3 | "Back to map" returns to value-stream map |
| AC-S005-3-7 | UC-S005-3 | Opening pane does NOT reflow the map [DEFECT-006] |
| AC-S005-4-1 | UC-S005-4 | Markdown table renders as HTML table |
| AC-S005-4-2 | UC-S005-4 | Code block renders as styled code |
| AC-S005-4-3 | UC-S005-4 | Null markdown input: no throw |
| AC-S005-4-4 | UC-S005-4 | Mermaid null input: no throw |
| AC-S005-5-1 | UC-S005-5 | History rows for real item [REAL-DATA] |
| AC-S005-5-2 | UC-S005-5 | History rows newest-first |
| AC-S005-5-3 | UC-S005-5 | History rows show required fields |
| AC-S005-5-4 | UC-S005-5 | Empty history renders placeholder |
| AC-S005-5-5 | UC-S005-5 | History updates on SSE event |
| AC-S005-6-1 | UC-S005-6 | Breadcrumb at all drill levels |
| AC-S005-6-2 | UC-S005-6 | Tree re-renders on items.csv change [REAL-DATA] |
| AC-S005-6-3 | UC-S005-6 | History re-fetches on SSE event |
| AC-S005-6-4 | UC-S005-6 | "Back to map" keyboard accessible |
| A11Y-S005-1 | UC-S005-2 | Tree keyboard-navigable (WAI-ARIA tree) |
| A11Y-S005-2 | UC-S005-2 | Node name carries type+state+value/cost |
| A11Y-S005-3 | UC-S005-3 | Detail pane labelled region + managed focus |
| A11Y-S005-4 | UC-S005-6 | Drill + zoom-out keyboard-operable |
| A11Y-S005-5 | UC-S005-6 | Breadcrumb labelled nav, current crumb marked |
| A11Y-S005-6 | UC-S005-2 | /process vs /work non-colour-redundant |
| A11Y-S005-7 | UC-S005-2 | Contrast ≥ 4.5:1 text / ≥ 3:1 non-text |
| A11Y-S005-8 | UC-S005-2 | Target size ≥ 24×24px |
| A11Y-S005-9 | UC-S005-6 | Reduced motion 0ms; SSE instant swap |
| A11Y-S005-10 | UC-S005-3 | Mermaid SVG role=img; md is semantic HTML |
| GEO-S005-1 | UC-S005-2 | Tree is indented hierarchy, not flat list |
| GEO-S005-2 | UC-S005-5 | History rows stack vertically in order |
| GEO-S005-3 | UC-S005-3 | Detail pane does not overlap tree |
| GEO-S005-3b | UC-S005-3 | Opening pane does not reflow the map [DEFECT-006] |
| GEO-S005-4 | UC-S005-3 | Selected node visually linked to open pane |
