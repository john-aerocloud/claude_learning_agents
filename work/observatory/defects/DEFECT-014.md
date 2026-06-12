# DEFECT-014 — Queue/stage hover opens all four metric-source panels in an overlapping stack

**Reported:** 2026-06-12 (human, live board)
**Status:** CONFIRMED → fix next (ui-designer ruling → engineer)
**Surface:** VSM stage/queue nodes — MetricSource hover reveal (CHK-2 board)
**Touches:** StageNode.jsx / MetricSource.jsx / metric-source.css (UC-S002-era surface, DEFECT-003/007 lineage)

## Expected
Hovering a queue shows ONE source panel — the one for the figure being
inspected.

## Actual
Hovering anywhere on a queue/stage node opens ALL FOUR panels (throughput,
dwell, depth, rework) absolutely positioned into an overlapping stack —
reads as "4 identical panels"; the top ones obscure the others and the queue
beneath.

## Intent
Inspect where a queue figure comes from (source provenance, the
DEFECT-003/005 data-trust affordance).

## Importance
Cosmetic-but-obscuring on the core observe surface: the provenance affordance
is unusable when four panels paint over each other.

## Reproduction evidence (2026-06-12, live :5173, Playwright probe)
- Hover Intake node → 4 visible `metric-source-intake-*` panels, bboxes
  y=381/381/432/483 each ~346×137-152 — heavy overlap. Same on Ready.
