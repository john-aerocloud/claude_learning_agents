# DORA Baseline (computed)

_Generated 2026-06-08T06:40:15Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 15 slice(s) |
| Deployment frequency | 7 /active-day | 5 day(s) |
| Change failure rate | 25 % | 36 deploy(s) |
| MTTR (median) | 2033 s | 8 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 6 | 120 | 210 | 241 |
| solution-architect | 14 | 1200 | 420 | 568 |
| cicd | 12 | 207 | 224 | 375 |
| engineer | 36 | 720 | 699 | 1045 |
| ui-designer | 1 | 540 | 540 | 540 |
| tester | 11 | 1200 | 1200 | 1680 |
| documenter | 12 | 60 | 60 | 168 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
