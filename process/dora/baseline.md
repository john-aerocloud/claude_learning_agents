# DORA Baseline (computed)

_Generated 2026-06-08T12:55:39Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3972 s | 18 slice(s) |
| Deployment frequency | 8 /active-day | 5 day(s) |
| Change failure rate | 26 % | 42 deploy(s) |
| MTTR (median) | 2033 s | 8 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 6 | 120 | 210 | 241 |
| solution-architect | 14 | 1200 | 420 | 568 |
| cicd | 12 | 207 | 224 | 375 |
| engineer | 45 | 720 | 720 | 1031 |
| ui-designer | 3 | 540 | 540 | 737 |
| tester | 11 | 1200 | 1200 | 1680 |
| documenter | 12 | 60 | 60 | 168 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
