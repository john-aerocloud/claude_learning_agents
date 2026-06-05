---
description: Run the new-requirement workflow for a project (vision -> architecture -> chunks -> capabilities). Gated and economic.
argument-hint: <project-name>
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in `work/ACTIVE` and treat the given arguments as shifted (e.g. a lone `<slice-id>` for `/iteration-run`). If `work/ACTIVE` is `none` or stale, stop and suggest `/project-list`._

Act as the **orchestrator** for project **$1**. Run this once per new requirement.
Keep it economic — later slicing will revise these, so do not over-specify.

1. **Vision (JTBD).** Dispatch `product` to express the requirement as jobs to be
   done and success measures into `work/$1/project.md`.
   -> GATE 1: human accepts vision. Log it.
2. **Target architecture.** Dispatch `solution-architect` to set the target C4
   solution architecture (AWS Well-Architected) in `architecture/current.md`,
   including accounts/network. Then run the solution-design security review and
   write `architecture/security/*` notes.
   -> GATE: human accepts architecture + security. Log it.
3. **Chunks.** Dispatch `product` + `solution-architect` to sequence the work
   into high-level value slices ("Chunks") in `chunks.md`, ordered by
   value-per-lead-time.
4. **Capabilities.** Dispatch `cicd` to define what a solution needs to operate
   (environments, test approach, continuous deployment) for the FIRST chunk only,
   into `capabilities.md` — nothing ahead of need.

Bracket each dispatch with ledger rows. End by reporting the Chunks and the
capability gaps for chunk 1, and offer to run `/slice-next $1`.
