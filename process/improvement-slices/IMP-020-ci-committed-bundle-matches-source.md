# IMP-020 — CI guard: committed deploy bundles must match their source (bundle-freshness)

**Status:** QUEUED (2026-07-23, AdixOut v102 retro — REQ-005 Chunk B close).
**Owner:** cicd (a project-level `build-and-test` CI capability + a `make` target).
**Tracks:** the recurring OI-BUNDLE-DRIFT open-item.

## Problem
Committed `infra/assets/*.mjs` deploy bundles go STALE relative to their own
`src/app` source. Because `deploy-sst` re-bundles fresh at deploy time, a stale
committed bundle causes NO functional defect — but it is a git-hygiene gap that
produces confusing deploy-IDENTITY shifts. Recurrence (UC-ADIX-020): commit
`6a1c88a` carried a stale bundle; an incidental LATER commit regenerated it, which
triggered a mid-validation CI auto-redeploy from `6a1c88a` → `9212c9d`. No
functional impact (the fresh re-bundle was equivalent), but the deploy identity
shifted under validation for no source reason — confusing, and CFR/deploy-identity
noise. This is the tracked, recurring **OI-BUNDLE-DRIFT**: a stale committed bundle
is caught only by LUCK (an unrelated commit happening to regenerate it), not by a
gate at push.

## Proposed solution
A `build-and-test` CI check (and/or a `make` target, e.g. `make bundle-check`) that:
1. Rebuilds the deploy bundles from source (`make bundle-all`) into a scratch dir; and
2. FAILS if the committed `infra/assets/*.mjs` differ from the freshly-built output.

So a stale committed bundle is caught deterministically AT PUSH, not by luck, and the
committed bundle always corresponds to the committed source. (Alternatively, stop
committing generated bundles and build them in CI only — but the near-term ask is the
freshness GUARD, matching how the repo commits bundles today.)

## DORA target
CFR / deploy-identity noise — fewer confusing deploy-identity shifts and lower
CFR-noise from bundle drift. A push whose committed bundle drifts from its source is
caught at the gate, not surfaced later as an unexplained mid-validation redeploy.

## Done condition
- A committed CI step (in `build-and-test`) and/or a `make` target rebuilds the
  bundles and FAILS the push when the committed `infra/assets/*.mjs` differ from a
  fresh `make bundle-all`.
- The guard is deterministic (byte-identical or normalized-content comparison,
  reproducible build) so it does not false-positive on incidental build nondeterminism.
- Owned by cicd; wired into the same build/push gate as lint/test/audit.

## Score / metric
Target: fewer confusing deploy-identity shifts and less CFR-noise attributable to
bundle drift — 0 mid-validation auto-redeploys caused by a stale committed bundle that
this guard would have caught at push.

## Related cicd-capability gap
A SIBLING project-level cicd-capability gap was ALSO flagged (by the documenter): a
missing `make render-diagrams` target to (re)render architecture diagrams so committed
rendered diagrams cannot drift from their `.mmd` sources. Same shape as this bundle
guard — a committed generated artifact drifting from its source with no gate. Note
both here as cicd-capability gaps to close on this project.
