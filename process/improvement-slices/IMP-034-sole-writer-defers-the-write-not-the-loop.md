# IMP-034 — the sole writer must defer the WRITE, not the LOOP

**Status:** QUEUED
**Opened:** v159 retro, ROC, 2026-08-29
**Scores:** the ELEVATE limb of v159's constraint (`wip` occupancy 1 → 2.2 of 8)
**Owner:** cicd + orchestrator

## The measurement that opened this

Measured live during the v159 cycle, not inferred. One engineer editing
`.claude/skills/work-items/scripts/work-items.py` — the sole writer every `wi-append`
shells out to — **froze every item state change in the project for the whole cycle.**

Concretely stalled behind that one file edit, for hours:

- **28 declines** from a completed 55-item intake triage, fully reasoned and staged
- **~6 amendments** (the `UC-ROC-112/113/114` `deps:` reclassification, already committed
  to the item FILES but with no event recorded)
- `OI-ROC-006`'s own `closed` event
- `make retro-mark`, so this retro cannot drain its own debt counter
- `make wi-project` / `wi-validate` / `loop-gate`, i.e. every gate the loop runs

## Why this is the elevate move, and why it is NOT "add capacity"

v159 established that **87.01%** of gross lead time is waiting, agent effort is **0.20%**
of elapsed, and 2.2x throughput needs `wip` occupancy of only **2.2 of 8** — a cap already
declared. Five retros correctly declined to ELEVATE capacity on that evidence.

So the binding limit is not how much work the system can do. It is that **§F2b
resource-class exclusivity, which is a correct safety rule, is simultaneously a hard cap of
1 on concurrency for anything that needs a state change.** Every UC build, every triage
decision, every gate. The lock is right; its blast radius is wrong.

## The change

**A held writer must defer the WRITE, not the LOOP.** An append issued while the writer is
locked should be queued durably and applied on release, in order, with the same edge check —
not refused, and not silently dropped.

Sketch, to be designed properly:
- appends land in an append-only spool when the writer is locked
- release drains the spool through the ordinary edge-checked path
- the spool is visible to `loop-gate` (a deep spool is a finding, exactly as a deep queue is)
- **fail closed:** an append that would be ILLEGAL on drain must be rejected loudly at drain
  time and must not be dropped, or this trades a stall for silent state loss — which is
  strictly worse and is this project's dominant defect family

## Non-vacuity — the criterion that stops a fake fix

**AC-034.1** — with the writer held, an append succeeds from the caller's point of view AND
is observably applied after release, with its original `--ts` preserved. A fix that
timestamps the append at DRAIN time fails this: it would destroy the age measurement
`OI-ROC-009` had to be repaired to restore this same cycle.

**AC-034.2** — an append that is illegal against the state at drain time is REPORTED and
retained, never discarded. Demonstrate it with a real illegal transition.

**AC-034.3** — the exclusivity guarantee §F2b exists for is NOT weakened: two concurrent
writers must still not interleave edits to the script itself. This spools CALLERS; it does
not make the file concurrently editable.

## How this could be wrong

If the real remedy is simply "never schedule a `work-items.py` edit during a cycle that
needs state changes", then this is machinery bought for a scheduling rule. Test that first:
it is cheaper. The counter-argument is that the lock was held for hours by a legitimately
scheduled item that was pulled *because* the window was clear — the schedule was correct and
the stall happened anyway.
