# DORA Baseline (computed)

_Generated 2026-06-08T09:01:36Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 17 slice(s) |
| Deployment frequency | 8 /active-day | 5 day(s) |
| Change failure rate | 28 % | 40 deploy(s) |
| MTTR (median) | 2033 s | 8 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 6 | 120 | 210 | 241 |
| solution-architect | 14 | 1200 | 420 | 568 |
| cicd | 12 | 207 | 224 | 375 |
| engineer | 41 | 360 | 720 | 1053 |
| ui-designer | 2 | 540 | 356 | 356 |
| tester | 11 | 1200 | 1200 | 1680 |
| documenter | 12 | 60 | 60 | 168 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
