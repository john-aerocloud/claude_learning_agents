# Architectural principle — version-identifiable deployments

**Every deployable surface exposes its build identity (the commit sha it was
built from), mechanically readable at the surface itself.** Human-directed,
2026-06-06.

| Surface | Carrier |
|---------|---------|
| Web page / SPA | response header (e.g. `x-build-sha`) and/or a meta tag / config field readable in the page |
| HTTP / WS API | response header on every response; error frames may carry it too |
| Function / job | structured log field on every invocation; env var set at deploy |

## Why

Deploy-timing problems — stale CDN edges, propagating invalidations, racing
pipelines, half-rolled deploys — present as BEHAVIOURAL failures unless the
observer can ask "which build am I actually talking to?". With version
identity exposed:

- **Validation asserts identity before behaviour.** The tester (and the
  pipeline's own smoke) first checks served-sha == sha-under-test; a mismatch
  is categorised as a deploy-timing/distribution condition, not a behavioural
  failure — no false-negative red runs, no false MTTR clocks.
- **Support can attribute** "old behaviour" reports to version skew instantly
  (runbook line: check the header).
- Mixed-version states (SPA new, Lambda old) become observable instead of
  inferred.

Evidence: a production-correct deploy produced a red smoke run because the
check raced CloudFront invalidation; the result was indistinguishable from a
real regression without version identity (DEFECT-005-001 re-validation, oxo).

## Mechanics

- The PIPELINE injects the sha at build/deploy time (build-arg/define for
  bundles, env for functions, header via the serving layer); never hand-set.
- The TESTER's first assertion in any live validation is the version check;
  on mismatch: wait/retry within a bounded window, then categorise as
  distribution failure — never report behaviour against an unverified build.
- The version value is the ledger's `sha under test` — closing the loop
  between validation_run rows and what actually served.

Owners: solution-architect (every delta states the carrier for each new
surface), cicd (injection + smoke gating), engineer (implementation),
tester (identity-before-behaviour), documenter (runbook: where to read it).
