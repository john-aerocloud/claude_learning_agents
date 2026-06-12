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

---
---

# UC-S015-2 — Steer action routing from WIP panel rows (STRUCTURE addendum)

Mode: STRUCTURE (before-build), scoped to **UC-S015-2**. This section is ADDITIVE
to the UC-S015-1 sections above — none of UC-S015-1's decisions (the routed
ViewSwitch, the WipPanel/WipRow shell, its A11Y/GEO/FIG conditions) change. UC-S015-2
composes the **delivered** s014 `SteerMenu` into each `WipRow` and wires the row's
`onSteer` up to the existing `ObservatoryView` steer dispatch — exactly the same
affordance the VSM chips (StageNode) and the work-item tree rows (TreeNode) already
carry. No new component; no new token.

## Delivered reality this UC builds on (read before building)

- **`SteerMenu`** (s014, delivered) is the per-item trailing `⋯` trigger + a
  body-portalled `role="menu"` popover of the FOUR actions. Its composition
  convention (from `TreeNode.jsx`): place `<SteerMenu itemId={id} itemLabel={job}
  onSteer={onSteer} />` as the **trailing element of the row's content**, after the
  figures. It stops propagation of its own click/keydown, so the row's own click
  (the future UC-S013-style drill, and here the row itself) is untouched.
  Its selector contract uses **`data-steer-item-id`** on the trigger (NOT
  `data-item-id` — that stays the `wip-row`'s unique contract).
- **`ObservatoryView.onSteer(itemId, actionType)`** (delivered, s014/UC-S014-2)
  already exists and ALREADY routes EVERY action type to a single
  `SteerPanelContainer` (`setSteer({itemId, actionType})` → mounts the panel).
  There is no per-action branching today and `ReslicePreviewPanel` does not exist
  yet. So the routing table below is mostly "thread the existing handler down to
  the WIP rows" — the re-slice branch is a documented future seam, not new logic.

## Surfaces touched

| Surface | Host / attach point | Change |
|---|---|---|
| WIP row | `WipRow` in `WipPanel.jsx` | add a **trailing `SteerMenu`** to each row (the `data-item-id` slot UC-S015-1 left open); add `onSteer` to `WipRow`/`WipPanel`/`WipPanelContainer` props |
| WIP container wiring | `WipPanelContainer` → `ObservatoryView` | thread `ObservatoryView`'s existing `onSteer` to `WipPanelContainer` → `WipPanel` → `WipRow` → `SteerMenu` (mirror the `WorkItemTreeContainer` pass-through) |
| Steer drawer | EXISTING `SteerPanelContainer` (s014) | NO change — it is the routing destination for all four actions today (incl. re-slice, until UC-S015-3 lands) |

The steer affordance is the row's ONLY interactive control in this UC (the WIP row
itself is not yet a drill target). The popover is an OVERLAY (s014 SteerMenu's
portalled `position:fixed` discipline) — it does NOT live in the WIP list flow, so
the list does not reflow when it opens (GEO-S015-2-WIP-1 below, the s014
GEO-S014-1..4 invariant applied to the WIP list).

## Navigation / IA delta

No new nav. The steer flow from a WIP row is the SAME two-step micro-flow the tree
and VSM chips already expose: open the row's `⋯` menu → pick an action → the steer
drawer opens. IA depth unchanged; the WIP view is still reached in 1 click (UC-S015-1).

## Component decomposition (component → states → stable selector)

### SteerMenu (REUSE — `src/app/src/components/SteerMenu.jsx`, delivered s014)
Composed read-only into each `WipRow`. **No change to the component.** Its states,
selectors, A11Y and geometry are exactly as recorded in `design/components.md`
(SteerMenu entry). Per-row instance:
- Trigger: `getByRole('button', { name: /steer <itemId>/i })`,
  `data-testid="steer-btn"`, `data-steer-item-id="<itemId>"`.
- Popover: `getByRole('menu', { name: 'Steer actions' })`, `data-testid="steer-menu"`.
- Items: `getByRole('menuitem', { name: '<exact label>' })`,
  `data-testid="steer-action-<actionType>"` + `data-action`.

### WipRow (EXTEND — child of WipPanel)
Add `onSteer` prop and the trailing `SteerMenu`. The previously-deferred
"steer-affordance slot" (UC-S015-1 ui-design WipRow note) is now populated.

**Props (extended):** `{ item: WipItem; horizonMs; onSteer?(itemId, actionType) }`

**States (extended):** default · hover · focus-visible · stale-open · **steer-menu
closed (trigger present)** · **steer-menu open (popover portalled)**.

**Selectors:** unchanged for the row (`data-testid="wip-row"`, `data-item-id`,
`data-stale`, `data-stage`); the steer trigger uses the SteerMenu contract above.
The steer trigger is placed AFTER the `<dl>` figures (trailing), consistent with
TreeNode — so it reads "figures … steer" and never interrupts the scannable figure
band (GEO-S015-2-WIP-2).

