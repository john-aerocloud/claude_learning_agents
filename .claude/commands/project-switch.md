---
description: Resume a project — ensure its worktree exists and rebuild minimal context so work continues where it left off.
argument-hint: <project-name>
allowed-tools: Read, Write, Edit, Bash
---

Act as the **orchestrator**. Resume work on project **$1**.

> **Worktree-per-project (§0a).** A project is worked INSIDE its own worktree on
> branch `instance/$1`, not by flipping a shared pointer in this tree. "Switching"
> therefore means: make sure the project's worktree exists (un-parking its repo if
> it was stopped) and point the human at it. `work/ACTIVE` is per-tree and set there.

1. **Ensure the worktree.** `WT=$(make -s project-worktree PROJECT=$1)` — if the
   worktree is absent it is re-created on `instance/$1` and any parked project repo
   (from `/project-stop`) is moved back in; that tree's `work/ACTIVE` is set to `$1`.
   If no such project/branch/repo exists anywhere, run `make project-worktrees` +
   scan for parked repos, list what IS available, and stop (suggest `/project-new $1`).
2. **Read `$WT/work/$1/project.md`.** If status=stopped, set status=active and log the
   reactivation in `$WT/work/$1/decision-log.md`.
3. **Rebuild MINIMAL resume context** from the worktree — read only:
   - `project.md` (vision, status),
   - the tail of `decision-log.md` (last ~10 entries: gates passed, decision pending),
   - `chunks.md` (which chunk is in play),
   - the DERIVED work state — `$WT/work/$1/views/state.md` (each item's folded state)
     and `views/queues.md` (in flight / ready / rework) — the authoritative record of
     where work stopped. Prefer these over inferring progress from which artifact files
     exist.
   Do NOT load architecture or full slice history — the decision log + derived views
   are the resume mechanism.
4. **Report**: the worktree path, where the project stands (gate + work state), the next
   recommended command to run **in that worktree session** (`/requirement`,
   `/slice-next`, `/loop-run`, or `/retro`), and any human decision pending when work
   last stopped.

Resuming never destroys state. Nothing in `/process` changes. Because each project has
its own worktree + machine-local `work/ACTIVE`, this is invisible to any other running
instance — every instance drives its own project independently, in parallel.
