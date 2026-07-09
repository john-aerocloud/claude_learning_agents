---
name: work-items
description: The event-sourced work-item substrate (v82). The single source of truth for every work item — requirements, chunks, slices, use-cases, defects, open-items. State is fold(events) through a per-type state graph; queues, the dependency tree, the board and ALL delivery metrics (the 4 DORA metrics, contribution-to-gross-lead-time by owner, quality by stage, recovery/MTTR by class) are DERIVED on read, never stored-and-hand-synced. Load this before registering an item, changing item state, pulling work, or reading metrics. Read process/machinery/CONTRACT.md + state-graphs.json first.
---

# Work items — the state substrate (v82)

**One principle:** each fact is stored once, in the item. Every other view — queues,
board, stats, tree — is COMPUTED from the items on read. There is no separate queue
file, no `state:` field, no metrics ledger to keep in sync. Contract:
`process/machinery/CONTRACT.md`. Type graphs: `process/machinery/state-graphs.json`.
Read both before using this skill.

## The model
- **Item = SSOT.** One file per item: `work/<project>/items/active/<ID>.md`. On
  completion it moves verbatim to `work/<project>/items/done/<ID>.md`.
- **state = fold(events).** An item has no stored state. Its current state is the
  fold of its append-only `events:` list through its type's graph. A half-written
  state cannot be represented, so the classic drift class is gone by construction.

## Item file schema (CONTRACT.md §1)
YAML-ish frontmatter (machine-authoritative) + markdown body (human definition).
Frontmatter fields:
- `id` — e.g. `UC-C1`, `SLC-032`, `DEF-041`, `REQ-…`.
- `type` — selects the state graph: `use-case | defect | open-item | slice | chunk | requirement`.
- `title`, `job` (JTBD id), `value`, `cost` — economics used by the pull.
- `personas:` — OPTIONAL list of persona ids (e.g. `[P1,P3]`) naming WHICH users the item serves. Personas + JTBD are REFERENCE docs under `work/<p>/product/` (`personas.md`, `jtbd-map.md`), not work items; use-cases point at them. Set by product from the `/requirement` discovery dossier.
- `parents:` — UPWARD hierarchical container(s). REQUIRED (except `requirement`).
- `deps:` — peer prerequisites; the DAG edges the pull uses to form the independent set. May be empty.
- `created_ts` — UTC registration time.
- `events:` — **append-only** list of `{ts, event, agent, [ref], [note]}`. NEVER add a `state:` field.
- `derived:` — the DERIVED block (state, queue, children, ancestors). **Do not hand-edit** — it is re-rendered by `wi-project`.

Edges are stored one-directional (each item names its `parents`/`deps`). `children`
and the full subtree are DERIVED (who names me) so an edge can never disagree with itself.
The markdown body carries the JTBD/value/acceptance definition, frozen at registration;
material changes are `amended` events, never silent edits.

## Type graphs & state ownership (state-graphs.json)
Each `type` is either a **flow** machine (use-case, defect, open-item — real event
streams) or an **aggregate** (slice, chunk, requirement — state bubbles up from
children via the graph `bubble` rule; they carry only registered/amended events for audit).
Every state maps to:
- a **queue** via `queue_map[state]` (`intake | ready | rework | waiting | wip`, or
  `null` for terminal/aggregate) — this is how queues are generated, derived.
- an **owner** via `state_owners[state]` — an agent name (that agent is actively
  working it → their throughput/quality), `queue` (pure wait latency, a time thief),
  or `external` (blocked on a human/third party). This is the basis for attributing
  GROSS LEAD TIME to each part of the process.

Wanting a transition that is not in the graph is **not** something an agent may just
do: propose an amendment to `state-graphs.json` WITH A REASON — a process experiment
(`EXP-NNN`) routed through the retro/version-bump gate. Edit that file only via that gate.

## The four commands (and when each runs)
All via the cross-platform launcher (never bare `python3` — see below); the root
Makefile wraps each.

1. **`make wi-append PROJECT=P ID=<ID> EVENT=<name> AGENT=<role> [REF=…] [NOTE=…]`**
   — the SOLE state writer, and the ONLY way to change item state (replaces
   `dora record` for item state). <!-- doc-lint:allow --> The append is **edge-checked**: it folds current
   state, looks up the graph, and appends with a UTC timestamp ONLY IF the event is
   a legal transition from the current state AND `agent` is in that transition's
   `agents`. An illegal transition is REJECTED (non-zero exit) with the current
   state, the events that ARE legal here, and the instruction to open an amendment
   experiment. Re-renders `derived:` on success. To register a NEW item, create its
   file with the frontmatter above and the initial `registered`/`reported`/`open`
   event, then append subsequent events with this command. No hand-editing of
   `derived:`; no separate queue file.

2. **`make wi-project PROJECT=P`** — recompute ALL views from the item set (pure
   functions). Run **after each loop pass** (and after any batch of appends). Writes:
   - `views/queues.md` + `.json` — membership of intake/ready/rework/waiting + WIP, via `queue_map[state]`.
   - `views/state.md` — every item's current folded state.
   - `views/tree.md` — the dependency tree (parents/children/deps).
   - `views/stats.md` + `.json` — all delivery metrics (below).
   - re-renders each active item's `derived:` block.

3. **`make wi-validate PROJECT=P`** — the drift GATE. Run **before pulling**. Exits
   non-zero if any invariant is violated: (I1) every event in every item is a legal
   transition; (I2) no terminal item sits in a non-null queue; (I3) every
   `parents`/`deps` id resolves and `deps` has no cycles; (I4) exactly one file per
   id across active/+done/, and a `done` item lives in `done/`.

4. **`make wi-migrate PROJECT=P`** — one-shot migration from the legacy
   `items.csv` + ledger into per-item files. Run once per project; not part of the loop.

## Reading metrics (from views/stats.md — the live metric source)
`stats.md`/`stats.json` are recomputed from event timestamps by `wi-project`; read
them instead of any ledger. They carry, overall and per item-type:
- **A. The four DORA metrics** — throughput / deployment frequency, lead time
  (registered→done), cycle time (pulled→done), change-failure rate, MTTR.
- **B. Gross-lead-time decomposition** — total time-in-flight, per-item median/p85,
  `by_state` (time thieves) and **`by_owner`** (each part of the process's
  contribution, via `state_owners`). This is the primary retro input: the largest
  `by_owner`/`by_state` contributor is the constraint.
- **C. Quality by stage** — build-fail / reject rates by owning stage, plus
  defect-arrival rate (all-time + trailing 30d).
- **D. Recovery (MTTR) by failure class** — median + mean recovery time split by
  class (build failure, validation reject, defect, deploy failure).

The old `process/dora/ledger/*.csv` is a FROZEN QueueApproach archive — do NOT
append to it; do NOT `dora record`. <!-- doc-lint:allow --> All live state and metrics come from here.
(See the `dora-ledger` skill, now a read-only archive stub.)

## Cross-platform invocation
Invoke via the launcher `sh .claude/skills/work-items/scripts/work-items <cmd>`
(the Makefile's `wi-*` targets do this). It resolves the real interpreter machine-
locally — real `python3` on macOS, `uv`-provided on Windows (where `python`/`python3`
are Microsoft Store stubs that fail silently). NEVER call bare `python3 …/work-items.py`.
`sh … work-items --python` prints the resolved interpreter (used by the Makefile's `PY`).
