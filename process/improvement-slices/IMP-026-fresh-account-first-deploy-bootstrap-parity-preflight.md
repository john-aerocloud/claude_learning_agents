# IMP-026 — fresh-account first-deploy bootstrap-parity preflight

**Status:** QUEUED (owned by cicd — a committed executable preflight + its self-tests)
**Opened:** 2026-07-30 (AdixOut v121 retro — founding EXP-119)

## Problem
A first-ever deploy into a fresh AWS account fails on missing create-permissions for account-level
singletons AWS/SST/EventBridge lazily provision on first use (the `sst-asset` ECR repo; service-linked
roles). dev masks these because dev created them long ago, so dev-green + local synth-pin both pass and
the gap only surfaces as a failed prod deploy (AdixOut UC-AIDX-039: ECR `CreateRepository`; DEF-AIDX-009:
EventBridge API-destinations SLR). Today the guard is the cicd.md written practice (v121) — memory, not
an executable gate; the v121 fixes were applied by hand after the failures.

## Proposed change
A committed `make first-account-preflight STAGE=<s>` (or equivalent script) that, from the stack's
own IaC, ENUMERATES the first-use auto-provisioned resources implied (SST/CDK asset store: S3 asset
bucket + `sst-asset` ECR repo; every AWS service used that provisions an SLR on first call) and ASSERTS
the target account's deploy role AND relevant runtime exec roles grant their creation — failing RED,
with the exact missing grant, BEFORE the deploy runs. Runs automatically as the first step of a
first-ever deploy into an account (detect "SLR/asset repo absent" ⇒ first-account) and is available
manually for promotions. This makes EXP-119's practice a self-healing check, the same way EXP-096 made
per-stage policy re-apply a check rather than a "remember to run bootstrap" note.

## Target metric
CFR on first-account deploys + deploy MTTR — 0 first-account deploys fail on a missing create-permission
for a first-use resource once the preflight is wired.

## Notes
Sibling of `bootstrap-deploy-role.sh` (EXP-094/096). Scope the SLR grants exactly (ARN +
`iam:AWSServiceName` condition, never `*`). Reuse the existing synth to derive the resource set so the
preflight never drifts from what the stack actually provisions.
