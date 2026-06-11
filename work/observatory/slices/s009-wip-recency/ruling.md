---
defect: DEFECT-009
ruling-by: product
date: 2026-06-10
status: RULING — binding on engineer + tester
supersedes: DEFECT-002 WIP reconciliation (items.csv-membership as primary filter — overturned)
applies-to: lib/ledgerAggregator.js (aggregateStageFlow / wipItems filter)
---

# DEFECT-009 — Product ruling: WIP recency-based definition

## The tension resolved

DEFECT-002 fixed phantom WIP (a HELD/DROPPED use-case's orphan `stage_enter` with
no `stage_exit` counting as in-flight forever) by reconciling against items.csv:
only items that EXIST and are non-terminal counted. This correctly cleared
UC-S003-2/3/4.

DEFECT-009 shows that reconciliation is the wrong discriminator: it also silences
genuine in-flight work whose item_id is a chunk (e.g. `CHK-2`, state `done`), a
slice id (`s008-throughput-rate`, absent from items.csv), or a meta token
(`SLC-vision`, absent). Product's Decompose WIP is structurally always 0.

The honest discriminator between a phantom orphan and real current work is
**recency**, not registry membership. Phantoms are hours/days old; real work is
minutes old. This ruling replaces items.csv-membership as the PRIMARY filter with
a staleness horizon.

---

## The exact WIP predicate

An open in-event (an `openIn` row with no matching `close` row for the same
`item_id`, in ledger order) is **in-flight / WIP** for its stage if and only if:

```
isWip(openRow, now) =
    (now - parse(openRow.timestamp)) <= STALENESS_HORIZON_MS
    AND NOT item_went_terminal_after_open(openRow, itemRegistry)
```

Where:

- `now` = request time (epoch ms), as already passed into `aggregateStageFlow`
  via `opts.now`.
- `STALENESS_HORIZON_MS` = **30 minutes** (see rationale below).
- `item_went_terminal_after_open` = true iff the item_id EXISTS in items.csv AND
  its current state is in `{done, dropped, cancelled}` AND the items.csv state
  transitioned to terminal AFTER the open was recorded. In practice this is
  evaluated as: `itemRegistry.get(id)?.terminal === true`. If the item is absent
  from the registry (chunk, slice, meta, or any non-UC token), this condition is
  false — absence does NOT disqualify. See secondary-role note below.

The condition is evaluated per-open, per-stage, at request time.

---

## Horizon value and rationale

**30 minutes.**

Real agent tasks complete in single-digit minutes (a product slice-next: 2–5 min;
an engineer build cycle: 5–15 min; a tester run: 2–8 min). A task that has been
open for 30 minutes without a matching `task_end` is almost certainly a stale
orphan — the agent crashed, the session was killed, or the row was written but the
close never landed. Thirty minutes is well above the 99th percentile of any
observed task duration and well below the hours-to-days age of known phantoms
(UC-S003-2/3/4 in DEFECT-002 were days old).

The horizon is a named constant (`WIP_STALENESS_HORIZON_MS`) in the aggregator so
it can be adjusted without logic changes. The chosen value is conservative: it
will miss a genuinely multi-hour task (which does not exist in practice) rather
than resurrect a phantom.

---

## Secondary role of items.csv terminal check

Items.csv terminal-state still plays a secondary, opportunistic role:

- If an item IS in the registry AND its state is terminal (`done`, `dropped`,
  `cancelled`), it is NOT WIP regardless of recency. Work that concluded is not
  in-flight even if the ledger close row was missed (e.g. a `task_end` never
  written). This preserves the DEFECT-002 intent for UC-type items that do land
  in items.csv.
- If an item is ABSENT from the registry (chunk, slice, meta, free-text id), the
  terminal check is SKIPPED. Absence must not be treated as terminal.
- The priority order is: recency check first (stale → exclude); if recent, then
  terminal check (terminal → exclude); if recent AND not-terminal-or-absent →
  include.

This is a softened form of the DEFECT-002 reconciliation. The primary gate is now
recency; items.csv is a secondary confirming signal, not the primary membership
test.

---

## What wip_items shows for non-UC items

