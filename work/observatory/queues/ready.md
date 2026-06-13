# Ready queue — observatory

Sorted by vc_ratio descending (defects pre-empt regardless of ratio).
Buffer: min_items=2 / wip_limit=4. Depth: 0 (BELOW floor=2 — replenishment signal ACTIVE).

_Last updated: 2026-06-13 iteration 9 sweep (part 2)_

| pos | item_id | value | cost | vc_ratio | enqueued_ts | reason |
|-----|---------|-------|------|----------|-------------|--------|

Queue empty. UC-S018-2 was enqueued this sweep but already atomically pulled by the engineer (01:29:51Z, ui-designer structure pass exit triggered pull).

## In-flight (not in queue — claimed seams)
| item_id     | state     | seams claimed                        | note                                                                                         |
|-------------|-----------|--------------------------------------|----------------------------------------------------------------------------------------------|
| UC-S018-2   | in-flight | CodStep.jsx + codScorer.js + ui-design.md (CoD step) | Engineer building — TDD per ui-design.md brief; structure pass complete |

## Floor status
Ready depth=0 < min_items=2. Replenishment signal ACTIVE.

Next DAG-ready item: UC-S018-3 (chain-blocked on UC-S018-2; unlocks on UC-S018-2 tester PASS).
CHK-6 has 3 forecast slices beyond s015 but operator-usage-gated — do NOT auto-decompose.

## Queue state (post-sweep)

| Queue   | depth | min_items | wip_limit | status |
|---------|-------|-----------|-----------|--------|
| intake  | 0     | 2         | 10        | below floor — no items pending intake; no new work to decompose this cycle |
| ready   | 0     | 2         | 4         | BELOW FLOOR — REPLENISHMENT SIGNAL ACTIVE; UC-S018-3 unlocks after UC-S018-2 pass |
| deploy  | 0     | 0         | 1         | ok |
| rework  | 0     | 0         | 2         | ok |
| staging | 0     | 0         | 20        | ok (drained) |
