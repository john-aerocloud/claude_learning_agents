---
description: Create a new project workspace and kick off the new-requirement workflow.
argument-hint: <project-name> [one-line problem statement]
allowed-tools: Read, Write, Edit, Bash, Task
---

Act as the **orchestrator** (`.claude/agents/orchestrator.md`). You regulate flow
only — dispatch specialists for all product/arch/eng decisions.

Project: **$1**. Problem statement: $ARGUMENTS

1. Copy `work/_TEMPLATE/` to `work/$1/`. Set `project.md` status=active, created=today.
   Ensure the event-sourced work-item substrate is scaffolded (CONTRACT.md):
   the item store `work/$1/items/active/` + `work/$1/items/done/` (empty) and the
   derived-view dir `work/$1/views/` (populated on the first `make wi-project`).
2. Open `decision-log.md` and record this kickoff. Write `$1` to
   `work/ACTIVE` — a new project becomes the active one.
3. Run the new-requirement workflow (`/requirement-new $1`): JTBD vision ->
   target architecture -> Chunks -> required capabilities. Honour the gates; do not
   proceed past a gate without logged human sign-off.

Stop at the first gate (product vision) and surface it for sign-off.
