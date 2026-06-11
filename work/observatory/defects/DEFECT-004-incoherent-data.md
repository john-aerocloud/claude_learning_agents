# DEFECT-004 — UI data inconsistent with itself; queued WIP/lead-time invisible; throughput unitless

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** HIGH (data-integrity + comprehensibility on the CORE observe view)

## Resolution
(1) flow-manager synced stale state (UC-S005-1/2/3→done; ready.csv→genuinely-queued; UC-S005-6→blocked). (2)+(3) engineer (sha 9f8a176/e264d8d/22e1ab9): every figure labelled (throughput "N items", dwell humanised/"—", "in-flight", "rework"); buffer stages add `queue_depth`+`queue_items[wait_s]` ("Depth" ≠ "WIP"); coherence rule reconciles queue vs items.csv + surfaces `coherence_warning`. 384 unit + 33 browser green. Verified live (after a controlled :5173 restart to deploy server code): throughput "10 items", Ready Depth 2 with ~2h accruing waits, map ready-count == tree ready-count (2), coherence_warning=false. Gaps → EXP-037 (keep registry/queues current with the ledger as each UC completes) + EXP-033 note (every figure readable with a unit) + open-item (server code needs auto-restart to deploy — only client HMRs).

## Four fields
- **Expected:** The map and tree present ONE coherent picture of the same work. Queued CHK-4 use-cases show in the value-stream map as queued/WIP with their accruing lead time. Throughput carries a unit so "12" is meaningful.
- **Actual:** Three sources disagree — (a) tree/`items.csv` shows all 6 CHK-4 UCs as `state=ready` though UC-S005-1/2/3 are DONE; (b) `ready.csv` still lists UC-S005-1/2 as queued (they're done); (c) map (ledger) shows engineer throughput 10 / wip 0 (built). Queued work isn't visible as WIP-with-lead-time in the map (Ready shows wip 0, depth not surfaced) though ready.csv has 2 items. Throughput is a bare number ("12") with no unit/window.
- **Intent:** Coherently observe flow — see queued work + its lead time, and understand the numbers.
- **Importance:** A monitoring tool whose three views contradict each other can't be trusted; bare unitless rates can't be read. Data-integrity + comprehensibility on the core job.

## Reproduction (confirmed, live :5173)
- `GET /items` CHK-4: UC-S005-1..6 all `state=ready` (UC-S005-1/2/3 actually built/done).
- `GET /queues/ready`: UC-S005-1, UC-S005-2 still listed.
- `GET /stage-flow`: engineer throughput 10 wip 0; ready throughput 3 wip 0; NO unit/window field on throughput; queued items not represented as current WIP/depth.

## Classification (§5a)
Our bug. Three layers: (1) **process/data hygiene** — registry/queues not kept current as UCs completed (orchestrator recorded the ledger but never had flow-manager transition item state / dequeue on each UC done in s005); (2) **design** — the map derives from the ledger ONLY and never reconciles with items.csv/queue current state → two divergent pictures of the same items; queued work (a buffer's current depth + each item's accruing wait/lead time) has no representation; (3) **labelling** — throughput rendered without a unit.

## Root cause (latent)
No single coherent "current state" model. The ledger (historical events), items.csv (item state), and queues (buffer contents) are three sources that drift because nothing keeps them in sync or reconciles them at render. Compounded by the orchestrator not transitioning item state as each UC completed (s004 bubbled correctly; s005's in-flight UCs were left at `ready`).

## Priority
**Fix NOW (interrupt)** — core-view data integrity, pre-empts the in-flight CHK-4 drill-down build (§38/§F5).

## Fix (three parts)
1. **Sync the registry/queues to reality** (flow-manager): UC-S005-1/2/3 → done; dequeue the done items from ready.csv; CHK-4 children/state correct.
2. **Coherence + queued-work + lead-time** (product/ui-designer ruling → engineer): the map and tree must agree; queue-stages (intake/ready/deploy) show current DEPTH + each queued item's accruing wait/lead-time (not just historical throughput); reconcile ledger vs items.csv (one model / cross-check at render).
3. **Throughput unit** (product/ui ruling → engineer): decide if throughput is a cumulative COUNT (label "N items") or a RATE (items / window, like DORA deploy-freq) and LABEL it; do the same audit for every figure (dwell already 's').
[sha + prod re-check on close]
