# UI design — s015 WIP navigate & re-slice/split before/after preview

Applies: **yes** — user-facing interactive surface (a navigable WIP list panel
reachable from the app's primary navigation).
Mode: STRUCTURE (before-build), scoped to **UC-S015-1** only (WIP navigation
panel: list + time-in-stage sort). UC-S015-2 (steer routing), UC-S015-3
(ReslicePreviewPanel) and UC-S015-4 (enriched prompt) get their own STRUCTURE
rows when pulled.

Library: none (token-based custom, per `design/components.md`). New component
themed entirely through `src/app/src/styles/tokens.css`; no new token system.

---

## Surfaces touched (screens/routes)

Single-page dashboard `/` — no new browser route. UC-S015-1 adds ONE new
view-region (`WipPanel.jsx`) plus ONE nav entry that switches it into view.

| Surface | Host / attach point | Change |
|---|---|---|
| Primary navigation | `ObservatoryView.jsx` `.observatory-layout` (the existing tree-rail \| main-col \| drawer layout) | add a **view-switch nav control** (a `role="tablist"` of two view entries: "Pipeline" and "In-flight WIP"); read-only addition — no behaviour change to the tree rail / VSM |
| WIP panel view | new `WipPanel.jsx` rendered in the **main column** when the WIP view is active | the panel REPLACES the VSM in the main column (view-switch), it does NOT stack on top of it — the VSM is still reachable in 1 click via the "Pipeline" nav entry |

**No-reflow decision (EXP-016): a ROUTED/SWITCHED VIEW, not an overlay.** The two
candidate models from the prompt are overlay vs routed view. I choose **routed
view (a view-switch in the main column)** for UC-S015-1, because:
- the WIP panel is a *destination* the operator navigates TO and dwells in
  (browses, sorts, picks an item), not a transient reveal over the VSM — an
  overlay over a live VSM would be a competing surface, not a navigation target;
- view-switching means the VSM is unmounted while the WIP view is mounted, so
  there is literally no "opening the WIP panel reflows the VSM" failure mode — the
  two surfaces never co-exist in the flow. The EXP-016 invariant is satisfied
  structurally: the VSM's bbox while the WIP view is active is N/A (absent), and
  switching back restores the VSM to its byte-identical pre-switch layout
  (GEO-S015-1 below asserts exactly this).
- the tree rail stays mounted and unchanged across the switch (the operator does
  not lose their work-item context) — only the main column's content swaps.

The steer panel / ReslicePreviewPanel that OPEN FROM a WIP row (UC-S015-2/3) ARE
overlays (portalled, `position:fixed`, the s014 SteerMenu/DEFECT-006 discipline)
— but that is designed in the UC-S015-2/3 STRUCTURE passes, not here. UC-S015-1's
done-condition is the list rendering, sorted, with the nav entry — no steer
affordance yet (the row exposes a `data-item-id` slot the later UC composes into).

---

## Navigation / IA delta

The dashboard gains an explicit **two-view switch** in the main column header
region (the tree rail is orthogonal and persists across both):

```
[WorkItemTree rail]  |  ┌─ view switch: ( Pipeline | In-flight WIP ) ──────────┐
  region "Work items"|  │  Pipeline view  → ValueStreamMap + DoRA + …          │
  (persists, unchanged)│  In-flight WIP   → WipPanel (this UC)                 │
                     |  └──────────────────────────────────────────────────────┘
```

- **Nav model = a `role="tablist"`**, not a sidebar tree of routes. Two views is
  too few for a sidebar; a horizontal tablist at the top of the main column is the
  shallowest IA (1 click to either view, both always visible, current view marked
  with `aria-selected`). This keeps IA depth at 1 and matches the operator's
  language ("Pipeline" / "In-flight WIP").
- **Default view on load = Pipeline** (the established at-a-glance home; J1 stays
  0-click — switching the default to WIP would regress the at-a-glance read).
- **Back/cancel path:** there is no modal stack here — the operator returns to the
  pipeline by clicking the "Pipeline" tab (1 click). No nav-stack growth.
- **Sort is fixed, not a control:** rows are pre-sorted longest-in-stage first
  (the items most likely to need action lead) — no sort dropdown, no extra click.
  Pre-sorting is a step REMOVED, not a control added (click-reduction heuristic).

`design/patterns.md` gains a CHK-6 nav row + click-path budget (mirrored below).

---

## Component decomposition (component → states → stable selector)

### ViewSwitch (new — `src/app/src/components/ViewSwitch.jsx`)
The two-view tablist control in the main-column header.

**Props:** `{ active: "pipeline" | "wip"; onSelect(view) }`

| Part | States | Notes |
|---|---|---|
| Tab "Pipeline" | default · hover · focus-visible · selected(`aria-selected`) | text label authoritative |
| Tab "In-flight WIP" | default · hover · focus-visible · selected | text label authoritative |

**Selectors:**
- Tablist: `getByRole('tablist', { name: 'Dashboard view' })`; `data-testid="view-switch"`.
- Each tab: `getByRole('tab', { name: 'Pipeline' })` / `getByRole('tab', { name: 'In-flight WIP' })`;
  `data-testid="view-tab-pipeline"` / `data-testid="view-tab-wip"`; `data-view`; `aria-selected`.

### WipPanel (new — `src/app/src/components/WipPanel.jsx`)
The view-region listing every in-flight item, sorted longest-in-stage first.

**Props:** `{ items: WipItem[]; status: "loading"|"ready"|"empty"; horizonMs: number; sourceRef: string }`
where `WipItem = { id, job, stage, stageLabel, value, cost, dwellMs, dwellText, isStale }`
(shape produced by `useWipItems.js`, see state-shape note below).

**States:** default (N rows) · empty ("No items currently in flight") · loading
(region + heading immediate, rows fill ≤ 2s) · live (SSE re-fetch).

**Selectors:**
- Panel: `getByRole('region', { name: 'In-flight WIP' })`; `data-testid="wip-panel"`.
  Visible `<h2>` "In-flight WIP".
- Row list: `role="list"` inside the region.

### WipRow (new — child of WipPanel; one in-flight item)
**Props:** `{ item: WipItem }`

**States:** default · hover · focus-visible · **stale-open** (dwell > horizon —
see WIP-semantics below) · (steer-affordance slot, populated in UC-S015-2).

**Selectors:**
- Row: `role="listitem"`; `data-testid="wip-row"`; **`data-item-id="<id>"`** (the
  composition hook UC-S015-2's `SteerMenu` reads — same contract the tree row
  uses; one steer trigger per row added there, not here).
- `data-stale="true|false"` (stale-open flag, GEO/figure assertion hook).
- Each figure inside the row is a labelled `<dt>`/`<dd>` pair (id / job / stage /
  value / cost / time-in-stage) so no number/reference is announced bare.

### Reuse, not invent
No existing component is a flat sortable item-list (TimeThiefView is a ranked
read-only list with no per-row affordance slot; WorkItemTree is a hierarchical
tree). `WipPanel`/`WipRow`/`ViewSwitch` are genuinely new — recorded as new rows
in `design/components.md`. They reuse: the §8 redundant state-encoding rule (for
stale-open), `--c-text-dim` for the dwell line, `--fs-tree`/`--fs-tree-badge`/
`--fs-history` type steps, `--sp-*` spacing, `--focus-ring`, `--target-min`,
`--radius-box`/`--radius-badge`, the `data-item-id` selector contract, and the
SourceLink `data-source` convention. No off-token values.

---

## WIP semantics — recency horizon & the stale-open case (DEFECT-011)

**The panel uses the CURRENT recency horizon = 2 h** (DEFECT-011, sha e8f1d8e —
NOT the stale "30 min" / "≤30 min" wording in slice.md SM-S6-1 and use-cases.md
lines 28/102, which predate DEFECT-011's constant change; the panel must read the
horizon from the same source the VSM WIP signal uses, never hard-code a number —
EXP-035's "constants derived from observed distributions" rule). `horizonMs` is a
prop so the test asserts against the live value, not a literal.

**An open item OLDER than the 2 h horizon must NOT silently vanish from THIS
list.** The recency horizon governs the *at-a-glance VSM WIP chip* (it stops
phantom-stuck items polluting the headline). But the WIP NAVIGATION panel is
precisely where the operator goes to find items that have been stuck too long —
dropping the longest-dwelling items would hide exactly what the panel exists to
surface (the "each safety exclusion is a new failure surface" lesson, EXP-035).

So the panel shows: **all items with an open `task_start` and no `task_end`,
regardless of age** — and visually distinguishes the *stale-open* ones (dwell >
horizon) with a NON-COLOUR-REDUNDANT cue:
- visible text badge **"stale — over Nh"** (authoritative; e.g. "stale — over 2h"),
- a glyph `<span aria-hidden="true">⏳</span>` (shape cue),
- a band using `--c-state-over` (the existing over-WIP colour channel; colour is
  the THIRD redundant cue, never alone),
- `data-stale="true"` on the row + the badge contributing ", stale, over 2h" to
  the row's accessible name.

Because rows are sorted longest-in-stage first, stale-open rows naturally lead the
list — the operator sees the most-stuck work first, correctly flagged, never
hidden.

---

## Click-path budget (per use case, with justification)

| Job | Budget | UC-S015-1 reality |
|---|---|---|
| "Reach the WIP navigation panel from a sensible start" | **≤ 2 clicks** | from the at-a-glance pipeline (default view): **1 click** on the "In-flight WIP" tab. From a cold page: page loads → 1 click. **MET (1 ≤ 2).** |
| "Find the item most likely to need action" | **0 further clicks** | rows are pre-sorted longest-in-stage first — the top row IS the most-stuck item; no sort interaction needed. **MET.** |
| "Return to the pipeline" | **1 click** | "Pipeline" tab. **MET.** |

Justification: a tablist gives 1-click access to either view without a sidebar's
depth or a menu's hunt. Pre-sorting removes the sort step entirely. There is no
0-click option for *reaching* the panel (it is a distinct destination, not the
home view — making it home would regress J1's 0-click at-a-glance read).

---

## Accessibility conditions (WCAG 2.2 AA) → mirrored into acceptance.md

Tag prefix `S15-1-A11Y-*`. Each is mechanically assertable (axe or Playwright).

- **S15-1-A11Y-1 (keyboard view-switch, 2.1.1/4.1.2):** the ViewSwitch is a proper
  `role="tablist"`/`role="tab"`: Tab reaches it; Arrow keys move between tabs;
  Enter/Space activates; the active tab carries `aria-selected="true"` and the
  others `="false"`. Assert focus + activation by keyboard alone; assert
  `aria-selected` reflects the active view.
- **S15-1-A11Y-2 (focus order & landmark, 2.4.3/1.3.1):** switching to the WIP view
  moves focus to / exposes the `region` named "In-flight WIP" with a visible `<h2>`;
  logical focus order tab → panel heading → first row. No focus trap. Assert focus
  element identity after switch.
- **S15-1-A11Y-3 (visible non-colour-redundant focus, 1.4.11/1.4.1):** tabs and
  rows show a `:focus-visible` ring (`--focus-ring`, ≥3:1 vs surface); the
  stale-open state is conveyed by text+glyph+band, NEVER colour alone (assert a
  stale row has a non-empty visible "stale" text node AND `data-stale="true"`,
  not just a colour). Assert non-empty computed outline/box-shadow on focus.
- **S15-1-A11Y-4 (target size, 2.5.8):** each tab's hit box ≥ 24×24 CSS px
  (`--target-min`). Assert `getBoundingClientRect` ≥ 24. (Rows are not yet
  interactive in this UC — the steer trigger's target size is asserted in
  UC-S015-2.)
- **S15-1-A11Y-5 (name/role/state, 4.1.2):** tablist named "Dashboard view"; tabs
  named "Pipeline" / "In-flight WIP"; panel `role="region"` named "In-flight WIP";
  rows `role="listitem"` each with an accessible name carrying id + job + dwell
  (never bare). axe `aria-*` rules zero violations.
- **S15-1-A11Y-6 (one h1 / ordered headings, 1.3.1):** the WIP view introduces
  exactly one `<h2>` ("In-flight WIP") under the existing page `<h1>`; no skipped
  heading levels. Assert heading order.
- **S15-1-A11Y-7 (live region for SSE refresh, 4.1.3):** SSE-driven row
  count changes are announced via a polite live region (reuse the existing
  `role="status"` pattern from LiveStatusDot — do not spam). Assert the panel
  count update is in a `aria-live="polite"` container.

---

## Geometry / no-reflow invariant (EXP-016) → testable, mirrored into acceptance.md

The board-as-a-line-class guard for this surface: the WIP list IS a vertical
list (stacked rows), and switching to it must NOT reflow the VSM.

- **GEO-S015-1 (view-switch does not corrupt the VSM):** capture the
  `value-stream-map` region's `getBoundingClientRect()` AND
  `documentElement.scrollHeight` with the Pipeline view active. Switch to WIP, then
  back to Pipeline. Re-capture. The VSM bbox + page scrollHeight are
  **byte-identical** to the pre-switch values (switching away and back is
  lossless — the EXP-016 invariant as it applies to a switched view). Assert
  equality. Also: with the WIP view active, `getByTestId('value-stream-map')` is
  absent (genuinely unmounted, not hidden-but-present reflowing).
- **GEO-S015-2 (WIP list STACKS, is not a line):** the WIP rows lay out
  vertically — each `wip-row`'s top offset is strictly greater than the previous
  row's AND all rows share a left offset (the s003 TimeThiefView / s005
  ItemHistoryPanel stacked-list guard reused). Assert via bounding-box:
  monotonically increasing tops, shared lefts, for ≥ 2 rows. This catches a row
  that renders inline / as a horizontal strip.
- **GEO-S015-3 (the tree rail persists unchanged across the switch):** the
  `work-item-tree` region's bbox is identical with the Pipeline view vs the WIP
  view active (the rail is orthogonal to the main-column view-switch — switching
  views must not nudge the rail). Assert equality.
- **GEO-S015-4 (within-row figures align, not wrap-ragged):** within a single
  `wip-row`, the labelled figure pairs (id/job/stage/value/cost/dwell) share a
  consistent baseline/row band so the row reads as one scannable line of figures,
  not a ragged stack — assert the figure `<dd>`s in one row share a top offset
  (within a small tolerance) at desktop width.

---

## Figure-legibility conditions (figure-legibility checklist) → mirrored into acceptance.md

The WIP panel surfaces a **duration figure** (time-in-stage) and **item
references** (id + job) per row — both in scope of the checklist (SM-S6-2).

- **S15-1-FIG-1 (duration carries a unit, §1/§2):** time-in-stage renders with a
  human time unit — "2 h 14 min", "28 min", "53 s" — NEVER a bare number and
  NEVER raw seconds. The metric is a *dwell duration* (a span), so it carries a
  duration unit (h/min/s), matching its dimension. Assert the dwell text matches a
  unit-bearing pattern (`/\d+\s*(h|min|s)/`) and is not a bare integer.
- **S15-1-FIG-2 (human-meaningful references, §3):** each row shows the item's id
  WITH its human job sentence (from `items.csv` `job`), and the **stage** as a
  human-readable label (e.g. "Decompose", "Build / TDD"), NEVER a machine-internal
  token alone (no `row:N`, no raw enum stage key like `engineer`/`tdd`, no bare
  positional index). Assert: row visible text contains the job sentence AND a
  stage label that is not the raw enum key; `data-item-id` is the live id pattern,
  not `row:\d+`.
- **S15-1-FIG-3 (empty/unknown ≠ zero, §4):** an item whose `task_start`
  timestamp is missing/unparseable shows dwell as "—" (unknown), NOT "0 s" (which
  would falsely imply just-started). Assert: a fixture row with no start timestamp
  renders "—", not "0".
- **S15-1-FIG-4 (zero-WIP empty state, §4):** when no items are in flight the
  panel shows the labelled empty state "No items currently in flight", never a
  blank region or "0" (AC-5). Assert the empty-state text is present and the row
  list is absent.

---

## State-shape note for `useWipItems.js` (build contract)

`useWipItems(projectId, { horizonMs })` composes `/api/projects/:id/stage-flow`
(WIP item ids + `task_start` timestamps per stage) with `/api/projects/:id/items`
(job/value/cost) and returns:

```
{
  status: "loading" | "ready" | "empty",
  horizonMs: number,                 // the live recency horizon (NOT hard-coded; 2h per DEFECT-011)
  items: Array<{
    id: string,                      // e.g. "CHK-5"
    job: string,                     // human job sentence from items.csv
    stage: string,                   // raw stage key (for data-attr only)
    stageLabel: string,              // human stage label (e.g. "Build / TDD")
    value: string, cost: string,
    dwellMs: number | null,          // null when start ts missing/unparseable → "—"
    dwellText: string,               // humanised "2 h 14 min" | "—"
    isStale: boolean,                // dwellMs != null && dwellMs > horizonMs
  }>,                                // SORTED dwellMs DESC (nulls last); stale lead naturally
}
```

Sort is in the hook (descending dwell), so WipPanel renders in order and the
component stays presentational. `isStale` drives the stale-open badge.

---

## Stable selectors handed to the engineer (consolidated build contract)

| Element | Primary selector (a11y) | Test-id | Extra data-attrs |
|---|---|---|---|
| View switch | `getByRole('tablist', { name: 'Dashboard view' })` | `view-switch` | — |
| WIP tab | `getByRole('tab', { name: 'In-flight WIP' })` | `view-tab-wip` | `data-view="wip"`, `aria-selected` |
| Pipeline tab | `getByRole('tab', { name: 'Pipeline' })` | `view-tab-pipeline` | `data-view="pipeline"`, `aria-selected` |
| WIP panel | `getByRole('region', { name: 'In-flight WIP' })` | `wip-panel` | — |
| WIP row | `role="listitem"` within the panel | `wip-row` | `data-item-id`, `data-stale` |
| Dwell figure | `<dd>` labelled "time in stage" within a row | — | unit-bearing text |

No `nth()`, no count-derived, no text-exclusion selectors. Rows are
disambiguated by `data-item-id` (the live id), the same contract UC-S015-2's
SteerMenu composes against.

---

## Component-map delta (change-impact model — co-owned .mmd)

Engineer/UI must update `architecture/dependencies/component-map.mmd` in the SAME
commit that lands WipPanel: add nodes `WipPanel`, `WipRow`, `ViewSwitch`; add
edges `WipRow --> WipPanel`, `WipPanel --> ObservatoryView`,
`ViewSwitch --> ObservatoryView` (per the file's existing granularity), marked
`classDef changed` for the tester's UI test-plan. Marks cleared at slice delivery
after the tester consumes them.

---

## NOT designed yet (deferred)

- **Steer routing from WIP rows** (UC-S015-2) — composing `SteerMenu` (s014,
  read-only) into each `WipRow` via the `data-item-id` slot, and the dispatch of
  "re-slice" → ReslicePreviewPanel vs other actions → SteerPanel. Its overlay
  no-reflow contract + target-size of the row trigger are designed when UC-S015-2
  is pulled.
- **ReslicePreviewPanel** (UC-S015-3) — the two-column before/after preview
  overlay; its figure-legibility (Part A/B fields, directional cost note), its own
  no-reflow overlay contract, and the `useReslicePreview` state-shape are designed
  when UC-S015-3 is pulled.
- **Enriched re-slice prompt** (UC-S015-4) — promptBuilder extension; no new
  surface, presentational only in the output area (designed with UC-S015-3).
- A sort/filter control on the WIP list — pre-sorted by dwell only; no operator
  controls in v1 (click-reduction).
- Mobile / responsive layout — out of scope per slice.md.
- The write path — there is none by design; the panel is read-only.
