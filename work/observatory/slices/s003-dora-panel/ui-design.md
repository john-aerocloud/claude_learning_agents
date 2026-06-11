---
slice: s003
slug: dora-panel
mode: STRUCTURE (before build)
owner: ui-designer
chunk: CHK-3 — DORA metrics surface (CORE job: observe DORA & flow at a glance, drillable to source)
extends: CHK-2 design system (design/design-system.md, components.md, patterns.md, tokens.css)
co-authored-into: acceptance.md (a11y + geometry conditions, see §5)
---

# UI design — s003 DORA panel + stage cards + time-thief view

This slice ADDS three sections to the single-page dashboard CHK-2 built. It does
not redesign the pipeline map and does not introduce drill-down (that is CHK-4).
The output is the interaction model + component contract + assertion-ready a11y /
geometry conditions the engineer builds to and the tester enforces.

## 1. IA / layout

The Observatory is one dashboard page. CHK-3 stacks three new landmark regions
BELOW the existing PipelineMap in the same `<main>`, with `gap: var(--sp-section)`:

```
<main>  (single screen; vertical scroll allowed)
  PipelineMap         region "Pipeline map"          [CHK-2 — UNCHANGED]
  DoraPanel           region "DORA metrics"           [CHK-3 / UC2] 4 MetricCards, wrap-row
  StageCardGrid       region "Per-agent task times"   [CHK-3 / UC3] auto-fill grid, 9 cards
  TimeThiefView       region "Time thieves"           [CHK-3 / UC4] stacked ranked list
```

**One-liner:** the three new sections sit vertically below the pipeline map, in
read order metrics → stage cards → time thieves; each is a `<section role="region">`
with an `<h2>`, so the page is navigable by headings and nothing re-lays-out the map.

Read-path rationale: "is flow healthy?" (map) → headline numbers (DORA) → "who is
the bottleneck?" (stage cards, constraint highlighted) → "what is eating the
clock?" (time thieves). All visible at-a-glance (above-fold for the headline
numbers; scroll reveals the long lists).

## 2. Component decomposition

Five new components (full contract in `design/components.md`). Each consumes UC1's
typed parser output; none handles raw markdown. Disjoint files per UC2/UC3/UC4 so
the render UCs build in parallel.

| Component | UC | Data in | Selector (a11y + test hook) | Geometry |
|---|---|---|---|---|
| `DoraPanel` | UC2 | `{ metrics: DoraMetrics; sourceRef }` | `role=region` `aria-label="DORA metrics"`, `data-testid="dora-panel"`, `<h2>` | contains MetricCards as `role=list` |
| `MetricCard` | UC2 | `{ label, value, window, source }` | `data-testid="metric-<glt\|deploy-freq\|cfr\|mttr>"`; value el has `data-metric` + `data-source` | cards wrap-row (≥2 share top offset) |
| `StageCardGrid` | UC3 | `{ agents, constraint, sourceRef }` | `role=region` `aria-label="Per-agent task times"`, `data-testid="stage-cards"` | CSS grid auto-fill, MULTI-row+col |
| `StageCard` | UC3 | `{ agent, n, modal, median, mean, isConstraint, source }` | `data-testid="stage-card-<agent>"`, `data-constraint`, times carry `data-agent-time` + `data-source` | `role=listitem`, dl of 3 times |
| `TimeThiefView` | UC4 | `{ thieves, sourceRef }` | `role=region` `aria-label="Time thieves"`, `data-testid="time-thief-view"`; rows `data-testid="thief-<i>"` w/ `data-thief` + `data-source` | rows STACK (monotonic top, shared left) |
| `SourceLink` | UC5 | `{ source, label? }` | `data-testid="source-link"` (visible caption); `data-source` attribute (programmatic) | per-section caption |

Reused unchanged from CHK-2: `ConstraintBadge` (`◆` + "constraint" + `--c-constraint`)
inside the constraint StageCard; `LiveStatusDot` (UC6 live refresh, no new logic).

### Data the components render (from the real artifacts — fidelity §8)
- DORA: GLT `3092 s` / `20 slice(s)`; deploy freq `8 /active-day` / `6 day(s)`;
  CFR `24 %` / `46 deploy(s)`; MTTR `2033 s` / `8 failure(s)`. Raw strings,
  NO rounding/reformatting (F4).
- Stage cards: 9 agents incl. `engineer` (n=52, 720/699/984) and `flow-manager`
  (n=0, —/—/—). Constraint = **tester** (median 1059).
- Time thieves: 3 rows — `Queue dwell (all queues)` `0 s`,
  `Hidden-edge collisions` `1`, `Parallelism efficiency` `1.00`.

## 3. Traceability pattern (§8 — critical, the auditable contract)

Every rendered figure carries traceability in TWO layers:

1. **Programmatic (always, the audit hook):** the figure element carries a
   `data-source="<file-path>#<section-anchor>"` attribute. The figure also carries
   one of the three class hooks so a single DOM traversal can find ALL figures:
   - DORA metric value → `data-metric` + `data-source="process/dora/baseline.md#four-key-metrics"`
   - stage-card time (each of modal/median/mean) → `data-agent-time` + `data-source="process/dora/baseline.md#per-agent-task-completion"`
   - time-thief row → `data-thief` + `data-source="<project>/dora/flow.md#time-thieves"`
2. **Visible (per section, once):** a `SourceLink` caption in each section header —
   text "source" + `↗` glyph + `--c-source-link` colour (never colour-only). In
   s003 this is a LABEL, not a navigable link (drill to file is CHK-4).

