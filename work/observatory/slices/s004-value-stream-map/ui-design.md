---
slice: s004-value-stream-map
owner: ui-designer
mode: STRUCTURE
updated: 2026-06-09
chunk: CHK-2 (value-stream map, re-scoped — supersedes thin queue map)
---

# UI design (STRUCTURE) — s004 value-stream map

This REPLACES the thin 4-box PipelineMap as the product's primary view. The
operator's words: *"I expect to see this whole thing and then the throughput data
with each part, neatly labelled."* So the deliverable is the WHOLE delivery
value-stream — ~10 labelled stage nodes in flow order, two gates marked AS gates,
a rework loop drawn returning into the build stages, and every node carrying four
neatly-labelled figures (throughput / dwell / WIP / rework) traceable to ledger rows.

> Builds on the existing design system (s002/s003). Reuses: the redundant
> state-encoding rule (§8 — never colour-only), the `SourceLink` `data-source`
> traceability convention, the `FlowArrow` SVG connector, the constraint glyph/
> text channel, and the StageCardGrid geometry-guard discipline. Extends tokens
> additively; nothing above s003 changes.

---

## 1. Confirmed data shape (against UC-S004-1)

Endpoint `GET /api/projects/:id/stage-flow` returns a JSON **array in flow order**,
one object per canonical stage (zero-stages present with zeros, never omitted):

```ts
type StageFlow = {
  stage: string;          // canonical key, e.g. "engineer"
  label: string;          // human name, e.g. "Build / TDD"
  throughput: number;     // integer — items passed through
  dwell_median_s: number; // median seconds in stage (0 if < 2 completed pairs)
  wip: number;            // integer ≥ 0 — items in-flight now
  rework: number;         // integer ≥ 0 — failure/recovery events
  source_rows: string[];  // ledger row ids / timestamps backing all four figures
  wip_items?: { item_id: string; since_ts: string }[]; // UC-S004-4 (optional)
};
```

> Note vs the dispatch brief: the authoritative field is **`dwell_median_s`** (not
> `dwell_median`) and **`source_rows`** (not `source`). Build to the use-cases.md /
> acceptance.md spec. **Rework is a LOOP, not an 11th node** — each stage carries
> its own `rework` count, and the *visual* rework loop is a back-path from Validate
> into the build band. There are **10 stage nodes**.

**Canonical order (the geometry contract):**
`intake → decompose → ready → capabilities → ui-design → engineer (Build/TDD)
→ ui-validate → deploy → validate → done`. Gates = **intake** and **deploy**.

---

## 2. Navigation / IA — the one-screen layout

**IA one-liner:** the value-stream is a single landmark region `"Value-stream map"`
that **replaces** the s002 PipelineMap at the top of the dashboard `<main>`; the 10
stage nodes render as a **banded left→right flow that wraps into rows at narrow
widths**, the two gates are diamond-edged nodes, and the **Rework loop is a labelled
back-arrow** from Validate returning into the build band.

This is a process, not a list. To fit 10 stages + 2 gates + a loop legibly on a
1280px screen without an unreadable single line OR a stacked column, the nodes are
laid out as a **CSS flex/grid flow that wraps row-by-row** (`flex-wrap: wrap`),
connected by `FlowArrow`s, grouped into three labelled **lanes (bands)** that match
the operator's mental model and the JTBD wording:

```
ValueStreamMap  region "Value-stream map"
 ┌─ LANE: Intake & Ready (queue band) ───────────────────────────────┐
 │  ◇Intake(gate) → [Decompose] → [Ready] →                          │
 ├─ LANE: Build (work band) ──────────────────────────────────────────┤
 │  [Capabilities] → [UI-Design] → [Build/TDD] → [UI-Validate] →      │
 │        ▲────────────── Rework loop ◄───────────────────┐           │
 ├─ LANE: Release (release band) ─────────────────────────────────────┤
 │  ◇Deploy(gate) → [Validate] ──Rework──┘ → [Done]                   │
 └────────────────────────────────────────────────────────────────────┘
```

