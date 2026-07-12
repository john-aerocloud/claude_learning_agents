# Infra pushed green-locally, red-in-CI (2026-07-12)

**Project:** OagEventSource, UC-XA2 (cross-account bus grant). **Class:** deploy-failure
(CFR incident), self-recovered by fix-forward.

## What happened
The engineer's first push (`ec56025`) turned the **infra (SST) CI pipeline red**. CI
auto-deploys infra changes to sandbox; the local `sst deploy` had failed (EventBridge
`PutPermission` rejected the placeholder principal ARN), but the engineer pushed on the
strength of green **unit + lint**, judging the offline increment sound. Fixed forward
immediately (`76a7e58`, guard so the grant only synthesizes with a real role → clean
fail-closed deploy). No lasting breakage, but the shared pipeline went red.

## Root cause (why-chain)
- WHY did CI go red? An infra statement that passed offline shape-tests was rejected at
  the AWS API on deploy.
- WHY wasn't that caught pre-push? The push-on-green done-condition was **unit + lint** —
  it did not include the synth/deploy step that CI actually runs for infra changes.
- WHY does that matter? For infra-bearing changes, CI auto-deploys, so "green" locally
  without a synth/deploy is not the same green CI enforces. Unit + lint is necessary but
  not sufficient. Same family as v84's finding and the 2026-06-23 false-green class:
  "green in the cheap check ≠ correct where it matters."

## Guard routed (retro v86)
- **process-current.md §14 [EXP-107]** — infra-bearing push gate: a change touching
  `sst.config.ts`/`infra/`/IaC/deploy-role policy is not push-green on unit+lint alone; the
  pre-push done-condition MUST include `make deploy-sst` (or `sst diff`/synth) passing.
- **engineer.md** — the same, woven into the push-when-done step (run the synth/deploy gate
  before pushing infra; `make deploy-sst` already exists locally and did surface it — the
  miss was gating on it).

## Note
`built_green` was recorded at `ec56025` (the failed push); the actual green+deployed sha is
`76a7e58`. The retro-debt counter did not auto-trip (no failure event was logged — the
engineer fixed forward under `built_green`), so this retro was triggered by the human
noticing the incident, not the gate. Secondary lesson: a fix-forward deploy-failure should
still leave a trace the §F8 counter can read — but keep that observation here rather than
over-engineering the counter this cycle.
