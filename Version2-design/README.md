# Version 2 design — the delivery model

**Status: event-sourced work items are the model of record (process v82, full
cutover 2026-07-06).** The single source of truth is the work item: state is
`fold(events)` over a per-item append-only log, and queues / board / DORA /
dependency tree are all *derived* views. The live system embodies this —
`process/machinery/CONTRACT.md` (build contract) + `state-graphs.json` (the type
graphs), `.claude/skills/work-items/`, the `make wi-append` / `wi-project` /
`wi-validate` targets, the `linear` + `jira` projection agents, and per-project
`items/{active,done}/` + `views/` scaffolding.

- [`04-work-item-state-model.md`](04-work-item-state-model.md) — **the model of
  record.** Diagnoses the state-drift defect class, then defines the event-sourced
  item model: the item as SSOT, `state = fold(events)` through per-type graphs,
  edge-checked writes, one-directional edges, and every other view as a pure
  projection. Read this first; the build contract that implements it is
  `process/machinery/CONTRACT.md`.

## Archived — QueueApproach design history

The prior **QueueApproach** (multi-queue, pull-based, DORA-CSV-ledger) design is
superseded by `04` and preserved for history under [`archive/`](archive/) and at
git tag `QueueApproach`:

- [`archive/00-pull-system-design.md`](archive/00-pull-system-design.md) — the
  QueueApproach design: parent/child work-item model, queues + buffers, the pull
  loop, replenishment, time thieves, the two-gate model, parallel loops by
  independence + collision/dependency-tree learning.
- [`archive/01-diagrams.md`](archive/01-diagrams.md) — the QueueApproach loops,
  gates and queue diagrams (mermaid).
- [`archive/02-example-retro.md`](archive/02-example-retro.md) — a worked
  QueueApproach retro that finds a queue bottleneck and fixes it.
- [`archive/03-process-loops.md`](archive/03-process-loops.md) — how the
  QueueApproach loops and the retro hang together.

The prior (Version 1) system is preserved verbatim under `../Version1/`.
