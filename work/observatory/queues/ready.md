# Ready queue — observatory

Sorted by vc_ratio descending (defects pre-empt regardless of ratio).
Buffer: min_items=2 / wip_limit=4. Depth: 1 (BELOW floor=2 — replenishment signal ACTIVE).

_Last updated: 2026-06-12 iteration 9 sweep_

| pos | item_id     | value | cost | vc_ratio | enqueued_ts              | reason                                                                                                 |
|-----|-------------|-------|------|----------|--------------------------|--------------------------------------------------------------------------------------------------------|
|   1 | UC-S018-1   | MED   | 1.33 | 1.50     | 2026-06-12T15:36:38Z     | UC-S014-4 cross-slice gate OPEN (CHK-5 done 15:33:59Z); SPA scaffold done; DAG-ready |

## In-flight (not in queue — claimed seams)
| item_id     | state     | seams claimed                        | note                                                                                         |
|-------------|-----------|--------------------------------------|----------------------------------------------------------------------------------------------|
| UC-S013-3   | in-flight | DefectDrillContainer.jsx + DefectDetail.jsx + MttrCard.jsx + lib/markdown.js | Resume build (defects drill-down + MTTR card) |
| UC-S015-4   | in-flight | promptBuilder.js re-slice path + templates/steer-prompts/re-slice.js + ReslicePreviewPanel prompt-output wiring | Enriched re-slice/split prompt — SEAM HOLD released |
| DEF-013     | in-flight | ledgerAggregator.js (aggregator coherence warning) | Axis-2 aggregator coherence fix |

## Floor status
Ready depth=1 < min_items=2. Replenishment signal ACTIVE.

Verdict-pending: UC-S013-4 (vc=1.33; SSE refresh for defects) blocked on UC-S013-3 (in-flight — cannot enqueue until tester pass).
CHK-6 has 3 forecast slices beyond s015 but operator-usage-gated — do NOT auto-decompose; note only.
On UC-S013-3 tester PASS: UC-S013-4 becomes DAG-ready → enqueue to ready pos=2 (below UC-S018-1 by vc_ratio 1.33 vs 1.50).
Two items at or above floor requires product decompose of next slice OR UC-S013-3 completing + UC-S013-4 enqueue.
