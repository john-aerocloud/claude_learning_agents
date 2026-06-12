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

## UC-S015-2 — Steer action routing from WIP panel rows

ui-designer STRUCTURE pass; mirrored from ui-design.md (UC-S015-2 addendum).
Composes the delivered s014 `SteerMenu` into each `WipRow` and threads the
existing `ObservatoryView.onSteer` dispatch to the WIP rows. Does NOT regress any
UC-S015-1 condition. The four-action dispatch is unchanged from s014; the
`re-slice` action routes to the existing `SteerPanel` until UC-S015-3 lands the
`ReslicePreviewPanel` (no dead-end).

### Functional (from use-cases.md UC-S015-2 AC-1..AC-4)
- F-S2-1: `data-testid="steer-btn"` present on EVERY WIP row; clicking it shows the
  four-option action picker (AC-1).
- F-S2-2: "Raise defect" / "Re-prioritise" / "Custom steer" from a WIP row opens the
  s014 `SteerPanel` with the correct item id pre-loaded (same as VSM/tree) (AC-2).
- F-S2-3: "Request re-slice / split" opens a steer destination, NOT a dead-end —
  interim it opens `SteerPanel` (UC-S015-3 re-points it to `ReslicePreviewPanel`).
  Assert the steer drawer opens with `data-action="re-slice"` (AC-3, interim form).
- F-S2-4: WIP rows remain rendered (not unmounted) while the steer drawer is open;
  operator can close and select a different row (AC-4).

### Accessibility (WCAG 2.2 AA) — ui-designer
- **S15-2-A11Y-1** steer trigger present + named per row: exactly one
  `data-testid="steer-btn"` per `wip-row`; accessible name carries the human item
  ref (`getByRole('button', { name: /steer <itemId>/i })`), never a positional
  token. (4.1.2)
- **S15-2-A11Y-2** keyboard-operable: trigger Tab-reachable in the WIP list;
  Enter/Space/ArrowDown opens; focus → first menuitem; Esc closes + returns focus
  to trigger; Tab escapes (no trap). (2.1.1)
- **S15-2-A11Y-3** target size: per-row steer trigger hit box ≥ 24×24 CSS px
  (`--target-min`) — the row-trigger target size deferred from S15-1-A11Y-4. (2.5.8)
- **S15-2-A11Y-4** no a11y regression: axe CLEAN on the WIP view with the trigger
  present AND with the menu open (no duplicate landmarks / orphan aria-controls);
  zero new violations vs the UC-S015-1 baseline. (4.1.2)
- **S15-2-A11Y-5** focus return after the drawer: picking an action opens
  `SteerPanel`; Cancel/×/Esc returns focus to the originating WIP-row trigger.
  (2.4.3)

### Visual-structural / no-reflow (EXP-016 / s014 GEO idiom) — ui-designer
- **GEO-S015-2-WIP-1** steer menu is a pure overlay: `wip-panel` bbox + scrollHeight
  + page scrollHeight byte-identical with the menu CLOSED vs OPEN; the open
  `steer-menu` is a child of `document.body`, not of `wip-panel`.
- **GEO-S015-2-WIP-2** trigger does not break the row band: with the trigger present
  (menu closed) the figure `<dd>`s still share their row band (GEO-S015-4 holds) AND
  the trigger sits trailing (left offset > every figure `<dd>`).
- **GEO-S015-2-WIP-3** list still STACKS (GEO-S015-2 not regressed): `wip-row`s still
  lay out vertically (monotonic tops, shared lefts) with the triggers present.
- **GEO-S015-2-WIP-4** clamped on-screen: the open steer menu is fully within the
  viewport (no horizontal scroll) from a right-edge WIP-row origin.

### Figure legibility (checklist) — ui-designer
- **S15-2-FIG-1** human reference in the trigger: trigger accessible name contains
  the live `data-item-id` value (+ job where available), never `row:\d+`/`nth`. (§3)
- **S15-2-FIG-2** action labels are human sentences: visible menuitem text is the
  human label; the enum rides `data-action` only — no raw `re-slice`/`custom` as
  visible text. (§3)

**Done condition (UC-S015-2):** F-S2-1..4 + all S15-2-A11Y-*, GEO-S015-2-WIP-*,
S15-2-FIG-* pass against the live running app, AND no UC-S015-1 condition regresses
(re-run GEO-S015-2 / S15-1-A11Y-* as regression guards).

---

## UC-S015-3 — Re-slice/split before/after preview panel

### Functional (from use-cases.md AC-1..AC-5)
- F-S3-1: `data-testid="reslice-preview-panel"` present in DOM when "Request
  re-slice / split" is selected; the panel shows two visible columns headed
  "Current item" and "Proposed split" (AC-1).
- F-S3-2: the Before column shows the live item's id, job sentence, value, cost,
  and stage — all human-readable labels; no raw CSV column names (AC-2).
- F-S3-3: Part A and Part B fields accept free text; typing triggers no file write
  (server write-guard 405 active) (AC-3).
- F-S3-4: "Looks right — generate prompt" is disabled until Part A, Part B, AND
  intent note all contain ≥1 character (AC-4).
- F-S3-5: Cancel closes the panel without generating a prompt; the WIP panel
  remains open and unmodified behind it (AC-5).

### Accessibility (WCAG 2.2 AA) — ui-designer
- **S15-3-A11Y-1** keyboard open→operate→close: selecting "Request re-slice / split"
  by keyboard opens the panel; Tab reaches Part A → Part B → intent → Generate →
  Cancel → ×; Esc closes; all keyboard-operable. (2.1.1)
- **S15-3-A11Y-2** focus move + return, no trap: on open focus moves into the panel;
  on close (×/Cancel/Esc) focus returns to the SteerMenu trigger that opened it;
  non-modal → Tab can leave (no trap). (2.4.3/2.1.2)