- **Why lanes, not one long wrapped strip:** 10 nodes on one 1280px row are each
  ~110px — too cramped for a name + four labelled figures. Three named bands
  (queue / build / release) let each node be ~200px (`--node-min`, = the proven
  `--card-min` width), keep the flow readable, AND give the operator a coarse
  "where in the process" anchor. The bands map directly to the project's CORE-job
  wording (Intake→Ready / [build cluster] / Deploy→Done).
- **Within a lane** nodes flow left→right with forward `FlowArrow`s; the **lane
  break is itself a connector** (the last node of a lane arrows down to the first
  of the next), so the global order intake→…→done is unbroken.
- **Wrap (responsive, fail-soft):** under the lane min width the lane's own nodes
  wrap to a second row; arrows reflow. Desktop-first per project scope — this is
  graceful degradation, not a mobile design.
- The map **replaces** PipelineMap as the region at the top of `<main>`; the s003
  DoraPanel / StageCardGrid / TimeThiefView remain stacked below it unchanged.

### Click-path budgets (core jobs)
| Job | Budget | s004 reality |
|---|---|---|
| J1 — "See the whole value-stream + per-stage throughput at a glance" | **0 clicks** — visible on open | all 10 stages + 4 figures each render on load |
| J1b — "See where in-flight work sits (WIP not invisible)" | **0 clicks** | WIP>0 nodes carry a non-colour in-flight indicator on load |
| SM3 — "Verify a figure against its ledger rows" | **1 interaction** (hover/click a figure → source rows) | UC-S004-5 tooltip; ≤ 1 |
| J2 — "Drill into a stage/item" | deferred to CHK-4 | nodes are focusable but drill-to-detail is not in s004 |

Budget justification: J1 is the entire point — zero clicks. The only interaction
added in s004 is the 1-step traceability reveal (UC-S004-5); everything else is
read-on-load. No step is spent on navigation chrome.

---

## 3. Per-stage node content (the four labelled figures)

Each `StageNode` shows, top→bottom:

1. **Stage name** (`label`, e.g. "Build / TDD") — the node heading.
2. A **gate marker** if the stage is a gate (intake/deploy) — `◇` glyph + visible
   text "gate" (non-colour-redundant; see §4).
3. The **four labelled figures**, each a `StageMetric` (label + value, never a bare
   number), in a fixed 2×2 order so the eye learns the position:

   | Throughput **N** | Dwell **Xm** |
   | WIP **N** | Rework **N** |

   - **Throughput:** integer, label "Throughput".
   - **Dwell:** `dwell_median_s` humanised — `< 60s` → "Ns", `< 3600s` → "Xm",
     else "Xh"; the unit is part of the displayed value; label "Dwell".
   - **WIP:** integer ≥ 0, label "WIP" — the in-flight count (see §4 prominence).
   - **Rework:** integer ≥ 0, label "Rework".
4. Each figure carries `data-source` (the `source_rows` for that node) — the
   traceability hook + the UC-S004-5 reveal target.

### WIP > 0 prominence — NON-COLOUR-REDUNDANT (the whole point)
"Pulled items disappear" is the defect this slice kills. A node with `wip > 0` is
made impossible to miss by **four simultaneous cues, three of them non-colour**:

1. **Shape/structure:** the WIP figure is promoted from a normal `StageMetric` to a
   prominent **in-flight badge** — a filled pill that visually pops out of the 2×2
   grid (larger, bordered), so the node's silhouette changes when WIP>0.
2. **Icon (shape cue):** a `●` "live work" glyph (`aria-hidden`) prefixes the WIP
   pill — present only when `wip>0`, absent at `wip=0` (so greyscale-distinguishable).
3. **Text (authoritative cue):** the pill reads `"● 2 in-flight"` (literal word
   "in-flight"), and the node's accessible name appends `", 2 in-flight"`. A screen
   reader announces it; the word, not the colour, is the signal.
4. **Colour (one of four, never alone):** a new `--c-wip` accent + node border —
   redundant with the three above, consistent with the §8 rule.

