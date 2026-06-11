---
slice: s002
slug: pipeline-map
mode: STRUCTURE (before build)
author: ui-designer
co-authored-with: solution-architect (§11.2 render-mechanism gate)
render-mechanism: HTML + CSS (flex) for boxes + inline SVG for flow arrows  # §11.2 Option A — DECIDED
design-system-ref: work/observatory/design/{design-system.md, components.md, patterns.md}
covers: UC3 (render), UC4 (buffer-state flags), UC5 (constraint highlight); layout hooks for UC6 (live)
---

# UI design — s002 pipeline map (STRUCTURE)

This is the FIRST visual surface of Observatory. It is the zoomed-out, single-screen
overview of the pull system. Drill-down is CHK-4, not here. Read-only (requirements
§7 "Phase 1 is strictly read-only — no steer affordances yet"; project §6 read-only).

## §11.2 render-mechanism decision — RESOLVED: Option A
**HTML + CSS flex for the 4 boxes; inline SVG `<line>`/`<path>` for the flow arrows.**
Rationale (ui-designer + architect): no external dependency / zero bundle cost;
full control over the a11y markup (Mermaid-rendered SVG is hard to make
WCAG-conformant); a 4-box static topology gains nothing from Mermaid's
graph-layout engine. SVG arrows are `aria-hidden` decorative — topology is also
carried structurally (DOM order + region label), so the diagram never depends on
the SVG for meaning. (Mermaid stays available for CHK-4 dependency `.mmd` graphs.)

---

## 1. Information architecture / layout (the IA one-liner)

A single labelled **region** ("Pipeline map") laying out the four queues left→right
as a horizontal flow — **Intake → Ready → [inner dev loop] → Deploy** — with
**Rework** as a return loop beneath, each queue a box showing name + live count +
buffer meta; SVG arrows show direction; starving/over-WIP surface as a badge ON the
relevant box; the ToC constraint surfaces as a distinct corner ribbon on whichever
box it names.