- **S15-3-A11Y-3** visible non-colour-redundant focus + guard: `:focus-visible` ring
  (`--focus-ring`, ≥3:1) on both textareas + buttons; Generate guard is
  `aria-disabled="true"` + non-colour inset (not colour alone), flipping only when
  Part A + Part B + intent are all non-empty. (1.4.11/1.4.1)
- **S15-3-A11Y-4** target size ≥ 24×24 CSS px for ×, Cancel, Generate. (2.5.8)
- **S15-3-A11Y-5** name/role/state: panel `role="dialog"` NON-MODAL (no `aria-modal`)
  named "Re-slice / split: <itemId>"; Part A/Part B/intent textareas each have an
  associated `<label>`; buttons named; column headings real headings ("Current item"
  / "Proposed split"); axe aria-* zero violations on the open panel. (4.1.2)
- **S15-3-A11Y-6** reduced motion: drawer slide-in `--dur-drawer`, 0ms under
  `prefers-reduced-motion: reduce`. (2.3.3)
- **S15-3-A11Y-7** labelled Before-column figures: every Before field is a
  programmatically labelled `<dt>`/`<dd>` pair so no value is announced bare. (1.3.1)
- **S15-3-A11Y-8** ordered headings: `<h2>` ("Re-slice / split: <id>") under the
  page `<h1>`; the two column headings as `<h3>` (no skipped levels). (1.3.1)

### Geometry / no-reflow + two-column structure (EXP-016) — ui-designer
- **GEO-S015-3-1** panel is a pure overlay: `wip-panel` (or `value-stream-map`/
  `work-item-tree`) region bbox + `documentElement.scrollHeight` byte-identical
  panel-closed vs panel-open; `getComputedStyle(panel).position === 'fixed'`, parent
  is `document.body`. (== AC-5 "WIP panel unmodified behind it".)
- **GEO-S015-3-2** TWO COLUMNS, not one stacked line: at desktop width
  `reslice-before` and `reslice-after` share a top offset (small tolerance) AND
  `reslice-after.left > reslice-before.left` AND `reslice-before.right ≤
  reslice-after.left` (side-by-side, no overlap) — NOT vertically stacked
  (geometry-carries-meaning; the s002-board-as-a-line guard for the two-column form).
- **GEO-S015-3-3** within each column the fields STACK: `reslice-before` `<dd>`s have
  monotonic tops + shared left; `reslice-after` Part A / Part B / cost-note stack
  vertically. Assert monotonic tops within each column.
- **GEO-S015-3-4** anchored on-screen: open panel bbox within the viewport (no
  negative left/top, right ≤ innerWidth) — no horizontal scroll.

### Figure / reference legibility — ui-designer
- **S15-3-FIG-1** Before column human-meaningful: id WITH job sentence ("CHK-5 —
  <job>"), human stage label, human value/cost; NO raw CSV key (`vc_ratio`/`done_ts`),
  never the id alone or `row:N`. (== AC-2.) (§3)
- **S15-3-FIG-2** After column labelled human-meaningful: Part A/Part B labelled in
  human words ("Part A job sentence" / "Part B job sentence") with human placeholders;
  enum keys ride `data-testid` only, never the visible label. (§3)
- **S15-3-FIG-3** empty proposed-parts ≠ a generated prompt / cost note: with Part A
  and/or Part B empty, `reslice-cost-note` is ABSENT and `prompt-output` is ABSENT
  (an unfilled split is not a staged proposal — unknown ≠ produced); with both filled,
  the cost note appears. (§4)
- **S15-3-FIG-4** not-found ≠ crash: a stale/unknown item id renders the labelled
  "Item <id> not found" Before state, never a blank panel or a thrown error.

### Behavioural / preview-only invariant (co-owned with engineer) — ui-designer pins
- **RESLICE-PREVIEW-1** PREVIEW-ONLY: the panel writes NOTHING — no items.csv edit,
  no split, no server call; the only output of Generate is the call to `onGenerate`
  with `{ context, partAJob, partBJob, intentNote }` (the UC-S015-4 handoff seam).
  Server write-guard returns 405 on POST/PUT/PATCH/DELETE during the interaction
  (== F-S3-3 / AC-3).
- **RESLICE-DISPATCH-1** the `re-slice` action routes to `ReslicePreviewPanel` (this
  panel), NOT `SteerPanel`; the other three actions (`raise-defect`/`re-prioritise`/
  `custom`) STILL route to `SteerPanel` — assert the dispatch re-point is scoped to
  the single `re-slice` branch and the WipRow/SteerMenu are untouched.

**Done condition (UC-S015-3):** F-S3-1..5 + all S15-3-A11Y-*, GEO-S015-3-*,
S15-3-FIG-*, RESLICE-PREVIEW-1, RESLICE-DISPATCH-1 pass against a live item from the
running app (EXP-033), AND no UC-S015-1/-2 condition regresses (re-run GEO-S015-2 /
GEO-S015-2-WIP-* / S15-1/2-A11Y-* as regression guards). The done condition is the
two columns + the guarded Generate + clean Cancel — NOT the generated prompt text
(that is UC-S015-4, exactly as UC-S014-2 excluded UC-S014-3).

---

## UC-S015-4
Acceptance conditions co-authored when UC-S015-4 is pulled — the enriched
`buildPrompt` extension (`partAJob`/`partBJob` tokens), the prompt rendered into
this panel's reserved output slot, and the reused s014 copy/toast idiom. The
inputs UC-S015-3 produces (`partAJob`/`partBJob`/`intentNote` + the shared
`useSteerContext` context) are -4's verbatim contract; the displayed prompt follows
the s014 PROMPT-FREEZE-1 discipline.
