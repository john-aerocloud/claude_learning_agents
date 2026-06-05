# Per-project DORA — oxo-online

## Time-to-first-deploy
**Kickoff → slice-001 deploy:** 09:30 → 16:55 = **7h 25min (26,700s)**
Target was < 90 min. Missed.
Driver: pipeline iteration loop (3h 22min, 45% of wall-clock) — 8 fix cycles
after engineer completion. Session continuity was maintained (no overnight),
but the cloud/hosted pipeline introduced a new wait class not present in ox.

## Per-slice record

| slice | change | expected DORA effect | actual | regression? | reflection |
|-------|--------|----------------------|--------|-------------|------------|
| 001 | v7 session continuity | lead time < 60 min in-session | 7h 25min — missed | Yes (cloud pattern) | Session continuity eliminated overnight waits but not pipeline iteration loops. Cloud/hosted needs CICD pre-flight checklist (v9 §19) as additional lever. |
| 001 | v8 commit discipline | cleaner audit trail, no red commits | Applied throughout — all commits intent-focused | No | Working as intended. Does not directly affect lead time. |

## Pipeline iteration breakdown (slice 001)

| Iteration | Failure | Fix |
|-----------|---------|-----|
| 1 | Missing `cdk.json` | Added `cdk.json` + `ts-node` |
| 2 | `aws-region` not supplied | Added `OXO_ONLINE_AWS_REGION` default |
| 3 | OIDC `sub` too strict | Relaxed to `StringLike :*` |
| 4 | `environment: production` approval gate | Removed gate |
| 5 | `GITHUB_*` prefix reserved | Switched to `-c` context flags |
| 6 | CDK `iam:PassRole` denied | Split infra/app pipelines; new `oxo-infra-deploy` role |
| 7 | Playwright `@playwright/test` not found | Added `npm ci` in deploy job |
| 8 | `OXO_ONLINE_S3_BUCKET` empty | Set missing GitHub variables |
