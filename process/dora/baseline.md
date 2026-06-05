# DORA Baseline (computed)

_Generated 2026-06-05T18:53:19Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2340 s | 5 slice(s) |
| Deployment frequency | 3 /active-day | 2 day(s) |
| Change failure rate | 33 % | 6 deploy(s) |
| MTTR (median) | 257 s | 2 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 3 | 120 | 120 | 159 |
| solution-architect | 9 | 1200 | 900 | 780 |
| cicd | 6 | 1080 | 152 | 297 |
| engineer | 6 | 360 | 240 | 489 |
| tester | 7 | 1200 | 1059 | 943 |
| orchestrator | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
