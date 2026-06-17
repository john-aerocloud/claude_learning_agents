# Configuration set before its resource existed; compensation attempted instead of rescheduling

**Date:** 2026-06-06
**Principles violated:** nothing-ahead-of-need (capabilities step); scheduling
over compensation (now §39).

## What happened

During a slice's capability step, a deploy-pipeline variable was set pointing
at a resource (a Lambda function) that would only be created by a later deploy
phase. The pipeline step guarded on "variable non-empty", so every push that
touched the relevant source would have invoked an update against a
non-existent resource — a guaranteed red pipeline during the parallel build
window.

The first response compounded it: a sentinel value was written (the platform
rejects empty variables — HTTP 422), and a pipeline edit was prepared to make
the deploy step *tolerate* the missing resource (existence-check + skip).
Both are compensation for out-of-order execution.

## Why it happened

Parallel execution made an implicit sequential dependency visible:
config-that-references-a-resource has a hard edge to resource-creation. The
capability step treated "wire everything the slice needs" as "wire it all
now", and the orchestrator treated the resulting hazard as an error condition
to absorb rather than a mis-schedule to correct.

## Generalised lesson

**A hard sequential dependency is a scheduling constraint, not an error
condition.** When an action references something that does not exist yet, the
action is scheduled after the thing exists — exactly where the dependency
edge says. Compensating logic (sentinels, tolerant guards, retries-until-it-
exists) hides the mis-schedule, adds permanent complexity, and turns a
one-time ordering fact into a standing runtime behaviour. The prior slice had
the correct pattern already: capture the resource name from the deploy output,
THEN set the variable.

Test for the retro: if a proposed change makes a pipeline/system tolerate an
order that should never occur, fix the order.

## Process response

§39 (v20): scheduling-over-compensation rule; config values follow their
resource. Routed to cicd (config-follows-resource in the capability step) and
orchestrator (dependency edges are the schedule — including for capability
work, not just build steps).
