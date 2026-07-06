---
description: List all projects in /work with status, current slice, and last activity. Marks the active one.
allowed-tools: Read, Bash
---

Act as the **orchestrator**. For each directory under `work/` except
`_TEMPLATE`:

- name and `status` from `project.md` (mark the one named in `work/ACTIVE` with
  an arrow),
- current work state from the DERIVED views — read `work/<p>/views/state.md`
  (each item's folded state) and `work/<p>/views/stats.md` (throughput / what is
  done vs in-flight); a slice is delivered when its state folds to `done`, not by
  the presence of a `result.md` file,
- timestamp of the last `decision-log.md` entry,
- any gate awaiting human sign-off.

Render as a compact table. End with: the active project, and the recommended
next command for it. If `work/ACTIVE` is `none` or stale (names a missing
project), say so and suggest `/project-switch <name>`.
