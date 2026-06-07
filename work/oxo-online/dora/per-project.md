# Per-project DORA — oxo-online

## Time-to-first-deploy
**Kickoff → slice-001 deploy:** 09:30 → 16:55 = **7h 25min (26,700s)**
Target was < 90 min. Missed.
Driver: pipeline iteration loop (3h 22min, 45% of wall-clock) — 8 fix cycles
after engineer completion. Session continuity was maintained (no overnight),
but the cloud/hosted pipeline introduced a new wait class not present in ox.

## Per-slice record

| slice | change | expected DORA effect | actual | regression? | reflection |
|-------|--------|----------------------|--------|-------------|------------|
| 001 | v7 session continuity | lead time < 60 min in-session | 7h 25min — missed | Yes (cloud pattern) | Session continuity eliminated overnight waits but not pipeline iteration loops. Cloud/hosted needs CICD pre-flight checklist (v9 §19) as additional lever. |
| 001 | v8 commit discipline | cleaner audit trail, no red commits | Applied throughout — all commits intent-focused | No | Working as intended. Does not directly affect lead time. |
| 002 | v9 CICD pre-flight (§19) | ≤ 3 pipeline fix cycles | 0 pipeline config fix cycles — no OIDC/CDK/node issues | No ✓ | Pre-flight checklist worked. 1 failure occurred (smoke tests), but it was content regression, not CICD config. |
| 002 | v10 security auto-accept (§8a) | Gate 3 human wait = 0 on no-infra slices | Auto-accepted, zero human wait | No ✓ | Working exactly as intended. Pure frontend delta confirmed in ~0s. |
| 002 | n/a (new failure mode) | n/a | CFR 20% — smoke tests stale after root route change | Yes ✗ | Unit tests updated; smoke tests missed. §22 (surface-change done condition) added in v11 to prevent recurrence. MTTR 222s — recovery was fast. |
| 003 | v11 §21 arch-lite | Solution-architect ≤ 5 min for frontend-only slices | 64s — confirmed (down from 780s in s002). Planning phase: 2 min total | No ✓ | Hit strongly. §21 working as designed. |
| 003 | v11 §22 surface-change done condition | CFR restored to 0% | CFR 33% — another smoke failure. Mode-selector buttons broke getCells count. §22 trigger too narrow (route rewiring only, missed new-button-added case) | Yes ✗ | Rule class correct; trigger too narrow. Broadened in v12 to cover new interactive controls added to smoke-tested screens. |
| 003 | n/a (pattern confirmed) | n/a | 2nd consecutive fragile-selector failure | Yes ✗ | getCells used all-buttons-minus-play-again; mode-selector buttons broke it. Now a pattern (2 data points). §23 stable selector mandate added in v12. MTTR 257s — fast recovery. |
| cross-session | v13 §25 working-dir convention | `cd &&` compound prompts eliminated | Anticipated: zero approval prompts for npm/dora/gh run variants | — pending | npm --prefix replaces cd&&npm; dora.py root-relative by convention; committed settings.json covers gh run variants. Measure at s004. |

## Pipeline iteration breakdown (slice 001)

