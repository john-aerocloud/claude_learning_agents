---
description: Create a new project workspace (in its own worktree) and kick off the new-requirement workflow.
argument-hint: <project-name> [one-line problem statement]
allowed-tools: Read, Write, Edit, Bash, Task
---

Act as the **orchestrator** (`.claude/agents/orchestrator.md`). You regulate flow
only — dispatch specialists for all product/arch/eng decisions.

Project: **$1**. Problem statement: $ARGUMENTS

> **Worktree-per-project (§0a).** Every project lives in its OWN git worktree on
> branch `instance/$1`, a sibling of this integration tree. You do NOT scaffold a
> project into the integration tree's `work/` — you create its worktree and
> scaffold inside it. The worktree lifecycle is owned by
> `.claude/scripts/worktree` via the `make project-*` targets — never hand-assemble
> `git worktree` commands.

1. **Ensure the worktree.** `WT=$(make -s project-worktree PROJECT=$1)` — creates
   the worktree at `../$1-worktree` on branch `instance/$1` (off `main`) if absent,
   moves any parked repo back in, sets that tree's machine-local `work/ACTIVE=$1`,
   and prints the path. Idempotent. Use `$WT` as the project tree for everything
   below (operate with absolute paths / `git -C "$WT/work/$1" …`).
2. **Scaffold the project INSIDE the worktree.** Copy `$WT/work/_TEMPLATE/` to
   `$WT/work/$1/`. Set `project.md` status=active, created=today, owner. Scaffold the
   event-sourced substrate (CONTRACT.md): item store `$WT/work/$1/items/{active,done}/`
   (empty) + derived-view dir `$WT/work/$1/views/` (populated on first `make wi-project`).
   Init the project's own git repo: `git -C "$WT/work/$1" init` (each project is a
   standalone repo, v50) and commit the kickoff scaffold.
3. **Log the kickoff** in `$WT/work/$1/decision-log.md`. (`work/ACTIVE` in the
   worktree is already set by step 1.)
4. **Hand off to the requirement gate.** The requirement workflow (`/requirement $1`)
   is INTERACTIVE (discovery loops with the human for dossier sign-off), so it runs
   **inside the project's worktree session**. Tell the human: open a session in `$WT`
   (`cd "$WT"`) and run `/requirement` — vision → dossier sign-off → architecture →
   chunks → capabilities, honouring the gates. Do not proceed past a gate without
   logged human sign-off.

**Fold-back reminder (§0a).** Process/agent-system improvements made during the
project's retros land on `instance/$1`; reintegrate them by running
`make project-foldback PROJECT=$1` from THIS integration tree (on `main`). Only the
process layer merges — `work/*` is gitignored, so no project output ever rides along.

End by reporting: the worktree path, the branch, that the scaffold is committed, and
the exact next step for the human (open the worktree session, run `/requirement`).
