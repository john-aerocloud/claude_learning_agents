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
