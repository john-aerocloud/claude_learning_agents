---
description: Switch the active project. Sets work/ACTIVE and rebuilds minimal context from the decision log so work resumes exactly where it left off.
argument-hint: <project-name>
allowed-tools: Read, Write, Edit, Bash
---

Act as the **orchestrator**. Switch the active project to **$1**.

1. Validate `work/$1/` exists and read its `project.md`. If it does not exist,
   list the projects under `work/` (excluding `_TEMPLATE`) with their status and
   stop. If status=stopped, say so and ask whether to reactivate (set
   status=active, log it) before switching.
2. Write `$1` to `work/ACTIVE`.
3. Rebuild MINIMAL resume context — read only:
   - `project.md` (vision, status),
   - the tail of `decision-log.md` (last ~10 entries: which gates are passed,
     which decision is pending),
   - `chunks.md` (which chunk is in play),
   - the latest `slices/<nnn>-*/` dir: which of slice.md / acceptance.md /
     route.md / result.md exist tells you exactly where the slice stopped.
   Do NOT load architecture or full slice history — the decision log is the
   resume mechanism.
4. Report: where the project stands (gate state, slice state), the next
   recommended command (`/slice-next`, `/iteration-run <slice>`, or `/retro`),
   and any human decision that was pending when work last stopped.

Switching never destroys state: the previous project keeps its files, its open
gates, and its project-tagged DORA rows. Nothing in `/process` changes.
