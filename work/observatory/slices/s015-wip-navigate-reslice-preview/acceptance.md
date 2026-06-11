# Acceptance — s015 WIP navigate & re-slice/split before/after preview

Co-authored: product (functional ACs in use-cases.md), ui-designer (UI/a11y/
geometry/figure conditions below). Each condition is mechanically assertable
(axe rule, Playwright, or Vitest). Tester enforces.

---

## UC-S015-1 — WIP navigation panel (list + time-in-stage sort)

### Functional (from use-cases.md AC-1..AC-5 / SM-S6-1,2)
- F-1: a nav entry ("In-flight WIP") exists; clicking it shows the WIP panel
  WITHOUT hiding the value-stream map permanently (the VSM is reachable via its
  own "Pipeline" nav entry — AC-1).
- F-2: every currently in-flight item appears; the row set matches the
  recency-based WIP definition (DEFECT-011 horizon = 2 h) (AC-2 / SM-S6-1).
- F-3: each row shows item id, job sentence (not raw CSV key), human stage label
  (not enum key), value, cost, and time-in-stage with a time unit; no raw CSV
  column names visible (AC-3 / SM-S6-2).
- F-4: rows are sorted longest-in-stage first — the first row's dwell ≥ every
  other row's dwell (AC-4).
- F-5: empty state ("No items currently in flight") renders without a crash when
  WIP is zero; no console error (AC-5).

### Accessibility (WCAG 2.2 AA) — ui-designer
- **S15-1-A11Y-1** keyboard view-switch: ViewSwitch is `role="tablist"`/`tab`;
  Tab reaches it, Arrow keys move between tabs, Enter/Space activates; active tab
  `aria-selected="true"`, others `="false"`. (2.1.1/4.1.2)
- **S15-1-A11Y-2** focus order & landmark: switching to WIP exposes the `region`
  named "In-flight WIP" with a visible `<h2>`; focus order tab → heading → first
  row; no trap. (2.4.3/1.3.1)
- **S15-1-A11Y-3** visible non-colour-redundant focus + stale state: tabs and rows
  show a `:focus-visible` ring (`--focus-ring`, ≥3:1); the stale-open state is
  text+glyph+band, never colour alone — a stale row has a non-empty visible
  "stale" text node AND `data-stale="true"`. (1.4.11/1.4.1)
- **S15-1-A11Y-4** target size ≥ 24×24 CSS px for each view tab (2.5.8) — assert
  getBoundingClientRect ≥ 24.
- **S15-1-A11Y-5** name/role/state: tablist named "Dashboard view"; tabs named
  "Pipeline"/"In-flight WIP"; panel `role="region"` named "In-flight WIP"; rows
  `role="listitem"` with accessible name carrying id + job + dwell (never bare).
  axe aria-* rules zero violations. (4.1.2)
- **S15-1-A11Y-6** exactly one `<h2>` ("In-flight WIP") under the page `<h1>` in
  the WIP view; no skipped heading levels. (1.3.1)
- **S15-1-A11Y-7** SSE-driven row-count changes announced via a polite live region
  (reuse LiveStatusDot `role="status"` pattern; no spam). (4.1.3)

### Geometry / no-reflow invariant (EXP-016) — ui-designer
- **GEO-S015-1** view-switch is lossless: `value-stream-map` bbox +
  `documentElement.scrollHeight` are byte-identical before switching to WIP and
  after switching back to Pipeline. With the WIP view active,
  `value-stream-map` is ABSENT (genuinely unmounted, not hidden-but-reflowing).
- **GEO-S015-2** the WIP list STACKS, is not a line: each `wip-row` top offset is
  strictly greater than the previous AND all rows share a left offset, for ≥ 2
  rows (the TimeThiefView/ItemHistoryPanel stacked-list guard).
- **GEO-S015-3** the `work-item-tree` rail bbox is identical with the Pipeline
  view vs the WIP view active (the rail is orthogonal to the main-column switch).
- **GEO-S015-4** within one `wip-row` the labelled figure `<dd>`s share a top
  offset (within tolerance) at desktop width — one scannable line of figures, not
  a ragged stack.

### Figure / reference legibility — ui-designer
- **S15-1-FIG-1** time-in-stage carries a human time unit ("2 h 14 min" / "28 min"
  / "53 s"), never a bare number, never raw seconds; matches a unit-bearing
  pattern, not a bare integer. (§1/§2)
- **S15-1-FIG-2** each row shows id WITH its human job sentence AND a human stage
  label (not the raw enum stage key); `data-item-id` is the live id pattern, not
  `row:\d+`. (§3)
- **S15-1-FIG-3** an item with a missing/unparseable `task_start` shows dwell as
  "—" (unknown), NOT "0 s". (§4)
- **S15-1-FIG-4** zero-WIP shows the labelled empty state "No items currently in
  flight", never a blank region or "0"; the row list is absent. (§4, == F-5.)

### WIP-semantics / stale-open (DEFECT-011) — ui-designer
- **S15-1-WIP-1** the panel reads the recency horizon from the live source (2 h,
  DEFECT-011), NOT a hard-coded literal — assert `horizonMs` is passed in / derived,
  not a magic number in the component.
- **S15-1-WIP-2** an open item OLDER than the horizon does NOT vanish from the WIP
  panel: a fixture item with dwell > horizon (no `task_end`) is present in the row
  set AND flagged `data-stale="true"` with a visible "stale — over Nh" badge.
  (This is the key DEFECT-011 regression guard for THIS list.)

**Done condition (UC-S015-1):** F-1..F-5 + all S15-1-A11Y-*, GEO-S015-*,
S15-1-FIG-*, S15-1-WIP-* pass against the live running app (real items.csv +
ledger), not fixtures alone (EXP-033 / SM-S6-1).

---

## UC-S015-2 / -3 / -4
Acceptance conditions co-authored when each UC is pulled (product functional ACs
already in use-cases.md; ui-designer UI/a11y/geometry/figure conditions added per
STRUCTURE pass — UC-S015-2 steer-routing overlay no-reflow; UC-S015-3
ReslicePreviewPanel two-column geometry + Part A/B/cost-note figure legibility;
UC-S015-4 prompt-output presentation, designed then).
