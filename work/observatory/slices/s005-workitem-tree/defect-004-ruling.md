---
defect: DEFECT-004
ruling-by: product
date: 2026-06-10
status: RULING — binding on engineer + ui-designer
applies-to: s004-value-stream-map (StageNode/StageMetric), s005-workitem-tree (tree + queued-work), /stage-flow endpoint
---

# DEFECT-004 — Product ruling: units, queue current-state, and coherence

## 1. Throughput decision and unit

**Decision: throughput is a CUMULATIVE COUNT of items that exited the stage. Label
it "N items". NOT a rate.**

Justification: the data is what it is — the ledger records events, and what is
computable without a known wall-clock window is the count of items that completed
the stage (task_end / stage_exit pairs). Calling it a rate would require a stable
denominator (active-days, hours); the current ledger has no reliable denominator per
stage. DORA deploy-frequency IS expressed as "/active-day" because the DORA
baseline.md explicitly computes that window; per-stage throughput does not have an
equivalent window. A COUNT is honest. A rate would be fabricated.

The operator's CORE job (J1: see where work sits, how each stage performs) is served
by knowing "42 items have moved through Build/TDD" far better than a unitless "42"
or a misleading "42 /day" with an unstated denominator.

**Exact label/unit rule:**

- The StageMetric component's `value` prop MUST include the word "items" when
  throughput > 0: rendered as "N items" (e.g. "42 items", "1 item", "0 items").
- The accessible name of the node MUST read "throughput 42 items" — never bare "42".
- The `data-metric` element's visible text carries the unit: "42 items".
- The MetricSource tooltip/panel adds context: "42 items completed this stage
  (cumulative since project start)".

---

## 2. Per-figure unit table (every figure on a StageNode card)

| Figure | Field | What it measures | Unit / display rule | Example |
|--------|-------|-----------------|---------------------|---------|
| Throughput | `throughput` | Cumulative count of items that exited the stage | "N items" (always spelled out; "1 item" singular) | "42 items" |
| Dwell | `dwell_median_s` | Median time items spent in the stage (completed pairs only) | Humanised: < 60 → "Ns"; 60–3599 → "Xm"; ≥ 3600 → "Xh"; include unit; show "—" if < 2 completed pairs (no "0s" for unknown dwell) | "12m" · "3h" · "—" |
| WIP | `wip` | Items IN-FLIGHT right now (entered, not yet exited) | Integer with label "in-flight" when > 0 (InFlightBadge); plain "0" when 0. Derives from REGISTRY (see §4), not just ledger | "2 in-flight" |
| Rework | `rework` | Count of rework/failure events since project start | Integer + label "rework" | "3 rework" |

**Note on dwell "—":** showing "0m" when fewer than 2 pairs exist is misleading —
it implies measured zero latency. Show "—" with a tooltip "insufficient data
(< 2 completions)".

---

## 3. Queue-stages: current-state fields (Intake / Ready / Deploy / Rework)

The buffer stages (Intake, Ready, Deploy, and any Rework holding state) are BOTH
work-flow stages (they have historical throughput) AND queues (they hold items RIGHT
NOW). The current StageNode conflates these. They must show both:

### 3a. Historical (from ledger — existing)
- `throughput`: N items (as above — how many moved through historically).
- `dwell_median_s`: median wait in queue before being pulled (humanised).
- `rework`: rework events while in queue (usually 0 for pure queues).

### 3b. Current state (from registry/queues — NEW required fields)

The `/stage-flow` endpoint response shape MUST add these fields for queue-stages.
For non-queue stages (work stages), `queue_depth` = null and `queue_items` = null
(not present or null — the engineer chooses which; the UI treats absent/null as
"not a queue"):

```ts
type StageFlow = {
  // existing fields unchanged:
  stage: string;
  label: string;
  throughput: number;
  dwell_median_s: number;
  wip: number;
  rework: number;
  source_rows: string[];
  wip_items?: { item_id: string; since_ts: string }[];

  // NEW — queue-stage current state (null on work stages):
  queue_depth: number | null;    // how many items sitting here RIGHT NOW
  queue_items: QueuedItem[] | null; // each item's id + enqueue time
};

type QueuedItem = {
  item_id: string;
  enqueued_at: string;     // ISO timestamp when item entered this queue
  wait_s: number;          // seconds since enqueued_at (accruing — computed at request time)
};
```

**Display on queue-stage StageNode cards:**

Replace the plain "WIP N" metric on queue stages with a **QueueDepth figure** showing:

```
Depth  3 queued
       UC-S005-4  waiting 4h
       UC-S005-5  waiting 2h
       UC-S005-6  waiting 45m
```

Exact rules:
- Label: "Depth" (not "WIP" — WIP is in-flight; Depth is sitting/waiting).
- Value: "N queued" (e.g. "3 queued", "0 queued").
- Per-item wait: each queued item shows its `item_id` + humanised `wait_s` (same
  format as dwell: "Xm" / "Xh").
- If `queue_depth > 3`, show first 3 + "... +N more" — depth badge still shows
  full count.
- `queue_depth = 0`: show "0 queued" — no items listed; no false in-flight signal.
- `queue_depth = null`: the stage is not a queue; render WIP as before.

The accessible name for a queue stage MUST read, e.g.:
"gate: Intake stage, throughput 5 items, dwell 2h, depth 3 queued (longest wait 4h),
rework 0 rework".

---

## 4. Coherence rule

**The single authoritative current-state model is: items.csv + queues CSVs, reconciled.**
The ledger is HISTORICAL FLOW only.

