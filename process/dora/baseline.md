# DORA Baseline (computed)

_Generated 2026-07-05T07:47:04Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3092 s | 46 slice(s) |
| Deployment frequency | 4 /active-day | 28 day(s) |
| Change failure rate (deploys only) | 16 % | 19/118 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 44 defect(s) |
| MTTR (median, any prod issue) | 2218 s | 46 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 43972 s | 2 slice(s) |
| Deployment frequency | 2 /active-day | 8 day(s) |
| Change failure rate (deploys only) | 8 % | 1/13 deploys |
| Defect intake rate (separate, NOT in CFR) | 0 /active-day | 2 defect(s) |
| MTTR (median, any prod issue) | 2690 s | 3 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 22 | 900 | 300 | 463 |
| solution-architect | 21 | 1200 | 344 | 588 |
| cicd | 20 | 300 | 300 | 538 |
| engineer | 154 | 1500 | 796 | 1060 |
| ui-designer | 6 | 540 | 750 | 798 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 16 | 60 | 126 | 239 |
| orchestrator | 2 | 900 | 465 | 465 |
| flow-manager | 0 | — | — | — |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 7740 | 2% | 295497 | 19% |
| delivery | 360530 | 98% | 1236600 | 81% |

_Plumbing share: time 2%, tokens 19% (token coverage 4% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
