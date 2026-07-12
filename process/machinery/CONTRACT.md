# Work-item machinery — contract

The event-sourced single-source-of-truth work-item model (design: `design-rationale/work-item-state-model.md`).
This file is the build contract for the machinery script and the Linear/Jira projection
agents. **One principle:** each fact is stored once (in the item), and every other view
(queues, board, stats, tree) is computed from the items on read — never persisted-and-hand-synced.

## 1. Item file — the ONLY place state lives

One file per item: `work/<project>/items/active/<ID>.md`. Completed items move verbatim to
`work/<project>/items/done/<ID>.md` (whole truth archived in one move). Format is YAML-ish
frontmatter (machine-authoritative) + markdown body (human definition).

```markdown
---
id: UC-C1
type: use-case            # selects the state graph (process/machinery/state-graphs.json)
title: "Fold carrier codeshares into the projection"
job: J3                   # JTBD id (reference doc work/<p>/product/jtbd-map.md)
personas: [P1, P3]        # OPTIONAL: which users this behaviour serves (reference doc .../personas.md). set by product from the signed-off discovery dossier.
value: 3
cost: 0.5
parents: [SLC-032]        # UPWARD edges only: hierarchical container(s). REQUIRED (except requirement).
deps: [UC-C0]             # peer prerequisites (DAG edges the pull uses for the independent set). may be empty.
created_ts: 2026-06-17T21:30:00Z
events:                   # append-only. state = fold(events) through the type graph. NEVER store a `state:` field.
                          # each event MAY carry an OPTIONAL `tokens: <int>` — the subagent_tokens the
                          # dispatched specialist spent producing that transition. Absent ⇒ unknown/0
                          # (parsing is tolerant). Feeds the plumbing-vs-delivery cost-split in stats.
  - {ts: 2026-06-17T21:30:00Z, event: registered, agent: flow-manager}
  - {ts: 2026-06-18T09:00:00Z, event: made_ready, agent: flow-manager, note: "vc=6.0"}
  - {ts: 2026-06-18T12:00:00Z, event: pulled,      agent: orchestrator}
  - {ts: 2026-06-18T15:30:00Z, event: built_green, agent: engineer, ref: <sha>, tokens: 48000}
  - {ts: 2026-06-18T15:45:00Z, event: deployed,    agent: cicd}          # deploy-to-dev
  - {ts: 2026-06-18T16:10:00Z, event: validated,   agent: tester, ref: <sha>, tokens: 12000}  # local-only: dev==prod
# --- everything below this line is DERIVED (rendered by the machinery). do not hand-edit. ---
derived:
  state: done
  queue: null
  children: [ ]           # computed: items whose `parents` include this id
  ancestors: [SLC-032, CHK-4, REQ-OAGEVENTSOURCE]
  metrics:                # per-item DORA/flow, RENDERED per item (flow items only; pure fn of events)
    gross_lead_time_s: 2400.0        # genesis (registered) -> terminal event
    cycle_time_s: 2400.0             # pulled -> done (delivery clock)
    time_in_state: {registered: 5400.0, ready: 10800.0, building: 12600.0, deploying: 900.0, dev-validating: 1500.0}
    time_by_owner: {queue: 16200.0, engineer: 12600.0, tester: 1500.0, cicd: 900.0}
    rework_count: 0
    recovery: {n: 0, mttr_median_s: null, mttr_mean_s: null}
    tokens: {total: 60000, plumbing: 0, delivery: 60000}
---

## Definition
<the JTBD/value statement, actor/trigger/outcome, acceptance criteria — frozen at registration;
 material changes are `amended` events, not silent edits>
```

**Edges stored one-directional.** Each item names its `parents` and `deps` (upward). `children`
and the full subtree are DERIVED (who names me) — so an edge cannot disagree with itself. This
honours "the item contains its dependency tree" (children are rendered into `derived:`) without
storing any edge twice.

## 2. Appending an event (the write path — replaces `dora record` for item state)

`work-items append --project <p> --id <ID> --event <name> --agent <role> [--ref R] [--note N]`

