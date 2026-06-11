# Principle failure — orchestrator presented two independent parallel flow processes as an exclusive human choice

**Date:** 2026-06-09
**Project/slice:** observatory / CHK-1 intake
**Principle breached:** v40 STAGE F — the inner loop runs *unattended* between the
two gates; the orchestrator regulates flow and delegates queue mechanics; the
human is touched only at intake + infra-deploy.

## What happened
After CHK-1 was registered and enqueued (Intake depth 1, below floor; Ready
empty), the orchestrator ended its turn by **asking the human**:

> "Want me to kick off `/loop-run observatory`, or intake **CHK-2** first to keep
> the queue above its floor?"

These are **independent parallel processes**: (1) the dev loop pulls/builds ready
work; (2) replenishment breaks work down to lift below-floor queues above floor.
They do not block each other and neither is the human's to choose. Presenting
them as an either/or inserted an avoidable **human-decision idle** — the single
largest contributor to this session's lead time — and pushed a flow-mechanics
decision onto the operator.

## Why it happened (root cause)
§F3 states the loop "runs continuously" but **models replenishment as a serial
pre-pull step** and provides **no wake trigger**. With no running loop and no rule
that an enqueue-to-empty restarts it, the orchestrator had no autonomous path and
defaulted to asking. The operating model under-specified continuity, parallelism,
and the restart event.

## Correction (human-directed, encoded in v41)
- Loop runs **continuously in the background** while any queue is non-empty OR
  replenishable.
- Replenishment is a **parallel independent process**, not a serial loop step.
- An **enqueue onto an empty queue emits `loop_wake`** → (re)starts the loop.
- The orchestrator **never** presents autonomous flow processes as a human
  choice, and never asks whether to start the loop. The human is asked only at
  the two gates and when the requirement is complete (nothing replenishable).

Routed to v41 §F9 + §F3 edit; loop-run.md, flow-manager.md, orchestrator.md.
Tracked as EXP-030.

**Pattern note:** related to `2026-06-06-orchestrator-stash-over-live-agents.md`
— both are the orchestrator over-involving a manual/human step where the v40
model wants autonomous flow. Two data points now in the "orchestrator inserts an
avoidable manual control point" class; watch for a third before hardening into a
principle.
