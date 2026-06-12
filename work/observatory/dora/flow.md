# Flow view — observatory

_Generated 2026-06-12T15:39:43Z from ledger.csv + queues/policy.csv. Do not hand-edit._

## Queues — buffer control + statistical metrics

Buffer control per queue = **min_items** (replenish floor) + **WIP limit** (cap). Metrics: **length** (now), **throughput** (dequeues/active-day), **dwell** (enqueue→dequeue, the time to be taken off the queue — the queue's slice of GLT), **rework rate** (re-entries ÷ items).

| Queue | min_items | WIP limit | length | throughput /day | dwell median (s) | rework rate | items through |
|-------|-----------|-----------|--------|-----------------|------------------|-------------|---------------|
| intake | 2 | 10 | 5 | — | — | 0.00 | 0 |
| ready | 2 | 4 | 1 | 4 | 57648 | 0.00 | 8 |

## Time thieves (wall-clock not spent doing the work)

| Thief | Value | Source |
|-------|-------|--------|
| Queue dwell (all queues) | 507048 s | enqueue->dequeue pairs = the wait part of GLT |
| Hidden-edge collisions | 2 | declared independence proven false (s13) |
| Parallelism efficiency | 0.89 | achieved / max independent set |

### Collisions (-> correct the dependency tree)

| when | item | other (ref) | shared seam (note) |
|------|------|-------------|--------------------|
| 2026-06-09T01:48:05Z | UC-S002-4 | UC-S002-4 | UC4+UC5 both claim PipelineMap.jsx seam -> serialize (§39); not disjoint at render integration |
| 2026-06-11T10:47:18Z | UC-S013-2 | COLLISION-OBS-S13-S15 | hidden edge UC-S013-2 vs UC-S015-2: shared seam ObservatoryView.jsx (tabpanel wiring + onSteer threading). Engineer serialised by commit order (ae7aa28 before b21cffc) without choreography — caught at integration, not pre-build. Edge S13UC2->S15UC2 added to use-case-deps.mmd (classDef changed). Rework cost: zero additional rework (no revert/fix needed; commit order was sufficient). Time thief attribution: ~0 code rework but ~5 min serialisation wait. component-map.mmd adjacency (UC-S014-3 vs UC-S015-2) is commit-granularity only — no logic collision, no edge to add. |

## Per-item lead time (created -> shipped)

| item | lead (s) | queue dwell (s) | service (s) | wait share |
|------|----------|-----------------|-------------|------------|
|  122 tests | — | 0 | 316 | — |
|  13 a11y/geo conditions | — | 0 | 0 | — |
|  18 tests | — | 0 | 154 | — |
|  6 UCs (UC1-4 independent | — | 0 | 0 | — |
|  GEO+A11Y all | — | 0 | 136 | — |
|  GEO/A11Y | — | 0 | 0 | — |
|  Ready empty - bootstrap replenishment | — | 0 | 0 | — |
|  Vitest/jsdom | — | 0 | 0 | — |
|  header-only=[] | — | 0 | 720 | — |
|  lanes | — | 0 | 0 | — |
|  latency ~100ms (<1s) | — | 0 | 302 | — |
|  missing-artifact soft; 11 tests | — | 0 | 109 | — |
|  mount deferred to integration | — | 0 | 0 | — |
|  not 4 buffer queues. Defect: empty queues -> map shows nothing; inner-dev-loop stages not drawn. Data exists in ledger. Awaiting stage-model confirm | — | 0 | 0 | — |
|  path-traversal guarded; 21 tests | — | 0 | 205 | — |
|  vertical dashboard | — | 0 | 0 | — |
| 004-value-stream-map | 399 | 0 | 0 | 0% |
| 3 | — | 0 | 0 | — |
| CHK-1 | 139460 | 0 | 0 | 0% |
| CHK-2 | 136251 | 0 | 720 | 0% |
| CHK-3 | 49915 | 0 | 900 | 0% |
| CHK-4 | 69302 | 0 | 0 | 0% |
| CHK-5 | 404 | 0 | 2034 | 0% |
| CHK-6 | 2086 | 0 | 1465 | 0% |
| CHK-7 | 52957 | 0 | 815 | 0% |
| CHK-8 | 1327 | 0 | 0 | 0% |
| D7-AC-7 | — | 0 | 0 | — |
| DEF-011 | — | 0 | 0 | — |
| DEF-012 | 1182 | 0 | 2700 | 0% |
| DEF-013 | — | 0 | 0 | — |
| DEFECT-005 | — | 0 | 1320 | — |
| DEFECT-006 | 804 | 0 | 1389 | 0% |
| DEFECT-010 | — | 0 | 1200 | — |
| DEFECT-011 | — | 0 | 0 | — |
| FLOW-MGR-ITER8 | 47 | 0 | 0 | 0% |
| FLOW-MGR-ITER8-FINISH | 236 | 0 | 0 | 0% |
| FLOW-MGR-ITER9 | 162 | 0 | 0 | 0% |
| REQ-OBSERVATORY | — | 0 | 0 | — |
| S2-UC1 | 283 | 0 | 1860 | 0% |
| SLC-S014 | 81 | 0 | 0 | 0% |
| SLC-S015 | — | 0 | 0 | — |
| SLC-S018 | — | 0 | 0 | — |
| SLC-vision | 4 | 0 | 180 | 0% |
| UC-S001-1 | 51358 | 0 | 1021 | 0% |
| UC-S001-2 | — | 0 | 720 | — |
| UC-S001-3 | 51702 | 0 | 2640 | 0% |
| UC-S001-4 | — | 0 | 0 | — |
| UC-S001-5 | 52055 | 0 | 498 | 0% |
| UC-S001-6 | 2517 | 0 | 810 | 0% |
| UC-S002-1 | — | 0 | 357 | — |
| UC-S002-2 | — | 0 | 0 | — |
| UC-S002-3 | — | 0 | 516 | — |
| UC-S002-4 | — | 0 | 486 | — |
| UC-S002-5 | 462 | 0 | 1043 | 0% |
| UC-S002-6 | — | 0 | 1927 | — |
| UC-S003-1 | — | 0 | 0 | — |
| UC-S003-2 | — | 0 | 0 | — |
| UC-S003-3 | — | 0 | 0 | — |
| UC-S003-4 | — | 0 | 0 | — |
| UC-S004-1 | — | 0 | 420 | — |
| UC-S004-2 | 376 | 0 | 540 | 0% |
| UC-S004-5 | — | 0 | 0 | — |
| UC-S004-6 | 188 | 0 | 1500 | 0% |
| UC-S005-1 | — | 0 | 0 | — |
| UC-S005-2 | 2857 | 0 | 2280 | 0% |
| UC-S005-3 | 498 | 0 | 3600 | 0% |
| UC-S005-4 | — | 0 | 0 | — |
| UC-S005-5 | 1247 | 0 | 1320 | 0% |
| UC-S005-6 | 597 | 0 | 720 | 0% |
| UC-S013-1 | 53393 | 52921 | 721 | 99% |
| UC-S013-2 | 10304 | 1520 | 8924 | 15% |
| UC-S013-3 | — | 0 | 0 | — |
| UC-S014-1 | 2105 | 23 | 3193 | 1% |
| UC-S014-2 | 2255 | 2710 | 7595 | 120% |
| UC-S014-3 | — | 0 | 700 | — |
| UC-S014-4 | — | 0 | 17955 | — |
| UC-S015-1 | 54981 | 52930 | 2635 | 96% |
| UC-S015-2 | — | 0 | 1378 | — |
| UC-S015-3 | — | 0 | 17215 | — |
| UC-S015-4 | — | 0 | 0 | — |
| UC-S018-1 | — | 0 | 0 | — |
| UC-S018-2 | — | 0 | 0 | — |
| UC-S018-3 | — | 0 | 0 | — |
| UC-S018-4 | — | 0 | 0 | — |
| flow-manager-sweep | 223 | 0 | 0 | 0% |
| s001-read-layer | — | 0 | 0 | — |
| s002-pipeline-map | — | 0 | 0 | — |
| s003-dora-panel | — | 0 | 1500 | — |
| s004-value-stream-map | 4 | 0 | 900 | 0% |
| s005 | — | 0 | 0 | — |
| s005-drill-down | 11 | 0 | 0 | 0% |
| s005-workitem-tree | — | 0 | 0 | — |
| s006-single-server | — | 0 | 0 | — |
| s008-throughput-rate | — | 0 | 0 | — |
| s009-wip-recency | — | 0 | 0 | — |
| s011-retro-v47 | — | 0 | 0 | — |
| s014-steer-prompt-handoff | — | 0 | 1320 | — |
| s015-wip-navigate-reslice-preview | — | 0 | 1320 | — |
| s019-atomic-pull | — | 0 | 0 | — |

_Every metric ties back to the two system numbers: Σ dwell across queues is the WAIT part of gross lead time; the throughput of the binding (lowest-throughput) queue is system throughput; rework rate inflates both. Hidden-edge rate (collisions/slice) and false-edge rate live in architecture/dependencies/edge-ledger.md._
