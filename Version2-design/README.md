# Version 2 design — pull-based delivery system

**Status: IMPLEMENTED (2026-06-08) as process v40.** These docs are the rationale
of record; the live system now embodies them — `process/process-current.md`
**STAGE F**, `.claude/agents/flow-manager.md`, the `/intake` `/loop-run`
`/flow-status` commands, the extended `dora.py` (+ `flow`), and per-project
`items/`+`queues/` scaffolding (oxo-online & ox backfilled). Every change is a
registered experiment (`process/experiments.md`, EXP-020…EXP-029) to be scored at
future retros. `00-pull-system-design.md §12` was the implementation map.

- [`00-pull-system-design.md`](00-pull-system-design.md) — the design: work-item
  model (parent/child + per-item DORA), queues + buffer, the pull loop,
  replenishment, time thieves, the two-gate model, the new flow-manager agent,
  **parallel dev loops by independence + the collision/dependency-tree learning
  loop (§13)**, and the implementation map.
- [`01-diagrams.md`](01-diagrams.md) — loops, gates, and queues (mermaid):
  hierarchy, full flow, use-case state machine, time-thief view.
- [`02-example-retro.md`](02-example-retro.md) — a worked retro that finds a
  queue bottleneck and fixes it with a registered experiment.

Decisions taken at kickoff: structured ledger + rendered views; intake + deploy
gates only; a dedicated flow-manager agent; design-first (this folder), then
implement on approval. Cost of Delay is deferred to a later iteration (the model
is built CoD-ready).

The prior system is preserved verbatim under `../Version1/`.
