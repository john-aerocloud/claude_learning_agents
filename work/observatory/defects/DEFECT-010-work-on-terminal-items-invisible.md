# DEFECT-010 — active work shows nothing in-progress (recent work on terminal items excluded)

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** HIGH (the map's headline promise — "see what's happening now" — fails during active work)

## Resolution
Product ruled RECENCY-ONLY; engineer sha `6b21b6f`: WIP = open in-event ≤30min with no close, terminal/registry check DELETED from the WIP path (kept for queue-depth coherence). 483 unit + 44 browser green. Verified live :5173 (auto-deployed via the OI-SERVER-RESTART fix — no manual restart): a recent `engineer stage_enter` on the DONE item CHK-2 → engineer WIP=1 with its note; DEFECT-002 orphans still excluded. Gap → EXP-035 (3rd WIP defect: each added "safety" condition bred a defect; simplest predicate won) + product.md metric-craft note.

## Four fields
- **Expected:** when work is actively happening (an agent mid-task), the value-stream map shows that stage in-progress (WIP).
- **Actual:** "you are doing work but nothing is in progress in the value stream map" — the map stays at 0 in-flight while agents are actively dispatched and working.
- **Intent:** watch the pipeline live and SEE that work is happening now.
- **Importance:** the core observe job; the map looks dead during exactly the moments it should be most alive.

## Reproduction (confirmed — mechanism from code + ledger)
- The SSE watcher watches the whole repo root incl. `process/dora/ledger.csv`, so a logged work row DOES trigger a map refresh. Not the cause.
- WIP rule (DEFECT-009): recent open in-event (≤30 min) **AND NOT (item terminal in items.csv)**. The terminal check is a *secondary* exclusion kept from DEFECT-002.
- **All recent work is logged against TERMINAL items:** the last dispatches recorded `product task_start CHK-2`, `engineer stage_enter CHK-2 / UC-S004-5`, `cicd task_start CHK-1` — and CHK-1, CHK-2, UC-S004-5 are all `done`. The terminal-exclusion drops every one → decompose/build/capabilities WIP = 0 while those agents are actively running. (Defect-fixes & rework happen on already-delivered chunks/UCs, which are terminal.)

## Classification (§5a)
Our bug — the WIP terminal-state exclusion (DEFECT-009's secondary rule) is too aggressive: it hides recent ACTIVE work whose item is a delivered (terminal) chunk/UC.

## Root cause (latent) — the third turn of the WIP screw
DEFECT-002 (phantom WIP on dropped items) → added registry reconciliation. DEFECT-009 (product work hidden) → made recency primary but KEPT terminal as secondary. DEFECT-010 (now): the terminal-secondary itself hides recent active work on delivered items. **A recent open in-event with no close IS in-flight, regardless of the item's registry state** — recency alone already excludes the DEFECT-002 phantoms (they're hours old). The terminal check adds no value and causes harm.

## Fix (direction — product to rule)
Drop the terminal-state exclusion → **recency-only WIP** (open in-event, no matching close, within the staleness horizon), OR the precise variant: exclude a terminal item's open ONLY if the open PREDATES the item's `done_ts` (the work concluded), so new/rework opens AFTER done still show. Product picks; confirm DEFECT-002 stays fixed (old phantoms excluded by recency) and DEFECT-009/010 fixed (recent work on any item, terminal or not, shows). Engineer implements; re-check live that a fresh task_start on a done item shows WIP and an old orphan does not. [sha + prod re-check on close]
