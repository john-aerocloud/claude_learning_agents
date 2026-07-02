# DORA Baseline (computed)

_Generated 2026-07-02T20:27:55Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2566 s | 47 slice(s) |
| Deployment frequency | 4 /active-day | 27 day(s) |
| Change failure rate (deploys only) | 18 % | 21/120 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 44 defect(s) |
| MTTR (median, any prod issue) | 2189 s | 47 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 12931 s | 3 slice(s) |
| Deployment frequency | 2 /active-day | 7 day(s) |
| Change failure rate (deploys only) | 25 % | 3/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 0 /active-day | 1 defect(s) |
| MTTR (median, any prod issue) | 759 s | 3 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 22 | 900 | 300 | 463 |
| solution-architect | 20 | 1200 | 374 | 608 |
| cicd | 21 | 300 | 300 | 526 |
| engineer | 153 | 1500 | 782 | 1061 |
| ui-designer | 6 | 540 | 750 | 798 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 15 | 60 | 135 | 247 |
| orchestrator | 2 | 900 | 465 | 465 |
| flow-manager | 1 | 900 | 900 | 900 |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 8640 | 2% | 666755 | 24% |
| delivery | 359089 | 98% | 2152057 | 76% |

_Plumbing share: time 2%, tokens 24% (token coverage 8% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **flow-manager**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
