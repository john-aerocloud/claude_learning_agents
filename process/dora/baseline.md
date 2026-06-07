# DORA Baseline (computed)

_Generated 2026-06-07T22:24:47Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 15 slice(s) |
| Deployment frequency | 9 /active-day | 4 day(s) |
| Change failure rate | 25 % | 36 deploy(s) |
| MTTR (median) | 2033 s | 8 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 5 | 120 | 120 | 206 |
| solution-architect | 14 | 1200 | 420 | 568 |
| cicd | 12 | 207 | 224 | 375 |
| engineer | 34 | 720 | 699 | 1064 |
| ui-designer | 0 | — | — | — |
| tester | 11 | 1200 | 1200 | 1680 |
| documenter | 12 | 60 | 60 | 168 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
