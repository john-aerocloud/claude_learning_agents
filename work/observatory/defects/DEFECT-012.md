# DEFECT-012 — Decomposed work is invisible between product completion and flow-manager triage

**Reported:** 2026-06-10 (human, during live loop observation)
**Status:** CLOSED (fixed bc2ff5f, recovered 2026-06-11T07:35:13Z, prod re-check PASS below)
**Surface:** stage-flow board (Intake & Ready region) + flow model
**Lineage:** DEFECT-009/011 family (product work invisible on the board)

## Expected
When product finishes a decompose, the produced items appear SOMEWHERE visible
immediately — the operator's suggestion: "in the ready queue until the
flow-manager does something with it".

## Actual
The item leaves Decompose (WIP drops — correct, task closed) and the produced
use-cases appear NOWHERE: not in Ready, not in any queue. They exist only as
slice files until the flow-manager's separate sweep registers them in items.csv
and enqueues them. Gap observed: product finished CHK-6 decompose ~15:50Z; the
s015 UCs became visible only at the flow-manager sweep (~16:25Z+), stretched
further by an infra stall of that sweep.

## Intent
Operator watching the board to see where every piece of work is at all times
(core observe job, J1).

## Importance
Data-trust on the core job: work in flight becomes invisible at every
decompose handoff — recurring by design, not an edge case. Same family as
DEFECT-009 (too-little-WIP) but on the queue view rather than the WIP figure.

## Reproduction evidence (confirmed 2026-06-10)
- ledger row 973: product task_end REPLENISH-CHK6 16:16:50Z (actual ~15:50Z,
  recorded late by orchestrator — itself part of the gap).
- items.csv: SLC-S015/UC-S015-* created_ts only at the flow-manager sweep.
- Between those moments the board had no representation of 4 decomposed UCs.
- Inverse symptom live at confirm-time: orphan product task_start
  (REPLENISH-NEXT 16:28:46Z, agent never launched) → Decompose WIP=1 with
  nothing running. Same root: handoff/bookkeeping out-of-band from actual work.

## Ruling (orchestrator, answering "what should it be doing")
Between product task_end and flow-manager triage the items are in a REAL
handoff state; lean rule — every handoff is a buffer, and buffers are visible.
It should NOT enter Ready directly (Ready means pullable now; chain-blocked
items would lie). Correct semantics:
1. **Staging buffer** `queues/staging.csv` ("Decomposed — awaiting triage"):
   PRODUCT appends its produced items there at completion, with its own
   provisional value/cost. Flow-manager remains queue owner: its triage drains
   staging → items.csv registration + Ready enqueue (or planned/chain-blocked).
2. **Board** renders the staging buffer between Decompose and Ready.
3. Items chain-blocked after triage are visible in the tree as `planned`
   (already true); staging covers only the decomposed-but-untriaged window.

## Fix
- engineer: staging.csv in stage-flow API + board panel; product def: append at
  completion; flow-manager def: drain staging at every sweep. Pinning test:
  product task_end with staged items ⇒ staging depth > 0 until a triage row.
- Scheduled as next pickup after the re-dispatched wave (seams disjoint from
  UC-S013-1 / UC-S015-1).

## Gap-closing experiment
EXP-040 (registered at fix time): agents self-record their open/close ledger
rows at actual start/finish; orchestrator records only flow events it owns.
Root cause: proxy bookkeeping by the orchestrator lags/leads reality (late
task_end, orphan task_start), making truthful WIP impossible by construction.

---

## Prod re-check

**Date:** 2026-06-11  
**SHA under test:** bc2ff5f (staging buffer fix commit), HEAD d872ac2  
**Tester:** tester agent  
**Verdict:** PASS — staging box renders correctly; DEFECT-012 user-visible symptom is closed.

### What was validated

1. **Staging API (live observatory server :5173):**
   `GET /api/projects/observatory/queues/staging` returns `{"queue":"staging","depth":0,"rows":[]}`
   — correct empty/drained state (live `work/observatory/queues/staging.csv` is header-only,
   as expected after all staged items have been triaged by the flow-manager).

2. **Board rendering — empty state:**
   The staging box is visible on the live board at `data-testid="staging-buffer"` with
   `data-depth="0"`, `data-empty="true"`, `aria-label="Staging buffer (decomposed, awaiting
   triage), 0 awaiting triage"`. This reads as a status ("0 awaiting triage"), not as broken.

3. **GEO guard (D12-GEO) — PASS on live server:**
   The staging box sits BETWEEN Decompose and Ready in the queue lane. The D12-GEO spec
   (`staging-buffer.spec.js:48`) asserts left→right order
   (`decompose.x + decompose.width ≤ staging.x`, `staging.x + staging.width ≤ ready.x`)
   AND vertical overlap with both neighbours. This passes on the live :5173 server with
   the empty staging box present.

4. **Fixture-backed spec (D12-E2E-1/E2E-2/D12-A11Y) — PASS on :5199:**
   All 4 staging-buffer tests pass against the fixture server (which has 2 staged rows:
   UC-D9, UC-D10). D12-E2E-1/2 failures on the live server are expected (fixture expects
   depth=2; live is correctly depth=0) — these are not defects.

5. **3-lane / no-stacked-column guard:**
   The ValueStreamMap continues to render 3 lanes (queue lane, stage lane, metrics lane).
   The StagingQueueBox is within the queue lane, confirmed by the D12-GEO lane bounds check
   (`box.y ≥ lane.y` and `box.y + box.height ≤ lane.y + lane.height`).

### Evidence

- `curl http://localhost:5173/api/projects/observatory/queues/staging` → `{"queue":"staging","depth":0,"rows":[]}`
- `work/observatory/queues/staging.csv` content: header-only (`item_id,parent,job,value,cost,produced_ts,producer_ref`)
- D12-GEO Playwright test: 1/1 PASS on live :5173
- D12-E2E-2 test failure message confirms box IS present with `data-depth="0"` and correct aria-label

The DEFECT-012 user-visible symptom (decomposed work invisible between product completion
and flow-manager triage) is closed: the staging buffer box is present on the board, reads
"0 awaiting triage" in the current drained state, and will show staged items whenever
product appends to staging.csv before the next flow-manager triage sweep.
