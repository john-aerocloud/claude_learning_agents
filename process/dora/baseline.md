# DORA Baseline (computed)

_Generated 2026-06-06T14:59:44Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 7 slice(s) |
| Deployment frequency | 5 /active-day | 3 day(s) |
| Change failure rate | 27 % | 15 deploy(s) |
| MTTR (median) | 3054 s | 4 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 4 | 120 | 95 | 137 |
| solution-architect | 12 | 1200 | 660 | 656 |
| cicd | 9 | 207 | 207 | 384 |
| engineer | 7 | 360 | 360 | 522 |
| tester | 10 | 1200 | 1130 | 1536 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
