# Principle failure (RECURRING): impacted-tests still mis-resolves the project git root

**Date:** 2026-07-11
**Project:** OperationalFlowSimulator
**Agent:** tester (hit it), cicd (owns the tool)
**Principle:** §12c read-before-test / §5b (a recurring root cause is a system failure to smooth it)
**Prior entries:** 2026-06-24-impacted-tests-blind-to-project-subrepo-dep-model.md; EXP-077 → IMP-007 (still `queued`)

## What happened (recurrence)
`.claude/tools/impacted-tests.js` / `make impacted-tests` resolves the git root to
`process.cwd()` — the parent/integration repo. Under the v50 nested-repo + v0a
worktree-per-project topology, the project is its OWN nested git repo under
`work/<project>/`, so any project SHA passed as `SINCE` fails with `fatal: bad revision`.
This hit the tester on **UC-A3, UC-A4, UC-A5, and UC-E3 — four slices this session** — each
time forcing a manual fallback and losing the mechanical change-impact coverage assurance.

This is a **recurrence** of the 2026-06-24 finding. EXP-077 was registered and IMP-007
specced to fix it, but IMP-007 was never built (status `queued`), and the tester's
hand-derived fix this session (detect the nested `.git` under `work/<project>` and diff
from it — **all 14 self-tests pass with it**) was reverted as parent-repo-out-of-scope for
the build loop.

## Root cause (≥3-level)
1. The tool hard-codes `root = process.cwd()` (the parent repo) as the diff base.
2. The project's architecture model + SHAs live in the nested project repo, invisible to
   the parent repo (parent `.gitignore`s `/work/*/`).
3. The fix was correctly diagnosed a first time but parked as a *spec* (IMP-007 `queued`)
   instead of being LANDED — a specced-but-unbuilt improvement is not protection; it
   recurred at the same cost until built.

## Remediation (routed this retro)
- Re-open **EXP-077 → under-question**, tied to landing the nested-repo resolution.
- **Augment IMP-007** with the concrete nested-`.git` resolution fix the tester already
  proved (14/14 self-tests) and route the BUILD to **cicd** (tool owner, §16.3) as a
  prioritised loop item — a proven, self-tested fix must be landed, not re-specced.

## Standing lesson
A capability gap diagnosed once and specced-but-not-built will recur at full cost every
time its predicate matches. When a fix is already proven (self-tests green), the retro
routes the BUILD, not another spec. Target: tester lead time + CFR (restored impact coverage).
