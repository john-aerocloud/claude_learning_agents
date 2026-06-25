# DORA Baseline (computed)

_Generated 2026-06-25T15:52:33Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2543 s | 42 slice(s) |
| Deployment frequency | 5 /active-day | 20 day(s) |
| Change failure rate (deploys only) | 19 % | 18/93 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 40 defect(s) |
| MTTR (median, any prod issue) | 2189 s | 43 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 1565 s | 5 slice(s) |
| Deployment frequency | 4 /active-day | 3 day(s) |
| Change failure rate (deploys only) | 25 % | 3/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 4 /active-day | 13 defect(s) |
| MTTR (median, any prod issue) | 3373 s | 8 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 20 | 900 | 282 | 466 |
| solution-architect | 18 | 1200 | 374 | 627 |
| cicd | 18 | 600 | 300 | 579 |
| engineer | 111 | 1500 | 960 | 1240 |
| ui-designer | 6 | 540 | 750 | 798 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 15 | 60 | 135 | 247 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 7710 | 2% | 0 | — |
| delivery | 316892 | 98% | 0 | — |

_Plumbing share: time 2%, tokens — (token coverage 0% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **engineer**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
