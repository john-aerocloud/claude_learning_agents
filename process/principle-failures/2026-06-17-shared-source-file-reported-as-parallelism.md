# 2026-06-17 — flow-manager reported unachievable parallelism on a shared source file

**Class:** dependency-model gap / false-independence signal (§F6/§F7), recurring.

## What happened (3 data points: SLC-001, SLC-002, SLC-003)
Use-cases that add a new branch to ONE source file (`normaliser-core.ts`) are
declared **mutually independent** in `use-case-deps.mmd` (no behavioural edge
between them — each handles a different event type). The flow-manager therefore
reported `achieved=1 max=4` (par_eff 0.25) on the SLC-002 and SLC-003 pulls and
called the shared file "the parallelism time-thief".

But the parallelism it reported as *available* was **never achievable**: under
trunk-based development with no branches (§40), concurrent engineer edits to the
same working-tree file collide. So the "max=4" is phantom — it measures a
parallelism the rules forbid, making par_eff look like lost opportunity when it is
not.

## Why it's a deviation
§F6 defines the independent set as "no edge/path between them **AND disjoint
claimed seams/paths**". A shared source file IS a shared claimed path. The
behavioural graph (`use-case-deps.mmd`) had no edge because there is no
*behavioural* dependency — but the **claimed-path** test (the second half of §F6)
should have excluded them. The flow-manager applied only the behavioural-edge
half and reported the set as independent.

## Root cause
The claimed-path registry (§F6) was not consulted for **source-file** seams at
costing time — only behavioural edges in the `.mmd` were. A UC's
"seams/paths it will own" did not include the source file(s) it edits, so two UCs
editing one file read as disjoint.

## Fix (routed → flow-manager.md + process §F6, EXP-051)
Encode the shared source-file as a **seam edge** (scheduling over compensation,
§19): a UC's claimed paths include the **source file(s) its route mutates**; two
ready UCs that claim the same source file are seam-serialised (NOT independent),
so `theoretical-max` reflects the achievable set under §40. This stops the
flow-manager reporting phantom parallelism, and makes par_eff a true efficiency
signal again. The genuine remedy for wanting the parallelism is a **structural
refactor** (split the file per event-type / a dispatch registry so each UC owns a
distinct file) — that is the false-edge null-hypothesis lever (§F7), tracked
separately; until then, serial-on-trunk is the *correct* schedule, not a missed
opportunity.
