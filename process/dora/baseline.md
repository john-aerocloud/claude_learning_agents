# DORA Baseline (computed)

_Generated 2026-06-10T15:23:13Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 21 slice(s) |
| Deployment frequency | 7 /active-day | 7 day(s) |
| Change failure rate | 45 % | 47 deploy(s) |
| MTTR (median) | 842 s | 18 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 9 | 900 | 300 | 381 |
| solution-architect | 14 | 1200 | 420 | 568 |
| cicd | 12 | 207 | 224 | 375 |
| engineer | 58 | 720 | 720 | 997 |
| ui-designer | 4 | 540 | 810 | 823 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 12 | 60 | 60 | 168 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step): **orchestrator**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
