# DORA Baseline (computed)

_Generated 2026-06-05T17:41:06Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2211 s | 4 slice(s) |
| Deployment frequency | 2 /active-day | 2 day(s) |
| Change failure rate | 20 % | 5 deploy(s) |
| MTTR (median) | 222 s | 1 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 1 | 120 | 120 | 120 |
| solution-architect | 7 | 1200 | 900 | 969 |
| cicd | 4 | 1080 | 270 | 418 |
| engineer | 4 | 360 | 240 | 347 |
| tester | 5 | 1200 | 1200 | 1058 |
| orchestrator | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
