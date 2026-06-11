---
slice: s005-workitem-tree
chunk: CHK-4
mode: STRUCTURE
produced-by: ui-designer
date: 2026-06-10
status: structure-set (engineer builds against this; ui-designer polishes after)
---

# UI design (STRUCTURE) — s005 Work-item tree & zoom/drill

Serves **J2 (CORE)** — navigate REQ→CHK→SLC→UC and drill into detail, fluidly
between the whole and the part. EXTENDS the existing design system (s002/s003/s004
tokens, the `data-source`/SourceLink convention, the §8 redundant-encoding rule,
the constraint `◆` channel, LiveStatusDot, the existing SSE channel). Nothing in
the value-stream map is re-laid-out. Token-based custom components (no library).

---

## 1. IA / layout — tree + drill + zoom-out

**One-liner:** The work-item tree opens as a **left rail panel** alongside the
existing `<main>` dashboard; clicking a node **drills** into a **right detail
pane** (artifacts + history) overlaid above the dashboard; an explicit
**breadcrumb / "Back to map"** zooms out and returns focus to the value-stream
map. Single screen, keyboard-navigable, no route change.

The drill model from requirements §7 (`pipeline → queue → item → slice-artifact`)
maps onto the tree hierarchy: the value-stream map IS the pipeline level (the
zoomed-out home); the tree is the item level; the detail pane is the
slice-artifact level. Zoom-out is the explicit return path at every level.

```
+-----------------------------------------------------------------------------+
| Observatory  ·  LiveStatusDot (reused)                                      |
+----------------------+------------------------------------------------------+
| [WorkItemTree rail]  |  <main> (existing, unchanged)                         |
|  region "Work items" |    ├─ ValueStreamMap   (s004 — the "pipeline" level)  |
|  ┌────────────────┐  |    ├─ DoraPanel        (s003)                         |
|  │ ▾ REQ-OBSERV.  │  |    ├─ StageCardGrid    (s003)                         |
|  │   ▾ CHK-1 done │  |    └─ TimeThiefView    (s003)                         |
|  │     ▸ s00x …   │  |                                                       |
|  │   ▾ CHK-4 back │  |  --- on node click, DetailPane opens over <main> ---  |
|  │       UC-…     │  |  +-------------------------------------------------+  |
|  └────────────────┘  |  | [Breadcrumb]  Pipeline ▸ CHK-4 ▸ s005 ▸ UC-…   |  |
|                      |  | [Back to map]                            [×]    |  |
|                      |  | DetailPane  region "Item detail: <id>"          |  |
|                      |  |   ArtifactView (markdown + .mmd)                |  |
|                      |  |   ItemHistoryPanel (ledger rows, newest-first)  |  |
|                      |  +-------------------------------------------------+  |
+----------------------+------------------------------------------------------+
```

- **Tree rail** is a persistent left landmark (`role="region" aria-label="Work
  items"`). It does not push the map off-screen; on narrow widths it collapses to
  a toggle (desktop-first per project scope — mobile out of scope).
- **Detail pane** opens as a **non-modal overlay region** anchored right, over
  `<main>`. It does NOT cover the tree rail (tree stays visible/navigable while
  reading detail — the "whole and the part" requirement). Geometry guard GEO-3
  asserts the pane's left edge ≥ the tree rail's right edge (no illegible
  overlap of tree and pane).
- **Zoom-out** is the Breadcrumb root ("Pipeline" / project name) + a "Back to
  map" control + an `×` close. Any of them closes the pane and returns focus to
  `data-testid="value-stream-map"` (AC-S005-3-6 / AC-S005-6-4).

