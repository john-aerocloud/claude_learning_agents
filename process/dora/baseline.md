# DORA Baseline (computed)

_Generated 2026-07-02T14:55:39Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3092 s | 46 slice(s) |
| Deployment frequency | 4 /active-day | 27 day(s) |
| Change failure rate (deploys only) | 16 % | 19/118 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 44 defect(s) |
| MTTR (median, any prod issue) | 2218 s | 46 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 43972 s | 2 slice(s) |
| Deployment frequency | 2 /active-day | 7 day(s) |
| Change failure rate (deploys only) | 8 % | 1/13 deploys |
| Defect intake rate (separate, NOT in CFR) | 0 /active-day | 2 defect(s) |
| MTTR (median, any prod issue) | 2690 s | 3 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 22 | 900 | 300 | 463 |
| solution-architect | 20 | 1200 | 374 | 608 |
| cicd | 20 | 300 | 300 | 538 |
| engineer | 153 | 1500 | 782 | 1061 |
| ui-designer | 6 | 540 | 750 | 798 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 15 | 60 | 135 | 247 |
| orchestrator | 2 | 900 | 465 | 465 |
| flow-manager | 0 | — | — | — |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 7740 | 2% | 330509 | 20% |
| delivery | 358590 | 98% | 1282747 | 80% |

_Plumbing share: time 2%, tokens 20% (token coverage 5% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
