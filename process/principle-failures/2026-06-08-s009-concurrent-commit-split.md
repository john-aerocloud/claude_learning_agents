# Principle failure — s009 concurrent-commit split (ENGINEER-BACKEND)

**Date:** 2026-06-08  **Slice:** s009-arcade-scoreboard  **Agent:** engineer (backend)

## What happened
ENGINEER-BACKEND and ENGINEER-SPA committed to trunk at nearly the same instant.
A path-scoped `git add` + `git commit` from the backend agent interleaved with
the SPA agent's commit such that the backend's staged content (board/ lambda,
game-stack-s009.test.ts, class-deps.mmd backend nodes) landed UNDER the SPA
commit's message (752a483 "UC3 leaderboard display (SPA)"), while three backend
infra source files (game-stack.ts + two stale-pin test updates) were left
unstaged and did NOT land. Net effect: one commit on trunk whose message did not
match its contents, and a momentary RED tree at HEAD (game-stack-s009.test.ts
present without the game-stack.ts wiring it pins).

## Principle(s) breached
- "Commit when green / never leave trunk red." HEAD was briefly red between the
  racey commit and the roll-forward repair.
- Commit message must state intent matching the change — 752a483's message
  describes only SPA UC3 work but the commit also carries all backend board-fn
  code.
- §model: the class-deps.mmd dependency-edge update rode in a commit whose
  message does not name those edges.

## Root cause
Two engineers writing trunk in parallel with no working-tree isolation and no
serialisation on `git add/commit`. The file boundary was clean (disjoint source
trees) BUT the shared co-owned file `architecture/dependencies/class-deps.mmd`
plus simultaneous index operations on the same working copy created the race.
The wave plan isolated BUILD files but did not serialise the COMMIT step on the
single shared working tree / index.

## Recovery (roll-forward)
Committed the three missing infra files as 6895d80 with an intent message that
names the repair. HEAD verified green: infra 137, lambda 243, synth clean.

## Fix / prevention (for retro)
Parallel engineers sharing ONE working tree must serialise the `git add`+`commit`
critical section (a commit lock), or work in separate clones/worktrees and
integrate. The class-deps.mmd co-edit needs an append-only discipline or a
per-engineer section file merged at delivery. Flag to orchestrator: the wave
plan's "two engineers on trunk" needs a commit-serialisation rule, not just a
file-boundary rule.
