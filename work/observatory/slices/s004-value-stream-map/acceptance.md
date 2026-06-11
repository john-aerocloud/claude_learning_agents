---
slice: s004-value-stream-map
updated: 2026-06-09
---

# Acceptance — s004-value-stream-map

## Slice done-condition

The slice is DONE when ALL of the following are true:

1. All tagged acceptance cases below pass.
2. **SM-VSM-3 (real-data):** the tester has hand-counted at least one stage's
   throughput from the live `process/dora/ledger.csv` and confirmed it matches the
   number shown in the UI. This must appear in result.md as an explicit verification
   row (stage name, hand-counted value, UI-shown value, match: yes/no).
3. **SM-VSM-4 (WIP visibility):** the tester has confirmed at least one in-flight
   item (or a synthetic row appended to ledger.csv) appears as WIP in its current
   stage rather than being invisible.
4. `GET /api/projects/observatory/stage-flow` returns non-empty JSON with throughput
   > 0 for at least the "engineer" stage (real repo data, not a fixture).

Fixture-only green tests do NOT satisfy the done-condition. The process gap from s002
is closed by this hard requirement.

---

## Acceptance cases

### UC-S004-1 — Ledger-aggregation endpoint

**AC1.1** `GET /api/projects/observatory/stage-flow` returns HTTP 200 with
`Content-Type: application/json`.

**AC1.2** Response is a JSON array with at least 8 entries (one per canonical stage).
Stages with zero events are present with all four figures as 0, not omitted.

**AC1.3** Each entry has the shape:
`{stage: string, label: string, throughput: number, dwell_median_s: number, wip: number, rework: number, source_rows: string[]}`.
No field is null or undefined.

**AC1.4 (real-data gate):** For the live observatory project, the "engineer" stage
`throughput` value equals the count of `task_start` events with `agent=engineer` and
`project=observatory` in the live `process/dora/ledger.csv`. Tester hand-counts and
records the number.

**AC1.5** The "engineer" stage `wip` value equals the count of items with a
`stage_enter` or `task_start` (agent=engineer) and no corresponding `stage_exit` or
`task_end` in the live ledger for project=observatory. Tester verifies this is 0 or
a positive integer matching actual open items.

**AC1.6** `dwell_median_s` for any stage with at least two completed pairs is a
positive number (not 0 and not NaN).

**AC1.7** `source_rows` for the "engineer" stage is a non-empty array when
throughput > 0.

**AC1.8** Requesting a project with no ledger entries returns all zeros without error:
`GET /api/projects/nonexistent/stage-flow` → 200 with all stages present, all zeros.

**AC1.9** The endpoint does not read any file outside `process/dora/ledger.csv` (path
traversal guard inherited from CHK-1 read-only constraint).

---

### UC-S004-2 — Value-stream map render

**AC2.1** The SPA renders a flow diagram visible without scrolling on a 1280px-wide
viewport.

**AC2.2** All 10 canonical stages appear as distinct labelled elements in left-to-right
order: Intake → Decompose → Ready → Capabilities → UI-Design → Build/TDD →
UI-Validate → Deploy → Validate → Done.

**AC2.3** Gates (Intake, Deploy) are visually distinct from work-stage boxes
(e.g. diamond or pill shape, or different border style).

**AC2.4** The Rework loop is shown as a labelled back-arrow or path from Validate
(failure) returning to (at minimum) Build/TDD, with a label such as "Rework".

**AC2.5** Arrows connecting adjacent stages are present and directionally correct
(left-to-right flow, rework loop right-to-left).

**AC2.6** The map renders without error when `stage-flow` returns all-zeros data
(e.g. a newly created project with no ledger rows).

---

### UC-S004-3 — Per-stage metric display

**AC3.1** Every stage box shows all four labels: "Throughput", "Dwell", "WIP",
"Rework" (or equivalent unambiguous abbreviations consistently applied).

**AC3.2** Throughput values are integers (not floats) for whole-item counts.

**AC3.3** Dwell values are displayed in a human-readable unit: seconds for < 60s,
minutes for < 3600s, hours otherwise. The unit label is present.

**AC3.4** WIP and Rework values are integers ≥ 0.

**AC3.5 (real-data gate):** the engineer stage throughput in the UI matches the
hand-counted value from AC1.4. Tester records both values in result.md.

**AC3.6** All four numbers are legible against the stage box background (contrast
ratio ≥ 4.5:1 — accessibility).

---

### UC-S004-4 — In-flight WIP indication

**AC4.1** A stage box with `wip > 0` renders with a visual distinction from a
stage with `wip = 0` (e.g. highlighted border, pulsing indicator, or WIP count in a
different colour). The distinction is not colour-only (e.g. also a shape or label
change).

**AC4.2 (real-data gate):** if any item in the live `process/dora/ledger.csv` has a
`stage_enter`/`task_start` without a matching `stage_exit`/`task_end` for project
=observatory, the tester confirms that item's stage box shows wip > 0 and the
in-flight indicator. If no such item exists, the tester appends a synthetic
`stage_enter` row for agent=engineer and confirms the engineer box shows wip=1 and
the indicator, then removes the synthetic row and confirms it returns to wip=0.

**AC4.3** When `wip = 0` for all stages, no in-flight indicators are shown (no
false positives).

---

### UC-S004-5 — Metric traceability

**AC5.1** Clicking or hovering any metric value (throughput, dwell, WIP, or rework)
on any stage box reveals a tooltip or panel showing at least one source reference
(timestamp or row identifier from ledger.csv).

**AC5.2** The source reference is non-empty when the metric value is > 0.

**AC5.3** When the metric value is 0, the tooltip/panel shows a message such as
"no events recorded" rather than an empty or broken state.

