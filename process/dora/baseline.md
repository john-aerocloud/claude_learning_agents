# DORA Baseline (computed)

_Generated 2026-06-06T15:13:48Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3618 s | 7 slice(s) |
| Deployment frequency | 5 /active-day | 3 day(s) |
| Change failure rate | 27 % | 15 deploy(s) |
| MTTR (median) | 3054 s | 4 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 4 | 120 | 95 | 137 |
| solution-architect | 12 | 1200 | 660 | 656 |
| cicd | 9 | 207 | 207 | 384 |
| engineer | 7 | 360 | 360 | 522 |
| tester | 10 | 1200 | 1130 | 1536 |
| orchestrator | 1 | 900 | 900 | 900 |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester** (median 1130s)
- Recommended exploit/subordinate action (v27): the tester's cost is driven by
  the QUALITY of work arriving at it — the costliest defect (DEFECT-005-001,
  MTTR 5807s) had 4/6 root causes that were browser-only and gave a FALSE GREEN
  to the node-level probe run before hand-off. EXPLOIT: move browser/transport/
  policy detection upstream of the tester — engineer drives the §17 walking-
  skeleton probe in a REAL browser (Playwright / Playwright MCP), not node;
  lands wire-on-deploy + code↔policy contract tests; tester carries ≥1 browser-
  transport spec + honest harness (no actionable click on disabled). Capability:
  IMP-006. Next constraint to watch after this lands: solution-architect
  (median 660s) or prod-defect MTTR depth itself.
