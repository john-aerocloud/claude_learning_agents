# 2026-06-18 — CI pipeline left stale after a framework migration

**Class:** continuous-deployment / migration-completeness, §19a (new), §14 commit
discipline. Founding evidence for EXP-062.

## What happened
OagEventSource migrated its deploy framework from CDK to SST v3 (delta-005): the
CDK `OagFeedStack` was destroyed and the stack redeployed on SST/Pulumi (deploy
row `8906d0d:sst-sandbox` — "CDK OagFeedStack destroyed + SST OagEventSource/
sandbox deployed"). But the CI deploy workflow `work/OagEventSource/.github/
workflows/infra.yml` was **never converted** — it still runs `npx cdk synth
OagFeedStack`, an "Install CDK dependencies" step, and a "Build CDK TypeScript"
step. The pipeline references a stack and a toolchain the project no longer uses.

Because all this session's deploys were done by hand (the repo's remote exists but
the pipeline was not exercised), the stale pipeline was **silently
non-functional** — it has never run and would fail on the first trigger.

## Why it's a deviation
1. A continuous-deployment project's pipeline is supposed to be the deploy path.
   A pipeline that would fail is a latent CFR failure dressed as working infra —
   the same misleading-asset class as a comment that describes misbehaviour
   (EXP-042), applied to a workflow.
2. The migration was treated as "re-platform the stack" when its true scope is
   "re-platform the DEPLOY MECHANISM" — which includes the CI/CD pipeline and the
   deletion of the dead path. Deferring the pipeline conversion indefinitely is
   exactly the deferral §19a now forbids.

## Root cause
No rule said the CI/CD conversion + dead-path deletion is part of a framework
migration's done-condition. The migration slice shipped the new stack and left
the old pipeline in place, with no failing check to surface the gap (the by-hand
deploys masked it).

## Fix (routed → cicd + architect, EXP-062 / process §19a)
- **process §19a (new, v58):** a framework migration's done-condition INCLUDES
  converting the CI/CD pipeline to the new framework and deleting the dead deploy
  path, in the migration slice — never deferred. The converted pipeline is proven
  via the EXP-056 pre-flight + the §40 walking-skeleton probe.
- **cicd.md (Framework migration completes the pipeline):** cicd rewrites the
  workflow to the new framework's deploy command, updates path triggers + role,
  and deletes the dead steps in the same change.
- **solution-architect.md (migration delta):** the architect's migration delta
  names the pipeline conversion as part of the delta.
- **OI-007 (open-items):** the OagEventSource infra.yml conversion is scheduled as
  a HIGH open item — the standing instance of this class to close.

Targets CFR (a non-functional CI deploy path is a latent failure) + deployment
frequency (a working pipeline replaces by-hand deploys).