**AC5.4** The source reference is traceable: the tester can find the cited timestamp
or row in `process/dora/ledger.csv` and confirm it is the correct row type for the
metric (e.g. a `task_start` row for a throughput source).

---

### UC-S004-6 — Live refresh

**AC6.1** After `process/dora/ledger.csv` is appended with a new row (either a real
ledger write or a manual test append), the relevant stage metric in the UI updates
within 5 seconds without a manual browser reload.

**AC6.2** The update is incremental (the count increases by the correct delta, not
replaced by a stale value).

**AC6.3** If the SSE connection drops and reconnects, the map re-fetches and shows
current data after reconnection (regression from OI-S002-1 — do not replicate that
gap).

**AC6.4** The live-refresh mechanism does not cause the map to flicker or lose the
current scroll/zoom position on update.

---

### UI-DESIGNER co-authored — a11y + geometry (WCAG 2.2 AA)

Mirrored from `ui-design.md` §5 (ui-designer). Axe/Playwright contract; the tester
enforces these alongside the UC cases. SHAPE is asserted via computed style /
bounding-box, never element presence alone (the s002-board-as-a-line guard).

**A11Y-1** Map is `role="region"` `aria-label="Value-stream map"` with a visible
`<h2>`; three lanes are labelled `role="group"`s — reachable by heading/region nav.

**A11Y-2** Each `[data-testid^="stage-"]` is `role="group"` with an accessible name
matching `/<label> stage, throughput \d+, dwell .+, WIP .+, rework \d+/`. Gate nodes'
names start "gate:"; the constraint node's name ends ", constraint". No bare number.

**A11Y-3** Tab visits the 10 stage nodes in canonical order intake→…→done; each gets
a visible focus ring (≥ 3:1, ≥ 2px); no keyboard trap.

**A11Y-4** A `data-wip-active="true"` node carries the in-flight signal as TEXT (the
substring "in-flight" in BOTH the accessible name and visible text) AND a glyph —
not colour-only; detectable under monochrome / forced-colors emulation.

**A11Y-5** Each `[data-testid^="gate-"]` contains visible text "gate" and its node
carries `data-stage-kind="gate"`; gate identity survives greyscale.

**A11Y-6** `[data-testid="rework-loop"]` exposes a visible DOM text node "Rework"
OUTSIDE the aria-hidden SVG; the loop is assertable by text, not only the arrow.

**A11Y-7** All figure values + labels ≥ 4.5:1 contrast vs node surface; focus ring,
node/gate/wip borders, in-flight pill edge ≥ 3:1.

**A11Y-8** Focusable nodes and the metric-source trigger are ≥ 24×24px.

**A11Y-9** Under `prefers-reduced-motion: reduce`, the in-flight pulse + live-update
transitions collapse to 0ms; the in-flight signal still reads via static cues.

**A11Y-10** The MetricSource reveal opens on focus+Enter (not hover-only), closes on
Esc, and is referenced by the metric via `aria-describedby`.

**A11Y-11** `make a11y-observatory` reports zero serious/critical violations on the
rendered map in default, all-zeros, and wip-active states.

**GEO-1** Within a populated lane band, ≥ 2 stage nodes share the same (±tol) top
offset with increasing left offsets (left→right flow) — NOT a single vertical column.

**GEO-2** The 10 nodes are NOT all on one row at 1280px: the bands yield ≥ 2 distinct
top-offset rows overall, and each node's width ≥ ~200px (`--node-min`).

**GEO-3** Lane band top offsets increase queue < build < release; DOM/visual order is
the canonical intake→…→done.

**GEO-4** Gate nodes' computed border/clip differs measurably from work nodes'
(diamond edge vs `--radius-box`) — a geometric/style difference, not colour alone.

**GEO-5** `[data-testid="rework-loop"]` SVG path has non-zero length and runs
right→left (end x < start x — a return), bounding the build band.

**GEO-6** A `data-wip-active="true"` node's InFlightBadge bounding box exceeds a
sibling normal StageMetric's area — the shape/silhouette cue is real.

**GEO-7** Stage-node bounding boxes within a lane do not overlap; none has zero
width/height (catches a collapsed-flex regression).

**GEO-8** With all-zeros data the 10 nodes still render at non-zero size with all four
"0" figures — the empty state is the full labelled skeleton, not a blank region.

**SRC-1** Every `[data-metric]` element has a non-empty `data-source`; for any node
with `throughput>0` the throughput `data-source` is a real ledger row ref; a value of
0 makes MetricSource show "no events recorded" (not blank/broken).

---

## Cross-cutting

**CC1 (resilience):** if `process/dora/ledger.csv` is absent or header-only, the
endpoint returns all-zeros without a server error. The UI renders the empty map
without crashing.

**CC2 (read-only):** no write is performed to any file by the server or the SPA
during any acceptance run.

**CC3 (performance):** `GET /api/projects/observatory/stage-flow` responds in < 2s
on the live ledger (currently ~710 rows). If ledger grows to 2000 rows, response
must still be < 5s (note for engineer: streaming parse or index may be needed at
scale — design accordingly).

---

## Real-data verification record (to be completed by tester in result.md)

| Stage | Hand-counted throughput (ledger.csv) | UI-shown throughput | Match |
|-------|--------------------------------------|---------------------|-------|
| engineer | _[tester fills in]_ | _[tester fills in]_ | _[yes/no]_ |
| tester | _[tester fills in]_ | _[tester fills in]_ | _[yes/no]_ |

| Stage | In-flight WIP items (ledger hand-count) | UI wip shown | Match |
|-------|------------------------------------------|--------------|-------|
| engineer | _[tester fills in]_ | _[tester fills in]_ | _[yes/no]_ |

Slice is NOT accepted if this table is left blank or contains "N/A".
