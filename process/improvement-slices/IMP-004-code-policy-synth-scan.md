# IMP-004 — Code↔policy synth scan

**Status:** DECLINED (v176 retro, ROC 2026-09-14) — AWS IAM/policy-synth shaped, opened 2026-06-06 and unpulled for 100 days. ROC is Azure-native by contract (Terraform, no IAM synth surface), so ROC cannot build or score it, and no other project has pulled it in three months. Declined rather than left QUEUED because an item no one can pull is not a queue, it is a filing cabinet. REVISIT TRIGGER: a project with an AWS policy surface adopts it and re-opens under its own id.
**Owner:** engineer (build) / solution-architect (action-set source of truth)

## Job
Least-privilege IAM correctly broke production when handler code drifted to an
ungranted action (UpdateItem on a Put/Delete-only grant). Tests asserted what
roles GRANT; nothing asserted what code NEEDS. Manual per-handler pins now
exist (s005 R2) but rely on engineers remembering.

## DORA target
CFR — eliminates the code↔policy drift class mechanically.

## Done condition
A synth-time check (test or script in the infra suite) that extracts the SDK
commands each handler issues (static scan of imported *Command classes per
handler entry point) and asserts they are a subset of the actions granted to
that function's role in the synthesised template. Red when code uses an
ungranted action OR a grant goes unused (over-grant flagged as warning).

## Protection
Pure static analysis at synth; no runtime, no credentials. Runs in
make test-infra.

## Score
Zero AccessDenied-class prod failures after adoption; the s005 drift case
re-created as a fixture must go red.
