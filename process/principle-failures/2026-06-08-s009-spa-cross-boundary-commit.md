# Principle failure — ENGINEER-SPA committed files outside its boundary (s009)

- **Date:** 2026-06-08
- **Slice:** s009-arcade-scoreboard (iteration 14)
- **Agent:** engineer (ENGINEER-SPA)
- **Principle:** file-boundary discipline under parallel engineers; "Path-scoped
  git add … never add -A" (slice brief) + WIP independence (engineer.md §Parallelism).

## What happened

My UC3 commit `752a483` ("UC3 leaderboard display (SPA)") included, in addition
to my SPA files, the parallel ENGINEER-BACKEND's `src/lambda/board/**` (8 files)
and `src/infra/test/game-stack-s009.test.ts`. My boundary was
`work/oxo-online/src/app/**` + class-deps + ledger ONLY; I must not touch or
commit `src/lambda` / `src/infra`.

## Root cause

`git add <my paths>` is path-scoped, but `git commit` commits the WHOLE staged
index. The git index is SHARED process state. The backend engineer had already
`git add`-ed its board-fn files into the index in its parallel session; my
subsequent `git commit` swept them into my commit. Path-scoping the `add` does
NOT isolate the commit when another party has pre-staged files — the isolating
operation must be `git commit -- <pathspec>` (or `git stash` of foreign staged
changes), not just a scoped `add`.

## Impact

LOW / no work lost. The backend files were legitimate UC2 work; they landed
exactly once (not duplicated), the backend engineer's later commits (6895d80,
912eced, 7df19aa) build on them cleanly, and all pipelines (app deploy + infra)
went green. The only defect is attribution: backend files landed under an SPA
commit message instead of the backend engineer's intended UC2 commit. This is
the same concurrent-commit hazard already logged in
`2026-06-08-s009-concurrent-commit-split.md`.

## Fix forward (process)

When multiple engineers share a working tree, the committing engineer MUST scope
the COMMIT, not just the add:

    git commit -- <my-pathspec…>

so a co-worker's pre-staged files in the shared index cannot be swept in. Add
this to the parallel-engineer playbook (orchestrator/cicd) and consider a
pre-commit guard that rejects a commit touching paths outside the agent's
declared boundary. Worktree-per-engineer would remove the shared-index hazard
entirely and is the stronger structural fix.
