# 2026-07-30 — AdixOut first prod deploy: fresh-account first-use bootstrap gaps (dev masked them)

**Principle stressed:** dev-first / "acceptance before prod" (a green dev deploy should de-risk prod);
least-privilege deploy/exec roles must be *complete* for the target account.

## What happened
AdixOut's first-ever deploy into a fresh prod account (`prod-dataout` 616963375937, UC-AIDX-039)
failed on missing IAM create-permissions for account-level singletons AWS/SST/EventBridge lazily
provision **on first use** — and did so TWICE in one session:

1. **ECR bootstrap** — `sst deploy --stage prod` → `AccessDeniedException: ecr:CreateRepository`
   on `repository/sst-asset` (SST v3 Ion provisions an `sst-asset` ECR repo on first deploy). The
   deploy-role policy had no ECR grant. (run 30537306744)
2. **EventBridge service-linked role** — first prod webhook onboarding → "Failed to create service
   linked role because the caller does not have sufficient permissions": the onboarding EXEC role
   lacked a scoped `iam:CreateServiceLinkedRole` for `AWSServiceRoleForAmazonEventBridgeApiDestinations`,
   which did not yet exist in the fresh account. Shipped as prod defect **DEF-AIDX-009**, caught only
   by live prod validation.

A related third miss: a committed probe pushed with an unused-var **eslint** error bounced CI twice
because `lint` was not in the author's local pre-push gate.

## Root cause
Both bootstrap gaps were **invisible in dev**: dev created those singletons (the ECR asset repo, the
SLR) long ago and stopped exercising the *create* path, so dev-green + local synth-pin both passed.
"Green in dev" does not prove a fresh account will deploy, because the fresh account must CREATE
first-use resources the deploy/exec roles were never granted to create. This is a distinct gap from
EXP-094 (policy verb-completeness) and EXP-096 (policy applied-per-stage): the content can be complete
AND applied, yet still omit the first-use creates that only a fresh account exercises.

## Remedy (v121)
- **cicd.md** — new practice: before any first-ever deploy into a fresh account, audit BOTH the deploy
  role AND every runtime exec role for the create permissions of the first-use resources the stack
  implies (SST/CDK asset store incl. the `sst-asset` ECR repo; a scoped `iam:CreateServiceLinkedRole`
  for every AWS service the app uses that lazily creates an SLR — ARN + `iam:AWSServiceName` condition,
  never `*`). Grant in BOTH stages' policy source for fresh-account self-heal + dev↔prod parity.
  Tracked as **EXP-119** (target: CFR on first-account deploys + deploy MTTR).
- **IMP-026** — an executable preflight so this is a committed gate, not memory.
- **Local pre-push gate must include `lint`** — folded into cicd/engineer practice; the local gate
  before any push runs lint + typecheck + unit + synth-pin, matching CI's build-and-test job.
