# DORA Baseline (computed)

_Generated 2026-06-18T07:22:37Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2543 s | 30 slice(s) |
| Deployment frequency | 6 /active-day | 13 day(s) |
| Change failure rate (deploys only) | 21 % | 15/72 deploys |
| Defect intake rate (separate, NOT in CFR) | 1 /active-day | 15 defect(s) |
| MTTR (median, any prod issue) | 843 s | 25 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 1823 s | 3 slice(s) |
| Deployment frequency | 2 /active-day | 5 day(s) |
| Change failure rate (deploys only) | 17 % | 2/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 0 /active-day | 2 defect(s) |
| MTTR (median, any prod issue) | 32951 s | 3 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 19 | 900 | 265 | 443 |
| solution-architect | 17 | 1200 | 344 | 523 |
| cicd | 13 | 207 | 216 | 363 |
| engineer | 63 | 720 | 720 | 1012 |
| ui-designer | 4 | 540 | 810 | 823 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 13 | 60 | 60 | 169 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step): **orchestrator**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