### Click-path budgets (J2 core jobs)
| Job | Budget | s005 reality |
|---|---|---|
| "See the whole work-item tree" (J2 overview) | **0 clicks** — tree renders on open | tree rail populated from `/items` on load |
| "Open any item's detail (artifacts + history)" | **1 click** (or Enter on focused node) | node click → DetailPane opens with artifact + history |
| "Read a slice artifact / diagram" | **1 click** (same drill) | ArtifactView renders markdown/`.mmd` in the pane |
| "See an item's ledger history" | **1 click** (same drill) | ItemHistoryPanel co-renders in the pane |
| "Zoom back out to the map" | **1 click / 1 key** | Breadcrumb root / Back-to-map / `×` / Esc |
| "Expand or collapse a subtree" | **1 click / arrow key** | TreeNode disclosure toggle |

Justification: every interrogation job (artifact + history, the SM1 mechanism)
is reachable in a **single interaction** from the tree, and the tree itself is
**0-click** on load. Drill and zoom-out are symmetric (1 in / 1 out) so the
operator never loses the path back — the §7 "clear path back out" requirement.

---

## 2. Component decomposition

All new. Data shapes from `GET /api/projects/:id/items` (typed records:
`{id, type, parent, children, job, state, value, cost, vc_ratio}` + a `space`
field — see §3), `/slices/:slug/:artifact` (raw text), `/deps/:artifact` (`.mmd`),
`/ledger?item_id=<id>` (history rows). Every figure reuses the `data-source`
convention.

### WorkItemTree  (UC-S005-2)
- **Role:** the left-rail landmark holding the full REQ→CHK→SLC→UC hierarchy as a
  keyboard-navigable tree.
- **Props:** `{ items: ItemRecord[]; selectedId: string|null; onSelect(id);
    expanded: Set<id>; onToggle(id); sourceRef: string }`.
- **States:** default (N nodes) · empty ("No work items", header-only items.csv)
  · loading (region + heading immediate, nodes fill ≤ 2s) · live (SSE re-fetch).
- **Selector:** `role="tree"` + `aria-label="Work items"`;
  `data-testid="work-item-tree"`. Builds the tree from `parent`/`children`; REQ
  at root.
- **A11y:** WAI-ARIA `tree` pattern. Roving `tabindex` (one node tabbable; arrow
  keys move focus — A11Y-1). Node count on render = items.csv row count
  (AC-S005-2-1).
- **Library:** custom.

### TreeNode  (UC-S005-2)
- **Role:** one work item — disclosure toggle, type glyph, name/job, state badge,
  value/cost badge, space-tag badge. The unit of the tree.
- **Props:** `{ item: ItemRecord; depth: number; isExpanded: bool; hasChildren:
    bool; isSelected: bool; onSelect; onToggle }`.
- **States:** default · hover · focus (roving) · selected · expanded · collapsed
  · leaf (no disclosure) · state-variants (the items.csv `state` value) ·
  space-variant (`/work` vs `/process`).
- **Selector:** `role="treeitem"`; `data-testid="tree-node"` (every node);
  `data-item-id="<id>"`; `data-type="REQ|CHK|SLC|UC|DEF"`; `data-state="<state>"`;
  `data-space="work|process"`; `data-value="<value>"`; `data-cost="<cost>"`;
  `aria-level="<depth>"`; `aria-expanded` (branch nodes only);
  `aria-selected="true|false"`.
- **Accessible name (carries type+state+value/cost — A11Y-2):** e.g.
  `"CHK-4, checkpoint, work-item tree & zoom/drill, state backlog, value high,
  cost M"`. State text label is a visible sibling (`data-state` + visible text —
  AC-S005-2-6), never colour-only.
- **State encoding (REUSES §8 redundant rule):** state = type glyph (shape) +
  visible text label (authoritative) + colour band (`--c-tree-state-*`). The
  three differ in lightness + text, surviving greyscale.
- **/work vs /process** distinction: see §3.
- **Geometry (GEO-1):** child nodes are **indented** relative to parents — a
  node's content left offset strictly increases with `aria-level` (an indented
  hierarchy, NOT a flat list). Assert: a child node's `getBoundingClientRect().left`
  (content start) > its parent's by ≥ `--tree-indent`.