At `wip=0` the WIP figure renders as an ordinary "WIP 0" `StageMetric` with **no**
badge, **no** glyph, **no** accent (AC4.3 — no false positives). The `wip_items`
(if returned) name the in-flight items in the figure's traceability tooltip.

Reduced-motion: a subtle pulse on the in-flight pill is gated behind
`@media (prefers-reduced-motion: no-preference)`; under reduce it is a static
bordered pill (the three non-motion cues still carry the signal).

---

## 4. Component decomposition (states · props · selectors)

All custom (no library named). Selectors are the build contract AND the tester's
hooks. Every figure carries `data-source` (§8 / UC-S004-5).

### ValueStreamMap  (UC-S004-2 — top-level, replaces PipelineMap as primary view)
- **Role:** the whole value-stream region; owns lane layout + global flow order.
- **Props:** `{ stages: StageFlow[]; constraint?: string | null; sourceRef: string }`.
- **States:** default (10 nodes) · empty (all-zeros data → renders full labelled
  skeleton of 10 nodes showing zeros, NOT a blank/crash — AC2.6 / CC1) · loading
  (region + lane headings render immediately, figures fill ≤ 2s).
- **Selector:** `role="region"` + `aria-label="Value-stream map"`;
  `data-testid="value-stream-map"`. Lanes are a `role="list"` of three
  `role="group"` bands (`data-testid="vsm-lane-<queue|build|release>"`, each with an
  `aria-label`). Stage nodes form an ordered set; DOM order = canonical flow order.
- **A11y / geometry:** landmark region with a visible `<h2>` "Value-stream map".
  DOM order is the canonical order (flow conveyed structurally, not only by arrows).
- **Library:** custom. Reuses FlowArrow.

### StageNode  (UC-S004-2/3/4/5 — one stage)
- **Role:** one canonical stage — name, (gate marker if gate), four labelled figures.
- **Props:** `{ stage; label; throughput; dwell_median_s; wip; rework; source_rows;
  wip_items?; isGate: boolean; isConstraint?: boolean }`.
- **States:** default · gate (diamond edge + GateMarker) · wip-active (`wip>0`,
  in-flight badge) · constraint (optional — reuses s002 `◆`/"constraint" channel) ·
  zero (all figures 0 → still fully rendered, AC1.2/AC2.6) · focus (focusable,
  visible ring) · loading (skeleton).
- **Selector:** `role="group"` + `aria-label` = the node's accessible summary
  (see a11y); `data-testid="stage-<stage>"` (canonical key);
  `data-stage-kind="gate|work"`; `data-wip="0|N"` (geometry/state hook);
  `data-wip-active="true|false"`; `data-constraint="true|false"`.
- **Focusable:** `tabindex="0"`, read-only, keyboard-reachable (target ≥ 24px,
  far exceeded). Drill is CHK-4 (not in s004).
- **A11y:** accessible name carries the key figures so the number is never bare,
  e.g. `"Build / TDD stage, throughput 42, dwell 12 minutes, WIP 2 in-flight,
  rework 3"`. Gate nodes prepend `"gate: "`; constraint appends `", constraint"`.
- **Library:** custom.

### StageMetric  (UC-S004-3 — one labelled figure)
- **Role:** a single label+value figure (throughput | dwell | wip | rework). Never
  a bare number.
- **Props:** `{ kind: "throughput"|"dwell"|"wip"|"rework"; label: string;
  value: string; raw: number; source: string }`.
- **States:** default · zero (value "0"/"0s", still rendered — AC1.2/AC3.4) ·
  wip-active (the `wip` kind, when `raw>0`, renders AS the InFlightBadge instead).
- **Selector:** `data-testid="metric-<stage>-<kind>"`; the value element carries
  `data-metric` (UC-S004-5 traversal hook) AND non-empty
  `data-source="<source_rows joined / first row id>"`.
- **A11y:** rendered as a `<dt>` label + `<dd>` value (definition pair) so each
  number is labelled. Contrast ≥ 4.5:1 (AC3.6). Integers shown as integers (AC3.2);
  dwell humanised with unit (AC3.3).
- **Library:** custom. Reuses the SourceLink `data-source` convention.

