# Principle failure: impacted-tests blind to project sub-repo dependency model updates

**Date:** 2026-06-24
**Slice:** DEFECT-OAG-025
**Agent:** tester
**Principle:** Process v16 §35 IMP-001 / tester plan-from-the-change-map

## What happened

`make impacted-tests SINCE=5104d18 PROJECT=OagEventSource` reported "No changed/added/removed nodes" — exit 0 — even though commit `36916ed` in the project sub-repo (work/OagEventSource) had updated `architecture/dependencies/class-deps.mmd` to mark `normaliser-core` as `:::defect025changed`.

The impacted-tests tool diffs `work/<project>/architecture/dependencies/*.mmd` using `git -C <ROOT> diff <since>..HEAD`, where ROOT is the parent agent-system repo. But the project output lives in its own independent git repo under `work/OagEventSource/` and the parent `.gitignore` excludes `/work/*/`. So the parent repo HEAD at `5104d18` has no knowledge of changes committed in the project sub-repo — the diff is always empty from the parent's perspective.

The tester instruction says: "If the model diff is empty but code clearly changed behaviour, that is an updated-in-commit principle failure — log it and derive your plan from the code diff instead." The code clearly changed (normaliser-core.ts, 41 lines), the class-deps.mmd was updated in the project sub-repo, and the test-plan was derived from the code diff. This worked, but only because the tester knew to check.

## Root cause

Two git repos, one tool. `make impacted-tests` only knows the parent repo's history. Project-level architecture model updates are invisible to it.

## Impact

The change map for DEFECT-OAG-025 was empty from the tool's perspective, requiring manual fallback to code diff. This is recoverable but it is a process friction point and could cause a tester to miss scope if they relied solely on the tool output without the fallback rule.

## Remediation options

1. **Extend impacted-tests to also diff the project sub-repo** using `git -C work/<project> diff <since>..HEAD -- architecture/...` when the parent diff is empty and the project has its own repo. The tool would need to handle the case where `<since>` is a project-repo SHA, not a parent-repo SHA.
2. **Document the SINCE semantic**: make it explicit that SINCE is always a parent-repo SHA; project-level dep model changes need a separate lookup or a project-level `make impacted-tests` variant.
3. **Require architecture model changes to be mirrored in the parent repo** — but this violates the two-repo boundary (process §14).

Option 1 is the least disruptive. Until fixed, the fallback rule (code diff when model diff is empty) is the tester's safety net.
