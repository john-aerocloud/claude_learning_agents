# IMP-009 — Faster validation execution (attack the tester constraint)

**Status:** queued (specced 2026-06-08, OI-45, human-directed "attack OI-45")
**Owner:** tester (selection + regression-core) / cicd (parallel config + exemption timing) / engineer (impacted-driven runner if code needed)

## Job
The tester is the named constraint (median ~1200s) and EXP-013's two clean
scores proved the cost is **execution-bound, not planning-bound**: AC count ×
two-browser runs × budget waits dominate; planning aids (IMP-007) don't move
the median. So the lever is validation EXECUTION time. Two compounding causes,
each with an investment we ALREADY made but haven't exploited:

1. **Serial-by-default (EXP-009 workaround).** WS-consuming specs were
   serialised because parallel workers exhausted the per-IP connect budget
   (20/5min) + WAF rate rule. But **IMP-008** (WAF runner-IP exclusion) and
   **s007a** (authorizer `EXEMPT#<ip>` item) now EXEMPT the runner IP from BOTH
   layers. The reason for serialisation is gone for the exempt IP — yet the
   suite still runs serial/conservatively. Re-enabling parallel validation
   for the exempt runner is a direct execution-time win.
2. **Full-suite-every-slice.** Every slice re-runs the whole accreting suite
   (s014 = 84 smoke tests for a chat change). The now-clean `make
   impacted-tests` (post-OI-42) lists exactly which specs a slice's model-diff
   impacts. That output should DRIVE which specs run — not just inform
   planning. Run IMPACTED specs + a pinned REGRESSION CORE, not everything.

## DORA target
Tester median task time (the constraint): target < 900s (from ~1200s).
Secondary: lead time (validation is on the critical path to delivery).

## Done condition
1. **Parallel validation under exemption (lever 1):** with the runner-IP
   exemption ACTIVE (the smoke-ci add/remove cycle), the smoke suite runs
   parallel workers without budget false-reds. cicd verifies the exemption
   covers BOTH the WAF rate rule AND the authorizer per-IP budget for the
   runner, then sets the smoke project's worker count accordingly. A run proves
   the previously-serial WS specs pass in parallel from the exempt IP.
2. **Impacted-driven selection + regression core (lever 2):** a `make
   validate-impacted SINCE=<sha>` (or equivalent) that runs the impacted-spec
   set from `make impacted-tests` UNION a small committed REGRESSION CORE
   (the critical-path smokes that must pass every slice regardless: a full
   online game, pairing, board geometry, identity-gate) — NOT the full suite.
   The tester owns defining the regression-core (the "always-run" set). A
   periodic/at-chunk-boundary FULL run remains (so unmarked-edge coverage gaps
   surface) — `make validate` (full) stays; `validate-impacted` is the
   per-slice fast path.
3. **Coverage honesty (the risk guard):** running impacted-only could miss a
   break outside the model's marked set (the §12a unmarked-edge risk). So:
   the regression core always runs; the full suite runs at chunk delivery; and
   any uncovered-changed-node from impacted-tests forces a spec (existing §12a
   rule). Document the guard; never silently narrow coverage without the core +
   periodic-full backstop (process §17 "no silent caps").

## Protection
The parallel config + the impacted-selection target are committed and tested;
the regression-core is an explicit committed list (reviewable). The periodic
full-suite run is the backstop. Scored on the actual tester median next 2
slices.

## Score
Next 2 slices with a model + exemption: tester median vs < 900s; zero prod
defects in an area that impacted-selection SKIPPED (if one occurs, the
regression-core/full-backstop was insufficient → rework). applies-to: any
slice whose validation runs the suite (i.e. all UI/backend slices).