### InFlightBadge  (UC-S004-4 — the WIP>0 prominence component)
- **Role:** the prominent non-colour-redundant in-flight indicator that replaces the
  plain WIP `StageMetric` when `wip>0`.
- **Props:** `{ count: number; items?: {item_id; since_ts}[]; source: string }`.
- **States:** present (`wip>0`) · absent (`wip=0` → component not rendered; plain
  "WIP 0" StageMetric shown instead — AC4.3).
- **Selector:** `data-testid="inflight-<stage>"`; carries `data-inflight="N"`.
  Visible text `"● N in-flight"`; `●` is `<span aria-hidden="true">`.
- **A11y:** the literal word "in-flight" + count is the authoritative cue; glyph
  `aria-hidden`; colour redundant; contributes `", N in-flight"` to the node name.
  Pulse animation only under `prefers-reduced-motion: no-preference`.
- **Library:** custom.

### GateMarker  (UC-S004-2 — gate distinction)
- **Role:** marks intake & deploy AS gates, non-colour-redundantly.
- **Props:** `{ gate: "intake"|"deploy" }`.
- **States:** present (on gate nodes) · absent (work nodes).
- **Selector:** `data-testid="gate-<intake|deploy>"`; visible text "gate"; `◇` glyph
  `<span aria-hidden="true">`. Node also carries `data-stage-kind="gate"` AND a
  diamond-edged border style (shape cue) distinct from work-node radius.
- **A11y:** "gate" text + `◇` shape + border-shape — three non-colour cues; the node
  name prepends "gate:". (AC2.3 — gates visually distinct, not colour-only.)
- **Library:** custom.

### ReworkLoopConnector  (UC-S004-2 — the rework loop)
- **Role:** the labelled back-path from Validate (failure) returning into the build
  band (Build/TDD at minimum). The loop, not a node.
- **Props:** `{ from: "validate"; to: "engineer"; label: "Rework" }`.
- **States:** static (always drawn — the loop is part of the process topology, AC2.4).
- **Selector:** `data-testid="rework-loop"` with `data-from="validate"`
  `data-to="engineer"`; the SVG path is `aria-hidden="true"` (decorative); the
  visible **text label "Rework"** is a real DOM text node (NOT inside the
  aria-hidden SVG) so the loop is announced/asserted by text, not only the arrow.
- **A11y:** topology conveyed by the visible "Rework" label + the per-stage `rework`
  figures; the curved arrow is decorative (AC2.4/AC2.5). Right-to-left direction.
- **Library:** custom (inline SVG path + visible label). Specialisation of FlowArrow.

### FlowArrow  (reused from s002 — forward connectors between adjacent stages)
- Unchanged. `data-testid="flow-arrow"` + `data-from`/`data-to`; SVG `aria-hidden`;
  direction left→right within lanes, and lane-to-lane down-connectors. (AC2.5.)

### MetricSource (UC-S004-5 — traceability reveal; the 1-interaction path)
- **Role:** on hover/click of any StageMetric value, reveals the `source_rows`
  (row ids / timestamps) so the operator can verify against ledger.csv.
- **Props:** `{ source_rows: string[]; metricLabel: string }`.
- **States:** value>0 (shows ≥ 1 row ref — AC5.1/AC5.2) · value=0 ("no events
  recorded" — AC5.3, not blank/broken).
- **Selector:** `data-testid="metric-source-<stage>-<kind>"`; `role="tooltip"` (or a
  side panel) referenced by the metric via `aria-describedby`.
- **A11y:** keyboard-triggerable (focus the metric → reveal), not hover-only;
  dismissible (Esc); content is text row refs. Reuses the SourceLink "↗ source"
  visible affordance convention.
- **Library:** custom. Reuses s003 SourceLink convention.

### Reused unchanged
`SourceLink` convention (`data-source` on every figure), `LiveStatusDot` (UC-S004-6
SSE re-fetch indicator), the constraint `◆`/"constraint" channel.

### Component-map delta
Add `value-stream-map` node (replaces `pipeline-map` as primary surface) and the
new components (StageNode, StageMetric, InFlightBadge, GateMarker,
ReworkLoopConnector, MetricSource) → used-by edges to the value-stream-map surface;
mark the changed `pipeline-map → value-stream-map` supersession with mermaid
`classDef changed`. **The engineer/UI-validate updates
`architecture/dependencies/component-map.mmd` in the build commit; the marks are the
tester's UI test-plan input and are cleared at slice delivery.** (Flagged here as a
STRUCTURE obligation; the `.mmd` edit lands with code, not in this spec.)

