---
slice: s004-value-stream-map
chunk: CHK-2 (re-scoped)
status: defined
created: 2026-06-09
value: HIGH
cost: L   # ~12h estimated across 6 UCs
vc_ratio: HIGH/L
---

# s004 — Value-stream map with per-stage metrics

## Job served

**J1 — See the full delivery value-stream live.**
When the operator wants to know whether the pipeline is healthy and where work sits,
they want to see the WHOLE process laid out with every stage labelled, in-flight WIP
visible (not invisible after pull), and four per-stage numbers (throughput, dwell,
WIP, rework) sourced from the live ledger — so they can act on real numbers, not
silence.

## Thin scope (what this slice delivers)

1. **Ledger-aggregation endpoint** (`GET /api/projects/:id/stage-flow`): reads
   `process/dora/ledger.csv`, groups events by stage, and returns per-stage
   `{stage, label, throughput, dwell_median_s, wip, rework, source_rows}` for the
   named project. This is the foundational computation; nothing else in this slice
   can render without it.

2. **Value-stream map render**: a visual flow diagram spanning all stages in sequence:
   Intake (gate) → Decompose (product) → Ready (queue) → Capabilities (cicd) →
   UI-Design (ui-designer) → Build/TDD (engineer) → UI-Validate (ui-designer) →
   Deploy (gate) → Validate (tester) → Done, with the Rework loop (tester-fail →
   rework → re-loop) and both gates shown as distinct shapes.

3. **Per-stage metric display**: each stage box shows all four numbers neatly labelled:
   throughput (#), dwell median, WIP (in-flight count), rework count.

4. **In-flight WIP indication**: any item currently entered-but-not-exited a stage
   is explicitly shown in that stage (not invisible). Stage boxes distinguish
   "active WIP" from "historical throughput."

5. **Traceability**: each figure in the UI links to (or reveals on hover) the source
   ledger row set that produced it, satisfying SM3.

6. **Live refresh via SSE**: the map re-fetches on SSE file-change events so the
   operator sees the current state without manual reload.

## Explicitly NOT in scope

- DORA four-metric panel (Lead Time / Deploy Freq / Change Fail Rate / MTTR) — these
  come from `baseline.md`, not the ledger aggregation; defer to a follow-on slice.
- Per-agent task-time breakdown (modal/median/mean by agent) — also `baseline.md`-
  sourced; defer.
- Time-thief ranking from `flow.md` — defer.
- The original s003-dora-panel slice: SUPERSEDED by this slice and not built.
- The original CHK-2/s002 4-box queue map: delivered and kept as-is but replaced in
  the primary view by this value-stream map.
- Drill-down from a stage box into individual item history — that is CHK-4 / s005+.
- Constraint (ToC) highlight beyond what the stage data makes obvious — can carry to
  a follow-on improvement slice.
- Filtering by project other than the active project.
- Mobile / responsive layout.

## Success measures (basis for acceptance)

| # | Measure | How observed |
|---|---------|--------------|
| SM-VSM-1 | Every stage labelled in correct sequence, gates shown, Rework loop shown | Visual review against the stage list above |
| SM-VSM-2 | Each stage shows four numbers: throughput, dwell median, WIP, rework | UI inspection; all four labels present on every stage box |
| SM-VSM-3 | **Real-data acceptance (non-negotiable):** at least one stage's throughput and WIP count verified by hand-counting matching ledger rows from the live repo ledger | Tester counts `task_start`+`task_end` pairs for "engineer" agent in `ledger.csv`; value matches the UI; WIP count matches items with stage_enter but no stage_exit |
| SM-VSM-4 | In-flight WIP is visible (an item pulled but not yet completed appears in its current stage, not absent) | Find a real item with `stage_enter` and no `stage_exit` in the live ledger; confirm it appears as WIP in the correct stage box |
| SM-VSM-5 | Each number links to its source ledger rows | Clicking/hovering a metric reveals the row range or ref that produced it |
| SM-VSM-6 | Map re-renders within N seconds of a ledger.csv append | Append a test row to ledger.csv; map updates without manual reload |
| SM-VSM-7 | Endpoint returns non-empty data from the live repo ledger (not fixtures only) | `GET /api/projects/observatory/stage-flow` returns stages with throughput > 0 for at least engineer and tester stages |

**Real-data done-condition (process gap fix):** the slice is NOT done if all tests pass
only against fixture data. The tester MUST validate SM-VSM-3 and SM-VSM-4 against the
live `process/dora/ledger.csv` in this repo and confirm at least one stage shows correct,
non-zero, hand-verifiable numbers. This is a direct response to the s002 process gap
where green tests masked an empty/useless operator view.

## Architecture question for solution-architect / cicd

**Key open question:** where does the per-stage aggregation compute?

- **Option A — read-layer endpoint** (`GET /api/projects/:id/stage-flow`): the Express
  server reads the ledger CSV and computes per-stage metrics in-process on each request.
  Keeps computation close to the data; consistent with CHK-1 design. Risk: ledger grows
  large; each request re-parses the whole file.

- **Option B — extend `dora.py`**: add a `stage-flow` sub-command to `dora.py` that
  emits a JSON snapshot (like `flow.md`); the read-layer serves the snapshot file.
  Keeps Python for DORA computation (where it already lives); separates concerns.
  Risk: snapshot can lag; adds a make/script dependency to the observer startup.

The product preference is Option A for this slice (live, no snapshot staleness, in-process
parse is acceptable for current ledger sizes). If the architect prefers Option B,
the UC-S004-1 scope adjusts accordingly but the API contract is unchanged.

## Process-gap correction committed by this slice

Every acceptance run MUST include at least one assertion against the live repo ledger
(not a fixture copy). The tester result.md must explicitly call out which stage was
hand-verified and how.
