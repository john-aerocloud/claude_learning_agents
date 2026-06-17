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
   fill the anticipated-vs-observed score for the PREVIOUS change. Revert or
   rework any prior change that was not a net win across throughput (lead
   time), quality (CFR), frequency, and recovery (MTTR).
5a. **Score the experiment registry** (`/process/experiments.md`, process §25a):
   every `active` row that had a scoring opportunity gets a scoring note;
   horizon-reached rows with no measurable improvement move to
   `under-question` and MUST be resolved (rewrite as a new experiment, or
   start a `retirement-trial` — physically remove the text, run **4–5 scoring
   opportunities** (1–2 is an anecdote, not a sample), reinstate on an
   attributable metric drop / retire permanently only after no drop across
   the full window; max one trial RUNNING per artifact at a time — a
   confounding guard, not a sample size). Agent-def simplicity is a goal:
   text that cannot demonstrate value does not stay.
   **Newly-validated rows trigger INTEGRATION (§25a v34):** rewrite the owning
   agent file(s) so the validated behaviour is woven into the agent's core
   instructions as plain operating practice — experiment scaffolding (vNN/EXP
   citations, trial caveats) removed, file shorter or equal, behaviour intact.
   Note the integration commit on the registry row; the next retro spot-checks
   the mechanism still fires (EXP-011 scores this policy itself).
6. **Route each change to its narrowest owner** (process §36):
   - one agent's behaviour → edit that agent's file in `.claude/agents/`
   - cross-agent rules → `/process/process-current.md` (version+1)
   - repeated manual action → a parameterised committed tool (Makefile
     target / script / skill) — never inline hand-assembly
   - needs building/testing → an improvement slice in
     `/process/improvement-slices/` (§32), queued with product work
   Identify frictions proactively (prompts, inline assembly, throwaway checks,
   missing records); ask the human only where the call is genuinely theirs.
   If the process file has visibly accreted (many same-day versions,
   agent-specific detail creeping into global sections), run
   `/refactor-process` as part of this step.
7. Write the new `/process/process-current.md` (version+1) for whatever routed
   to the global process. Each change — wherever it routed — must target a
   named DORA metric and state its ANTICIPATED effect so the next retro can
   score it. The answer to the focus question drives the change-set.
   **Register every routed change** (including agent-file edits and tools) as
   a row in `/process/experiments.md` with target metric, anticipated effect,
   and scoring horizon (default 2 scoring opportunities).

Report: the focus question and answer, the new process version, each change
WITH where it was routed (agent file / process / tool / improvement slice),
the metric each targets, the anticipated effect, and the constraint to attack next.
