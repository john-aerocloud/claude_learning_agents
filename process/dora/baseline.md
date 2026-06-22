# DORA Baseline (computed)

_Generated 2026-06-22T22:35:53Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2566 s | 37 slice(s) |
| Deployment frequency | 5 /active-day | 18 day(s) |
| Change failure rate (deploys only) | 18 % | 15/82 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 29 defect(s) |
| MTTR (median, any prod issue) | 992 s | 32 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 7492 s | 7 slice(s) |
| Deployment frequency | 2 /active-day | 7 day(s) |
| Change failure rate (deploys only) | 8 % | 1/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 14 defect(s) |
| MTTR (median, any prod issue) | 7800 s | 7 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 19 | 900 | 265 | 443 |
| solution-architect | 17 | 1200 | 344 | 523 |
| cicd | 16 | 300 | 270 | 576 |
| engineer | 88 | 1500 | 840 | 1082 |
| ui-designer | 5 | 540 | 600 | 778 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 14 | 60 | 98 | 200 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 3660 | 1% | 0 | — |
| delivery | 265099 | 99% | 0 | — |

_Plumbing share: time 1%, tokens — (token coverage 0% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **orchestrator**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
