---
slice: s004-value-stream-map
updated: 2026-06-09
---

# Use cases — s004-value-stream-map

Decomposed into six separately-buildable, separately-testable interaction units.
Listed thinnest-first (foundational data layer first, then rendering in dependency
order). UC-S004-1 is the critical foundational UC; all others depend on it.

---

## UC-S004-1 — Ledger-aggregation endpoint (foundational)

**Actor:** read-layer server (Express)
**Trigger:** `GET /api/projects/:id/stage-flow`
**Observable outcome:** returns a JSON array of per-stage objects with the shape:
```json
{
  "stage": "engineer",
  "label": "Build / TDD",
  "throughput": 42,
  "dwell_median_s": 720,
  "wip": 0,
  "rework": 3,
  "source_rows": ["row:34", "row:35", ...]
}
```
One object per canonical stage. Stages with zero events return zeros, not omitted.
Data sourced exclusively from the live `process/dora/ledger.csv`, filtered to the
requested project.

**Canonical stage list and event mapping:**

| Stage key | Label | In-event | Out-event | Rework-event |
|-----------|-------|-----------|-----------|--------------|
| intake | Intake (gate) | `gate` (ref contains GATE-1/intake) | `gate` success | — |
| decompose | Decompose (product) | `task_start` agent=product | `task_end` agent=product | — |
| ready | Ready (queue) | `enqueue` queue=ready | dequeue/stage_enter | — |
| capabilities | Capabilities (cicd) | `task_start` agent=cicd | `task_end` agent=cicd | `failure` agent=cicd |
| ui-design | UI-Design (ui-designer) | `task_start` agent=ui-designer | `task_end` agent=ui-designer | `failure` agent=ui-designer |
| engineer | Build / TDD (engineer) | `task_start`/`stage_enter` agent=engineer | `task_end`/`stage_exit` agent=engineer | `failure` agent=engineer |
| ui-validate | UI-Validate (ui-designer, validation) | `task_start` agent=ui-designer slice contains validate | `task_end` | `failure` |
| deploy | Deploy (gate) | `gate` ref=GATE-deploy or event=deploy | success | — |
| validate | Validate (tester) | `task_start` agent=tester | `task_end` agent=tester | `failure` agent=tester |
| done | Done | `deploy` outcome=success | — | — |

WIP = items (item_id) that have a matching in-event but no out-event in the ledger.
Dwell = median of (out_timestamp - in_timestamp) for all completed pairs.
Rework = count of `failure` or `recovery` events for that stage.
source_rows = list of ledger row indices contributing to all four figures.

**Value:** HIGH (3) — nothing else can render without this
**Cost:** 4h
**vc_ratio:** 0.75
**Dependencies:** UC-S001-2 (CSV parser infra), UC-S001-3 (read-layer route pattern)
**Done condition:** endpoint returns non-empty JSON for project=observatory with at
least engineer stage showing throughput >= 1; tester hand-counts one stage against
ledger.csv and confirms match.

---

## UC-S004-2 — Value-stream map render (layout + stages)

**Actor:** SPA (pipeline operator views the main map)
**Trigger:** operator opens Observatory or navigates to the pipeline view
**Observable outcome:** a visual flow diagram renders with all canonical stages in
left-to-right sequence, connected by arrows; gates shown as diamond/pill shapes
distinct from work stages; the Rework loop shown as a labelled back-arrow from
Validate to Rework and back into Build/TDD; stages are neatly labelled with their
human names.

Data source: `GET /api/projects/:id/stage-flow` (UC-S004-1).

**Value:** HIGH (3)
**Cost:** 3h
**vc_ratio:** 1.00
**Dependencies:** UC-S004-1 (data), UC-S002-1 (SPA scaffold)
**Done condition:** all 10 canonical stages (including gates and Done) present in the
rendered diagram; Rework loop arrow visible; no stage missing its label.

---

## UC-S004-3 — Per-stage metric display (four numbers)

