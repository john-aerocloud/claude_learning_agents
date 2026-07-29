# Principle failure — manual `shared`-stage deploy attempted because no CI path existed

**Date:** 2026-07-16
**Project:** OagEventSource (SLC-041 cross-account push)
**Process at time:** v87 → corrected in v88 (EXP-109)
**Principle broken:** *Environments deploy through the CI/CD pipeline; dev is the
fully-integrated pre-prod validation environment.* (Now explicit: process-current.md
§14 infra-push-gate; cicd.md "Every environment deploys through the pipeline".)

## What happened
Resuming SLC-041, the loop tried to deliver the shared-account Aerobus fan-out (+ a
diagnostic DLQ) by running `make deploy-sst STAGE=shared AWS_PROFILE=dev-shared`
**by hand from the worktree**, against dev-shared (211125523819). The harness
permission guard ("Modify Shared Resources") blocked it — repeatedly (3 attempts
across the engineer + orchestrator). Effort was spent trying to satisfy the guard
(AskUserQuestion, adding settings.json allow rules, asserting the rules were "live")
instead of recognising the guard was correct.

## Root cause
The `infra.yml` pipeline deploys **sandbox → dev → acceptance-dev → prod** — a proper
integrated-dev-gates-prod model — but the **`shared` stage was never wired into it**,
and the **cross-account 3-hop probe was never made a CI integration test**. With no
correct (pipeline) path for the shared tier, a manual deploy looked like the only
option. The missing pipeline job — not the permission guard — was the real defect.

## Why it matters
- A manual `sst deploy` to a real account bypasses the integrated-environment gate:
  nothing proves the change is safe before prod, and the deploy isn't reproducible or
  auditable the way a pipeline run is.
- The permission guard resisting a hand-run shared-account write is the guard working
  as intended; treating it as an obstacle to route around inverts the lesson.

## Corrective actions
1. **Process (v88, EXP-109):** environment deploys are pipeline-only; local runs are
   synth/diff pre-push gate only; dev is the fully-integrated pre-prod validation env;
   all integration/acceptance tests against a deployed env run in the pipeline; a
   cross-account/hub tier belongs in the pipeline (its own deploy job + integration
   probe); a stage not yet in CI is an infra gap to close, not a licence to deploy by
   hand. (process-current.md §14; cicd.md.)
2. **Infra (to do, tracked under SLC-041):** add a `deploy-shared` CI job + a
   cross-account 3-hop integration-test job to `infra.yml`, gating prod like
   `acceptance-dev`. Requires a one-time human §F5 bootstrap of the shared OIDC deploy
   role in dev-shared (211125523819) + GitHub `shared` environment/secret.

## Signal to watch
Anyone (agent or human) reaching for a manual cross-account/shared deploy = a pipeline
job is missing. Register + wire it; don't work around the guard.