| Data | Source of truth | Used for |
|------|----------------|---------|
| Item state (done/ready/backlog/in-flight) | `items.csv` | Tree node state; WIP derivation |
| Queue contents (what is currently queued) | `queues/ready.csv`, `queues/intake.csv`, etc. | `queue_depth`, `queue_items`, wait calculation |
| Historical throughput | `process/dora/ledger.csv` | `throughput` count, `dwell_median_s`, `rework` |
| In-flight WIP (stage-level) | Ledger (open task_start / stage_enter with no matching end) AND reconciled with items.csv state | `wip`, `wip_items` |

**Reconciliation rule at render time (applied by the `/stage-flow` endpoint):**

1. `queue_depth` for a buffer stage = count of rows in that stage's queue CSV that
   have not been marked done in items.csv. A row present in `ready.csv` for an item
   whose `items.csv` state = "done" is a STALE QUEUE ENTRY — it does NOT count toward
   `queue_depth` and MUST NOT appear in `queue_items`. The endpoint must filter stale
   entries silently (log a warning server-side; do not surface a broken state to the UI).

2. `wip` for any stage = items whose state in items.csv is "in-flight" (or equivalent)
   and whose stage matches, UNION with items who have an open ledger stage_enter/task_start
   for that stage. If ledger says in-flight but items.csv says done: items.csv wins
   (ledger event was not closed; treat as closed). Log the discrepancy.

3. The tree (s005) derives item state exclusively from items.csv — not the ledger.
   A UC showing state=ready in items.csv MUST show "ready" in the tree, not "done",
   until items.csv is corrected by the flow-manager. (The flow-manager sync is a
   SEPARATE fix — DEFECT-004 part 1 — outside this ruling. This ruling defines what
   the UI shows given whatever state the registry is in.)

**Consistency check the viewer can do:**

- CHK-4's queued UCs: count of nodes in the tree showing state=ready under CHK-4 /
  s005 MUST equal the `queue_depth` on the Ready stage card in the map.
- If they differ, a `data-coherence="warning"` attribute is added to the Ready stage
  node (visible as a text label "queue count mismatch — see tree") so the discrepancy
  is surfaced, not silently hidden.
- This check is a reconciliation at endpoint level: `/stage-flow` reads the queue CSV
  count and the items.csv count for that stage; if they differ, the response includes
  `coherence_warning: true` on that stage entry.

---

## 5. Acceptance conditions (additions to s004/s005 ACs)

The following ACs extend s004 acceptance.md and s005 acceptance.md. Tagged as
DEFECT-004-AC-N. The engineer must implement; the tester must verify.

**DEFECT-004-AC-1 — Throughput carries unit "items"**
Every `[data-testid^="metric-"][data-metric="throughput"]` element's visible text
content matches `/\d+ items?/` (e.g. "42 items", "1 item"). No bare integer.

**DEFECT-004-AC-2 — Dwell shows "—" when insufficient data**
Any stage with fewer than 2 completed ledger pairs renders dwell as "—" (not "0s"
or "0m"). Automation: for a fixture stage with 0 or 1 completed pairs, assert
the dwell value element's text is exactly "—".

**DEFECT-004-AC-3 — Queue stages show depth + wait**
For at least the "ready" stage in the live observatory project: the StageNode's
`queue_depth` field is present and non-null in the API response; the card shows
"N queued" with a numeric depth matching the non-stale count in `queues/ready.csv`.

**DEFECT-004-AC-4 — Stale queue entries excluded**
If `queues/ready.csv` contains an item_id whose state in items.csv = "done", that
item MUST NOT appear in `queue_items` and MUST NOT be counted in `queue_depth`.
Test via: fixture with one stale entry + one live entry → `queue_depth = 1`.

**DEFECT-004-AC-5 — Each queued item shows accruing wait**
In the UI, every `QueuedItem` row in a queue-stage card shows a humanised `wait_s`
matching the formula `now - enqueued_at` (within a 5-second tolerance at test time).
Automation: compare `data-wait-s` attribute against the fixture enqueue time.

**DEFECT-004-AC-6 — Map and tree agree on queue depth (coherence)**
The count of tree nodes in state "ready" under any given slice MUST equal the
`queue_depth` on the Ready stage card (after stale-entry filtering). If they disagree,
the Ready card shows `data-coherence="warning"` with visible text "queue count
mismatch". Test via fixture with known counts — no mismatch → no warning; 1-item
mismatch → warning visible.

**DEFECT-004-AC-7 — Accessible names carry units**
Every stage node's accessible name (via `aria-label` or `role="group"` computed name)
matches the pattern:
`/<label> stage, throughput \d+ items?, dwell .+, (depth \d+ queued|WIP .+), rework \d+ rework/`
For queue stages: "depth N queued"; for work stages: "WIP N in-flight" or "WIP 0".
No bare number in any accessible name for any metric.

---

## 6. Explicitly NOT ruled here

- How the flow-manager transitions item state (correcting UC-S005-1/2/3 from "ready"
  to "done") — that is DEFECT-004 part 1, a flow-manager / orchestrator fix.
- The visual style of the QueueDepth figure (pill shape, typography) — that is
  ui-designer territory; this ruling specifies the fields and labels only.
- Whether queue-stage and work-stage StageNodes are the same component or split into
  two — engineer implementation choice, provided the acceptance cases pass.
- The "Rework" holding buffer — treat as a work stage (wip, not depth) unless a
  rework queue CSV exists. If it does, apply the same queue-stage rules.