Per DEFECT-008, every `wip_items` entry should carry context, not just an opaque
id. The engineer extends `wip_items` from `string[]` to `{item_id, note}[]`:

```ts
wip_items: Array<{ item_id: string; note: string }>
```

Where `note` is the `note` field from the open-in-event ledger row (the
human-readable "why" already carried by the tolerant parser). For a product
`task_start` on `CHK-2` the note will be something like `"slice-next: s009
wip-recency"` — immediately intelligible. For a UC item the note will be the
original task note. Empty string when the note field is blank.

This satisfies DEFECT-008 (source events lack context) specifically for the
in-flight panel. The item_id is still present for programmatic use.

---

## How "now" is sourced

`now` is `opts.now` when provided (request time epoch ms, passed by the HTTP
adapter at the moment it calls `aggregateStageFlow`). When absent, `Date.now()`
is used as the existing fallback. No change to the calling convention is needed —
the adapter already passes `opts.now = Date.now()` per the DEFECT-004 fix.

---

## How DEFECT-002 stays fixed

The UC-S003-2/3/4 orphan enters were written when CHK-3 was built (days before
the DEFECT-002 report). At any subsequent request time their age is hours to days
old — far beyond the 30-minute horizon. They fail the recency check and are
excluded. DEFECT-002 remains fixed by recency, not by the items.csv-membership
check it previously relied on.

Secondary confirmation: UC-S003-2/3/4 are also absent from items.csv (they were
removed when CHK-3 was dropped). Under the new rule absence does NOT disqualify
— but they are already excluded by staleness before the secondary check fires.

---

## Acceptance conditions (assertion-ready)

**D9-AC-a — Recent product open is WIP=1**
Given: a product `task_start` row on any item_id (including a chunk id like
`CHK-2`, a slice id, or a meta token) written < 30 minutes before request time,
with no matching `task_end`.
Expected: `GET /api/projects/<project>/stage-flow` → decompose stage `wip = 1`,
`wip_items` contains `{ item_id: <the id>, note: <the note from the open row> }`.

**D9-AC-b — Stale orphan (DEFECT-002 case) is NOT WIP**
Given: a `stage_enter` row for UC-S003-2 (or any item) written > 30 minutes
before request time, with no matching `stage_exit` (the DEFECT-002 orphan
pattern).
Expected: engineer stage `wip = 0` for that item. UC-S003-2 does NOT appear in
`wip_items`.

**D9-AC-c — Item that went terminal after its open is NOT WIP**
Given: a `task_start` for item `UC-X-1` written < 30 minutes ago, AND `UC-X-1`
exists in items.csv with `state = done`.
Expected: that stage `wip` does NOT count `UC-X-1`; `UC-X-1` does NOT appear in
`wip_items`.

**D9-AC-d — Recent engineer open is WIP (regression guard for engineer stage)**
Given: a `task_start` for `agent=engineer` written < 30 minutes before request
time, with no matching `task_end`, for any item_id.
Expected: engineer stage `wip = 1`, `wip_items` contains the item.

**D9-AC-e — No-registry fail-soft preserved**
Given: `aggregateStageFlow` called without an `itemsCsv` argument (null/omitted).
A recent open row (< 30 min) is present.
Expected: that item counts as WIP (recency-only path). No error thrown. (The
registry absence must not break the recency path.)

**D9-AC-f — wip_items shape is {item_id, note}**
`wip_items` entries in the `/stage-flow` response are objects
`{ item_id: string, note: string }`, not bare strings. The `note` field matches
the `note` column of the open in-event ledger row (may be empty string).

---

## Explicitly NOT ruled here

- Visual display of wip_items in the UI (what the map renders for in-flight items
  in the stage node) — that is a ui-designer concern for a later slice.
- Adjusting the horizon dynamically (per-project config, per-agent config) — the
  constant is sufficient for now; revisit if multi-hour tasks appear.
- Whether the horizon should differ by stage (e.g. longer for tester) — same
  answer: uniform 30 min is correct for all current agents.
- Adding WIP pairing to gate stages (intake, deploy, done) — those stages have no
  `openIn` matcher and this ruling does not change that.
