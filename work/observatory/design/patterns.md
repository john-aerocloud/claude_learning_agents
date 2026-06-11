---
project: observatory
owner: ui-designer
seeded: s002-pipeline-map
---

# Navigation / IA model, click-path budgets, standard states

## Navigation / IA (Phase 1 — Observe)
The Observatory is a single-page **dashboard**. The pipeline map (CHK-2) is the
home/overview surface — the "zoomed-out" top of the drill model
(pipeline → queue → item → slice artifact). Drill-down is CHK-4, NOT s002.

For s002 the pipeline map is the whole visible surface. It sits in a top-level
`<main>`; future CHK-3/CHK-4 panels attach around it without re-laying-out the map.

## Click-path budgets (core jobs)
| Job | Budget | s002 reality |
|---|---|---|
| "See current flow state at a glance" (J1) | **0 clicks** — visible on open | met: map + counts + states + constraint all render on load |
| "Where is work stuck?" (J2) | 1 click to drill (CHK-4) | s002 is read-only at-a-glance; 0 interaction |

## Standard states (this surface)
- **Empty:** no active project → map renders a labelled empty state ("No active project"), not blank/crash (AC3.4).
- **Loading:** initial fetch → boxes show skeleton/0 until first state lands (≤ 2s).
- **Error / partial:** missing policy/queue CSV → fail soft (status `ok`, count 0); never crash (SM5).
- **Live (UC6):** LiveStatusDot shows connected / reconnecting; on SSE error the map holds last-known state.

## Responsive
v1 is desktop-first (mobile explicitly out of scope, project §"Out of scope").
The 4-box row wraps gracefully below a min width but is not optimised for mobile.

## CHK-3 (s003) — dashboard layout + IA delta

CHK-3 ADDS three sections to the same single-page dashboard `<main>` that hosts
the CHK-2 PipelineMap. The map is NOT re-laid-out; the new sections stack BELOW
it in a vertical dashboard rhythm (`gap: var(--sp-section)`), top→bottom:

```
<main>  (single screen, vertical scroll allowed; "at a glance" = above-fold core)
  ├─ [CHK-2] PipelineMap          region "Pipeline map"      (unchanged)
  ├─ [CHK-3] DoraPanel            region "DORA metrics"      (4 MetricCards, wrap-row)
  ├─ [CHK-3] StageCardGrid        region "Per-agent task times" (auto-fill grid)
  └─ [CHK-3] TimeThiefView        region "Time thieves"      (stacked ranked list)
```

Order rationale: pipeline state → headline DORA numbers → who is the constraint
(stage cards) → what is eating the clock (time thieves) — the operator's read
path from "is flow healthy" down to "where do I act". All four are landmark
regions with `<h2>` headings → reachable by heading navigation (A3).

Drill-DOWN from any figure to its source FILE is CHK-4, not s003. In s003 the
SourceLink is a LABEL (a `data-source` attribute + a visible "source" caption),
not a navigable link that leaves the SPA. This keeps s003 a pure read-only
at-a-glance overview.

## Click-path budgets (CHK-3 jobs)
| Job | Budget | s003 reality |
|---|---|---|
| "See the four DORA metrics at a glance" (J3) | **0 clicks** — visible on open | met: DoraPanel renders on load |
| "Know which agent is the constraint" (J4) | **0 clicks** | met: constraint StageCard highlighted on load |
| "Know what is eating lead time" (J5) | **0 clicks** | met: TimeThiefView ranked list on load |
| "Verify a number against its source" (J6) | **0 clicks** to SEE source ref; drill to file is CHK-4 | met: `data-source` + visible source caption present on load |

All four CHK-3 core jobs are **0-click** — the panel is a read-only at-a-glance
dashboard. No interaction is added in s003; drill-down is CHK-4.

## Standard states (CHK-3 surfaces)
- **Empty:** baseline.md absent → DoraPanel "No baseline computed yet" + StageCardGrid
  "No agent task times yet"; flow.md absent → TimeThiefView "No flow data yet".
  Accessible text, never blank (A2 / R1 / R2).
- **Loading:** initial fetch → sections render their region + heading immediately,
  figures fill on first parse (≤ 2s).
- **No-data row:** an agent with n=0 (flow-manager) renders its dashes "—" as
  literal text; card still present (not dropped).
- **Live (UC6):** baseline change re-renders DoraPanel + StageCardGrid; flow change
  re-renders TimeThiefView; under reduced-motion the value swaps instantly.

## CHK-2 re-scope (s004) — value-stream map IA delta

