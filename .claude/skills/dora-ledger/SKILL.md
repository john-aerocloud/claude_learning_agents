---
name: dora-ledger
description: Record delivery events and compute DORA metrics for the agent pipeline. Use whenever an agent starts/finishes a task, a deploy happens, a failure or recovery occurs, or a gate decision is made, and whenever the orchestrator needs to refresh the DORA baseline (modal/median/mean per agent + gross lead time, deployment frequency, change failure rate, MTTR) for Theory-of-Constraints optimisation.
---

# DORA ledger

The shared instrument for the whole agent team. The append-only event log lives
at `/process/dora/ledger.csv`; the computed view at `/process/dora/baseline.md`.

## Record an event (every agent, around every unit of work)

```
python .claude/skills/dora-ledger/scripts/dora.py record \
  --project <p> --iteration <n> --slice <id> --agent <agent> \
  --event <task_start|task_end|deploy|failure|recovery|gate> \
  [--duration <seconds>] [--outcome <success|fail|rolled_forward|rolled_back|na>] \
  [--ref <sha/PR/test/decision-anchor>] [--note "..."]
```

Rules:
- Bracket each unit of work with `task_start` then `task_end` (put wall-clock
  seconds on `--duration` of the `task_end`).
- `deploy` on merge-to-main; `failure` when the tester finds prod broken;
  `recovery` when the fix is validated in prod (this pair drives MTTR).
- `gate` for each checkpoint decision; put the decision-log anchor in `--ref`.
- Never edit prior rows. The log is the truth.

## Compute the baseline (orchestrator, each iteration + at retro)

```
python .claude/skills/dora-ledger/scripts/dora.py compute
```

Rewrites `baseline.md` with: per-agent modal/median/mean task time; gross lead
time (median, first task_start -> first successful deploy per slice); deployment
frequency (deploys per active day); change failure rate (% deploys with a
failure); MTTR (median failure->recovery). It also names the **constraint** (the
slowest median step) for Theory-of-Constraints work — the orchestrator then fills
in the exploit/subordinate action.

Pipeline integration: have CI call `record` for deploy/failure/recovery so those
metrics are real and not hand-entered.
