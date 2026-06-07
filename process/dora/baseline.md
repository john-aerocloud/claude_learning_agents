# DORA Baseline (computed)

_Generated 2026-06-07T09:42:16Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 9 slice(s) |
| Deployment frequency | 6 /active-day | 4 day(s) |
| Change failure rate | 32 % | 25 deploy(s) |
| MTTR (median) | 2033 s | 8 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 4 | 120 | 95 | 137 |
| solution-architect | 12 | 1200 | 660 | 656 |
| cicd | 10 | 207 | 224 | 384 |
| engineer | 20 | 360 | 390 | 519 |
| tester | 10 | 1200 | 1130 | 1536 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
