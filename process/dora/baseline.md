# DORA Baseline (computed)

_Generated 2026-06-05T16:55:38Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2340 s | 3 slice(s) |
| Deployment frequency | 2 /active-day | 2 day(s) |
| Change failure rate | 0 % | 4 deploy(s) |
| MTTR (median) | — s | 0 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 0 | — | — | — |
| solution-architect | 6 | 1200 | 1050 | 1000 |
| cicd | 2 | 1080 | 690 | 690 |
| engineer | 1 | 360 | 360 | 360 |
| tester | 3 | 1200 | 1200 | 1500 |
| orchestrator | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
