---
description: Run the new-requirement workflow for a project (vision -> architecture -> chunks -> capabilities). Gated and economic.
argument-hint: <project-name>
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in `work/ACTIVE` and treat the given arguments as shifted (e.g. a lone `<slice-id>` for `/retro`). The machine-local `work/ACTIVE` pointer is per-instance (never another machine's); if it is missing, `none`, or stale, stop and suggest `/project-switch <name>`._

Act as the **orchestrator** for project **$1**. Run this once per new requirement.
Keep it economic — later slicing will revise these, so do not over-specify.

Per §F5 the only human gate in the whole flow is intake; vision/architecture below
are dispatched and logged, not human-gated.

1. **Vision (JTBD).** Dispatch `product` to express the requirement as jobs to be
   done and success measures into `work/$1/project.md`. Log the vision to
   `decision-log.md`.
2. **Target architecture.** Dispatch `solution-architect` to set the target C4
   solution architecture (AWS Well-Architected) in `architecture/current.md`,
   including accounts/network. Then run the solution-design security review and
   write `architecture/security/*` notes. Log it.
3. **Chunks.** Dispatch `product` + `solution-architect` to sequence the work
   into high-level value slices ("Chunks") in `chunks.md`, ordered by
   value-per-lead-time.
4. **Capabilities.** Dispatch `cicd` to define what a solution needs to operate
   (environments, test approach, continuous deployment) for the FIRST chunk only,
   into `capabilities.md` — nothing ahead of need.

End by reporting the Chunks and the capability gaps for chunk 1, and offer to run
`/slice-next $1`.
