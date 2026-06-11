# DEFECT-002 — stage WIP stuck (phantom in-flight from abandoned items)

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + prod-re-checked) · **Severity:** HIGH (data-integrity on the CORE observe view)

## Resolution
Aggregator WIP now reconciles against items.csv: open-enter counts only if the item exists AND state ∉ {done,dropped,cancelled}. Commits `10b6441` (fix + fixture + real-data pin) `3b735ce` (watcher de-flake). Live prod re-check: engineer wip=0, decompose wip=0, UC-S003-2/3/4 gone, throughput preserved (10). 133/133 green, trunk fully green (watcher de-flaked too → OI-FLAKY-WATCHER CLOSED). Gap → EXP-035 (reconcile derived 'now' state vs authoritative registry; 2nd instance of the "aggregator trusts raw ledger" class).

## Four fields
- **Expected:** Each stage's in-flight WIP reflects what is GENUINELY in-flight now, and changes as work starts/finishes (drops to 0 when nothing is actively in that stage).
- **Actual:** Build/TDD constantly shows ~4 (now 3) in-flight and Decompose showed 1 — numbers that never clear even though that work is long finished or was never built.
- **Intent:** Observe live what is actually in-flight per stage.
- **Importance:** False, stuck numbers on the core observe surface — undermines trust in every figure. Data-integrity.

## Reproduction (confirmed)
`GET /api/projects/observatory/stage-flow` → engineer `wip=3`, `wip_items=[UC-S003-2, UC-S003-3, UC-S003-4]`. These are the CHK-3 render wave that was HELD (re-vision) and never built: a `stage_enter` was recorded for each, no matching `stage_exit`. CHK-3 was dropped and its UC-S003-* rows were REMOVED from `items.csv` — so these are not even items, yet they count as permanent in-flight. Decompose self-cleared to 0 once `product` task_end rows landed (the "1" was transient-real).

## Classification (§5a)
Our bug — aggregator logic (primary) + data hygiene (orphan enter rows from held/dropped work, secondary). The aggregator (`lib/ledgerAggregator.js`) computes WIP from raw ledger enter/exit pairing and never reconciles against the authoritative registry (`items.csv`).

## Root cause (latent)
WIP = (open enter, no exit) with no reconciliation against item state. An item that is `done`/`dropped`/`cancelled` — or no longer exists in items.csv — must NOT count as in-flight even if its enter row was never closed. Second instance of "aggregator trusts raw ledger without reconciling against authoritative state" (first: strict-CSV line drop → tolerant parser).

## Priority
**Fix NOW (interrupt)** — data-integrity on the core view, user actively watching. Pre-empts the in-flight CHK-4 build per §38/§F5.

## Fix
Aggregator WIP = items with an open enter-without-exit AND that still exist in `items.csv` AND whose state ∉ {done, dropped, cancelled}. Pin the UC-S003-2/3/4 case (open enter + absent-from-items.csv → NOT wip). Re-check live: engineer wip reflects only genuinely-current work (≈0 now — nothing actively building). [sha + prod re-check on close]
