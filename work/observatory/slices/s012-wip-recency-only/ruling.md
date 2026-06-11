---
defect: DEFECT-010
ruling-by: product
date: 2026-06-10
status: RULING — binding on engineer + tester
supersedes: DEFECT-009 WIP predicate (recency-primary + terminal-secondary — overturned)
applies-to: lib/ledgerAggregator.js (aggregateStageFlow / wipItems filter)
---

# DEFECT-010 — Product ruling: recency-only WIP (terminal check dropped)

## Option chosen: RECENCY-ONLY

Drop the items.csv terminal-state exclusion entirely. The secondary rule kept
by DEFECT-009 ("if item IS terminal in items.csv → exclude, even if recent") is
the direct cause of DEFECT-010 and adds zero value over recency alone.

The done_ts-aware variant (exclude only if open_ts < item.done_ts) was
considered and rejected: it is harder to implement correctly (requires done_ts
to be recorded and available in the aggregator), introduces a new failure mode
(missing done_ts silently falls back to wrong behaviour), and solves a
theoretical edge that does not occur in practice. Three WIP defects in sequence
is evidence that complexity here has a high bug rate. Simpler is correct.

---

## The exact WIP predicate (final, no further refinement expected)

```
isWip(openRow, now) =
    (now - parse(openRow.timestamp)) <= STALENESS_HORIZON_MS
```

That is the entire predicate. One condition. No registry lookup. No terminal
check. No done_ts comparison.

- `now` = `opts.now` (request epoch ms, passed by HTTP adapter); fallback `Date.now()`.
- `STALENESS_HORIZON_MS` = 30 minutes (constant `WIP_STALENESS_HORIZON_MS`, unchanged).
- An open in-event is any row whose event type matches `openIn` matchers for its
  stage (e.g. `task_start`, `stage_enter`).
- "Matching close" = a subsequent row in ledger order for the same `item_id`
  whose event type matches `closeIn` for that stage (e.g. `task_end`,
  `stage_exit`). If a close exists, the item is not in-flight regardless of
  recency.

The items.csv registry (`itemRegistry`) is NOT consulted for WIP determination.
It may still be passed to the aggregator for other purposes (throughput, cycle
time) and must not be removed — its WIP path is simply not taken.

---

## Why recency alone fixes all three defects

DEFECT-002 phantoms (UC-S003-2/3/4 orphan stage_enter rows): written days
before any request. Age >> 30 minutes. Excluded by recency. Stays fixed.

DEFECT-009 (product work on chunks/slices/meta tokens hidden): those items are
absent from the registry OR terminal. Under the new rule no registry lookup
occurs. A recent product task_start on CHK-2 is WIP=1. Fixed.

DEFECT-010 (recent work on DONE items hidden): the terminal check was firing on
recent opens against done items. The terminal check no longer exists. A recent
engineer stage_enter on UC-S004-5 (state=done) is WIP=1. Fixed.

The key insight: a recent open in-event with no close IS in-flight work. The
registry records what the plan says about an item's completion state; it says
nothing about whether an agent is running against it right now. Recency of the
ledger event is the authoritative signal.

---

## Accepted edge (one, self-healing)

A just-finished task whose `task_end` was not written (agent crash after work
completed, session kill mid-close) will show as WIP for up to 30 minutes then
self-clear. This is the same edge accepted in DEFECT-009 and is unchanged. It
is acceptable: the map slightly over-reports in-flight in this case, which is
the less harmful direction (false positive vs false negative), and it heals
automatically. No mitigation needed.

---

## Confirmation table

| Defect | Mechanism | Fixed by recency-only? |
|--------|-----------|------------------------|
| DEFECT-002 | Orphan opens hours/days old → age > 30 min → excluded | YES — unchanged |
| DEFECT-009 | Product opens on non-registry items → no registry lookup → included | YES — strengthened (no secondary check can re-exclude) |
| DEFECT-010 | Recent opens on terminal items → terminal check dropped → included | YES — root cause removed |

---

## Acceptance conditions (assertion-ready)

**D10-AC-a — Recent open on a DONE item is WIP=1**
Given: a `task_start` or `stage_enter` row for any agent against any item_id
(e.g. `engineer stage_enter UC-S004-5`, `product task_start CHK-2`) written
< 30 minutes before request time, with no matching close row, AND the item
exists in items.csv with `state = done`.
Expected: that stage `wip = 1`; the item appears in `wip_items`.
(This is the DEFECT-010 regression case — was incorrectly 0 before this fix.)

**D10-AC-b — Stale open on ANY item is NOT WIP (DEFECT-002 regression guard)**
Given: any open row (task_start or stage_enter) written > 30 minutes before
request time, with no matching close, regardless of item state or registry
membership.
Expected: that item does NOT appear in `wip_items`; stage `wip` does not count it.

**D10-AC-c — Recent product open on a chunk is WIP=1 (DEFECT-009 regression guard)**
Given: a `product task_start` on `CHK-2` (or any chunk id) written < 30 minutes
before request time, with no matching `task_end`.
Expected: decompose stage `wip = 1`; `wip_items` contains the item.

**D10-AC-d — Recent engineer open on a DONE UC is WIP=1**
Given: an `engineer stage_enter` on `UC-S004-5` (state = done in items.csv)
written < 30 minutes before request time, with no matching `stage_exit`.
Expected: build stage `wip = 1`; `UC-S004-5` appears in `wip_items`.

**D10-AC-e — Recent cicd open on a DONE chunk is WIP=1**
Given: a `cicd task_start` on `CHK-1` (state = done in items.csv) written
< 30 minutes before request time, with no matching `task_end`.
Expected: capabilities stage `wip = 1`; `CHK-1` appears in `wip_items`.

**D10-AC-f — Closed open is NOT WIP regardless of age**
Given: a `task_start` row followed by a matching `task_end` row for the same
item_id (both < 30 min old).
Expected: that item does NOT appear in `wip_items`. (Close row must pair
correctly.)

**D10-AC-g — No registry argument does not error (fail-soft preserved)**
Given: `aggregateStageFlow` called without `itemsCsv` / `itemRegistry`; a
recent open row is present.
Expected: item counts as WIP. No error thrown. (Registry is not consulted for
WIP — no path to fail.)

**D10-AC-h — wip_items shape is {item_id, note} (DEFECT-008/D9-AC-f preserved)**
`wip_items` entries remain `{ item_id: string, note: string }`. The `note`
field is the note column from the open ledger row (may be empty string).

---

## Implementation delta from DEFECT-009 ruling

The engineer removes the secondary terminal-check block from the WIP filter in
`aggregateStageFlow`. The items.csv lookup in that function's WIP path is no
longer called. All other logic (horizon constant, open/close matching, wip_items
shape, opts.now sourcing) is unchanged.

The D9-AC-c acceptance condition from DEFECT-009 ("item that went terminal after
its open is NOT WIP") is OVERTURNED by this ruling and MUST NOT be present in
the test suite after this fix. Replace it with D10-AC-a and D10-AC-d above.

---

## Explicitly NOT ruled here

- Adjusting the 30-minute horizon (still 30 min; revisit if multi-hour tasks appear).
- Horizon variation by stage or agent type (uniform 30 min is correct).
- Visual rendering of wip_items in the stage node (ui-designer concern).
- Whether to remove itemRegistry parameter from the function signature (leave it;
  it is still used for throughput and cycle time; this ruling only removes its
  role in WIP determination).
