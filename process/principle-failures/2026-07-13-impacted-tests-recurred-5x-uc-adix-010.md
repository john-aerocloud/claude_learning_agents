# Principle failure (RECURRING, 5th hit): impacted-tests still mis-resolves the project git root

**Date:** 2026-07-13
**Project:** AdixOut
**Agent:** tester (hit it), cicd (owns the tool)
**Principle:** §12c read-before-test / §5b (a recurring root cause is a system failure to smooth it)
**Prior entries:** 2026-06-24-impacted-tests-blind-to-project-subrepo-dep-model.md;
2026-07-11-impacted-tests-recurred-4x-under-worktree-topology.md; EXP-077 → IMP-007
(still `queued` as of this hit)

## What happened (recurrence, now 5x)
Validating UC-ADIX-010 (BRS-arrival OperationTime mapping), `make impacted-tests
SINCE=f067702 PROJECT=AdixOut` (f067702 = the SHA of UC-ADIX-009's prior `validated`
commit, in the AdixOut NESTED repo) failed immediately:
`fatal: bad revision 'f067702..HEAD'` — the tool ran `git -C <parent-worktree-root> diff
f067702..HEAD` against the PARENT repo, which has no knowledge of a SHA that only exists
in `work/AdixOut/`'s own nested git history. Identical root cause to the four prior hits,
now under the AdixOut worktree instead of OperationalFlowSimulator.

## Fallback taken (this validation)
Derived the test plan manually instead of mechanically:
- Read `work/AdixOut/architecture/dependencies/data-flow.mmd`'s `MAP` node (the sole
  `classDef changed` node this slice touches) to confirm scope = the mapper-only arrival
  `OperationTime` extension, matching UC-ADIX-010's own definition/acceptance text.
- Found `@covers` tags are not adopted ANYWHERE in this project's test suite (`grep
  "@covers"` across `src/app/tests` and `src/app/scripts` returns zero hits) — so even
  had the tool run, this project has no mechanical tick-off substrate yet. This is a
  SEPARATE gap from the git-root bug: the `@covers`-tag convention itself is unused here.
- Ran the full unit (143/143) + local (6/6) tiers, the two committed live probes
  (`probe-resync-arrival-mapping` for UC-009 regression, and a new
  `probe-resync-arrival-timing` authored this validation for UC-010), and a direct live
  message fetch, as the actual coverage evidence.

## Standing lesson (unchanged, now costed a 5th time)
IMP-007 remains `queued`, not built. Each recurrence costs one tester session's worth of
manual plan-derivation and forfeits the mechanical uncovered-node tick-off. Routing this
again: land IMP-007 (nested-`.git` resolution, already self-tested 14/14 per the 2026-07-11
entry) as a prioritised cicd build item, not another spec-and-park. Additionally: the
`@covers`-tag convention should be adopted retroactively in AdixOut's test suite (or an
explicit waiver recorded) so impacted-tests has something to match against once the
git-root fix lands.