| Iteration | Failure | Fix |
|-----------|---------|-----|
| 1 | Missing `cdk.json` | Added `cdk.json` + `ts-node` |
| 2 | `aws-region` not supplied | Added `OXO_ONLINE_AWS_REGION` default |
| 3 | OIDC `sub` too strict | Relaxed to `StringLike :*` |
| 4 | `environment: production` approval gate | Removed gate |
| 5 | `GITHUB_*` prefix reserved | Switched to `-c` context flags |
| 6 | CDK `iam:PassRole` denied | Split infra/app pipelines; new `oxo-infra-deploy` role |
| 7 | Playwright `@playwright/test` not found | Added `npm ci` in deploy job |
| 8 | `OXO_ONLINE_S3_BUCKET` empty | Set missing GitHub variables |
| 004 | v13 §25–26 prompts | zero approval prompts for known patterns | Zero compound-command prompts across 7 dispatches | No ✓ | Confirmed; scored MET in v13 history snapshot. |
| 004 | v12 §22–23 selectors | CFR from fragile selectors = 0 | Play Online added to smoke-tested screen; zero smoke regressions | No ✓ | Both rules confirmed; selector class closed after 2 prior failures. |
| 004 | n/a (new failure mode) | n/a | DEFECT-004-001: CF /api/* vs API route key POST /games — both stacks synth-green individually, 404 in prod masked as SPA 200. 1 prod failure / 3 deploys (33%) | Yes ✗ | Cross-stack contract gap — synth-detectable. §30 added in v14 (composed-template contract tests). Also 3 CI pipeline failures (lock cross-platform, gitignored dist at synth, CDK batch-deploy export race) → §19 extended; reclassified per §31. |
| 004 | n/a (session boundary) | n/a | MTTR pair ~9h: fix deployed in-session (~18 min fix-to-redeploy) but re-validation crossed overnight gap | Yes ✗ | §4e added: never leave recovery validation pending at session boundary. |
| 005 | v18 §37 parallel UC build | build wall < serial sum | Set A 1280s ∥ Set B 539s: ~30% build-phase saving, zero collisions | No ✓ | First parallel build; file-ownership boundaries sufficed; §40 flags not needed this time. |
| 005 | v14 §30 composed contract | CFR 0% for cross-stack path class | Class did not recur (D1/T7 pinned) | No ✓ | But CFR moved to NEW classes: platform semantics, code↔policy drift, browser config/CSP. |
| 005 | n/a (new failure modes) | n/a | DEFECT-005-001: 6 stacked causes, 2 fix rounds; 1 prod failure / 5 deploys; MTTR 5807s same-session | Yes ✗ | 4/6 causes browser-only → §30 walking-skeleton probe (v25); code↔policy pin + IMP-004; OI-22/26 processed. |
| 005 | v14 §4e same-session recovery | MTTR < 600s | 5807s, but fully in-session (vs s004's 9h gap) | Partial | Defect depth, not session boundary, drove duration; probe is the lever. |
| 005 | v16 §35 + v23 self-service | tester prompt-free, tooling self-built | All validation via framework; tester extended make targets itself; caught GSI-ARN drift | No ✓ | Both confirmed. |
| 005 | v19 §38 + §8b pipelining | nothing evaporates; delivery gap ↓ | 27 OI items tracked; h1 gate-2-ready BEFORE s005 delivered | No ✓ | Pipelined planning operationalised. |
| s005-h1 | v25 probe + v28 gap list + region policy | CFR 0% new-mechanism; honest local/prod split | CF WAF live+observable; 2 in-slice defects (assoc ARN ~10min pipeline; CF-masking MTTR 4851s) — both platform-semantics, both now synth/skill-pinned | Yes ✗ (1 prod-reaching) | Probe surfaced the predictor anomaly; masking class killed permanently (block-code disjointness contract). Trunk-CD prereq timing → §19 corollary. |
| s005-h2 | connect auth + per-IP budget (iter 8) | CFR 0% on new-mechanism slice (§17 probe + §40 flags); MTTR < 900s | 6 deploys, 3 prod failures (CFR this slice 50%): H2-001 §39 schedule (1794s), H2-002 platform strike 5 (553s — probe-caught, best MTTR yet), H2-003 lazy-TTL (2272s, inflated ~75min by mid-recovery human retros). 17/17 ACs delivered; flag lifecycle clean (empty template diff) | Yes ✗ (CFR) / No ✓ (probe + flags + browser spec all earned keep) | Platform-semantic class is now the dominant defect source (strikes 4,5 + lazy-TTL). §12a data-flow platform-gate nodes (EXP-005) is the structural bet — score at s006. Probe MTTR 553s shows the catch-early lever works when the gate IS modelled |
| s006 | server-authoritative move relay (iter 9) | EXP-005/010 first scoring: tester<900s? defects at probes not validation; CFR | **0 prod failures / 4 deploys** (first zero-defect backend slice); p95 move 308ms; tester plan 15min vs 45-60 (EXP-005 MET); 1 read-before-build STOP resolved by 4-min architect ruling instead of a prod AccessDenied; tester wall 3120s (still >900s target — suite breadth, not discovery) | No ✓ (CFR 32→28) | The defect-prevention stack (model read-before-build + per-UC probes + build-phase browser tests + skeleton) kept ALL defects out of prod. Tester duration now dominated by suite RUN time + budget waits, not discovery — next lever is OI-34 (CI-IP budget) + S4-style coverage tooling, not more discovery aids |
| s007 | disconnect handling + IMP-008 + s007a exemption (iter 10) | EXP-009/010 second scores; CFR; gate integrity | **0 prod failures** (2nd consecutive); 1 pipeline_failure honestly classed (budget unmask) healed same-session; render gap caught at BUILD by local stand-up; tester plan 8min; freq 8/day; CFR 26%. Gate-4 timing slipped (ratified post-hoc) → v35 rule | No ✓ (CFR 28→26) | Two §5a STOPs (engineer twice refused to touch control semantics) each resolved by a <5min architect ruling — the escalation path is now cheaper than the defects it prevents. Layered-rate-controls lesson routed to skill |
| s008 | share-link UX — COMPLETES C4 (iter 11) | EXP-011 final; C4 done-condition; CFR | **0 prod failures (3rd consecutive)**; C4 done-condition MET (2.3s vs 5min); arch-lite §9a auto-accept; gate-4 clean; freq 9/day; CFR 26%; lead 3972s. EXP-011 validated on mechanism (3 zero-defect slices on integrated defs), simplicity-metric reframed v36 | No ✓ | The pipeline has reached steady state on thin slices: gate-3 auto-accept + gate-4 auto-approve + single serial engineer + per-UC probe + model-diff planning = a clean slice with one product wording-reconciliation as the only human-judgment touch. C4 (the core job) shipped across 7 slices |
