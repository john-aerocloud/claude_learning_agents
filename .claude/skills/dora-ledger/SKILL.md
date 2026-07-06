---
name: dora-ledger
description: FROZEN-ARCHIVE stub. The CSV ledger under process/dora/ledger/*.csv is a read-only archive of the retired QueueApproach delivery model — it is NEVER appended to and has NO live write path. All live work-item state and delivery metrics (the 4 DORA metrics, gross-lead-time by owner, quality by stage, recovery/MTTR by class) now come from the `work-items` skill. Load this ONLY to read the frozen archive; for anything live, use `work-items`.
---

# DORA ledger — frozen archive (retired) <!-- doc-lint:allow -->

The event-log CSV ledger belonged to the **QueueApproach** delivery model, now
retired (v82, `process/machinery/CONTRACT.md` §4). It has been **replaced** by the
event-sourced work-item substrate. There is **no live write path**:

- **Do NOT record events here.** The old `dora record` write path is gone. <!-- doc-lint:allow -->
- State changes go through **`make wi-append`** (the sole edge-checked state writer).
- All live metrics come from **`make wi-project`** → `work/<p>/views/stats.md`
  (the 4 DORA metrics + contribution-to-gross-lead-time by owner + quality by
  stage + recovery/MTTR by class). See the **`work-items`** skill.

## Reading the frozen archive (only if you ever need the historical numbers)

The archive is a plain, project-sharded CSV set — read it directly, never through a tool:

- `process/dora/ledger/<project>.csv` — the pre-freeze per-project shards.
- `process/dora/ledger.csv` — the older single-file archive.

Columns (schema as frozen): `timestamp, project, iteration, slice, agent, event,
duration_s, outcome, ref, note, item_id, queue, tokens`. Older rows have fewer
trailing columns. These numbers do **not** carry over into the new substrate; the
work-item `stats.md` is recomputed from item event logs going forward and is the
authoritative source for anything current.

For all live work, load **`work-items`** instead of this skill.
