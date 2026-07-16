# Principle failure: UC-ADIX-013's feat commit changed the MAP node's real behaviour but never touched architecture/dependencies/*.mmd — impacted-tests reported a clean "no changed nodes" that hid real scope

**Date:** 2026-07-16
**Project:** AdixOut
**Agent:** tester (hit it), engineer (owns the omission)
**Principle:** "Plan from the change map, then validate" (tester role) — "If the model
diff is empty but code clearly changed behaviour, that is an updated-in-commit
principle failure — log it and derive your plan from the code diff instead."

## What happened
Validating UC-ADIX-013 (TKO departure-actual milestone), `make impacted-tests
SINCE=55d2d38 PROJECT=AdixOut` ran cleanly (the nested-repo git-root bug from the
5-occurrence run of 2026-07-13 is fixed, IMP-007/OI-42 landed) and reported:

    No changed/added/removed nodes in architecture/dependencies/*.mmd.
    EXIT 0 (clean — nothing to tick off).

This is FALSE as a scope signal. The engineer's feat commit for this UC
(`c1eac4d feat(UC-ADIX-013): AIDX TKO (take-off, ACT) departure milestone`) changed
real behaviour — `mapLegData.ts`'s `departureOperationTimes` gained a new
`pushActMilestone(times, "TKO", actual?.offGround)` call, plus two new test files'
worth of assertions (`mapDeparture.test.ts` +14 tests incl. TKO cases,
`departureConformance.test.ts` +6 tests) — but the commit touched ZERO files under
`architecture/dependencies/`. Contrast with UC-ADIX-011's feat commit
(`50f4d75 feat(UC-ADIX-011): AIDX ELDT...`), which DID update
`architecture/dependencies/data-flow.mmd`'s `MAP` node text (added the "SLC-ADIX-006
PREDICTIVE (UC-ADIX-011)..." sentence and kept `:::changed`) in the same commit as
the code change. UC-013 skipped that step entirely.

Net effect: the MAP node's `:::changed` mark and description both predate this
window (from UC-011), so `impacted-tests` correctly saw no NEW change in-window —
but that is exactly backwards from the ground truth: UC-013 DID change MAP's real
behaviour (new TKO OperationTime, new call site) and left zero trace in the
change-map for the mechanical tick-off to catch.

## Fallback taken (this validation)
Did not rely on the empty impacted-tests report. Derived the plan directly from
the code diff (`git show --stat c1eac4d`): confirmed `mapLegData.ts` was the sole
source touched, confirmed `@covers domain-map` / `@covers domain-map @covers
domain-serialize` tags already exist on `mapDeparture.test.ts` /
`departureConformance.test.ts` (from prior UC work, reused not authored fresh), ran
the full unit suite (158/158, including the 14 mapDeparture + 6
departureConformance tests) and the full local/integration tier (6/6), plus the
committed live probe (`probe-resync-takeoff`, all 5 checks R0-R4 green against real
sandbox legs) and the three zero-regression sibling probes (UC-011 predictive,
UC-010 arrival timing, UC-009 arrival mapping — all green, no stale assertions this
time).

## Standing lesson
`impacted-tests`'s correctness is now gated on an ENGINEERING DISCIPLINE step (touch
the `.mmd` change-map in the same commit as the behaviour change) that has no
mechanical enforcement — UC-011 did it, UC-013 didn't, and the tool cannot tell the
difference between "no scope changed" and "scope changed but the map wasn't
updated." Recommend a cheap guard: a pre-commit or CI check that a commit touching
`src/app/src/domain/mapLegData.ts` (or any node's covering source file) also
touches the `.mmd` file declaring that node, OR an explicit `SKIP-MAP-UPDATE:
<reason>` commit-trailer waiver — otherwise this recurs silently on every slice
where the engineer forgets the change-map update, and only a tester's manual
code-diff cross-check (as done here) catches it.