**Assertion-ready (UC5 / T4):** a DOM traversal of
`[data-metric], [data-agent-time], [data-thief]` MUST find **zero** elements with
a missing or empty `data-source`. The `data-source` value format is
`"<file>#<anchor>"`. This is the single convention the engineer implements and the
tester asserts (count-of-missing = 0, AC5.1 / AC5.4).

## 4. Constraint highlight on stage cards (reuses CHK-2 encoding)

The agent named in `baseline.md` "Theory-of-Constraints read" (`constraint`,
currently **tester**) gets its StageCard highlighted with the EXACT s002 encoding —
no new token, no colour-only cue:
- `data-constraint="true"` on the card (others `="false"`).
- visible `ConstraintBadge`: `<span aria-hidden="true">◆</span>` + visible text
  `"constraint"` + `--c-constraint` border (`--c-constraint-bd`, ≥ 3:1).
- accessible name includes "constraint" → screen reader reads
  "tester, constraint, modal 1200, median 1059, mean 1448".
Non-colour cues: the `◆` glyph + the literal text "constraint" + the
`data-constraint` attribute. Colour is the third, redundant cue only.

## 5. Testable a11y + geometry conditions (WCAG 2.2 AA)

These are MIRRORED into `acceptance.md` as the §"Accessibility acceptance"
extension + a new §"Visual-structural (geometry)" block. They become axe /
Playwright / jsdom assertions; never colour-only, always text / aria / geometry.

### A11y (assertion-ready)
- **G-A1 Landmark regions:** DoraPanel, StageCardGrid, TimeThiefView each render
  `role="region"` with a unique `aria-label` AND a visible `<h2>`. Assert 3 new
  regions + 3 headings present (extends s002 A3 heading-nav).
- **G-A2 Metric context (no bare numbers):** each MetricCard is `role="listitem"`
  with the metric label as visible text adjacent to the value; the accessible name
  of the value conveys label + value + window. Assert value element's accessible
  context contains its label string.
- **G-A3 Metric group:** the four MetricCards are a `role="list"` of 4
  `role="listitem"` (announces "list, 4 items").
- **G-A4 Stage-card labelled times:** modal / median / mean each rendered with a
  visible label (dl `<dt>`/`<dd>`); the "—" no-data value renders as literal text,
  not blank (assert `textContent==="—"`, A2 extended).
- **G-A5 Constraint non-colour cue:** the constraint StageCard has
  `data-constraint="true"` AND a visible element containing text "constraint" AND
  the `◆` glyph; all other cards `data-constraint="false"` and contain no
  "constraint" text. (= AC3.3, generalised.)
- **G-A6 Empty-state accessible text:** when baseline/flow absent, each empty-state
  element has non-empty `textContent` (R1/R2/A2).
- **G-A7 Source caption not colour-only:** each `SourceLink` caption contains
  visible text "source" (the `↗` is `aria-hidden`) — the link is identifiable
  without colour.
- **G-A8 Contrast:** metric value & label ≥ 4.5:1 on `--c-surface`; window line
  (`--c-text-dim`) ≥ 6:1; source caption (`--c-source-link`) ≥ 4.5:1 as text;
  constraint border ≥ 3:1 (non-text). axe scan reports zero contrast violations.
- **G-A9 Keyboard order:** no new interactive controls in s003 (read-only); the
  three new regions are reachable by heading/landmark navigation; tab order is
  unchanged from s002 (no new tab stops introduced). Assert via Playwright that
  tabbing does not land inside the static figures.
- **G-A10 Reduced-motion:** under `prefers-reduced-motion: reduce`, UC6 live value
  swaps are instant (no transition). Assert transition-duration collapses to 0.

### Visual-structural / geometry (assertion-ready — the "board-is-a-line" guard)
Shape carries meaning here; presence tests are not enough. Assert via computed
style / bounding-box, not element count alone:
- **G-G1 DoraPanel is a wrap-ROW, not a stacked column:** at desktop width the 4
  MetricCards do NOT all stack vertically — assert ≥ 2 cards share a top offset
  (i.e. at least one row holds ≥ 2 cards). Guards against a CSS-less single column.
- **G-G2 StageCardGrid is a GRID (multi-row AND multi-col):** with 9 cards, assert
  the cards occupy > 1 distinct top offset AND > 1 distinct left offset (a real
  grid), NOT a single 9-tall column and NOT a single 9-wide line. Computed
  `display: grid` on the container. (Direct application of the s002 board-as-line
  lesson: a `role=list` of 9 with no `display:grid` would render as a line and
  every presence test would still pass.)
- **G-G3 TimeThiefView is a stacked LIST:** assert thief rows have monotonically
  increasing top offsets AND a shared left offset (vertical list, rank order),
  NOT a horizontal row.
- **G-G4 Sections stack below the map:** assert each CHK-3 region's top offset is
  greater than the PipelineMap region's bottom (the map is not overlapped /
  displaced). Order: DoraPanel < StageCardGrid < TimeThiefView by top offset.

## 6. NOT designed in this slice (scope guard)
- Drill-DOWN from a figure to the open source file / row (CHK-4). s003 SourceLink
  is a label + `data-source` attribute, not navigation.
- Per-item lead-time table from flow.md (not in CHK-3 acceptance; deferred).
- Mobile/responsive optimisation (project out-of-scope; desktop-first).
- Any write/interaction control (read-only surface, W1).
- Sorting / filtering of stage cards or thieves (source order only in s003).

## 7. Component-map delta
`architecture/dependencies/component-map.mmd` updated in the SAME commit as this
design: adds the DoraPanelScreen sections + 5 new component nodes + used-by edges,
marked `class ... changed` for the tester's UI test plan. Marks cleared at slice
delivery after the tester consumes them.
