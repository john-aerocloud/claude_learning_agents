---
description: Stop a project. Self-state in /process is untouched; /work can later be reset.
argument-hint: <project-name>
allowed-tools: Read, Edit, Bash
---

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in `work/ACTIVE` and treat the given arguments as shifted (e.g. a lone `<slice-id>` for `/iteration-run`). If `work/ACTIVE` is `none` or stale, stop and suggest `/project-list`._

Act as the **orchestrator**. Set `work/$1/project.md` status=stopped and
stopped=today. Append a closing entry to `decision-log.md` summarising where the
project ended (last slice, open gates). Do NOT touch `/process` — the agents keep
everything they learned. If `work/ACTIVE` names this project, reset it to `none`. Confirm the project
is parked and what it would take to resume (`/project-switch $1` reactivates).
