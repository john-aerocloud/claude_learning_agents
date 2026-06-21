# DORA Baseline (computed)

_Generated 2026-06-21T13:10:24Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2520 s | 35 slice(s) |
| Deployment frequency | 5 /active-day | 16 day(s) |
| Change failure rate (deploys only) | 19 % | 15/79 deploys |
| Defect intake rate (separate, NOT in CFR) | 1 /active-day | 21 defect(s) |
| MTTR (median, any prod issue) | 892 s | 28 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 1506 s | 8 slice(s) |
| Deployment frequency | 2 /active-day | 6 day(s) |
| Change failure rate (deploys only) | 8 % | 1/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 1 /active-day | 6 defect(s) |
| MTTR (median, any prod issue) | 37341 s | 3 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 19 | 900 | 265 | 443 |
| solution-architect | 17 | 1200 | 344 | 523 |
| cicd | 16 | 300 | 270 | 576 |
| engineer | 78 | 1500 | 766 | 1100 |
| ui-designer | 4 | 540 | 810 | 823 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 13 | 60 | 60 | 169 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 1920 | 1% | 0 | — |
| delivery | 250279 | 99% | 0 | — |

_Plumbing share: time 1%, tokens — (token coverage 0% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **orchestrator**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
