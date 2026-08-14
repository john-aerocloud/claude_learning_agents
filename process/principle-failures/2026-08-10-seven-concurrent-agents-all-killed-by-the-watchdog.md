# Seven concurrent verification agents, all seven killed by the stall watchdog

**Date:** 2026-08-10 · **Project:** OagEventSource · **Agent at fault:** orchestrator (me)
**Principle breached:** §F2b — schedule by RESOURCE CLASS, not only by logical dependency
[EXP-127] · **Recorded at:** v138 retro

## What happened

An external review produced seven findings needing independent verification. The seven were
logically independent — different files, different AWS resources, no shared writes — so I
dispatched **all seven concurrently in one message**, each briefed to read code, query prod
CloudWatch/DynamoDB, and in two cases run a reproduction test.

**All seven died.** Six were killed by the stall watchdog ("no progress for 600s"); one died
on `Connection closed mid-response`. Not one returned a report on its first run.

Every one of them died *late* — at the expensive step. Their last recorded lines show how
far they got: one at "Now let me verify the live prod state", one at "Now writing the
throwaway reproduction test", one at "Now let me quantify against prod", one mid-way through
a full-history CloudWatch scan of a 573 MB log group.

## Why it is a principle failure and not bad luck

§F2b exists for exactly this, and it was written from exactly this evidence. Its founding
measurement: *12+ agent deaths in one session, two dying at the identical step, `eslint` at
**8 s idle vs 19 s under load** (2.4x, nothing changed but concurrency), load average 14.68
during failures vs 8.19 quiet.* Its rule is that `wip_limit` caps by QUEUE and `deps`
express LOGICAL order, but neither expresses **contention for a shared physical resource** —
so scheduling must consider resource class.

I applied the logical-independence test (§F6, maximal independent set) and stopped there.
Seven agents each running AWS CLI calls, log scans and a test runner are not independent in
the dimension that killed them: local CPU, network, and the model-stream watchdog. The
process already told me this and I did not read it as applying to *verification fan-out* —
I read it as applying to *builds*.

## What worked, and is worth keeping

**Resuming by name recovered every agent's banked work.** Because each agent's transcript
survives, `SendMessage` to the dead agent resumed it with full context, and I asked each to
**report from what it had already established and mark the rest as a LIMIT** rather than
continue exploring. Every one then returned a complete, evidence-bearing report — several
including measurements taken *before* the kill (22 Event Hub partitions at head; the
non-`EVT#` enrichment drop; prod publisher error counts).

So the expensive work was not lost — but it cost a full extra round-trip per agent, plus my
own diagnosis time, for zero additional findings.

**Resuming in batches of three succeeded where seven failed.** That is the actual capacity
signal, and it is roughly consistent with §F2b's load observations.

## The correction

1. **Verification/research fan-out is a resource class**, not a set of independent logical
   tasks. Cap concurrent agents that hit the same physical resources (local CPU, one AWS
   account's API, one test runner, one container) at **~3**, and pipeline the rest.
2. **When an agent is briefed to do something expensive at the END of its work** (a live
   query, a test run), it should report incrementally, or be briefed to establish the
   expensive thing FIRST while its budget is fresh. Six of seven died at the expensive step
   because it came last.
3. **A killed agent is not a lost agent** — resume it by name and ask for a report-from-banked-work
   before letting it explore further. Do not re-dispatch a fresh agent for the same brief;
   that discards the transcript and pays for the work twice.

## Scoring note

This is a **live re-confirmation of EXP-127**, not a new finding — which makes it the more
damning kind: the mechanism existed, was correct, was written from near-identical evidence,
and was not applied because I did not recognise my task as the class it governs. Recorded
so the next occurrence is a third strike against the *rule's reach*, not against its truth.

Related: `2026-08-06-we-schedule-by-logical-dependency-and-never-by-resource.md` (the same
principle's founding failure), `OI-AGENT-WATCHDOG-KILLS-UNEXPLAINED` (the project-side
open item), `OI-CONCURRENT-AGENTS-SHARE-ONE-GIT-INDEX` (a sibling contention class).
