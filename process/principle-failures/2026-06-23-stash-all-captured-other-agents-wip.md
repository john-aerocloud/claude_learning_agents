# 2026-06-23 — git stash-all captured other agents' WIP and nearly lost committed learning

**Class:** commit-discipline failure under concurrent project-repo writers (§14).

## What happened
A ui-designer, needing a clean tree to `git pull --rebase` before pushing its own
file, ran `git stash` (stash-all). The working tree at that moment also held OTHER
agents' uncommitted changes — an engineer's DEFECT-OAG-014 WIP, the flow-manager's
`edge-ledger.md` (the UC1→UC2 false-edge RETIRED record + candidate rows), and other
bookkeeping. All of it went into the ui-designer's stash. The ui-designer committed
only its own file and moved on, leaving a stash the next agent didn't know to
restore. The `edge-ledger.md` learning was nearly lost and required manual recovery
(`git checkout stash@{0} -- …`) by the orchestrator.

## Why it's a deviation
§14 already mandates explicit-pathspec commits for concurrent writers. Stashing is
the same hazard one level up: `git stash` is tree-wide, so it sweeps everything
uncommitted — not just your change — into a place other agents won't look.

## Root cause
The pathspec-isolation rule covered `git add`/`git commit` but not `git stash`. An
agent reached for stash-then-rebase as the "clean" way to integrate, not realising it
captured peers' WIP.

## Fix (routed → process §14 commit discipline)
Never `git stash`/stash-all a shared tree to clear it for your own rebase. Commit
ONLY your explicit pathspec and `git pull --rebase --autostash` for just that staged
change; leave every file you do not own untouched. Targets gross lead time (no rework
recovering lost work) + CFR. Deeper remedy is per-agent worktree isolation for
genuinely concurrent seams (already a §14/§37 option).