- **Library:** custom.

### DetailPane  (UC-S005-3 — shell; UC-S005-4/5 compose in)  ⚠ REVISED by DEFECT-006
- **Role:** the right-anchored non-modal detail region opened on drill.
  **DEFECT-006 supersedes the positioning below** — see the **"DEFECT-006:
  floating drawer"** subsection at the end of this section. CONTENT is unchanged.
- **Props:** `{ item: ItemRecord|null; artifact: ArtifactPayload|null;
    history: LedgerRow[]; onClose; sourceRef }`.
- **States:** closed (absent) · open · loading (region + breadcrumb immediate) ·
  artifact-absent ("not yet available" placeholder, no crash — AC-S005-3-4).
- **Selector:** `role="region"` + `aria-label="Item detail: <id>"`;
  `data-testid="detail-pane"`. Contains Breadcrumb, ArtifactView, ItemHistoryPanel.
- **A11y:** labelled region (not a modal — tree stays operable). On open, focus
  moves to the pane heading; on close, focus returns to the originating tree node
  (DEFECT-006 revision — see below; was "value-stream map"). Esc closes (zoom-out).
- **Library:** custom.

#### DEFECT-006: floating drawer (supersedes the in-flow positioning)

**What shipped & why it broke (evidence, :5199 Playwright, 1440×900):** the pane
was built as an **in-flow** element inside `.observatory-main-col` —
`position:sticky; width:min(440px,42vw); margin-left:auto` — the SAME column as
the wide multi-lane value-stream map. Opening it appended the pane BELOW the map
in that column: measured the main column grew **+690px** and the page
`scrollHeight` grew **+690px** on open (`/tmp/defect-006-before.png` vs
`/tmp/defect-006-closed.png`). The pane reflows the page and competes with the
map for the column — the drill-down is visually broken on the CORE navigate job.
(The map's own `boundingBox` width didn't shrink in the top-of-page measurement
because the pane stacks vertically below it, not beside it — but the document
reflow / sticky-competition IS the break, which is why a *map-bbox-only* guard at
build time missed it and a *column-height / page-reflow* guard is now added.)

**The fix — right-anchored NON-MODAL floating drawer:**
- **Containment:** `position: fixed`, anchored to the right viewport edge
  (`top: var(--drawer-inset); right: var(--drawer-inset); bottom:
  var(--drawer-inset)`), `width: var(--drawer-width)` (`min(440px,38vw)`, FIXED),
  `z-index: var(--z-drawer)` (40), `box-shadow: var(--drawer-elev)`,
  `max-height` bounded by the inset so the body scrolls internally. Because it is
  `fixed`, the pane is **removed from `.observatory-main-col`'s flow** → the
  column and the map do NOT grow or reflow when it opens. This is the core
  acceptance (GEO-S005-3b).
- **Move it OUT of the column in the DOM too:** the engineer should render
  `<DetailPaneContainer>` as a sibling of `.observatory-layout` (e.g. a direct
  child of the App `<main>` or a portal-style last child of `.observatory-layout`),
  NOT nested inside `.observatory-main-col`. A `fixed` element escapes flow
  regardless of DOM parent, but lifting it out of the column makes the
  "doesn't affect the column" contract structural, not just visual. *(This is the
  one composition edit in `ObservatoryView.jsx` — a positioning/containment move,
  no behaviour/data-flow change; the lifted `selectedId/onClose/selectedItem`
  wiring is unchanged.)*