---

## 5. Testable a11y + geometry conditions (WCAG 2.2 AA) — mirror into acceptance.md

Assertion-ready. These are co-authored into
`work/observatory/slices/s004-value-stream-map/acceptance.md` as the axe/Playwright
contract the tester enforces (alongside the existing AC2/AC3/AC4 cases).

### A11y (WCAG 2.2 AA)
- **A11Y-1 (region + headings):** `role="region"` `aria-label="Value-stream map"`
  with a visible `<h2>`; the three lanes are labelled `role="group"`s — all
  reachable by heading/region navigation. (1.3.1, 2.4.1)
- **A11Y-2 (every stage is a labelled region whose name carries its figures):**
  each `[data-testid^="stage-"]` is `role="group"` with an accessible name matching
  `/<label> stage, throughput \d+, dwell .+, WIP .+, rework \d+/` — the number is
  never announced bare. Gate nodes' names start "gate:"; constraint nodes end
  ", constraint". (1.3.1, 4.1.2)
- **A11Y-3 (flow order keyboard-navigable):** Tab visits the 10 stage nodes in
  canonical DOM order intake→…→done; each receives a visible focus ring
  (`--focus-ring`, ≥ 3:1, ≥ 2px). No keyboard trap. (2.1.1, 2.1.2, 2.4.3, 2.4.7)
- **A11Y-4 (WIP non-colour-redundant):** for a node with `data-wip-active="true"`,
  the in-flight signal is present as TEXT (the substring "in-flight" in the
  node's accessible name AND visible text) and as a glyph — NOT colour-only.
  Asserted by reading text/aria, with colour disabled (forced-colors / monochrome
  emulation) the indicator is still detectable. (1.4.1)
- **A11Y-5 (gates have text labels):** each `[data-testid^="gate-"]` contains the
  visible text "gate" and the node carries `data-stage-kind="gate"`; gate identity
  survives greyscale (text + `◇` shape + border-shape). (1.4.1, 1.3.1)
- **A11Y-6 (rework loop has a text label):** `[data-testid="rework-loop"]` exposes a
  visible DOM text node "Rework" outside the aria-hidden SVG; the loop's existence
  is assertable by text, not only the decorative arrow. (1.3.1, 1.4.1)
- **A11Y-7 (contrast):** all figure values + labels ≥ 4.5:1 against the node
  surface; non-text UI (focus ring, node/gate/wip borders, in-flight pill edge)
  ≥ 3:1. New `--c-wip` + its border meet these (recorded in design-system.md).
  (1.4.3, 1.4.11)
- **A11Y-8 (target size):** focusable nodes and the metric reveal trigger ≥
  24×24px (`--target-min`). (2.5.8)
- **A11Y-9 (reduced motion):** under `prefers-reduced-motion: reduce`, the in-flight
  pulse and live-update transitions collapse to 0ms; the in-flight signal still
  reads via its static text/glyph/border cues. (2.3.3)
- **A11Y-10 (traceability reveal is keyboard-operable & dismissible):** the
  MetricSource reveal opens on focus+Enter (not hover-only) and closes on Esc;
  metric value references it via `aria-describedby`. (2.1.1, 1.4.13)
- **A11Y-11 (axe clean):** `make a11y-observatory` reports zero serious/critical
  violations on the rendered value-stream map (default + all-zeros + wip-active
  states).

### Geometry / visual-structural correctness (the s002-board-as-a-line guard)
Functional-green ≠ visually-correct. Assert SHAPE via computed style / bounding-box,
not element presence.
- **GEO-1 (it is a flow, not a stacked column):** within a lane band, the stage
  nodes share a row — assert ≥ 2 nodes in a populated lane have the SAME (±tol)
  top offset and INCREASING left offsets (left→right flow). NOT all 10 nodes in a
  single vertical column. (Direct mirror of the s003 StageCardGrid / s002 board
  guard.)
- **GEO-2 (it is not an unreadable single line):** the 10 nodes are NOT all on one
  row at 1280px — assert the bands produce ≥ 2 distinct top-offset rows overall
  (lanes stack), each node width ≥ `--node-min` (≈200px) so name + 2×2 figures fit.
- **GEO-3 (lane order top→bottom = flow order):** lane bands' top offsets increase
  queue < build < release; within-and-across lanes the canonical DOM order is
  intake→…→done.
- **GEO-4 (gates are shape-distinct):** gate nodes' computed border/clip differs
  from work nodes' (diamond-edge vs `--radius-box`) — assert a measurable
  geometric/style difference, not colour alone.
- **GEO-5 (rework loop renders as a returning path):** `[data-testid="rework-loop"]`
  SVG path has non-zero length and runs right→left (its end x < start x — a return),
  bounding the build band. Asserts the loop is drawn, not just labelled.
- **GEO-6 (in-flight badge pops the silhouette):** a `data-wip-active="true"` node's
  InFlightBadge bounding box exceeds a normal StageMetric's (the shape cue is real,
  not just a class) — assert badge height/area > the sibling metric area.
