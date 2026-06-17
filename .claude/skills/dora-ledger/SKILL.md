---
name: dora-ledger
description: Record delivery events and compute DORA metrics for the agent pipeline. Use whenever an agent starts/finishes a task, an item is enqueued/dequeued from a queue, a deploy happens, a failure/recovery/collision occurs, or a gate decision is made, and whenever the orchestrator/flow-manager needs to refresh the DORA baseline (modal/median/mean per agent + gross lead time, deployment frequency, change failure rate, MTTR) or the per-project flow view (queue length/wait, time thieves, parallelism efficiency) for Theory-of-Constraints optimisation.
---

# DORA ledger

The shared instrument for the whole agent team. The append-only event log lives
at `/process/dora/ledger.csv`; the computed views at `/process/dora/baseline.md`
(whole pipeline) and `work/<project>/dora/flow.md` (per-project queues + thieves).

## Schema (v40)

`timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue`

`item_id` and `queue` were added in v40 for the pull-based flow. Rows written
before v40 have 10 fields; the tool pads `item_id`/`queue` to empty so old data
still computes. **Populate `item_id` on every row** (REQ-/CHK-/SLC-/UC-/DEF-);
when omitted it defaults to `--slice` for back-compat.

## Record an event (every agent, around every unit of work)

```
python .claude/skills/dora-ledger/scripts/dora.py record \
  --project <p> --iteration <n> --slice <id> --agent <agent> \
  --event <task_start|task_end|deploy|failure|recovery|gate|enqueue|dequeue|collision|parallel_dispatch|stage_enter|stage_exit> \
  [--duration <seconds>] [--outcome <success|fail|rolled_forward|rolled_back|na>] \
  [--ref <sha/PR/test/decision/other-item>] [--note "..."] \
  [--item-id <REQ-/CHK-/SLC-/UC-/DEF- id>] [--queue <intake|ready|deploy|rework>]
```

Rules:
- Bracket each unit of work with `task_start` then `task_end` (put wall-clock
  seconds on `--duration` of the `task_end`).
- `enqueue`/`dequeue` bracket an item's time on a queue (`--queue`, with
  value/cost in `--note`); the pair gives **queue wait** = dequeue − enqueue.
- `stage_enter`/`stage_exit` bracket a dev-loop stage (`--agent` = stage) for
  per-stage service time and in-loop wait.
- `deploy` on merge-to-main. **Two kinds of prod issue, logged distinctly (v51,
  process §3):** `deploy_failure`→`deploy_recovery` when a just-shipped change
  fails its validation (the CFR numerator); `defect_intake`→`defect_resolved`
  (ref `DEFECT-NNN`) when a defect is raised against the standing system via
  `/defect` (excluded from CFR, reported as defect-arrival rate). Both drive
  MTTR. Legacy `failure`/`recovery` still work — `dora.py` classifies by ref
  (`DEFECT-` ⇒ defect_intake, else deploy_failure).
- `collision` when concurrent work proves a declared independence false:
  `--ref` = the other in-flight item, `--note` = the shared seam. This is the
  hidden-edge signal feeding the §13 dependency-tree learning loop.
- `parallel_dispatch` when N use-cases are dispatched concurrently; put
  `achieved=<K> max=<M>` in `--note` so parallelism efficiency is computable.
- `gate` for each checkpoint decision; put the decision-log anchor in `--ref`.
- Never edit prior rows. The log is the truth.

## Compute the baseline (orchestrator, each iteration + at retro)

```
python .claude/skills/dora-ledger/scripts/dora.py compute
```

Rewrites `baseline.md`: per-agent modal/median/mean task time; gross lead time
(median, first task_start → first successful deploy per slice); deployment
frequency; change failure rate; MTTR; and the named **constraint** (slowest
median step) for Theory-of-Constraints.

## Compute the flow view (flow-manager / orchestrator, per project)

```
python .claude/skills/dora-ledger/scripts/dora.py flow --project <p>
```

Rewrites `work/<p>/dora/flow.md`: per-queue depth + median/total wait; the
**time-thief table** (total queue wait, hidden-edge collisions, parallelism
efficiency); the collision log (→ correct the dependency tree); and per-item
lead time with wait-share. This is the primary input the retro reads to find
the largest contributor to gross lead time.

Pipeline integration: have CI call `record` for deploy/failure/recovery so those
metrics are real and not hand-entered.
