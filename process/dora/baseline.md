# DORA Baseline (computed)

_Generated 2026-07-02T07:45:33Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2543 s | 44 slice(s) |
| Deployment frequency | 4 /active-day | 27 day(s) |
| Change failure rate (deploys only) | 16 % | 18/112 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 44 defect(s) |
| MTTR (median, any prod issue) | 2189 s | 45 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | — s | 0 slice(s) |
| Deployment frequency | 2 /active-day | 7 day(s) |
| Change failure rate (deploys only) | 0 % | 0/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 0 /active-day | 2 defect(s) |
| MTTR (median, any prod issue) | 1724 s | 2 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 22 | 900 | 300 | 463 |
| solution-architect | 21 | 1200 | 344 | 588 |
| cicd | 19 | 300 | 300 | 564 |
| engineer | 151 | 1500 | 750 | 1061 |
| ui-designer | 6 | 540 | 750 | 798 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 16 | 60 | 126 | 239 |
| orchestrator | 2 | 900 | 465 | 465 |
| flow-manager | 0 | — | — | — |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 7740 | 2% | 295497 | 44% |
| delivery | 356710 | 98% | 380866 | 56% |

_Plumbing share: time 2%, tokens 44% (token coverage 2% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
