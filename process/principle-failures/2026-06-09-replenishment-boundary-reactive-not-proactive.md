# Principle failure — replenishment ran boundary-reactive, not proactively ahead of the engineer

**Date:** 2026-06-09
**Project/slice:** observatory / s001–s004 run
**Principle breached:** v41 §F3/§F9 — replenishment is a parallel process that
keeps the Ready buffer (`min_items`) stocked so the engineer never waits.

## What happened
Product (replenishment) fired ONLY at chunk boundaries: `REPLENISH-CHK-1`
(00:25), `REPLENISH-CHK-2` only at 01:10 *after* s001 was done, then the
re-vision. Between those, **product was idle while engineers built**, and the
next chunk was not broken down until the current one drained. The Ready queue
sat at depth 0–1 for the entire run, never at its floor of 2. flow-manager
repeatedly emitted "ready below floor / starving" signals, and the orchestrator
**rationalised them away** — "scaffold-constrained this cycle", "will refill
after UC1 done", "hold replenishment" — instead of keeping product working
ahead. The human observed it directly: *"the product work of creating work is
[not] happening in parallel with the dev loop properly — I would expect future
work to be identified and broken down ready for the engineer next."*

## Why it happened (root cause)
§F3 declared replenishment "parallel and independent" but defined its trigger as
`depth < min_items` (i.e. reactive, fired at the boundary when the buffer
drained) and never as a continuous look-ahead that keeps the buffer stocked. The
orchestrator dispatched product only when Ready emptied, treating below-floor as
an acceptable steady state rather than a refill-now signal. The buffer's whole
purpose — work-ahead so the engineer always has the next item — was lost.

## Correction (encoded in v44)
- §F3 rewritten: replenishment is **proactive + continuous**; trigger is
  below-floor OR projected-below-floor-after-the-next-pull; product decomposes
  the next slice AND the next chunk's first slice WHILE the current chunk builds
  (no decompose-gap at chunk edges); below-floor is a hard refill-now trigger,
  never tolerated.
- orchestrator.md: dispatch product in the SAME parallel batch as each build
  wave to look ahead; never rationalise a below-floor signal.
- flow-manager.md: signal proactively (projected-below-floor), re-raise until
  Ready ≥ floor, decompose-ahead across chunk boundaries.
Tracked as EXP-034.

**Pattern note:** related to the orchestrator-rationalises-a-flow-signal class.
The standing fix is: a buffer floor exists to be MAINTAINED ahead of need, not
observed after it breaches.
