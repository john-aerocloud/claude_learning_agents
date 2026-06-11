# DEFECT-005 — traceability reveal shows meaningless raw row numbers

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** MED-HIGH (defeats the CORE "every figure drillable to source" goal)

## Resolution
Server (`ledgerAggregator`) emits `source_events: [{ts,agent,event,item_id}]` + `source_total` (sha b4b7dc1); client `MetricSource` renders readable lines (`HH:MM · agent · event · item`) + names `process/dora/ledger.csv` + "…and N more", no `row:N` (sha d7a99c9). 398 unit + 33 browser green. Verified live after a controlled :5173 restart (server-side change): `source_events` present, readable, total 88, no row:N. Gap → EXP-033 sharpened (human-facing drill/source affordances validated for human-MEANINGFULNESS, not just presence of a data-source attribute).

## Four fields
- **Expected:** Hovering a figure to see its "source" shows something a human can understand and verify — which events/items produced the number (e.g. timestamp · agent · event · item), naming the source file.
- **Actual:** Shows a bare list of internal CSV line indices — `row:700, row:701, …` (engineer throughput = 85 of them) — meaningless without opening ledger.csv and counting lines.
- **Intent:** Trace a figure back to its source (§8 traceability NFR; J1 "drillable to source").
- **Importance:** The traceability affordance is unusable as built — it defeats a CORE design goal and confuses rather than informs.

## Reproduction (confirmed, live :5173)
`GET /stage-flow` → `source_rows: ["row:700","row:701",…]` (engineer 85, decompose 24, ready 3). `MetricSource.jsx` renders each `row:N` literally as a `<li>`. No event content, no human context, no usable file reference.

## Classification (§5a)
Our bug — UX/design. The aggregator emits internal row indices; the reveal shows them verbatim. "Link to file+row" (§8) was implemented as the row INDEX rather than the row CONTENT.

## Root cause (latent)
Traceability was built to satisfy "has a data-source" (the audit-hook AC) without asking "can a human READ this and verify the claim?" A source reference must be human-meaningful, not a machine-internal pointer.

## Fix
The reveal shows the actual contributing ledger EVENTS in human-readable form (e.g. `2026-06-09 14:36 · engineer · stage_exit · UC-S001-1`), names the source file (`process/dora/ledger.csv`), and handles many rows sensibly (cap + "…and N more", or group by item). The `data-source` audit hook can stay, but what the operator SEES must be readable. ui-designer rules the presentation; engineer emits readable source data + renders. [sha + prod re-check on close]
