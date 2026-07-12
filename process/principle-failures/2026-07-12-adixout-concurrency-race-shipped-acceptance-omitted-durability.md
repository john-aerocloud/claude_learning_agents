---
date: 2026-07-12
project: AdixOut
iteration: 0
principle: acceptance completeness — a concurrent surface's acceptance must specify durability under concurrency, not just the happy path
dora_metric_harmed: change_failure_rate
---

## Expected
The acceptance conditions for a use-case fully encode what "correct" means for that
component, so the engineer TDDs the real requirement and a green build is a
trustworthy build. For a component that is inherently CONCURRENT (an SQS-triggered
Lambda runs many invocations at once over shared aggregate state), "correct" MUST
include durability under concurrent/batched delivery — not merely a single happy-path
message.

## Actual
UC-ADIX-006 (gap→pull-heal on the subscribe path) shipped a **last-writer-wins data
race** to the 0.6.0 sandbox deploy. Under concurrent/batched delivery, multiple
Subscribe invocations each loaded an in-memory snapshot of the same aggregate and
unconditionally `store.save()`d it; a stale snapshot's save landed after a fresher
write and regressed `lastAppliedPosition` backward (observed 27→26, 50→49 on 2 of 6
real streams), **silently and permanently losing push-only content** that was not
replayable from the pull feed. This breaches REQ-001 J3 ("a missed/reordered push
must not corrupt or silently gap the aggregate"). The engineer's build was fully
green — because the tests (and the acceptance they were derived from) only exercised a
single happy-path gap-heal. The defect was caught ONLY because the tester, on its own
initiative, invented a batched-simultaneous-injection stressor at the deployed
surface. Cost: one rework cycle (rejected → retried → built_green → redeploy 0.6.1),
CFR 25%, rework rate 33% for the slice.

## Why the principle did not hold
The acceptance authoring (product + solution-architect at /slice-next) specified the
happy path and the negative unfillable-gap→DLQ path, but NOT durability under the
concurrency that the SQS transport inherently produces. Concurrency was a known
property of the component (it is an event-source-mapping-triggered Lambda) yet no step
required the acceptance to enumerate the concurrency/ordering/idempotency failure
modes. So a whole class of "correct" was unspecified, the engineer's green tests could
not cover it, and the only safety net was the tester improvising — a net that worked
here but is not guaranteed and catches the defect POST-deploy (a CFR hit) instead of
at design time.

## Guidance for next time
- **The architect MUST author concurrency / ordering / idempotency-under-parallelism
  acceptance conditions for any concurrent surface** (SQS-/stream-/EventBridge-triggered
  or any >1-instance-over-shared-state component): name the failure modes
  (last-writer-wins, out-of-order/duplicate delivery, stale-snapshot clobber, state
  regression) and the observable condition that must hold under batched load (e.g. "under
  N simultaneous deliveries to the same aggregate the high-water mark never regresses and
  no applied content is lost"). Routed to `solution-architect.md` step 3. [EXP-103]
- **The tester runs a concurrency/batch-durability probe as STANDING practice** for such
  surfaces — fire a simultaneous batch at the same record, consistent-read, assert no
  regression across EVERY affected record. Routed to `tester.md`. [EXP-103]
- Net effect: the race becomes a first-time TDD target for the engineer (fewer
  post-deploy rejects → lower CFR + MTTR), and the tester's improvised catch becomes a
  guaranteed check rather than luck. Sibling to the "validate derived state on a
  real-volume window" tester pattern (EXP-092) and the "unrun test = failure" rule — all
  three say a green build is only as good as the completeness of what it exercises.
