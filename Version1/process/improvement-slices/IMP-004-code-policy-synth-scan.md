# IMP-004 — Code↔policy synth scan

**Status:** queued (specced at s005 retro, 2026-06-06)
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