The ValueStreamMap **REPLACES** the s002 PipelineMap as the top region of `<main>`
(the operator rejected the thin 4-box map: "I expect to see this whole thing... with
each part neatly labelled"). The s003 DoraPanel / StageCardGrid / TimeThiefView
stack below it unchanged. The buffer queues (intake/ready/deploy) are now STAGES
WITHIN the value stream, not the map itself.

```
<main>
  ├─ [CHK-2 re-scoped] ValueStreamMap   region "Value-stream map"   (REPLACES PipelineMap)
  │     ├─ lane "Intake & Ready"   ◇Intake(gate) → Decompose → Ready
  │     ├─ lane "Build"            Capabilities → UI-Design → Build/TDD → UI-Validate
  │     │                              ▲──────────── Rework loop ◄────────────┐
  │     └─ lane "Release"          ◇Deploy(gate) → Validate ──Rework──┘ → Done
  ├─ [CHK-3] DoraPanel            (unchanged)
  ├─ [CHK-3] StageCardGrid        (unchanged)
  └─ [CHK-3] TimeThiefView        (unchanged)
```

**Layout choice — three labelled lanes, not one wrapped strip:** 10 nodes on one
1280px row are ~110px each — too cramped for a name + four labelled figures. Three
named bands (queue / build / release) keep each node at `--node-min` (~200px),
let the flow read as a PROCESS, and give the operator a coarse "where in the
process" anchor matching the CORE-job wording. Within a lane nodes flow left→right
with FlowArrows; the lane break is a down-connector so global order is unbroken.
The Rework loop is a labelled right→left back-path from Validate into Build/TDD.

### Click-path budgets (CHK-2 re-scope jobs)
| Job | Budget | s004 reality |
|---|---|---|
| J1 — "See the whole value-stream + per-stage throughput at a glance" | **0 clicks** | all 10 stages + 4 labelled figures render on load |
| J1b — "See where in-flight work sits (WIP never invisible)" | **0 clicks** | WIP>0 nodes show a non-colour in-flight badge on load |
| SM3 — "Verify a figure against its ledger rows" | **1 interaction** | UC-S004-5 MetricSource reveal (focus/click) |
| J2 — "Drill into a stage/item" | deferred to CHK-4 | nodes focusable; drill-to-detail not in s004 |

### Standard states (value-stream map)
- **Empty (all-zeros):** the full labelled skeleton of 10 nodes with "0" figures —
  never blank/crash (AC2.6 / CC1).
- **Loading:** region + lane headings render immediately; figures fill ≤ 2s.
- **WIP>0:** in-flight badge (icon + "N in-flight" text + pill shape + `--c-wip`).
  WIP=0 shows plain "WIP 0" only — no false-positive indicator (AC4.3).
- **Live (UC-S004-6):** SSE append re-fetches stage-flow; numbers swap in place;
  under reduced-motion no animation, no scroll/zoom loss (AC6.4).

## CHK-4 (s005) — work-item tree + zoom/drill IA delta

ADDS a **left-rail WorkItemTree** beside the existing `<main>` (ValueStreamMap +
DoraPanel + StageCardGrid + TimeThiefView — all unchanged). Drilling a node opens
a **right-anchored non-modal DetailPane** over `<main>` that does NOT cover the
rail (tree stays navigable while reading detail — the "whole and the part"). The
drill model (§7 `pipeline → queue → item → slice-artifact`) maps onto: the
value-stream map = pipeline level (zoomed-out home), the tree = item level, the
DetailPane = slice-artifact level. ZoomBreadcrumb + "Back to map" + Esc are the
symmetric explicit zoom-OUT at every level.

```
[WorkItemTree rail]  |  <main> (unchanged)
  region "Work items"|    ValueStreamMap / DoraPanel / StageCardGrid / TimeThiefView
  tree REQ→CHK→SLC→UC|    --- node click → DetailPane opens over <main> ---
                     |      ZoomBreadcrumb (Pipeline ▸ CHK ▸ slice ▸ UC)  [Back to map] [×]
                     |      ArtifactView (markdown + .mmd)
                     |      ItemHistoryPanel (ledger rows, newest-first)
```

### Click-path budgets (CHK-4 / J2 jobs)
| Job | Budget | s005 reality |
|---|---|---|
| "See the whole work-item tree" | **0 clicks** — tree on load | rail populated from `/items` |
| "Open any item's detail (artifacts + history)" | **1 click / Enter** | node → DetailPane (artifact + history together) |
| "Read a slice artifact / diagram" | **1 click** (same drill) | ArtifactView markdown/.mmd |
| "See an item's ledger history" | **1 click** (same drill) | ItemHistoryPanel |
| "Zoom back out to the map" | **1 click / 1 key** | breadcrumb root / Back-to-map / × / Esc |
| "Expand/collapse a subtree" | **1 click / arrow key** | TreeNode disclosure |

Symmetric drill (1 in / 1 out) so the path back is never lost (§7).

### Standard states (work-item tree surfaces)
- **Empty:** header-only items.csv → tree "No work items"; absent artifact →
  ArtifactView "not yet available"; no ledger rows → ItemHistoryPanel "no history
  yet". Accessible text, never blank/crash (NFR resilience).
- **Loading:** rail + heading and pane region + breadcrumb render immediately;
  nodes / artifact / history fill ≤ 2s.
- **Live (UC-S005-6):** SSE re-fetches the tree (items.csv change) and the
  selected item's history/artifact (ledger change) without reload; under
  reduced-motion content swaps instantly, no scroll/focus loss.

### /process vs /work partition (§6/§8/§175)
Every node carries `data-space` and a SpaceTagBadge (text "work"/"process" + icon
+ colour band — non-colour-redundant). `/process` items group under a labelled
banded subtree so process self-state is clearly partitioned from project output.
Read-only this slice; steer-leak prevention is a Phase-2 concern.
