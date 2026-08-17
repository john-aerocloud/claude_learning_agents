# A branch switch in a SHARED checkout silently destroyed another agent's green trunk commit

**Date:** 2026-08-14 · **Project:** ROC · **Items:** UC-ROC-092 (engineer), DEF-ROC-024 (cicd)
**Class:** parallel-agent isolation. Sibling of the shared-index sweep family
(`git add` + bare commit), but a strictly WORSE failure mode: the sweep merges work,
this one LOSES it.

## What happened

Two agents were live in one project checkout (`work/ROC`, a standalone repo inside the
`ROC` worktree). The engineer built UC-ROC-092 and committed it green — `git -C work/ROC
commit -- <pathspec>`, 129/129 tests, lint clean, `tsc` clean. Believing it was on trunk,
the engineer moved on to `wi-append`/`wi-project`.

Meanwhile the cicd agent was probing CI concurrency for DEF-ROC-024 by **creating and
checking out branches in that same shared checkout** (`probe/cicd-concurrency-crossbranch`,
`fix/def-roc-024-concurrency-ref`). Consequences, in order:

1. At the moment the engineer committed, `HEAD` was on **cicd's probe branch**, not `main`.
   The UC-ROC-092 commit (`77e47d4`) landed as the tip of a throwaway probe branch.
2. cicd then checked out its other branch. That **reverted the engineer's source files in
   the working tree and deleted the new test file** — the working tree kept no trace of
   the work at all.
3. `git log`/`git status` looked entirely normal to both agents. The engineer discovered it
   only because a tool-side file-state notice showed `run.ts` back at its pre-change
   content. Nothing in the commit-then-verify discipline catches this: the commit
   SUCCEEDED, and `git ls-files` on the new path returned it — on the wrong branch.

Recovery (engineer, ~15 min): `git worktree add <scratch> main` → `cherry-pick 77e47d4` →
re-run suite/lint/build against the exact `main` tree → re-append the work-item events with
the true trunk sha (the first `built_green` ref pointed at a commit reachable only from a
probe branch that was about to be deleted) → commit the item/views on `main` in the temp
worktree → remove it. Nothing was lost, but only because the revert happened to be noticed
within minutes and the commit object was still in the reflog.

## Which principle was broken

- **CLAUDE.md §0a / worktree-per-project:** a working tree holds ONE `HEAD` and one index,
  which is exactly why concurrent sessions get separate worktrees. The rule was written for
  Claude *instances*; it applies just as much to two **agents inside one instance** sharing a
  checkout. cicd already knew this — it had its own `scratchpad/roc-gate/db-*` worktrees for
  the Dependabot gate — and then switched branches in the shared checkout anyway.
- **Trunk-based development:** work must land on trunk. It cannot, if `HEAD` is not on trunk
  when you commit.
- **Engineer commit discipline** verifies "is the file tracked / not ignored" (v89, DEF-ROC-001)
  but never "am I on trunk" — a real gap in that check.

## Cheapest fix (in order)

1. **Never switch branches in a shared checkout.** Any agent needing a non-trunk ref uses
   `git worktree add` (cicd's own gate already does this) — branch experiments included.
   CI-behaviour probes are the exact case that tempts a bare `checkout`.
2. **Assert the branch before committing.** Add to the engineer/cicd commit step:
   `git -C work/<project> rev-parse --abbrev-ref HEAD` must equal the trunk recorded in
   `project.md` — otherwise stop and flag. Two seconds, and it turns a silent loss into a
   refusal. Worth folding into a `make wi-commit`-style helper so the check cannot be skipped.
3. **`built_green --ref` should be on trunk.** A ref reachable only from a side branch is a
   dangling audit trail. Re-fire the event with the trunk sha rather than hand-editing the
   note (the machinery stays the sole writer).
