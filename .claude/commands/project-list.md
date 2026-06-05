---
description: List all projects in /work with status, current slice, and last activity. Marks the active one.
allowed-tools: Read, Bash
---

Act as the **orchestrator**. For each directory under `work/` except
`_TEMPLATE`:

- name and `status` from `project.md` (mark the one named in `work/ACTIVE` with
  an arrow),
- latest slice id and its furthest artifact (slice → acceptance → route →
  result = delivered),
- timestamp of the last `decision-log.md` entry,
- any gate awaiting human sign-off.

Render as a compact table. End with: the active project, and the recommended
next command for it. If `work/ACTIVE` is `none` or stale (names a missing
project), say so and suggest `/project-switch <name>`.