- **Modal vs non-modal — NON-MODAL, NO scrim (justified):** the requirement is
  "the whole and the part" — read the map AND the item detail together. A modal
  scrim would dim/block the map and defeat that, and would also force a focus
  trap. So: no backdrop, no `aria-modal`, no focus trap. The map stays fully
  readable beside/behind the drawer (the left ~62% of the 1440px map is
  uncovered; the tree rail is never covered — the drawer's left edge ≈ 916px,
  far right of the rail's ~307px right edge).
- **Closeable:** Esc + a visible `×` close affordance + the "Back to map"
  breadcrumb control. (No scrim → no click-scrim-to-close; the three explicit
  controls cover dismissal.)
- **Focus management (non-modal = focus-MOVE, not trap):** on open, focus moves
  to the pane heading (`detail-pane-heading`, `tabindex=-1`) — unchanged. On
  close, focus RETURNS to the **originating tree node** (the `treeitem` that was
  clicked), not the map. Rationale: a non-modal drawer should drop the keyboard
  user back where they were so they can drill the next sibling node without
  re-traversing; returning to the map (the old behaviour) loses their place. The
  container already owns the close path, so it captures the originating node ref
  and restores focus there. "Back to map" ALSO scrolls/surfaces the
  `value-stream-map` as the primary visible region (AC-S005-3-6 preserved).
- **Reduced motion:** slide-in over `--dur-drawer` (160ms) only under
  `prefers-reduced-motion: no-preference`; under `reduce` the drawer appears
  instantly (0ms) — A11Y-S005-9.
- **No horizontal scroll / no rail overlap:** `--drawer-inset` keeps the drawer
  off the right edge; the fixed width + inset guarantee it fits the viewport
  (`right + width ≤ viewport`), so no horizontal scrollbar appears; the left edge
  stays right of the tree rail (GEO-S005-3).

**Engineer's change (positioning/containment ONLY — no behaviour change):**
1. `ObservatoryView.jsx`: move `<DetailPaneContainer>` out of `.observatory-main-col`
   to a sibling of (or portal from) `.observatory-layout`. Wiring unchanged.
2. `detail-pane.css`: replace the `.detail-pane` block — `position:sticky` /
   `width:min(440px,42vw)` / `margin-left:auto` → `position:fixed` + the
   `--drawer-*` tokens above; add the slide-in transition gated on
   `prefers-reduced-motion`.
3. `DetailPaneContainer` (or `ObservatoryView`): capture the originating tree
   node element on select; on close, restore focus to it (was: map).

### ArtifactView  (UC-S005-3/4)
- **Role:** renders the item's slice artifact — markdown as styled HTML, `.mmd`
  as live Mermaid SVG.
- **Props:** `{ kind: "md"|"mmd"|null; text: string|null; source: string }`.
- **Composes:** `MarkdownRenderer` (md → HTML; tables `<table>`, code
  `<pre><code>`, headings/lists — AC-S005-4-1/2) and `MmdRenderer`
  (`.mmd` → `<svg>` inside `data-testid="mmd-render"` — AC-S005-3-3).
- **States:** md · mmd · empty/null ("not yet available", no throw —
  AC-S005-4-3/4).
- **Selector:** `data-testid="artifact-view"`; carries non-empty `data-source`
  (the slice/artifact path). Markdown output has NO top-level `<pre>` of raw
  source (AC-S005-3-2).
- **A11y:** rendered HTML is real semantic content (headings reachable by heading
  nav). Mermaid `<svg>` gets `role="img"` + an `aria-label` naming the diagram;
  decorative internals `aria-hidden`. Both renderers fail soft.
- **Library:** custom wrapper; markdown + mermaid libs are client-side deps
  (version + bundle size confirmed at architect gate — see §6 open items).

### ItemHistoryPanel  (UC-S005-5)
- **Role:** the item's ledger event history — the primary interrogation
  affordance (SM1 answer mechanism).
- **Props:** `{ rows: LedgerRow[]; itemId: string; source: string }`.
- **States:** default (N rows, newest-first) · empty ("no history yet", no crash
  — AC-S005-5-4) · loading · live (SSE re-fetch — AC-S005-6-3).
- **Selector:** `role="region"` + `aria-label="Item history: <id>"`;
  `data-testid="item-history"`. Rows are a `role="list"`; each row
  `data-testid="history-row"` + `data-timestamp="<iso>"`. Carries
  `data-source="process/dora/ledger.csv#item_id=<id>"`.
- **Each row shows (AC-S005-5-3):** timestamp · event type · agent · `duration_s`
  (when present) · outcome · note. Newest-first (AC-S005-5-2: first row
  `data-timestamp` ≥ last row's).
- **A11y/geometry (GEO-2):** rows STACK vertically in timestamp order — each
  row's top offset strictly increases AND rows share a left offset (a list, not a
  grid; the s003 TimeThiefView guard reused). Row text is labelled (event/agent
  are dt/dd or column-headed). REAL-DATA: default view shows real non-zero rows
  for a real item (EXP-033 — AC-S005-5-1).
- **Library:** custom.

### ZoomBreadcrumb  (UC-S005-3/6)
- **Role:** the zoom-path trail + the explicit zoom-OUT controls.
- **Props:** `{ path: BreadcrumbStep[]; onZoomTo(step); onBackToMap }`.
- **States:** pipeline-level ("Pipeline" / project name) · item-level
  ("Pipeline ▸ CHK-4 ▸ s005 ▸ UC-S005-3" — AC-S005-6-1).
- **Selector:** `data-testid="breadcrumb"`; root crumb
  `data-testid="breadcrumb-root"`; "Back to map" `data-testid="back-to-map"`.
  Breadcrumb text includes the selected item id (AC-S005-3-5).
- **A11y:** `<nav aria-label="Zoom path">` with `aria-current="page"` on the
  current crumb. Each crumb is a keyboard-operable control (Tab + Enter —
  AC-S005-6-4); the separator `▸` is `aria-hidden`. "Back to map" reachable and
  operable by keyboard; returns focus to the map.
- **Library:** custom. Specialises the SourceLink affordance style (text + glyph,
  never colour-only).

### SpaceTagBadge  (UC-S005-2 — the /process-vs-/work distinction)
- See §3. `data-testid="space-tag"`; non-colour-redundant.

---

## 3. /process vs /work distinction (requirements §6/§8/§175 — assertion-ready)

The tree must visually AND structurally distinguish **persistent agent self-state
(`/process`)** from **resettable project output (`/work`)**, and the distinction
must NOT rely on colour alone (§8).

**Mechanism — three redundant cues per node, the §8 pattern applied:**

| Cue | `/work` | `/process` |
|---|---|---|
| **Text label (authoritative)** | visible text `"work"` | visible text `"process"` |
| **Icon (shape)** | `▤` (stacked/project glyph, `aria-hidden`) | `⚙` (gear/self-state glyph, `aria-hidden`) |
| **Colour band** | `--c-space-work` (teal channel) | `--c-space-process` (violet/neutral channel) |

- Every node carries `data-space="work|process"` (AC-S005-2-4: non-empty on every
  `[data-testid="tree-node"]`) and renders a `SpaceTagBadge`
  (`data-testid="space-tag"`) with the visible text label + icon + colour band.
- **Visually distinct (AC-S005-2-5):** distinct `data-space` values map to
  distinct computed colour bands (assert background/border colour differs between
  the two space values) AND distinct visible text labels — so the distinction
  survives greyscale and colour-blindness via text + glyph.
- **Structural partition:** `/process` items group under a labelled subtree (or a
  visually banded section) so process self-state is not interleaved
  ambiguously with project output — mirrors §175 "clearly partitioned". (For the
  observatory project the live tree is predominantly `/work`; the `/process`
  banding is the structural hook so the cue is present and assertable even when
  process items are few.)
- **Read-only safety (§6/§175):** this slice is read-only; no steer action exists
  to leak project specifics into `/process`. The distinction here is purely
  presentational + structural. (The "cannot be targeted by steer" guarantee is a
  Phase-2 concern; noted as NOT-designed-here in §7.)

**Source of `space`:** derived from the item's path/origin — `/process/*` items
(process self-state) vs `/work/*` items (project output). If `/items` does not
yet expose a `space` field, deriving it from the record origin is an enabler the
engineer owns; flag at architect gate (§6 open items). The UI contract is the
`data-space` attribute regardless of derivation.

---

## 4. Testable a11y + geometry conditions (WCAG 2.2 AA) — mirror into acceptance.md

These are checkable conditions (axe / Playwright / computed-style / bounding-box),
matching the rigor of the s002/s004 GEO+A11Y blocks. Each is also added to
`acceptance.md` so the tester enforces it.

### A11Y (WCAG 2.2 AA)
- **A11Y-1 — Tree is keyboard-navigable (2.1.1 / WAI-ARIA tree):** the tree is
  `role="tree"` with `role="treeitem"` children using roving `tabindex`. ↑/↓ move
  focus between visible nodes; → expands a collapsed branch (or moves to first
  child); ← collapses (or moves to parent); Enter/Space selects (drills). Assert:
  Tab reaches exactly ONE tree node; arrow keys move focus per pattern; Enter on
  a focused node opens the detail pane.
- **A11Y-2 — Node accessible name carries type + state + value/cost:** every
  `treeitem`'s accessible name includes the type, the state text, and the
  value/cost (e.g. "CHK-4, checkpoint, state backlog, value high, cost M"). State
  text label is present as visible content (`data-state` + text sibling —
  AC-S005-2-6), never colour-only.
- **A11Y-3 — Detail pane is a labelled region with managed focus (1.3.1 / 2.4.3):**
  `data-testid="detail-pane"` is `role="region" aria-label="Item detail: <id>"`;
  on open focus moves into the pane; on close (Back-to-map / Esc / ×) focus
  returns to the **originating tree node** (DEFECT-006 revision — was the
  value-stream map; the non-modal drawer drops the keyboard user back where they
  were). "Back to map" ADDITIONALLY surfaces `data-testid="value-stream-map"` as
  the primary visible region (AC-S005-3-6). NON-MODAL: no `aria-modal`, no focus
  trap — the tree and map stay operable while the drawer is open.
- **A11Y-4 — Drill + zoom-out are keyboard-operable (2.1.1):** node Enter drills
  in; Tab to "Back to map" + Enter, OR Esc, zooms out and surfaces the map as the
  primary visible region (AC-S005-6-4). No hover-only or click-only path.
- **A11Y-5 — Breadcrumb is a labelled nav, current crumb marked (1.3.1):**
  `<nav aria-label="Zoom path">` with `aria-current` on the active crumb; each
  crumb keyboard-operable; separators `aria-hidden`.
- **A11Y-6 — /process vs /work is non-colour-redundant (1.4.1 Use of Colour):**
  the space distinction carries a visible text label AND an icon in addition to
  the colour band; distinct `data-space` values yield distinct visible text
  (AC-S005-2-5).
- **A11Y-7 — Contrast (1.4.3 / 1.4.11):** all node text ≥ 4.5:1 on its surface;
  state-band and space-band borders/edges ≥ 3:1 vs surface (non-text UI);
  selected/focus ring reuses `--focus-ring` (≥ 3:1, ≥ 2px). New
  `--c-tree-state-*` / `--c-space-*` tokens carry their contrast pairing in
  design-system.md.
- **A11Y-8 — Target size (2.5.8):** the disclosure toggle and every node hit area
  ≥ `--target-min` (24×24px).
- **A11Y-9 — Reduced motion (2.3.3 / animation):** expand/collapse and pane-open
  transitions collapse to 0ms under `prefers-reduced-motion: reduce`; SSE
  re-render swaps content instantly with no scroll/focus loss (AC-S005-6-2/3).
- **A11Y-10 — Mermaid SVG is not a bare graphic (1.1.1):** rendered `.mmd` `<svg>`
  has `role="img"` + an `aria-label` naming the diagram; markdown renders as real
  semantic HTML (headings reachable), not a `<pre>` blob (AC-S005-3-2).

### GEO (visual-structural correctness — shape carries meaning)
- **GEO-1 — Tree is an INDENTED hierarchy, not a flat list:** for any parent→child
  pair, the child node's content left offset >  the parent's by ≥ `--tree-indent`
  (e.g. 16px). Assert via `getBoundingClientRect().left` of the node label across
  ≥ 2 depth levels: distinct, strictly increasing left offsets with depth. (This
  is the s002-board-as-a-line guard applied to the tree — a tree that renders as a
  flat ungrouped list passes presence tests but is structurally wrong.)
- **GEO-2 — History rows STACK vertically in order:** each `history-row` top
  offset strictly increases; all rows share a left offset (a list, not a grid;
  reuses the s003 TimeThiefView guard).
- **GEO-3 — Detail pane does NOT illegibly overlap the tree:** when the pane is
  open, its bounding-box left edge ≥ the tree rail's right edge (pane is anchored
  beside/over `<main>`, never on top of the tree). Both regions have non-zero,
  non-overlapping content areas.
