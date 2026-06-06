# IMP-005 — Per-agent ledger shards

**Status:** queued (specced at s005 retro, 2026-06-06)
**Owner:** orchestrator (spec) / engineer (dora.py change)

## Job
process/dora/ledger.csv is the single shared append-file every concurrent
agent writes; it caused every rebase conflict and both stash incidents in
s005 (one of which swept a live agent's WIP). Flags (§40) don't help — it's
one physical file.

## DORA target
Lead time (removes the only systematic merge-conflict source in parallel
work); protects metric integrity (no union-merge surgery).

## Done condition
Agents append to process/dora/shards/<agent>-<session>.csv (no contention);
dora.py compute reads ledger.csv + all shards; a compaction step (at retro)
folds shards into the main ledger. Same schema, same metrics output —
compute results byte-identical on the existing history.

## Protection
dora.py unit-tested on fixture shards before/after; compaction idempotent.

## Score
Zero ledger merge conflicts across a fully parallel slice.
