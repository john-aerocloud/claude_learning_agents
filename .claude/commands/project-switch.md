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
2. Write `$1` to `work/ACTIVE` (the **machine-local, gitignored** pointer — this
   changes only THIS instance's active project; it is never committed and can
   never affect another machine/instance).
3. Rebuild MINIMAL resume context — read only:
   - `project.md` (vision, status),
   - the tail of `decision-log.md` (last ~10 entries: which gates are passed,
     which decision is pending),
   - `chunks.md` (which chunk is in play),
   - the DERIVED work state — `work/$1/views/state.md` (each item's folded state)
     and `work/$1/views/queues.md` (what is in flight / ready / rework) tell you
     exactly where work stopped. Prefer these over inferring progress from which
     slice artifact files happen to exist.
   Do NOT load architecture or full slice history — the decision log plus the
   derived views are the resume mechanism.
4. Report: where the project stands (gate state, work state), the next
   recommended command (`/slice-next`, `/loop-run`, or `/retro`), and any human
   decision that was pending when work last stopped.

Switching never destroys state: the previous project keeps its files, its open
gates, and its project-tagged DORA rows. Nothing in `/process` changes. Because
`work/ACTIVE` is machine-local, switching here is invisible to any other running
instance — each instance drives its own project independently.
