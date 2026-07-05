# DORA Baseline (computed)

_Generated 2026-07-05T13:26:01Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3092 s | 48 slice(s) |
| Deployment frequency | 4 /active-day | 29 day(s) |
| Change failure rate (deploys only) | 21 % | 25/121 deploys |
| Defect intake rate (separate, NOT in CFR) | 2 /active-day | 46 defect(s) |
| MTTR (median, any prod issue) | 1794 s | 49 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 26624 s | 4 slice(s) |
| Deployment frequency | 1 /active-day | 9 day(s) |
| Change failure rate (deploys only) | 54 % | 7/13 deploys |
| Defect intake rate (separate, NOT in CFR) | 0 /active-day | 3 defect(s) |
| MTTR (median, any prod issue) | 64 s | 5 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 24 | 300 | 300 | 445 |
| solution-architect | 21 | 1200 | 344 | 588 |
| cicd | 21 | 300 | 300 | 526 |
| engineer | 168 | 1500 | 826 | 1050 |
| ui-designer | 6 | 540 | 750 | 798 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 16 | 60 | 126 | 239 |
| orchestrator | 2 | 900 | 465 | 465 |
| flow-manager | 2 | 900 | 600 | 600 |

## Plumbing vs delivery (system overhead — EXP-067)

Plumbing = running the agent OS (orchestrator + flow-manager + retro/gate/bookkeeping events); delivery = producing/validating customer value. Watch the plumbing SHARE and its trend.

| class | time (s) | time % | tokens | tokens % |
|-------|----------|--------|--------|----------|
| plumbing | 10987 | 3% | 666755 | 23% |
| delivery | 377767 | 97% | 2285878 | 77% |

_Plumbing share: time 3%, tokens 23% (token coverage 7% of task_end rows — grows as dispatches log --tokens, v59)._

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