The append is **edge-checked**: it folds the existing events to the current state, looks up the
type graph, and:
- **legal** transition (event allowed from current state AND `agent` in that transition's `agents`)
  → append with a UTC timestamp; re-render `derived:`.
- **illegal** transition → REJECT (non-zero exit) with the message: current state, the events
  that ARE legal here, and the instruction to open an amendment experiment if the transition
  should exist. This is where "wanting an undefined action" surfaces as a governed proposal.

There is no other way to change item state. No hand-editing of `derived:`; no separate queue file.

**Cancelling / superseding an item [state-graph v5].** Every flow type (use-case, defect,
open-item) has a `cancelled` terminal, reachable via a `cancelled` event (agents: orchestrator,
flow-manager) from any non-terminal working state. Use it when work is obsoleted by a design
change or de-scoped — the honest alternative to silently editing an item into a different thing.
A `cancelled` flow item archives to `items/done/` like any terminal item, and is EXCLUDED from
lead-time and deployment-frequency (it never shipped). For aggregates (slice/chunk/requirement):
a cancelled child does NOT block the parent — the parent is `done` when all children are terminal
(done or cancelled) and at least one is done; if ALL children are cancelled the aggregate itself
folds to `cancelled`.

## 3. Projections (queue generation + statistics = machinery, run after each loop)

`work-items project --project <p>` recomputes ALL views from the item set (pure functions):
- `work/<p>/views/queues.md` + `.json` — membership of intake/ready/rework/waiting + WIP, via
  `queue_map[state]`. This is the queue generation, derived; no `queues/*.csv` stored state.
- `work/<p>/views/state.md` — every item's current folded state (replaces the old hand-run cache).
- `work/<p>/views/tree.md` — the dependency tree (parents/children/deps), derived.
- `work/<p>/views/stats.json` + `.md` — DORA + flow from event timestamps. Reports:
  - the **4 DORA metrics**: throughput (deploy frequency), lead time (registered→done),
    change-failure rate, MTTR (defect reported→resolved); plus WIP.
    - **change-failure rate [state-graph v5]** = (validation `rejected` + `deploy_failed`) /
      (validations + deploy failures). A `rejected` (tester validation failure) OR a
      `deploy_failed` (deploy/CI-pipeline failure — e.g. a red pipeline on push) is a change
      failure. `deploy_failed` (`deploying`/`prod-deploying` → `reworking`, fired by cicd/engineer)
      exists so a **fixed-forward** deploy failure is not invisible: previously a red deploy
      recorded only `built_green`, so CFR read a false 0%. Fire `deploy_failed` on any red
      deploy even when you fix forward — the trace is what CFR counts.
  - **(a) gross-lead-time decomposition** — `by_state` and `by_owner`: time attributed to
    agent-work vs `queue` wait-latency vs `external` blocked, so the largest time thief is named.
  - **(b) quality** — failure / rework rate **by stage** (which stage red-flags most).
  - **(c) recovery** — **MTTR by failure class** (deploy failure vs prod defect vs collision).
  - **(d) token cost** — `token_cost`: total, `by_owner` (event `tokens` folded through the event's
    agent), and the **plumbing-vs-delivery split** (running-the-OS vs customer-value; classification
    ported from dora.py cost-split, EXP-067). Computed from each event's optional `tokens`.
  Aggregate (slice/chunk/requirement) state bubbles from children per the graph `bubble` rule.
- Re-renders each active item's `derived:` block (state, queue, children, ancestors, **metrics**).
- **(e) per-item metrics** — ALL the flow/DORA quantities are ALSO trackable for one item, not
  just in aggregate. `project` renders a `metrics:` sub-block into every FLOW item's `derived:`
  (gross lead time genesis→terminal, time-in-each-state, cycle time pulled→done, rework count,
  recoveries + MTTR, token total + plumbing/delivery split). It is a pure re-composition of the
  same helpers the aggregate stats use (`per_item_metrics`), so a single item's numbers are
  definitionally consistent with the roll-up. `work-items project --project <p> --item <ID>`
  prints one item's metrics to stdout (no view re-render) for a focused read.

`work-items validate --project <p>` — the drift GATE, now by construction not after-the-fact.
Exits non-zero if ANY invariant is violated:
- (I1) every event in every item is a legal transition (no illegal history slipped in by hand-edit).
- (I2) no item is both `done`/terminal and in a non-null queue (the UC-SF3 / UC-O8 hazard — now impossible to *represent*, this catches hand-edits that try).
- (I3) edge consistency: every `parents`/`deps` id resolves to an existing item; no cycles in `deps`.
- (I4) exactly one file per id across active/ + done/; a `done` item lives in done/.

## 4. Statistics reset

This is a fundamental substrate change; the historical DORA numbers do NOT carry over and that is
accepted. `stats.json` is recomputed from the migrated item event logs going forward. The old
`process/dora/ledger/*.csv` is retained read-only as the QueueApproach archive (tagged), not extended.

## 5. Cross-platform invocation

Invoke via the launcher `sh .claude/skills/work-items/scripts/work-items <cmd>` (mirrors the
dora launcher: resolves the real python3 on macOS / uv-provided on Windows). Never bare `python3`.
