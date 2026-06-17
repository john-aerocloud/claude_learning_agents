# State model — single source of truth (process v52, EXP-048)

This project uses the **append-only DORA ledger as the ONE writer of dynamic
state**. Item current-state and queue membership are **derived projections** of
the ledger — never independently stored — so they cannot drift from it (the
defect family that derivation eliminates: 10/16 of the observatory project's
defects were three-independent-writer disagreements).

- **`items/items.csv`** holds **static item facts only** — `id, type, parent,
  children, job, value, cost, created_ts, dora_ref`. It has **no `state` column**:
  state is derived. `vc_ratio` (= value÷cost) and `done_ts` (the `item_done`
  event time) are likewise derived, not stored.
- **`queues/policy.csv`** holds the **buffer config only** (`min_items`,
  `wip_limit` per queue). There are **no queue membership CSVs** — a queue's
  current contents and depth are derived from `enqueue`/`dequeue` ledger events.
- **To see current state:** `python3 .claude/skills/dora-ledger/scripts/dora.py
  project-state --project <this>` → writes `state.md` (a generated read-model;
  do not hand-edit). To CHANGE state, append a ledger event — never edit a CSV.

There is one writer, so there is nothing to keep in sync: the atomic-pull /
reconcile discipline that legacy projects need (EXP-037/041) does not apply here.
