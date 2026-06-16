# DORA Baseline (computed)

_Generated 2026-06-16T14:02:24Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 27 slice(s) |
| Deployment frequency | 7 /active-day | 10 day(s) |
| Change failure rate | 43 % | 67 deploy(s) |
| MTTR (median) | 843 s | 25 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 16 | 900 | 282 | 484 |
| solution-architect | 14 | 1200 | 420 | 568 |
| cicd | 12 | 207 | 224 | 375 |
| engineer | 61 | 720 | 720 | 1027 |
| ui-designer | 4 | 540 | 810 | 823 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 13 | 60 | 60 | 169 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step): **orchestrator**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
