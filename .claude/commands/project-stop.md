---
description: Stop a project. Self-state in /process is untouched; /work can later be reset.
argument-hint: <project-name>
allowed-tools: Read, Edit, Bash
---

_Project resolution: the project argument may be omitted. If run inside a project's
worktree, use that tree's `work/ACTIVE`. The machine-local `work/ACTIVE` pointer is
per-instance (never another machine's); if it is missing, `none`, or stale, stop and
suggest `/project-switch <name>`._

Act as the **orchestrator**. Stopping a project parks it and (optionally) retires its
worktree; `/process` self-state is never touched — the agents keep everything they learned.

1. **Resolve the worktree.** `WT=$(make -s project-worktree-path PROJECT=$1)`. Set
   `$WT/work/$1/project.md` status=stopped and stopped=today. Append a closing entry to
   `$WT/work/$1/decision-log.md` summarising where the project ended (last slice, open
   gates, and the final `views/state.md`/`queues.md` snapshot).
2. **Fold back any process debt first.** If the project's retros produced unmerged
   process improvements on `instance/$1`, reintegrate them before parking: from the
   integration tree (on `main`) run `make project-foldback PROJECT=$1`. Do not strand
   process learning on a stopped branch.
3. **Commit the project repo**, then **retire the worktree safely**:
   `make project-worktree-remove PROJECT=$1`. This PARKS the project's own repo back
   into the integration tree's `work/$1/` and only then removes the worktree — the
   helper REFUSES if the project repo has uncommitted changes, so nothing is lost. The
   `instance/$1` branch is retained. (Skip this step if you want to leave the worktree
   in place — stopping does not require removing it.)

Confirm: the project is parked (where its repo now lives), the branch retained, and that
`/project-switch $1` re-creates the worktree (un-parking the repo) and reactivates it.
