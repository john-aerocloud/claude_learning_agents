# Ready queue — observatory

Sorted by vc_ratio descending (defects pre-empt regardless of ratio).
Buffer: min_items=2 / wip_limit=4. Depth: 1 (BELOW floor=2 — replenishment signal ACTIVE).

_Last updated: 2026-06-11 iteration 9 sweep_

| pos | item_id     | value | cost | vc_ratio | enqueued_ts              | reason                                                                                                 |
|-----|-------------|-------|------|----------|--------------------------|--------------------------------------------------------------------------------------------------------|
|   1 | UC-S013-2   | HIGH  | 2.5h | 1.60     | 2026-06-11T07:44:00Z     | DAG-ready: UC-S013-1 tester-passed (done 07:43:41Z); seams DefectsPanel.jsx disjoint from in-flight UC-S014-2+UC-S015-1 |

## In-flight (not in queue — claimed seams)
| item_id     | state     | seams claimed                        | note                                                                                         |
|-------------|-----------|--------------------------------------|----------------------------------------------------------------------------------------------|
| UC-S014-2   | in-flight | SteerPanel.jsx + useSteerContext.js   | Tester validating in prod (built 07:40:10Z sha 1111636)                                      |
| UC-S015-1   | in-flight | WipPanel.jsx + useWipItems.js         | Tester validating in prod (built 07:42:09Z sha b7ec8a8+d872ac2)                              |

## Floor status
Ready depth=1 < min_items=2. Replenishment signal active.
On tester PASS for UC-S014-2: UC-S014-3 (vc=1.33; seams lib/promptBuilder.js+templates/steer-prompts/) becomes DAG-ready — enqueue to ready pos=2.
On tester PASS for UC-S015-1: UC-S015-2 (vc=2.00; seams SteerMenu.jsx read-only reuse) becomes DAG-ready — enqueue to ready pos=1 (pre-empts by vc).
Both passes → ready depth=3, floor satisfied. Loop continues without pause.
