# DORA Baseline (computed)

_Generated 2026-06-07T14:44:20Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 4232 s | 10 slice(s) |
| Deployment frequency | 7 /active-day | 4 day(s) |
| Change failure rate | 28 % | 29 deploy(s) |
| MTTR (median) | 2033 s | 8 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 4 | 120 | 95 | 137 |
| solution-architect | 13 | 1200 | 540 | 611 |
| cicd | 11 | 207 | 240 | 404 |
| engineer | 25 | 360 | 426 | 876 |
| tester | 11 | 1200 | 1200 | 1680 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
