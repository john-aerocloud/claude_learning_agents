# DORA Baseline (computed)

_Generated 2026-06-05T09:04:43Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2340 s | 3 slice(s) |
| Deployment frequency | 2 /active-day | 2 day(s) |
| Change failure rate | 0 % | 3 deploy(s) |
| MTTR (median) | — s | 0 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 0 | — | — | — |
| solution-architect | 3 | 1200 | 1200 | 1100 |
| cicd | 0 | — | — | — |
| engineer | 0 | — | — | — |
| tester | 3 | 1200 | 1200 | 1500 |
| orchestrator | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (agent work, slowest median step): **solution-architect** (1200s median, n=3, mean 1100s — stable)
- Constraint (wall-clock gross lead time): **session continuity** — fast slices (001: 31min, 003: 39min) completed in-session; slow slice (002: 8h21min) had tester session cross overnight. Session boundaries, not gate count, drive the variance.
- Recommended exploit: process v7 §4 session continuity guidelines — don't dispatch tester near end of session; run retro immediately after delivery; complete requirement workflow + first slice in one session.
- v7 targets: mean gross lead time < 3600s; time-to-first-deploy < 90min; delivery gap < 15min in-session.
- Note: ox uses tester-pass-as-deploy (local CLI exception). Cloud projects log deploy at CI/CD completion. See process §12.
