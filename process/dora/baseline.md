# DORA Baseline (computed)

_Generated 2026-06-06T08:44:50Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2979 s | 6 slice(s) |
| Deployment frequency | 3 /active-day | 3 day(s) |
| Change failure rate | 33 % | 9 deploy(s) |
| MTTR (median) | 292 s | 3 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 4 | 120 | 95 | 137 |
| solution-architect | 11 | 1200 | 780 | 667 |
| cicd | 9 | 207 | 207 | 384 |
| engineer | 7 | 360 | 360 | 522 |
| tester | 9 | 1200 | 1059 | 1107 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