- Root cause is in-code by design: StageNode.jsx ~L238 "the reveal is
  node-scoped … OPENS all four source panels"; metric-source.css L17 already
  documents the symptom ("node-hover opens every panel, and the dwell panel
  drops over the queue"). The UC-S014-1 `pointer-events:none` fix made the
  stack click-transparent but it still paints.

## Classification
Our bug — a node-scoped disclosure that should be figure-scoped (or a single
composite panel). UX ruling: ui-designer (owns the disclosure pattern), then
engineer defect-as-spec with the reproduction pinned (hover node ⇒ exactly one
visible panel, or zero until a figure is hovered/focused).

## Priority
Fix next (not pre-empting the two in-flight builds): small, seam free
(StageNode/MetricSource unclaimed), user-reported on the core surface.

## Gap-closing note (for the retro)
The overlap was KNOWN in a CSS comment but never became a defect/test — a
written-down symptom that never entered the work system. Candidate experiment:
comments that describe misbehaviour are defects (sweep for "TODO/known issue/
drops over" patterns at retro; each becomes a record or gets deleted).

---

## UI-DESIGNER RULING (2026-06-12, ui-designer; small fix — no slice ceremony)

### Chosen option: (b) node-scoped SINGLE composite panel
Node hover/focus+Enter opens ONE `MetricSource` panel containing all four
metrics SECTIONED (Throughput / Dwell / WIP-or-Depth / Rework). Esc or
mouse-leave closes it. The four-panel-per-figure stack is collapsed to a single
overlay anchored to the node.

**Why (b), not (a) or (c):**
- **(a) figure-scoped — rejected.** Reintroduces per-figure hover/focus targets.
  StageNode L13–18 records that per-metric tab stops were *deliberately avoided*
  (A11Y-3: Tab visits NODES only, in flow order). Figure-scoped keyboard means
  either four new tab stops (reverses a deliberate a11y decision) or a roving
  sub-focus inside the node — the largest change and it fights an existing
  principle. The whole point of the node-scoped model was 1-interaction-to-trace.
- **(c) fan/offset stack — rejected.** Four panels still paint and still occupy
  four footprints; on narrow/mobile viewports four offset overlays are *worse*.
  Multiplies overlay area for no semantic gain.
- **(b) chosen.** Keeps the EXACT built interaction model (node = single tab
  stop; hover/Enter opens, Esc/leave closes — zero a11y regression, keyboard
  path stays first-class). One overlay honours EXP-016 (still an absolute
  overlay, no reflow of the board; now a single one). Smallest change: render
  ONE `MetricSource` per node instead of one per StageMetric/badge. The panel
  CONTENT (readable event lines — DEFECT-005/007/008 work) is wholly untouched;
  only the container scoping moves up one level.

### TESTABLE conditions (engineer: red→green; tester enforces)

- **D14-AC-1 (exactly-one-visible invariant).** When a node is open (hover or
  focus+Enter), the count of visible (`:not([hidden])`) `role="tooltip"` /
  `[data-testid^="metric-source-<stage>-"]` elements within that node is EXACTLY
  ONE — never four. When the node is closed, that count is ZERO.

- **D14-AC-2 (composite content — all four metrics present, sectioned).** The
  single open panel contains a labelled section for EACH metric the node renders
  (Throughput, Dwell, WIP **or** Depth per stage kind, Rework), each section
  carrying its own readable source lines / summary / "no events recorded" empty
  state. No metric loses its provenance; legibility of each line is unchanged
  (assert the DEFECT-005 readable line `HH:MM · agent · event · item_id` and the
  DEFECT-007 throughput summary still render verbatim).

- **D14-AC-3 (open paths — hover AND keyboard, parity).** `mouseEnter` on the
  node opens the one panel; `focus` + `keyDown Enter` (and Space) on the node
  opens the same one panel. Both reach the identical exactly-one-visible state
  (D14-AC-1). Keyboard is NOT downgraded relative to hover.

- **D14-AC-4 (close paths — Esc AND mouse-leave).** `keyDown Escape` on the
  open node hides the panel (visible tooltip count → 0); `mouseLeave` hides it;
  `blur` hides it. No path leaves the panel stranded open.

- **D14-AC-5 (GEO non-overlap / single footprint).** With a node open, the
  bounding boxes of all visible `metric-source-*` tooltips do NOT overlap — i.e.
  there is at most one visible source panel box, so the "4 panels stacked at
  y=381/381/432/483" reproduction can never recur. Assert via
  `getBoundingClientRect`: at most one visible panel rect; if the test harness
  cannot measure layout, assert the DOM invariant (D14-AC-1) plus that the panel
  is rendered once per node, not once per figure.

- **D14-AC-6 (aria wiring preserved + click-transparency).** Every metric value
  / badge still resolves its `aria-describedby` to the (now shared) panel id, so
  the value→provenance relationship survives. The panel keeps
  `pointer-events:none` (UC-S014-1) so it cannot intercept clicks on the queue
  chips' steer buttons beneath it.

### Selector contracts (engineer MUST expose)
- The single composite panel: `data-testid="metric-source-<stage>"` (drop the
  `-<kind>` suffix on the CONTAINER — it is no longer per-kind). Keep
  `role="tooltip"`.
- Per-metric SECTIONS inside it: `data-testid="metric-source-<stage>-<kind>"`
  (the OLD per-figure id moves onto the section, preserving the existing
  `aria-describedby={`src-<stage>-<kind>`}` wiring and all current tester
  selectors — minimises test churn). i.e. the panel is the container, the
  sections keep the kind-scoped ids the values point at.
- Node state attr unchanged: `data-source-open="true|false"` on `.stage-node`.
- Source file / event-line / summary selectors UNCHANGED
  (`source-file-<stage>-<kind>`, `data-testid="source-event"`,
  `metric-source-summary-<stage>-<kind>`).

### Engineer brief (≤ ~1h, presentation-layer reshape, no behaviour change)
1. **MetricSource.jsx** — split into (a) a `MetricSourcePanel` container
   (`role="tooltip"`, `id`, `hidden` from `open`, `data-testid="metric-source-<stage>"`,
   `pointer-events:none`) and (b) a `MetricSourceSection` (the current body:
   caption/file/summary/events/empty) rendered with
   `data-testid="metric-source-<stage>-<kind>"` and its own `id` for the
   value's `aria-describedby`. The container holds N sections.
2. **StageNode.jsx** — render ONE `MetricSourcePanel` at node level (sibling of
   `<dl class="stage-figs">`), passing the per-metric source data for all four
   sections. Remove the per-`StageMetric`/`InFlightBadge`/`QueueDepth` MetricSource
   instances; those components keep emitting the value with its existing
   `aria-describedby={`src-<stage>-<kind>`}` pointing at the matching section id.
   Interaction state (`open`, `onKeyDown`, `onMouseEnter/Leave`, `onBlur`) is
   ALREADY at node level — leave it exactly as is.
3. **metric-source.css** — keep the overlay styling on the container; ensure ONE
   panel positions cleanly under the node. **DELETE/UPDATE the L15–18 comment**
   that documents the symptom ("node-hover opens every panel, and the dwell
   panel drops over the queue chips' steer buttons") — replace with the new
   single-panel rationale; the documented misbehaviour must not survive the fix
   (Gap-closing note: "comments that describe misbehaviour are defects").
4. **Tests** — section selectors (`metric-source-<stage>-<kind>`) survive, so
   most existing StageNode/MetricSource specs pass with the section id moved.
   Add D14-AC-1 (exactly-one-visible) and D14-AC-5 (single footprint) as new
   failing tests first.
5. **No** domain/route/data-flow change. This is an adapter-internal reshape.
