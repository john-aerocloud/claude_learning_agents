# DEFECT-008 — source-event reveal shows an opaque item id, no "why"

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** LOW-MED (comprehensibility on the drill-to-source; continues DEFECT-005)

## Resolution
Aggregator carries `note` in `source_events` → `{ts,agent,event,item_id,note}`; MetricSource renders `HH:MM · agent · event · item_id — <note>` (note ellipsised at 120; em-dash dropped when empty). sha `e54f590`. 456 unit + 44 browser green. Verified ephemeral :5205 real data: `SLC-vision` now reads "— Gate-1 vision: JTBD + success measures authored". :5173 restart batched with DEFECT-007. Gap → EXP-033 data point (surface an event/item reference WITH its human note/description, not just the id — DEFECT-005/008 same class).

## Four fields
- **Expected:** the hover reveal conveys WHY each event happened — human context, not just an opaque id (`SLC-vision` says nothing about what was done).
- **Actual:** shows `14:50 · product · task_start · SLC-vision` — agent + event + bare item id, no context.
- **Intent:** understand what the work behind a number actually was (trace + comprehend).
- **Importance:** the drill-to-source is readable (DEFECT-005) but still not meaningful — the id alone doesn't explain the work.

## Reproduction (confirmed, live :5173)
`/stage-flow` `source_events` carry only `{ts, agent, event, item_id}`. But the underlying ledger row HAS a rich `note`: `680: …,product,task_start,,,Gate-1 vision: JTBD + success measures authored,SLC-vision,` — the aggregator reads the row but DROPS `note` (the most meaningful field) when building `source_events`.

## Classification (§5a)
Our bug — the aggregator omits the ledger `note` (the human "why") from source_events; the reveal can only show the id.

## Root cause (latent)
`source_events` was shaped `{ts,agent,event,item_id}` (DEFECT-005) — readable, but it left out the one field that carries intent. Surfacing an identifier without its human description is the same class as DEFECT-005 (machine ref vs human meaning), one level deeper.

## Fix
Aggregator includes `note` in each `source_event`. MetricSource renders it: `HH:MM · agent · event · item_id — <note>` (note trimmed/capped sensibly). Where a note is empty, fall back to the item's `job` (from items.csv, joined by item_id) or just the id. Engineer implements; small ui polish for the longer line. Re-check live: hovering shows "…· product · task_start · SLC-vision — Gate-1 vision: JTBD + success measures authored". [sha + prod re-check on close]
