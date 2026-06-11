# DEFECT-009 — product's in-flight work is invisible on the value-stream map

**Reported:** 2026-06-10 · **Status:** CONFIRMED · **Severity:** MED-HIGH (the map misses real in-flight work — CORE observe completeness)

## Four fields
- **Expected:** when product (or any agent) is actively working a task (an open `task_start`, not yet ended), the value-stream map's stage (Decompose, for product) shows it as in-flight WIP.
- **Actual:** product's in-flight work never appears — Decompose WIP stays 0 even while product works.
- **Intent:** observe live what is happening in the pipeline right now, including product activity.
- **Importance:** the map's headline promise is "see what's in-flight now"; it silently omits a whole agent's work.

## Reproduction (confirmed — mechanism from `ledgerAggregator.js`)
WIP pairs `product task_start` (openIn) / `task_end` (close) for the decompose stage. BUT the DEFECT-002 reconciliation (lines ~33-37): *"An open enter is genuine in-flight ONLY if the item (1) still EXISTS in items.csv AND (2) is non-terminal. Absent-from-registry or terminal → STALE."* Product's `item_id` is almost always a CHUNK (e.g. CHK-2, state `done` → terminal), a SLICE id (`s008-throughput-rate` → not in items.csv), or meta (`SLC-vision` → absent). All are reconciled away → product WIP is structurally always 0.

## Classification (§5a)
Our bug — the WIP reconciliation (DEFECT-002's fix) is too strict. It correctly suppressed phantom WIP (a held/dropped UC's orphan enter) but ALSO suppresses genuine in-flight work whose item isn't a tracked non-terminal UC (chunks, slices, meta).

## Root cause (latent) — the DEFECT-002 ↔ DEFECT-009 tension
"In-flight" was defined as *"open enter on a non-terminal items.csv UC."* The right definition is *"open in-event with no matching close that is genuinely ACTIVE (recent), not stale/abandoned."* The DEFECT-002 phantom (a days-old orphan enter on a removed UC) should be excluded by **staleness/recency**, not by registry-membership — because registry-membership also hides legitimate chunk/slice/meta work. The WIP model has now produced both failure modes (too-much then too-little); it needs the recency-based definition that satisfies both.

## Status: CLOSED (fixed + verified)
Product ruled recency-based WIP (≤30 min open + not terminal-in-registry; recency primary, registry-terminal secondary). Engineer sha `31cb433`: WIP predicate rewritten, `WIP_STALENESS_HORIZON_MS=30min`, `wip_items={item_id,note}`, `OBSERVATORY_NOW` test seam. 476 unit + 44 browser green. Verified: a fresh product `task_start` on a chunk → Decompose wip=1 with its note; DEFECT-002 phantoms (hours old) still excluded; live :5173 (after controlled restart) deployed, phantoms absent. Gap → EXP-035 sharpened: reconcile derived 'now' state against the registry, but the PRIMARY in-flight signal is recency/activity — registry-terminal is a SECONDARY exclusion, never the gate (else it hides genuine non-UC work).

## Priority
Fix-now-ish (CORE observe completeness; user actively observing) — but the fix needs a WIP-semantics ruling (resolve the DEFECT-002↔009 tension) before code, so: product ruling → engineer.

## Fix (direction — product to rule exactly)
Redefine WIP as: an open in-event (no matching close) that is ACTIVE — i.e. recent (within a staleness horizon) — regardless of whether the item is a tracked non-terminal UC; exclude opens that are stale (older than the horizon) OR whose item went terminal-done after the open (work concluded). This shows product's recent decompose AND keeps DEFECT-002's old phantoms excluded. Product pins the horizon + the exact rule; engineer implements; re-check live that an open product task shows Decompose WIP=1 and a stale orphan still does not. [sha + prod re-check on close]