**Actor:** pipeline operator
**Trigger:** value-stream map renders
**Observable outcome:** every stage box shows four clearly labelled numbers:
  - "Throughput: N" (# items that have passed through)
  - "Dwell: Xm" (median time in stage, in appropriate unit)
  - "WIP: N" (items currently in stage)
  - "Rework: N" (failure/recovery events)
Numbers are zero (not blank) when there is no activity. Labels are present and
unambiguous.

Data source: same `stage-flow` response as UC-S004-2.

**Value:** HIGH (3)
**Cost:** 2h
**vc_ratio:** 1.50
**Dependencies:** UC-S004-2 (stage boxes must exist to hold the numbers)
**Done condition:** all four numbers present with labels on every rendered stage;
real-data check: engineer stage throughput matches hand-count from ledger.

---

## UC-S004-4 — In-flight WIP indication

**Actor:** pipeline operator
**Trigger:** an item has a stage_enter/task_start but no matching stage_exit/task_end
  in the ledger (i.e., currently in-progress)
**Observable outcome:** the stage box for that item's current stage shows a distinct
"active / in-flight" indicator (e.g. pulsing border, highlighted WIP count, or
item chip) so the operator can see at a glance that work is present and not yet
through. An item that has been pulled but not completed is NOT invisible.

Data source: the `wip` field in UC-S004-1 response; the endpoint should optionally
return `wip_items: [{item_id, since_ts}]` so the UI can name the in-flight items.

**Value:** HIGH (3) — this directly fixes the "pulled items disappear" defect
**Cost:** 2h
**vc_ratio:** 1.50
**Dependencies:** UC-S004-3 (WIP number is already shown; this UC adds the visual
distinction between wip=0 and wip>0, and optionally names the items)
**Done condition:** find a real item in the live ledger with stage_enter and no
stage_exit; confirm it appears as in-flight WIP in the correct stage box in the UI.
If no such item exists at validation time, test by temporarily appending a synthetic
stage_enter row to ledger.csv.

---

## UC-S004-5 — Metric traceability (figure → source rows)

**Actor:** pipeline operator investigating a number
**Trigger:** operator clicks or hovers a metric value on any stage box
**Observable outcome:** a tooltip or side panel reveals the source ledger row
references (row numbers or timestamps) that were summed/computed to produce that
figure — so the operator can open ledger.csv and verify the claim independently.

Data source: `source_rows` field from UC-S004-1 response.

**Value:** MED (2) — satisfies SM3 (traceability)
**Cost:** 1h
**vc_ratio:** 2.00
**Dependencies:** UC-S004-3 (numbers must exist before linking them to sources)
**Done condition:** clicking any metric shows at least one source reference; the
reference is a real ledger row identifier (timestamp or row index), not a placeholder.

---

## UC-S004-6 — Live refresh via SSE

**Actor:** pipeline operator watching the map
**Trigger:** `process/dora/ledger.csv` is appended (a new ledger row is written)
**Observable outcome:** the map re-fetches `stage-flow` and re-renders within the
configured refresh window (≤ N seconds, default 5s) without the operator manually
reloading the page. The update is seamless — numbers change in place.

Data source: existing SSE channel (`GET /api/events`, UC-S001-5); triggers re-fetch
of UC-S004-1.

**Value:** MED (2)
**Cost:** 1h
**vc_ratio:** 2.00
**Dependencies:** UC-S004-3 (map must exist), UC-S001-5 (SSE channel already live)
**Done condition:** append a row to ledger.csv; confirm the engineer (or tester)
throughput count increments in the UI within 5 seconds without page reload.

---

## Dependency graph summary (thinnest-first build order)

```
UC-S001-2 (CSV parser, CHK-1 DONE)
UC-S001-3 (routes, CHK-1 DONE)
UC-S001-5 (SSE, CHK-1 DONE)
UC-S002-1 (SPA scaffold, CHK-2 DONE)
    │
UC-S004-1  ← foundational; all render UCs block on this
    │
UC-S004-2  ← map layout
    │
UC-S004-3  ← four numbers on each stage
    │
UC-S004-4  ← in-flight WIP distinction (parallel with UC-S004-5)
UC-S004-5  ← traceability (parallel with UC-S004-4)
    │
UC-S004-6  ← live refresh (depends on map existing + SSE wired)
```

UC-S004-4 and UC-S004-5 are independently buildable once UC-S004-3 exists.
UC-S004-6 is independently buildable once UC-S004-3 exists and SSE is wired.

---

## Architecture seams (to co-declare with engineer/architect for path registry)

- UC-S004-1 owns: `server/routes/stageFlow.js` (new route), `server/lib/ledgerAggregator.js` (new module)
- UC-S004-2 owns: `src/app/components/ValueStreamMap.jsx` (new top-level component)
- UC-S004-3 owns: `src/app/components/StageBox.jsx` (new)
- UC-S004-4 owns: `StageBox.jsx` WIP indicator sub-component (within UC-S004-3 seam — coordinate)
- UC-S004-5 owns: `StageBox.jsx` tooltip/drill sub-component (within UC-S004-3 seam — coordinate)
- UC-S004-6 owns: `src/app/hooks/useStageFlow.js` (new hook, wires SSE to re-fetch)

UC-S004-3/4/5 all touch `StageBox.jsx` — they are serialised within that seam unless
the engineer splits the component. Flag to flow-manager at enqueue.
