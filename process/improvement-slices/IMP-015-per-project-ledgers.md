# IMP-015 — Per-project DORA ledgers (raw log lives in the project, not /process)

**Owner:** cicd/engineer on the dora-ledger skill. **Decision:** human — "push the ledgers for each project into the project; the shared ledger.csv is getting very large."

## Problem
All projects append to ONE shared `process/dora/ledger.csv` (2730 rows / ~695 KB and growing, with a `project` column). It grows unboundedly, mixes every project's raw events in one file, and couples the raw log to `/process` — against the §F10 fleet split (each project's raw data is its own isolated state; only the aggregated baseline is shared) and the two-repo model (a project's ledger is *its* output, belongs in its repo).

## Design
- **Raw ledger is per-project:** `work/<project>/dora/ledger.csv` (same schema; the `project` column becomes redundant but is kept for safety). `dora.py` resolves the ledger path from `--project` for every command that takes it (`record`, `project-state`, `flow`, `cost-split`, `retro-debt`, `log-decision`).
- **`/process` keeps only the aggregated, project-agnostic baseline** (`process/dora/baseline.md`, `statusline.json`). `dora.py compute` globs **all** `work/*/dora/ledger.csv`, concatenates, and computes the cross-project DORA baseline — so the shared spine stays *informed by* every project without holding their raw rows (§F10 "informed, not coupled").
- **`ROOT/process/dora/ledger.csv` is retired** after migration (kept as an archived snapshot, not written to).

## Migration (one-off, run when the loop is QUIESCENT)
Split the existing shared ledger by its `project` column into each `work/<folder>/dora/ledger.csv`, mapping the project-column value to the work folder (case-normalise: `Viggo-fix`/`viggo-fix` → `viggo-fix`; `OagEventSource`, `observatory`, `ox`, `oxo-online` map by name). Preserve row order (append-only, timestamp-sorted). Verify per-project row counts sum to the original. Then archive the shared file.

**Sequencing (critical):** the ledger is the single writer of dynamic state (STATE-MODEL) — item state + queues are *derived* from it. Do NOT split while a loop is writing (a dropped `enqueue`/`dequeue`/`item_done` row corrupts the derived `state.md`/board). Run the migration only when no project loop is mid-write, then flip `dora.py` to per-project in the same quiescent window.

## Acceptance
- `dora.py record --project P` writes to `work/P/dora/ledger.csv`; nothing new appends to `process/dora/ledger.csv`.
- `project-state`/`flow` for P derive identical results from the per-project ledger as before.
- `compute` produces the same aggregated baseline as the pre-migration shared ledger (row-count + metric parity check).
- Per-project row counts post-split sum to the pre-split total (no lost rows).