```
   region: aria-label="Pipeline map"
   ┌─────────┐      ┌─────────┐    ┌ inner ┐    ┌─────────┐
   │ INTAKE  │ ───▶ │  READY  │ ──▶│  dev  │──▶ │ DEPLOY  │
   │   5     │      │   1  ▽  │    │ loop  │    │   0     │
   │ cap 5 △ │      │floor 3  │    └───────┘    │ floor 1 │
   └─────────┘      └────◆────┘                 └─────────┘
        ▲           (constraint:◆ + starving:▽)      │
        │                                            │ (failed validation)
        └──────────────── REWORK ◀───────────────────┘
                          ┌─────────┐
                          │ REWORK  │
                          │   2     │
                          └─────────┘
```
- **Flow direction:** Intake→Ready→(dev loop)→Deploy is forward; Deploy→Rework→(back
  toward Ready/Intake) is the return loop. The "inner dev loop" is a labelled stage
  marker between Ready and Deploy (the pull system's build phase) — NOT a queue with a
  CSV; it carries no count, just orients the operator.
- **Where states surface:** starving (▽) / over-WIP (△) badge sits inside the box it
  applies to; the constraint (◆) is a corner ribbon so it can co-occur with a state
  badge on the same box without collision.
- Single screen, no scroll for the map itself; no drill affordance in s002.

## 2. Component decomposition (props / data shape)

Consumes the `QueueState[]` from UC2 and `constraintQueue` from UC5 — the render
layer never touches raw CSV. Inventory + selectors in `design/components.md`.

```ts
// produced by UC2 / UC5; consumed by the render components
type QueueState = {
  name: 'intake' | 'ready' | 'deploy' | 'rework';
  length: number;
  min_items?: number;     // floor (starve threshold) — undefined if no policy
  wip_limit?: number;     // cap (over-WIP threshold) — undefined if no policy
  status: 'ok' | 'starving' | 'over-wip';
};
type PipelineMapProps = {
  queues: QueueState[];          // 0..4; empty ⇒ empty-state render
  constraintQueue: string | null; // matched queue name, or null (UC5)
  live?: 'connected' | 'reconnecting'; // UC6
};
```

| Component | Props | Renders |
|---|---|---|
| **PipelineMap** | `PipelineMapProps` | region; ordered QueueBoxes; FlowArrows; LiveStatusDot; empty-state when `queues` is empty |
| **QueueBox** | `{ queue: QueueState, isConstraint: boolean }` | name, count, buffer meta ("1 / floor 3"), BufferStateIndicator, ConstraintBadge; `tabindex=0` |
| **BufferStateIndicator** | `{ status }` | starving (▽ + "starving") or over-WIP (△ + "over-WIP"); nothing when `ok` |
| **ConstraintBadge** | `{ present }` | ◆ + "constraint" corner ribbon when present |
| **FlowArrow** | `{ from, to, kind: 'forward'\|'rework' }` | inline SVG arrow, `aria-hidden` |
| **LiveStatusDot** | `{ live }` | connected/reconnecting status (UC6) |

## 3. Click-path / interaction budget

Read-only v1 → **0 clicks** to do the core job: the operator opens the URL and
reads flow state at a glance (J1 / SM2). Interaction is minimal-and-only:
- Queue boxes are **focusable** (`tabindex=0`) for keyboard reachability and
  screen-reader orientation — NOT clickable (drill-down is CHK-4).
- No hover-dependent information: any hover affordance (e.g. raised surface) is
  cosmetic; all data is visible without hover (so it survives touch/keyboard/SR).
- Nothing is hidden behind interaction. The whole point of the map is at-a-glance.

## 4. Testable accessibility conditions (WCAG 2.2 AA) — assertion-ready

These are mirrored into `acceptance.md` (they supersede/complete the placeholder
"Accessibility summary" there). Engineer must not weaken without ui-designer sign-off.
Assert **geometry / aria / text**, not colour.

**Structure & semantics**
- **A11Y-1 (region):** the map root has `role="region"` and `aria-label="Pipeline map"`.
  Assert: `getByRole('region', { name: /pipeline map/i })` resolves. (jsdom)
- **A11Y-2 (queue group + name carries count + state):** each QueueBox is
  `role="group"` whose accessible name matches `/<name> queue, \d+ item/i` and, when
  not `ok`, includes the state word (`starving`/`over-WIP`). Assert via accessible
  name, e.g. Ready+starving → name matches `/ready queue, 1 item.*starving/i`.
  (jsdom — completes AC4.5; supersedes acceptance placeholder #1/#2/#3)

**Keyboard**
- **A11Y-3 (focus order):** Tab from page start reaches all four boxes in DOM/flow
  order intake→ready→deploy→rework; each receives visible focus. (Playwright — AC3.5)
- **A11Y-4 (focus visible):** a focused QueueBox shows a focus indicator with
  contrast ≥ 3:1 and thickness ≥ 2px (`--focus-ring`). Assert computed
  `outline`/`box-shadow` present on `:focus-visible`. (Playwright — WCAG 2.4.7 / 2.4.11)

**State never colour-only (the core a11y requirement)**
- **A11Y-5 (redundant state encoding):** a `starving` box contains a
  `data-testid="state-badge"` element with **visible text** matching `/starving/i`
  AND an `aria-hidden="true"` icon; an `over-wip` box likewise with `/over-?wip/i`.
  An `ok` box contains NO state-badge element. (jsdom — completes AC4.1/4.2/4.3;
  asserts text+icon presence, NOT colour)
- **A11Y-6 (constraint non-colour cue):** the constraint box has
  `data-constraint="true"` AND a `data-testid="constraint-badge"` with visible text
  matching `/constraint/i` + an `aria-hidden` ◆ icon; non-constraint boxes have
  `data-constraint="false"` and no badge. (jsdom — completes AC5.5/5.6)
- **A11Y-7 (co-occurrence):** when a box is BOTH the constraint AND starving/over-WIP,
  both the state-badge and the constraint-badge are present and distinguishable
  (different `data-testid`, different visual channel). Assert both elements exist on
  the same box. (jsdom — guards against one signal masking the other)

**Contrast & target size**
- **A11Y-8 (text contrast):** queue name (`--c-text`) and count contrast ≥ 4.5:1
  against box surface; buffer meta (`--c-text-dim`) ≥ 4.5:1. State/constraint border
  colours ≥ 3:1 vs surface (non-text UI, WCAG 1.4.11). (Playwright axe scan — see `make a11y`)
- **A11Y-9 (target size):** any focusable element ≥ 24×24px (WCAG 2.2 §2.5.8).
  Assert bounding box of each QueueBox ≥ 24×24. (Playwright)

**Reduced motion**
- **A11Y-10 (reduced motion):** under `prefers-reduced-motion: reduce`, count/state
  transitions are 0ms — live updates (UC6) change value with no animation. Assert
  computed `transition-duration: 0s` under the media emulation. (Playwright)

**Visual-structural / geometry (shape carries meaning — EXP-016 practice)**
- **GEO-1 (horizontal flow, not stacked):** the four queue boxes lay out left→right —
  assert the four boxes' bounding-box `x` is strictly increasing and their `y` overlaps
  (same row), so the map renders as a FLOW, not a vertical list. (Playwright bounding-box)
- **GEO-2 (rework is the return loop, below):** the Rework box's bounding-box `y` is
  below (greater than) the forward row, confirming the return-loop topology rather than
  a fifth box in line. (Playwright bounding-box)
- **GEO-3 (badge inside its box):** a state badge / constraint badge's bounding box is
  contained within its owning QueueBox's bounding box (the signal is on the right box).
  (Playwright bounding-box)

> **Inherited-surface audit:** s002 is Observatory's first visual surface — nothing
> pre-exists to audit. (No `/defect` raised.)

## 5. Design tokens used

All from `work/observatory/design/design-system.md` (seeded by this slice). New
tokens introduced for this surface — the **state encoding is redundant**
(icon + text + colour) so colour is never the sole cue:
- Queue-state: `--c-state-ok`, `--c-state-starving`(▽/"starving"),
  `--c-state-over`(△/"over-WIP"), each with a matching `*-bd` border token.
- Constraint: `--c-constraint`(◆/"constraint") + `--c-constraint-bd` (distinct
  visual channel = corner ribbon).
- Focus: `--c-focus`, `--focus-ring` (≥ 3:1, ≥ 2px).
- Type: `--fs-count`, `--fs-label`, `--fs-meta`. Spacing: `--sp-*`.
  Radii/motion: `--radius-box`, `--dur-fast` (+ reduced-motion override).
- Target floor: `--target-min` = 24px.

## 6. Explicitly NOT designed in s002
- Drill-down / detail panes (CHK-4).
- DORA panel, stage cards, time-thief view (CHK-3).
- Any steer / write affordance (Phase 2 / CHK-5).
- Mobile/responsive optimisation (project out-of-scope).
- Multi-project overview tiles (CHK-1/CHK-4 surface, not this slice).
