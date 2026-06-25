# DORA Baseline (computed)

_Generated 2026-06-25T10:52:11Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3092 s | 40 slice(s) |
| Deployment frequency | 4 /active-day | 20 day(s) |
| Change failure rate (deploys only) | 20 % | 18/89 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 37 defect(s) |
| MTTR (median, any prod issue) | 1992 s | 38 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 11109 s | 5 slice(s) |
| Deployment frequency | 2 /active-day | 6 day(s) |
| Change failure rate (deploys only) | 25 % | 3/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 3 /active-day | 16 defect(s) |
| MTTR (median, any prod issue) | 6150 s | 10 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 19 | 900 | 265 | 443 |
| solution-architect | 18 | 1200 | 374 | 627 |
| cicd | 17 | 300 | 300 | 578 |
| engineer | 105 | 1500 | 1020 | 1234 |
| ui-designer | 6 | 540 | 750 | 798 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 15 | 60 | 135 | 247 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 3660 | 1% | 0 | — |
| delivery | 307352 | 99% | 0 | — |

_Plumbing share: time 1%, tokens — (token coverage 0% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **engineer**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