### WipPanel / WipPanelContainer (EXTEND — pass-through only)
`WipPanel` and `WipPanelContainer` gain an `onSteer` prop and pass it to each
`WipRow` (mirror `WorkItemTreeContainer`/`WorkItemTree`'s `onSteer` thread). No
other change; both stay presentational.

### Routing destination (NO new component this UC)
`ReslicePreviewPanel` (UC-S015-3) does not exist yet. The dispatch is unchanged:
all four actions → the existing `SteerPanelContainer`. See the routing table.

## Routing table — which action opens what (NOTHING dead-ends)

`onSteer(itemId, actionType)` fires from the WIP row's SteerMenu with `actionType`
∈ the four enum values. The dispatch (in `ObservatoryView`) is:

| actionType (enum) | Menu label | Opens NOW (UC-S015-2) | Opens AFTER UC-S015-3 |
|---|---|---|---|
| `raise-defect` | "Raise defect" | `SteerPanel` (item pre-loaded) | `SteerPanel` (unchanged) |
| `re-prioritise` | "Re-prioritise" | `SteerPanel` | `SteerPanel` (unchanged) |
| `custom` | "Custom steer" | `SteerPanel` | `SteerPanel` (unchanged) |
| `re-slice` | "Request re-slice / split" | **`SteerPanel`** (interim — same as VSM/tree today) | `ReslicePreviewPanel` |

**Explicit no-dead-end statement (dispatch directive):** until UC-S015-3 lands the
`ReslicePreviewPanel`, the "Request re-slice / split" action from a WIP row routes
to the EXISTING `SteerPanel` — identical to its behaviour from the VSM chips and
tree rows today. It does NOT dead-end, no-op, or throw. UC-S015-3 will re-point ONLY
the `re-slice` branch (a one-line dispatch change in `ObservatoryView`: `actionType
=== 're-slice' ? <ReslicePreviewPanel/> : <SteerPanel/>`), with no change to the
WIP row, the SteerMenu, or the other three branches. The interim behaviour is
correct and observable, not a stub.

## Click-path budget (per use case, with justification)

| Job | Budget | UC-S015-2 reality |
|---|---|---|
| "Steer an item I found in the WIP panel" | **≤ 3 clicks from the WIP view** | open the row's `⋯` (1) → pick an action (2) → the steer drawer is open with the item pre-loaded; act (3). The selection-and-dispatch is ONE flow from the row the operator already found — no navigating away to a separate steer surface. **MET.** |
| "Steer a DIFFERENT item" | **0 extra navigation** | the WIP list stays mounted behind the drawer (overlay, not a route swap) — close the drawer, open another row's menu. **MET.** |

Justification: reusing the SteerMenu means the steer micro-flow is identical
everywhere it appears (tree, VSM, WIP) — one learned interaction, no new model. No
step is added beyond the two intrinsic to any menu (open, choose).

## Accessibility conditions (WCAG 2.2 AA) → mirrored into acceptance.md

Tag prefix `S15-2-A11Y-*`. The SteerMenu's own a11y is already covered by the s014
acceptance suite; these assert the COMPOSITION into WipRow is correct and
regression-free.

- **S15-2-A11Y-1 (steer trigger present + named per row, 4.1.2):** every `wip-row`
  contains exactly one `data-testid="steer-btn"` whose accessible name carries the
  HUMAN item reference (`getByRole('button', { name: /steer <itemId>/i })`), never
  a positional token. Assert one trigger per row; assert the name pattern.
- **S15-2-A11Y-2 (keyboard-operable in the WIP row context, 2.1.1):** the trigger is
  Tab-reachable within the WIP list; Enter/Space/ArrowDown opens the menu; focus
  moves to the first menuitem; Esc closes and returns focus to the trigger; Tab
  escapes (no trap). Assert open/close + focus return by keyboard alone.
- **S15-2-A11Y-3 (target size, 2.5.8):** the per-row steer trigger hit box ≥ 24×24
  CSS px (`--target-min`). Assert `getBoundingClientRect` ≥ 24 on a WIP-row trigger
  (this is the row-trigger target-size deferred from UC-S015-1 S15-1-A11Y-4).
- **S15-2-A11Y-4 (no a11y regression on the WIP list, 4.1.2):** axe runs CLEAN on
  the WIP view with the steer trigger present AND with the menu open (the portalled
  menu must not create duplicate landmarks / orphan aria-controls). Zero new axe
  violations vs the UC-S015-1 baseline.
- **S15-2-A11Y-5 (focus return after the drawer, 2.4.3):** picking an action opens
  the `SteerPanel`; on Cancel/×/Esc focus RETURNS to the originating WIP-row steer
  trigger (the s014 SteerPanel focus-return contract, asserted now from the WIP
  origin). Assert focus identity after close.

## Visual-structural / no-reflow conditions (EXP-016 / s014 GEO idiom) → acceptance.md

The board-as-a-line-class guard for this UC: adding the steer trigger and opening
its portalled menu must NOT reflow the WIP list (the dispatch directive's
"GEO no-reflow on the WIP list").

- **GEO-S015-2-WIP-1 (steer menu is a pure overlay — zero flow height):** capture
  the `wip-panel` region `getBoundingClientRect()` AND its `scrollHeight` (and
  `documentElement.scrollHeight`) with all steer menus CLOSED. Open a row's steer
  menu. Re-capture. The WIP panel + page bbox/scrollHeight are **byte-identical**
  open vs closed (the menu is portalled `position:fixed` to `document.body` — s014
  GEO-S014-1..4 applied to the WIP list). Assert equality; assert the open
  `steer-menu` is a child of `document.body`, not of `wip-panel`.
- **GEO-S015-2-WIP-2 (adding the trigger does not break the row band):** with the
  trigger present (menu closed), the WIP row's figure `<dd>`s still share their row
  band (UC-S015-1 GEO-S015-4 still holds) AND the trigger sits at the row's trailing
  edge (its left offset > every figure `<dd>`'s left offset). Assert the trigger is
  trailing and the figure band is unbroken.
- **GEO-S015-2-WIP-3 (list still STACKS, UC-S015-1 GEO-S015-2 not regressed):** the
  `wip-row`s still lay out vertically (monotonically increasing tops, shared lefts)
  with the steer triggers present. Re-assert the UC-S015-1 stacked-list guard so
  the trigger composition did not turn rows into a strip.
- **GEO-S015-2-WIP-4 (clamped on-screen):** the open steer menu is fully within the
  viewport (no horizontal scroll introduced) — the s014 viewport-clamp invariant,
  re-asserted from a WIP-row origin near the panel's right edge.

## Figure-legibility conditions (checklist) → mirrored into acceptance.md

This UC adds a control, not a data figure — the WIP row's figures are unchanged
(UC-S015-1's S15-1-FIG-* still hold). The one legibility surface this UC owns is the
trigger's accessible label and the menu's action labels.

- **S15-2-FIG-1 (human reference in the trigger, §3):** the steer trigger's
  accessible name carries the HUMAN item reference — id + (where available) job
  sentence ("Steer CHK-5 — <job>") — never a bare positional/row token. Assert the
  name contains the live `data-item-id` value, not `row:\d+` or an `nth` index.
- **S15-2-FIG-2 (action labels are human sentences, §3):** the four menuitems show
  the human labels ("Raise defect" / "Re-prioritise" / "Request re-slice / split" /
  "Custom steer"), never the raw `data-action` enum (`re-slice`, `custom`, …) as
  visible text. Assert visible menuitem text is the human label; the enum rides
  `data-action` only.

## Stable selectors handed to the engineer (consolidated build contract — UC-S015-2)

| Element | Primary selector (a11y) | Test-id | Extra data-attrs |
|---|---|---|---|
| WIP-row steer trigger | `getByRole('button', { name: /steer <itemId>/i })` | `steer-btn` | `data-steer-item-id="<itemId>"`, `aria-controls`, `aria-expanded` |
| Steer menu (portalled) | `getByRole('menu', { name: 'Steer actions' })` | `steer-menu` | child of `document.body` |
| Steer action item | `getByRole('menuitem', { name: '<exact human label>' })` | `steer-action-<actionType>` | `data-action="<enum>"` |
| Steer drawer (destination) | `getByRole('dialog', { name: /steer: <itemId>/i })` | `steer-panel` | `data-item-id`, `data-action` |

Rows are disambiguated by the WIP row's `data-item-id` and the trigger's
`data-steer-item-id` (the live id) — the same contract the tree/VSM steer triggers
use. No `nth()`, no count-derived, no text-exclusion selectors.

## Component-map delta (change-impact model — co-owned .mmd) — UC-S015-2

Engineer/UI must update `architecture/dependencies/component-map.mmd` in the SAME
commit that lands the WipRow steer composition: add the edge **`SteerMenu --> WipRow`**
(the SteerMenu is now composed into WipRow, exactly as the existing
`SteerMenu --> TreeNode` and `SteerMenu --> StageNode` edges) and the routing-thread
note `ObservatoryView → WipPanelContainer → WipPanel → WipRow → SteerMenu`. Mark
the new edge + `WipRow`/`SteerMenu` nodes `classDef changed` (extend the existing
`s015changed` class) for the tester's UI test-plan. Marks cleared at slice delivery
after the tester consumes them. No new component nodes (SteerMenu, WipRow, WipPanel
all already exist on the map).

## NOT designed yet (deferred) — UC-S015-2 scope boundary

- **`ReslicePreviewPanel`** (UC-S015-3) — the two-column before/after preview
  overlay and the `re-slice` dispatch re-point. Designed when UC-S015-3 is pulled.
  Until then the `re-slice` action routes to `SteerPanel` (stated above).
- **Enriched re-slice prompt** (UC-S015-4) — promptBuilder extension; no surface.
- Any change to `SteerMenu` itself — it is READ-ONLY reuse; if the WIP composition
  surfaces a SteerMenu defect, raise it as a defect, do not fork the component.

---
---

# UC-S015-3 — Re-slice/split before/after preview panel (STRUCTURE addendum)

Mode: STRUCTURE (before-build), scoped to **UC-S015-3**. ADDITIVE to UC-S015-1/-2
above — none of their decisions (the routed ViewSwitch, the WipPanel/WipRow shell,
the SteerMenu composition + routing table, their A11Y/GEO/FIG conditions) change.
This UC adds ONE new component (`ReslicePreviewPanel`) + ONE new hook
(`useReslicePreview`), and RE-POINTS ONLY the `re-slice` dispatch branch.

## Delivered / specified reality this UC builds on (read before building)

- **`useSteerContext(itemId)`** (s014, delivered) is the item-context loader this
  panel REUSES VERBATIM for the Before column — the six-field contract
  (`id/job/state/value/cost/sourceRef`, status `loading|ready|not-found|error`).
  Do NOT reshape it; the Before column is a pure render of that contract, exactly
  as SteerPanel's SteerContextBlock is.
- **`SteerPanel`** (s014, delivered) is the drawer IDIOM this panel matches —
  `position:fixed`, portalled to `document.body`, `--z-drawer (+1)`, NON-MODAL (no
  scrim, no trap), focus-move-on-open + focus-return-on-close, Esc/×/Cancel. This
  panel is a SIBLING component in the SAME drawer family, NOT a fork of SteerPanel
  (UC-S015-3 use-cases: "reuses SteerPanel CSS/layout patterns, read-only style
  reuse, NOT component composition"). It reuses the `steer-panel.css` drawer tokens.
- **`ObservatoryView.onSteer` dispatch** (s014/UC-S015-2) currently routes ALL four
  actions → `SteerPanelContainer`. THIS UC makes the **one-line dispatch change**
  the UC-S015-2 seam note pinned: `actionType === 're-slice' ? <ReslicePreviewPanelContainer/>
  : <SteerPanelContainer/>`. NOTHING else in the dispatch changes; the other three
  branches and the WipRow/SteerMenu are untouched.
- **`buildPrompt`** (s014, delivered) is the prompt builder UC-S015-4 extends with
  `partAJob`/`partBJob`. THIS UC does NOT generate the prompt — it produces the
  INPUTS (Part A job, Part B job, intent) that UC-S015-4 feeds to `buildPrompt`. The
  Generate action here is preview→handoff staging, designed below as the seam to -4.
- **`PromptOutput` + copy/toast idiom** (s014/UC-S014-3/-4) is the output surface
  UC-S015-4 reuses inside this panel. THIS UC leaves a reserved output slot (same
  `prompt-output-slot` convention), pinned EMPTY until UC-S015-4.

## Surfaces touched (UC-S015-3)

Single-page dashboard `/` — no new route. The panel OPENS FROM the `re-slice`
action of ANY SteerMenu (WIP row, VSM chip, tree row) and floats OVER the
dashboard, exactly like SteerPanel.

| Surface | Host | Attach |
|---|---|---|
| Re-slice preview panel | portalled to `document.body`, right-anchored drawer (same family as SteerPanel) | opened by `onSteer(itemId, 're-slice')` — the dispatch re-point routes `re-slice` here instead of SteerPanel |
| Dispatch | `ObservatoryView.jsx` | the single-line `actionType === 're-slice'` branch (UC-S015-2 seam) |

## Navigation / IA delta (UC-S015-3)

No nav change. The re-slice flow is the SAME steer micro-flow (open `⋯` menu →
pick "Request re-slice / split" → drawer opens) — only the DESTINATION drawer
differs for that one action. Same drawer idiom = same learned interaction; the
operator does not learn a new surface, just sees a two-column form instead of the
single-column steer context. Non-modal: the WIP list / VSM / tree stay visible and
operable behind it ("the whole and the part"). Esc/×/Cancel close; focus returns to
the originating SteerMenu trigger (the s014 focus-return contract, inherited).

## Component decomposition (component → states → stable selector)

### ReslicePreviewPanel (new — `src/app/src/components/ReslicePreviewPanel.jsx`)
The two-column before/after re-slice preview drawer.

**Props (pure render):** `{ itemId; status: "loading"|"ready"|"not-found"|"error";
context: SteerContext|null; partAJob; partBJob; intentNote; onPartAChange;
onPartBChange; onIntentChange; onCancel; onGenerate({itemId, context, partAJob,
partBJob, intentNote}); prompt?: string|null }`. A `ReslicePreviewPanelContainer`
(same file) wires `useSteerContext(itemId)` (Before) + `useReslicePreview()`
(After local state) → the panel, mirroring `SteerPanelContainer`.

**Regions (top→bottom):** header (heading "Re-slice / split: <itemId>" + ×) →
**two-column body** (Before | After) → intent-note textarea → action row
("Looks right — generate prompt" + "Cancel") → reserved prompt-output slot
(EMPTY until UC-S015-4).

**States:**
- `loading` — header + two-column skeleton; Before shows "Loading item context…";
  After fields disabled until context ready.
- `ready` — full Before column; After fields enabled; Generate guarded.
- `not-found` — stale id: Before shows "Item <id> not found" (labelled, fail-soft);
  After + Generate hidden; Cancel/× remain. (Reuses SteerPanel not-found discipline.)
- `error` — "Could not load item context — try again"; Cancel/× remain.

**Selector:** `getByRole('dialog', { name: /re-slice.*: <itemId>/i })` — NON-modal
(no `aria-modal`), `aria-labelledby` → heading; `data-testid="reslice-preview-panel"`
(== AC-1) + `data-item-id`. Close × `getByRole('button', { name: /close re-slice
preview/i })` / `reslice-close`; Cancel `getByRole('button', { name: 'Cancel' })` /
`reslice-cancel`; Generate `getByRole('button', { name: 'Looks right — generate
prompt' })` / `reslice-generate` (`aria-disabled` reflects the guard).

### BeforeColumn (child — "Current item", read-only)
The Before column is a PURE RENDER of the `useSteerContext` six-field contract —
the SAME labelled `<dt>`/`<dd>` figure surface as SteerContextBlock, reused VERBATIM
so the operator sees identical item context whether steering or re-slicing.

**Contents (each a labelled `<dt>`/`<dd>` pair, from `context` — VERBATIM):**
| Field | Label (visible) | Source (useSteerContext) | Legibility rule |
|---|---|---|---|
| id+job | "Item" | `context.id` + `context.job` | "CHK-5 — <job sentence>" (§3 human ref; id never alone) |
| job | "Job" | `context.job` | full human job sentence |
| value | "Value" | `context.value` | "HIGH"/"MED"/"LOW"; absent → "—" |
| cost | "Cost" | `context.cost` | "S"/"M"/"L"; absent → "—" |
| state | "Current stage" | `context.state` | human state label; never a raw enum/CSV key |

Plus a fixed note: **"After split, this item will be replaced by Part A and Part
B"** (`data-testid="reslice-before-note"`) — sets the operator's expectation of the
After column (use-cases AC observable outcome).

**Selector:** column heading visible "Current item" (== AC-1); column
`data-testid="reslice-before"` carrying `data-source={context.sourceRef}` (SourceLink
convention); each field `data-testid="reslice-before-<id|job|value|cost|stage>"`.

### AfterColumn (child — "Proposed split", operator input)
The After column collects the proposed split.

**Contents:**
- **Part A job field** — `<label>` "Part A job sentence", placeholder "Describe what
  Part A will deliver…", `getByRole('textbox', { name: /part a job/i })`,
  `data-testid="part-a-job"` (== use-cases AC).
- **Part B job field** — `<label>` "Part B job sentence", placeholder "Describe what
  Part B will deliver…", `getByRole('textbox', { name: /part b job/i })`,
  `data-testid="part-b-job"` (== use-cases AC).
- **Directional cost note** (computed, read-only) — `data-testid="reslice-cost-note"`:
  shows "Each part will be smaller than the original — favours flow" when BOTH Part
  A and Part B are non-empty; renders EMPTY (absent) when either is empty
  (S15-3-FIG-3: an unfilled split is NOT a generated proposal — empty ≠ a note).

**Selector:** column heading visible "Proposed split" (== AC-1); column
`data-testid="reslice-after"`.

### IntentNote (REUSE idiom — child of ReslicePreviewPanel)
Free-text "Why are you splitting this item?" textarea — same pattern as the s014
IntentNote. `getByRole('textbox', { name: /why.*splitting|intent/i })`;
`data-testid="reslice-intent"`; associated `<label>`; placeholder.

### Reuse, not invent
ReslicePreviewPanel reuses the SteerPanel drawer IDIOM (tokens
`--z-drawer`/`--drawer-width`/`--drawer-inset`/`--drawer-elev`/`--dur-drawer`,
0ms reduced-motion), `--c-surface-raised`/`--c-border`/`--focus-ring`/`--target-min`/
`--radius-box`, the `<dt>`/`<dd>` labelled-figure pattern, the `data-source`
SourceLink convention, the not-found/error fail-soft discipline, and (for UC-S015-4)
the `PromptOutput` + copy/toast idiom. New rows in `design/components.md`:
`ReslicePreviewPanel`, `BeforeColumn`, `AfterColumn`. ONE possible new layout token
`--reslice-col-gap` (= `--sp-6` if the existing gap suffices — prefer reuse). No
off-token values.

## Preview-only discipline — what Generate produces HERE vs plain steer (the core rule)

**This panel is PREVIEW-ONLY: it WRITES NOTHING.** It collects inputs and stages a
handoff; it does not edit items.csv, does not split anything, does not call the
server (server write-guard 405 still active — AC-3). The distinction from "plain
steer" (SteerPanel):

- **Plain steer (SteerPanel):** Generate → `buildPrompt(actionType, context,
  intent)` → a single-block slash-command prompt. ONE intent field, no structured
  parts.
- **Re-slice preview (this panel):** Generate ("Looks right — generate prompt") →
  feeds the ENRICHED inputs `{ context, partAJob, partBJob, intentNote }` to
  UC-S015-4's extended `buildPrompt(..., partAJob, partBJob)` → a prompt with the
  explicit "Proposed split: Part A / Part B" block. THIS UC's Generate produces the
  same staged hand-off intent; the actual enriched-prompt RENDERING is UC-S015-4
  (the output slot stays empty here, pinned). What this UC DELIVERS is: the two
  columns render, the After fields accept text, the cost note computes, the guard
  works, Cancel is clean — NOT the generated prompt text (that is UC-S015-4, exactly
  as UC-S014-2's done-condition excluded UC-S014-3's prompt).

The output the Generate action produces here is the call to `onGenerate` with the
four inputs — observable as the seam; the prompt string is UC-S015-4's render.

## Generate guard (AC-4)

Generate is `aria-disabled` (discoverable, not removed — the s014 discipline) until
**Part A AND Part B AND intent note are ALL non-empty** (use-cases AC-4 — stricter
than the s014 single-field guard, because a coherent split proposal needs both parts
and a reason). Non-colour cue: inset shadow + flat cursor + dimming (reuse the
`.steer-generate[aria-disabled]` styling). Assert the guard flips only when all
three are non-empty (S15-3-A11Y-3 / F-S3-4).

## Click-path budget (UC-S015-3)

| Job | Budget | UC-S015-3 reality |
|---|---|---|
| "See the current scope beside my proposed split" | **0 clicks after the panel opens** | both columns are visible on open; the Before column is pre-loaded from `useSteerContext` (no fetch click). **MET.** |
| "Propose a split" | **keystrokes only** | type Part A, Part B, intent — no add-row/confirm clicks; two parts is the fixed v1 split (no "add Part C" control). **MET.** |
| "Stage the handoff" | **1 click** | "Looks right — generate prompt" (guarded). **MET.** |
| "Abandon without a prompt" | **1 click / 1 key** | Cancel / × / Esc; WIP list stays open behind. **MET (== AC-5).** |

No confirm/extra step. Two fixed parts (not a dynamic list) is a deliberate
click-reduction: the common case is a 2-way split; an N-way split is out of scope v1.

## Accessibility conditions (WCAG 2.2 AA) → mirrored into acceptance.md

Tag prefix `S15-3-A11Y-*`. Each mechanically assertable.

- **S15-3-A11Y-1 (keyboard open→operate→close, 2.1.1):** selecting "Request
  re-slice / split" by keyboard opens the panel; Tab reaches Part A → Part B →
  intent → Generate → Cancel → ×; Esc closes. All operable by keyboard alone.
  Assert the focus path.
- **S15-3-A11Y-2 (focus move + return, no trap, 2.4.3/2.1.2):** on open focus moves
  into the panel (heading); on close (×/Cancel/Esc) focus RETURNS to the SteerMenu
  trigger that opened it (the s014 contract, asserted from the re-slice origin).
  NON-MODAL → Tab can leave into the page (no trap). Assert focus identity.
- **S15-3-A11Y-3 (visible non-colour-redundant focus + guard, 1.4.11/1.4.1):**
  `:focus-visible` ring (`--focus-ring`, ≥3:1) on both textareas + buttons; the
  Generate guard is `aria-disabled="true"` + non-colour inset (not colour alone),
  flipping only when Part A + Part B + intent are all non-empty. Assert non-empty
  computed outline on focus; assert `aria-disabled` flips on the three-field rule.
- **S15-3-A11Y-4 (target size, 2.5.8):** ×, Cancel, Generate hit boxes ≥ 24×24 CSS
  px (`--target-min`). Assert getBoundingClientRect ≥ 24.
- **S15-3-A11Y-5 (name/role/state, 4.1.2):** panel `role="dialog"` NON-MODAL (no
  `aria-modal`) named "Re-slice / split: <itemId>"; Part A/Part B/intent textareas
  each have an associated `<label>`; buttons named; column headings are real
  headings ("Current item" / "Proposed split"). axe aria-* zero violations on the
  open panel.
- **S15-3-A11Y-6 (reduced motion, 2.3.3):** drawer slide-in `--dur-drawer`, 0ms
  under `prefers-reduced-motion: reduce`. Assert panel present same frame as the
  action selection under emulated reduce.
- **S15-3-A11Y-7 (labelled before-column figures, 1.3.1):** every Before field is a
  programmatically labelled `<dt>`/`<dd>` pair so no value is announced bare (the
  s014 A11Y-7 reused). Assert each `reslice-before-*` value has an associated label.
- **S15-3-A11Y-8 (ordered headings, 1.3.1):** the panel introduces an `<h2>`
  ("Re-slice / split: <id>") under the page `<h1>`, with the two column headings as
  `<h3>` (no skipped levels). Assert heading order.

## Geometry / no-reflow + two-column structure (EXP-016) → mirrored into acceptance.md

The board-as-a-line-class guard for THIS surface: the two columns must render as
TWO columns (side-by-side), and opening the panel must reflow NOTHING. Tag
`GEO-S015-3-*`.

- **GEO-S015-3-1 (panel is a pure overlay — zero flow height):** capture the
  `wip-panel` (or `value-stream-map`/`work-item-tree`) region bbox + the
  `documentElement.scrollHeight` with the panel CLOSED; open the panel; re-capture —
  byte-identical (the panel is `position:fixed`/portalled to `body`). Assert
  equality; assert `getComputedStyle(panel).position === 'fixed'` and its parent is
  `document.body`. (== AC-5 "WIP panel remains open and unmodified behind it".)
- **GEO-S015-3-2 (TWO COLUMNS, not one stacked line — the geometry-carries-meaning
  guard):** at desktop width the Before and After columns lay out SIDE-BY-SIDE — the
  `reslice-before` and `reslice-after` bounding boxes share a top offset (within a
  small tolerance) AND `reslice-after`'s left offset is strictly greater than
  `reslice-before`'s left offset (After is to the RIGHT of Before, both on the same
  band). They are NOT stacked vertically (which would lose the before/after-at-a-
  glance meaning — the s002-board-as-a-line lesson applied to the two-column form).
  Assert via bounding-box: shared top, before.left < after.left, before.right ≤
  after.left (no overlap).
- **GEO-S015-3-3 (within a column the fields STACK):** inside `reslice-before` the
  `<dd>`s stack (monotonic tops, shared left — the s014 stacked-list guard); inside
  `reslice-after` the Part A / Part B / cost-note stack vertically. Assert monotonic
  tops within each column.
- **GEO-S015-3-4 (anchored on-screen):** the open panel bbox is within the viewport
  (no negative left/top, right ≤ innerWidth) — no horizontal scroll. Assert viewport
  containment.

## Figure-legibility conditions (checklist) → mirrored into acceptance.md

Both columns carry human-readable references. Tag `S15-3-FIG-*`.

- **S15-3-FIG-1 (Before column human-meaningful, §3):** the Before column shows the
  item id WITH its job sentence ("CHK-5 — <job>"), the stage as a human label, and
  human value/cost — NEVER a raw CSV key (no `vc_ratio`/`done_ts`), NEVER the id
  alone, NEVER a `row:N`/positional token. (== AC-2.) Assert the Before column text
  contains the job sentence + a human stage label + no raw CSV key strings.
- **S15-3-FIG-2 (After column labelled human-meaningful):** the Part A / Part B
  fields are labelled in human words ("Part A job sentence" / "Part B job sentence")
  with human placeholders, never enum keys (`part_a_job` rides `data-testid` only,
  never as the visible label). Assert visible labels are the human phrases.
- **S15-3-FIG-3 (empty proposed-parts ≠ a generated prompt / cost note, §4):** when
  Part A and/or Part B are empty, the directional cost note is ABSENT (not a blank
  "0"/"—" placeholder, not a half-statement) AND the reserved prompt-output slot is
  EMPTY (no prompt is generated/shown — unknown split ≠ a produced proposal). Assert:
  with empty parts, `reslice-cost-note` is absent and `prompt-output` is absent;
  with both parts filled, the cost note appears. (This is the §4 unknown-≠-zero rule
  applied to a STRUCTURED input: an unfilled split must not look like a staged one.)
- **S15-3-FIG-4 (not-found ≠ crash):** a stale/unknown item id renders the labelled
  "Item <id> not found" Before state, never a blank panel or a thrown error (reuses
  the s014 S14-2-FIG-4 discipline). Assert the not-found text present, no console error.

## State-shape note for `useReslicePreview.js` (build contract) — consumed by UC-S015-4

`useReslicePreview()` is PURE LOCAL state — NO server calls (use-cases: "manages
Part A, Part B, intent state; no server calls; pure local state"). It does NOT load
item context (that is `useSteerContext`, composed in the container alongside it). It
returns:
```
{
  partAJob: string,        // After: Part A free text ('' initially)
  partBJob: string,        // After: Part B free text ('' initially)
  intentNote: string,      // "Why are you splitting this item?" ('' initially)
  setPartAJob(v), setPartBJob(v), setIntentNote(v),
  canGenerate: boolean,    // partAJob && partBJob && intentNote all non-empty (S15-3-A11Y-3 guard)
  costNote: string|null,   // "Each part will be smaller…" when both parts non-empty, else null (S15-3-FIG-3)
}
```
**Handoff to UC-S015-4:** on Generate, the container calls (UC-S015-4's extended)
`buildPrompt('re-slice', context, intentNote, { partAJob, partBJob })` — the
`partAJob`/`partBJob` map 1:1 onto the `{{part_a_job}}`/`{{part_b_job}}` template
tokens (use-cases UC-S015-4 template). `context` is the SAME `useSteerContext`
six-field object the Before column rendered, so the prompt's `{{item_*}}` tokens and
the Before column are byte-consistent (the operator hands Claude exactly what they
previewed). The displayed prompt then follows the s014 PROMPT-FREEZE-1 discipline
(no auto-regenerate on SSE refresh) — UC-S015-4 inherits it.

## Stable selectors handed to the engineer (consolidated build contract — UC-S015-3)

| Element | Primary selector (a11y) | Test-id | Extra |
|---|---|---|---|
| Re-slice panel | `getByRole('dialog', { name: /re-slice.*: <itemId>/i })` (non-modal) | `reslice-preview-panel` | `data-item-id` |
| Before column | heading "Current item" | `reslice-before` | `data-source` |
| Before field | `<dt>`/`<dd>` labelled pair | `reslice-before-<id\|job\|value\|cost\|stage>` | — |
| Before note | — | `reslice-before-note` | — |
| After column | heading "Proposed split" | `reslice-after` | — |
| Part A field | `getByRole('textbox', { name: /part a job/i })` | `part-a-job` | `<label for>` |
| Part B field | `getByRole('textbox', { name: /part b job/i })` | `part-b-job` | `<label for>` |
| Cost note | — | `reslice-cost-note` | absent when parts empty |
| Intent | `getByRole('textbox', { name: /why.*splitting\|intent/i })` | `reslice-intent` | `<label for>` |
| Generate | `getByRole('button', { name: 'Looks right — generate prompt' })` | `reslice-generate` | `aria-disabled` |
| Cancel | `getByRole('button', { name: 'Cancel' })` | `reslice-cancel` | — |
| Close × | `getByRole('button', { name: /close re-slice preview/i })` | `reslice-close` | — |
| Prompt output slot | — | `prompt-output-slot` | EMPTY until UC-S015-4 |

No `nth()`, no count-derived, no text-exclusion selectors.

## Component-map delta (change-impact model — co-owned .mmd) — UC-S015-3

Engineer/UI update `architecture/dependencies/component-map.mmd` in the SAME commit
that lands ReslicePreviewPanel: add nodes `ReslicePreviewPanel`, `BeforeColumn`,
`AfterColumn`, `useReslicePreview`; add edges `BeforeColumn --> ReslicePreviewPanel`,
`AfterColumn --> ReslicePreviewPanel`, `ReslicePreviewPanel --> useSteerContext` (Before
reuse), `ReslicePreviewPanel --> useReslicePreview`, and the RE-POINTED dispatch edge
`ObservatoryView --> ReslicePreviewPanel` (the `re-slice` branch — note this is a
re-point of the existing `ObservatoryView --> SteerPanel` adjacency for that one
action, the other three branches still edge to SteerPanel). Mark changed nodes/edges
`classDef changed` (extend `s015changed`) for the tester. Marks cleared at slice
delivery after the tester consumes them.

## NOT designed yet (deferred) — UC-S015-3 scope boundary

- **Enriched re-slice prompt rendering** (UC-S015-4) — the `buildPrompt` extension
  (`partAJob`/`partBJob` tokens) and the prompt text rendered into this panel's
  reserved output slot + the copy/toast reuse. The slot is left EMPTY here; the
  inputs this UC produces (`partAJob`/`partBJob`/`intentNote`) are -4's contract.
- An N-way split (Part C…) — v1 is a fixed 2-way split (click-reduction).
- Mobile / responsive layout — out of scope per slice.md (the two-column geometry
  is asserted at desktop width).
- The write path — there is none; this panel is PREVIEW-ONLY (NO-WRITE / AC-3).