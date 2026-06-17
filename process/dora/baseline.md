# DORA Baseline (computed)

_Generated 2026-06-17T22:34:57Z from ledger.csv. Do not hand-edit._

## Four key metrics — CUMULATIVE (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 2543 s | 30 slice(s) |
| Deployment frequency | 6 /active-day | 12 day(s) |
| Change failure rate (deploys only) | 19 % | 14/72 deploys |
| Defect intake rate (separate, NOT in CFR) | 1 /active-day | 15 defect(s) |
| MTTR (median, any prod issue) | 843 s | 25 issue(s) |

> CFR counts **deploy failures only** (a shipped change that failed its validation); defect intakes raised via /defect against the standing system are reported separately and excluded from CFR (process §3, v51). MTTR spans both kinds.

## Trailing window — last 12 deploys

_Recent-only view, so improvement is visible inside a retro's scoring horizon rather than lost in a history-dominated median (EXP-045)._

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 1823 s | 3 slice(s) |
| Deployment frequency | 3 /active-day | 4 day(s) |
| Change failure rate (deploys only) | 8 % | 1/12 deploys |
| Defect intake rate (separate, NOT in CFR) | 0 /active-day | 2 defect(s) |
| MTTR (median, any prod issue) | 32951 s | 3 issue(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 19 | 900 | 265 | 443 |
| solution-architect | 17 | 1200 | 344 | 523 |
| cicd | 13 | 207 | 216 | 363 |
| engineer | 63 | 720 | 720 | 1012 |
| ui-designer | 4 | 540 | 810 | 823 |
| tester | 14 | 1200 | 830 | 1354 |
| documenter | 13 | 60 | 60 | 169 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step, by per-agent median): **engineer** (median 720s,
  n=63 — the dominant-volume step). The script's "orchestrator" label is an n=1
  artifact (one orchestrator row at 900s); ignore it. The real flow constraint for
  the OagEventSource offline chunk-family is the **shared `normaliser-core.ts` seam**
  forcing all UCs serial (par_eff 0.25): build wall-clock = the serial chain, not the
  sum, and it cannot parallelise under §40 without a structural file split.
- Recommended exploit/subordinate action: the offline normaliser is COMPLETE, so the
  seam constraint retires with the chunk. The next constraint to watch (Chunk-2, first
  infra-bearing) is the **§F5 infra-deploy gate wait** (first human touchpoint) and
  first-AWS-mechanism defect risk — subordinate by landing the walking-skeleton probe
  + synth-time contract tests (§17) and scheduling the deploy gate at route completion
  (§9a Gate-4 timing), so the gate does not sit idle. SLC-003 window quality is strong
  (CFR 8%, lead 1823s); the lead-time thief to attack now is the per-node-command PATH
  tax (EXP-050 re-route) and the flow-metric phantom par_eff (EXP-053).
- Note: window MTTR (32951s) is dominated by legacy observatory overnight defect pairs,
  NOT OagEventSource (0 defects this project) — not a current-project signal.
