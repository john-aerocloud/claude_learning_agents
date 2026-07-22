# IMP-018 — CI pipeline emits the `deployed` wi-event itself

**Status:** QUEUED (2026-07-22, AdixOut v94 retro — UC-ADIX-015 stall)
**Owner:** cicd (pipeline assets) + work-item machinery (a CI-callable append entry point)

## Job
Under pipeline-triggered (push→CI) deploys, no agent runs an interactive
`sst deploy`, so no agent fires the `deployed` wi-event automatically. A UC then
sits in `deploying` although its infra is applied-and-green, blocking the tester
(UC-ADIX-015, principle-failure
`2026-07-22-uc-adix-015-missing-cicd-deployed-event-blocks-tester.md`). The v94
fold made the ORCHESTRATOR fire the CI-confirmed `deployed` after confirming the
pipeline deploy landed green (cicd.md + loop-run.md) — a correct but MANUAL
bridge that depends on an operator noticing the green run. Make the pipeline emit
the event itself so the orchestrator step becomes unnecessary.

## DORA target
Tester lead time / cycle time — a UC never stalls in `deploying` waiting for a
human to notice CI went green; the `deployed` event lands the moment the deploy
job succeeds. Secondary: CFR integrity — the paired `deploy_failed` on a red CI
deploy is emitted the same mechanical way (no reliance on an operator recording it).

## Done condition
The CD deploy job, on a GREEN apply, appends the item's `deployed` event itself
(`AGENT=cicd`, `REF=<deployed sha>`, `NOTE` citing the CI run id/URL) via a
CI-callable path into the work-item machinery — and on a RED apply appends
`deploy_failed` the same way. Requires: (a) the deploying job knows the UC id it
is deploying (carried from the triggering commit/PR or a deploy manifest); (b) a
committed, credential-light CI entry point that runs the launcher against the
project's item files and commits the append to the project repo; (c) the
orchestrator/loop-run + cicd bridge note is then RETIRED (the manual step is
removed once the pipeline emission is proven).

## Protection
A pipeline dry-run / fixture that asserts: a simulated green deploy job produces
exactly one `deployed` event for the target UC id with the run reference; a
simulated red deploy job produces exactly one `deploy_failed`; neither double-fires
on a re-run. Runs in CI without cloud credentials.

## Score
At the next retro with a pipeline-deployed UC: count UCs that stall in `deploying`
awaiting a manual `deployed` (target 0) and confirm the orchestrator no longer
hand-fires `deployed` for pipeline deploys. Relates to EXP-108 (deploy_failed
integrity) — the same CI-callable path emits both events.
