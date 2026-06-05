---
description: Hold a retrospective — recompute DORA, review principle-failures, and produce a new process version targeting a DORA metric.
argument-hint: <project-name> [slice-id] [--question "..."]
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in `work/ACTIVE` and treat the given arguments as shifted. If `work/ACTIVE` is `none` or stale, stop and suggest `/project-list`._

_Question resolution: if a `--question "..."` argument is present, use that as the retro focus question. If omitted, use the default: **"What was the largest contributor to gross lead time, and what strategies can be attempted to reduce this whilst protecting DORA metrics?"**_

Act as the **orchestrator**. Own this; gather input but make the process call.

1. Run `dora-ledger compute` to refresh `/process/dora/baseline.md`. Identify the
   constraint (Theory of Constraints) and record it.
2. Collect each agent's "what worked / what hurt" for the project and slice.
3. Review `/process/principle-failures/` and `work/<project>/dora/per-project.md`.
   Look for PATTERNS — do not revise a principle on a single data point.
4. **Answer the retro focus question** using the DORA data, principle-failures,
   and per-project evidence. Be specific: name the step, duration, and the
   mechanism that drove it. Propose 1–3 concrete strategies, each stating which
   DORA metric it protects or improves and what the anticipated effect is.
5. Snapshot the active process to `/process/process-history/vNN-<date>.md`, and
   fill the anticipated-vs-observed score for the PREVIOUS change.
6. Write a new `/process/process-current.md` (version+1). Each change must target
   a named DORA metric and state its ANTICIPATED effect so the next retro can
   score it. The answer to the focus question drives the change-set.

Report: the focus question and answer, the new process version, the change(s),
the metric each targets, the anticipated effect, and the constraint to attack next.
