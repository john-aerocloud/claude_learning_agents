---
date: 2026-07-11
project: AdixOut
iteration: 0
principle: slice value (minimise up-front design) — the register-then-slice reflex
dora_metric_harmed: lead_time
---

## Expected
By elaborating a requirement dossier (personas + jobs + a few clarifying
questions) and then moving promptly to value/cost → register → slice, we get to
delivering core value fast with minimal up-front design.

## Actual
On AdixOut REQ-001 the orchestration drove hard to *clear the requirement gate* —
dossier finalized, then immediately proposed product-value → register → first-chunk
capabilities → `/loop-run`. The human stopped it: the system was rushing to REQ-001
before the problem was understood well enough to slice without cost spikes. No code
was written yet (near-miss, caught at the gate), but the reflex — treat the gate as
a checkpoint to clear rather than a point to confirm understanding — is the failure.

## Why the principle did not hold
"Minimise up-front design" is right against *speculative* design, but it wrongly
suppressed the *problem-understanding* design that makes slicing safe. Understanding
via questions and planning is far cheaper than discovering a bad slice sequence in
code. The genuinely hard, valuable judgment — how much whole-problem design to do so
you can then ruthlessly cut to core value for one or two personas, and sequence the
layering so no later slice forces a re-architecture (a cost cliff) — was being
skipped in the rush to register.

## Guidance for next time
When X = "requirement dossier is signed and the next move is to slice," prefer Y =
first do enough whole-problem design to (a) see the full shape, (b) pick the initial
persona(s) to serve at the deliberate expense of the others, and (c) locate the cost
cliffs — BEFORE generating slices. The design pass exists to give slicing context;
slicing then ruthlessly cuts. Goal of design+slicing: predictable release cadence
with no sudden large cost spikes. Do not treat the gate as done just because the
dossier is signed. (Do not overturn value-slicing globally here — that is a retro
decision; this is the detection signal + narrower rule.)