- **GEO-7 (no overlap / no clipping):** stage-node bounding boxes within a lane do
  not overlap and none has zero width/height (catches a collapsed-flex regression).
- **GEO-8 (renders at all-zeros):** with all-zeros data the 10 nodes still render
  with non-zero size and all four "0" figures — the empty state is the full
  labelled skeleton, not a blank region (AC2.6 / CC1).

### Traceability
- **SRC-1:** every figure element (`[data-metric]`) has a non-empty `data-source`;
  for any node with `throughput>0` the throughput `data-source` is a real
  ledger row ref (UC-S004-5 / SM3). value=0 → MetricSource shows "no events recorded".

---

## 6. Design-system extension (additive tokens / components)

Added to `design-system.md`, `components.md`, `patterns.md`, `tokens.css`
(additive; nothing s002/s003 changes):

**Tokens (new):**
| Token | Value | Use | Contrast / note |
|---|---|---|---|
| `--c-wip` | `#7d5fff` | in-flight accent (WIP>0) — distinct hue from ok/starving/over/constraint | ≥ 4.5:1 text on `--c-surface`; border var ≥ 3:1 |
| `--c-wip-bd` | `#7d5fff` | in-flight node/pill border | ≥ 3:1 vs `--c-surface` |
| `--node-min` | `200px` | StageNode min width (= `--card-min`; reused intent) | geometry contract (GEO-2) |
| `--gap-node` | `16px` | inter-node / lane gap (= `--sp-4`) | — |
| `--gap-lane` | `24px` | inter-lane band gap (= `--sp-6`) | — |
| `--fs-stage-fig` | `1.5rem` | per-stage figure value (below `--fs-metric`) | weight `--fw-metric` |
| `--node-gate-clip` | (diamond edge style) | gate-node shape distinction (GEO-4) | non-colour cue |

The in-flight signal REUSES the §8 redundant-encoding rule (icon `●` + text
"in-flight" + border + colour). The traceability REUSES the s003 SourceLink
`data-source` convention. No new constraint token (s002 `◆`/"constraint" reused).

---

## 7. Explicitly NOT designed in s004 (boundary)
- **Drill-DOWN from a node to item/artifact detail** — that is CHK-4 (J2). s004
  nodes are focusable but do not navigate.
- **Per-item chips inside a node** beyond naming `wip_items` in the traceability
  tooltip — full item-level rendering is CHK-4.
- **Steer actions / prompt handoff** — CHK-5+ (J3), no controls here.
- **Mobile-optimised layout** — desktop-first per project scope; wrap is graceful
  degradation only.
- **Endpoint internals (UC-S004-1)** — owned by the engineer/architect seam; this
  spec consumes its output shape only.