- **GEO-3b — Opening the pane does NOT reflow the value-stream map (DEFECT-006,
  the key regression guard):** capture `[data-testid="value-stream-map"]`'s
  `getBoundingClientRect()` with the pane CLOSED, open the pane (click a tree
  node), and assert the map's box is **IDENTICAL** (x/y/width/height within ≤ 1px)
  with the pane open. ALSO assert `.observatory-main-col` height and
  `document.documentElement.scrollHeight` are unchanged (± the drawer's own height
  must NOT be added — the in-flow build added +690px; the float adds 0). The
  drawer floats above the map (intentional z-index overlap) and is within the
  viewport (`right + width ≤ innerWidth`, no horizontal scroll). This is the guard
  the in-flow build lacked — a map-bbox-only check passed because the pane stacked
  vertically; the page-reflow / column-height check is what catches it.
- **GEO-4 — Selected node and its open pane are visually linked:** the selected
  `treeitem` has `aria-selected="true"` and a visible selected affordance while
  its detail pane is open (state continuity across the drill).

---

## 5. Stable selectors (build contract + test hooks) — summary

| Element | Selector | Carries |
|---|---|---|
| Tree | `role=tree` `data-testid=work-item-tree` | — |
| Node | `role=treeitem` `data-testid=tree-node` | `data-item-id, data-type, data-state, data-space, data-value, data-cost, aria-level, aria-expanded, aria-selected` |
| Space tag | `data-testid=space-tag` | visible "work"/"process" + icon |
| Detail pane | `role=region` `data-testid=detail-pane` | `aria-label="Item detail: <id>"` |
| Artifact | `data-testid=artifact-view`; `.mmd`→`data-testid=mmd-render` | `data-source` |
| History | `role=region` `data-testid=item-history`; rows `data-testid=history-row` | `data-timestamp, data-source` |
| Breadcrumb | `data-testid=breadcrumb`; root `breadcrumb-root`; `back-to-map` | item id in text, `aria-current` |

---

## 6. Open items for the architect gate (NOT my decisions)
- **Markdown + Mermaid client libs:** version + bundle-size confirmation (UC-S005-3/4).
- **`space` field on `/items`:** if absent, deriving `/process` vs `/work` from
  record origin is an engineer enabler — confirm at gate. UI contract is
  `data-space` regardless.
- **`ledgerAggregator.js` extraction** for the new `/ledger` route (UC-S005-1) —
  per use-cases shared-seam note.

## 7. Explicitly NOT designed in this slice
- No steer / mutation affordances (Phase 2) — read-only per §145.
- No "cannot be targeted by steer" enforcement on `/process` (Phase-2 concern;
  only the presentational + structural partition is built here).
- No WIP-navigator / collision history / interrogate-prompt composition (Phase 2).
- No mobile layout (project scope: desktop-first, mobile out of scope).
- No new route/URL — drill is in-page state, not navigation.
