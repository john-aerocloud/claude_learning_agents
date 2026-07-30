---
process_version: 121
effective_from: 2026-07-30
supersedes: v120, v119, v118, v117, v116, v115, v114, v113, v112, v111, v110, v109, v108, v107, v106, v105, v104, v103, v102, v101, v100, v99, v98, v97, v96, v95, v94, v93, v92, v91, v90, v89, v88, v87, v86, v85, v84, v83, v82, v81, v80, v76
status: active
---

<!-- v121 (FOCUSED retro, AdixOut 2026-07-30; on main v120 via fold-forward-FIRST, clean fast-forward — this session's STEP-0 fold-forward had been DEFERRED, so the fold-forward-then-bump discipline was applied here before any version work, avoiding a version-skew foldback conflict). §F8 retro-debt INCIDENT gate — DEF-AIDX-009 prod-defect resolve. HEADLINE: AdixOut's FIRST-EVER production deploy went LIVE and validated — UC-AIDX-039 stood up the prod ingest stack (AidxOut-prod-IngestBus + least-priv OAG cross-account grant + prod C10/C11 + FlightAggregate) in prod-dataout 616963375937, now folding REAL OAG prod traffic (~457 legs, ~1.6k Subscribe folds/hr at retro time). FOCUS Q (largest GLT contributor + how to reduce while protecting DORA): raw top contributor is `queue`/`registered` = 75.8% of GLT — but decomposition shows this is the ESTABLISHED multi-session dependency/external-gate ARTIFACT (e.g. UC-039 sat registered 2 days waiting on its own dep UC-038 + the human prod gate, not pull-latency), NOT an in-system squeezable constraint; per the constraint-gate the change budget was NOT spent there. The ACTIONABLE, evidenced, recurring root cause this cycle = the CFR/rework driver: the first-ever fresh-account prod deploy failed TWICE on missing create-permissions for account-level singletons AWS/SST/EventBridge lazily provision on FIRST USE (ECR `CreateRepository` on `sst-asset`; `iam:CreateServiceLinkedRole` for the EventBridge API-destinations SLR), BOTH invisible in an already-bootstrapped dev (dev-green + local synth both passed) — the SLR miss shipped as prod defect DEF-AIDX-009, caught only by live prod validation. ANSWER / change-set (all safety/CFR fixes, permitted under the constraint-gate as defect-preventing): (1) EXP-119 → cicd.md — before any first-ever deploy into a fresh account, audit BOTH the deploy role AND every runtime exec role for the create perms of first-use resources the stack implies (SST asset store incl. `sst-asset` ECR; scoped `iam:CreateServiceLinkedRole` — ARN + `iam:AWSServiceName` cond, never `*` — per SLR-provisioning service), granted in BOTH stages for fresh-account self-heal + dev↔prod parity; executable preflight queued IMP-026; targets CFR-on-first-account-deploys + deploy MTTR. (2) `.claude/settings.local.json` UNTRACKED + gitignored — it is machine-local by design (CLAUDE.md), but being TRACKED meant harness auto-edits (a `Bash(wait)` allowlist line) recurringly dirtied the worktree and DEFERRED this session's STEP-0 fold-forward (EXP-113 boundary), leaving the loop stale (v118 vs main v120); removing it makes STEP 0 return exit 0 cleanly; targets reconcile-latency/lead-time. (3) local pre-push gate MUST include `lint` — a probe pushed with an eslint unused-var bounced CI twice; folded into cicd/engineer local-gate practice (run lint+typecheck+unit+synth-pin before push, matching CI's build-and-test job). SCORED: EXP-101 (dev-first/acceptance-before-prod) POSITIVE — its dev→prod PROMOTION leg finally RAN for real ×2 through the gated pipeline; BOUNDARY: dev-first can't contain fresh-account bootstrap gaps (now EXP-119's domain); kept active one cycle to confirm a clean promotion. EXP-107 (pre-push infra synth gate) NEGATIVE/boundary confirmed (real-control-plane IAM failures local synth can't catch → EXP-119's domain). EXP-113 (fold-forward-first) NEGATIVE-then-fixed (the settings.local blocker, remedied here). CFR HONESTY: the failed deploys + DEF-AIDX-009 are real change-failures, but the process WORKED — every gap was caught by CI or live prod validation before a real customer hit it (prod onboarding is a latent capability, no live customers yet); the ingest→fold→AIDX path was never impaired. HUMAN GATES this session (recorded in work/AdixOut/decision-log.md): the ECR least-priv guard-exception relaxation + the scoped prod-IAM CreateServiceLinkedRole grant were both harness-flagged and EXPLICITLY human-approved before proceeding. Registry: EXP-119 added → 8 active (AT cap-8; EXP-101 adopt-eligible next cycle to reopen a slot). No global-section rule changed; routed = cicd.md (EXP-119 + lint-gate) + engineer.md (lint-gate) + .gitignore/untrack + IMP-026 + principle-failure 2026-07-30-adixout-first-prod-deploy-fresh-account-bootstrap-gaps.md. CONSTRAINT TO ATTACK NEXT: unchanged (registered/queue dependency artifact — not in-system squeezable); the next in-system lever remains engineer/dev-validation quality (EXP-119 + EXP-115 family). -->

<!-- v118 (FOCUSED retro, AdixOut 2026-07-29; RECONCILED onto main v117 via fold-forward-then-reapply — main advanced v113→v117 (OFS v114/v115, ROC v116, OAG v117) while this AdixOut retro was in flight, so renumbered v114→v118; §F8 retro-debt INCIDENT gate — DEF-AIDX-008 resolve + the dedicated-fan-out increment closes: dev `AidxOut-dev-IngestBus` + dual-run UC-034/035 live zero-gap, dev handoff UC-036 to OAG, prod branch UC-038 built+stripped deploy-ready/human-gated; DEF-AIDX-008 egress outage + UFI-drift fixed). Constraint UNCHANGED — `registered`/`queue` 76.26% of GLT (the established multi-session/dependency ARTIFACT, not squeezable in-system, budget NOT spent, constraint-gate); the squeezable in-system cost is engineer 17.31%. TIGHT: THREE plain-practice folds (NO experiment rows), all from the DEF-AIDX-008 root story — REQ-004's live ingest SUCCESS grew the read model from a synthetic/tiny seed to ~9k real legs at ~50–90/min, which BROKE the already-"done"/validated egress `Catchup` (`POST /flightlegs` 502 for EVERY customer, 10s timeout — a `CATCHUP_PAGE_SIZE=2` page-until-entitled scan of the single-partition `byType` GSI didn't scale); fixed (page-size 500 + per-invocation scan-budget bound + 15s + metrics); adversarial validation then found the AIDX UFI/`OriginDate` drift (`deriveOriginDate` recomputed from mutable operational timestamps → fixed to derive-once + pin-at-ingest); the tight-SLO structural cure (entitlement-aligned airport GSI) registered as REQ-005 follow-up CHK-AIDX-013. FOLD 1 (THE BIG ONE → tester.md primary + solution-architect.md): "done at synthetic/seed scale" ≠ "done at real scale" — a feed GOING LIVE re-opens its DOWNSTREAM consumers for re-validation; the architect states a scale/growth assumption + its fitness tripwire on every read-path design, the tester re-exercises downstream at the real load when a feed goes live rather than trusting prior synthetic-scale sign-off. Extends the v113 real-sample family to real LOAD. FOLD 2 (→ engineer.md): mirroring a stack to a new environment (esp. prod) VERBATIM carries dev/test FIXTURES — seed customers, hand-seeded data, test doubles/receivers — which MUST be stripped (real envs get data only via the governed/real path); founding = the prod-branch strip (`synthetic-customer-a` seed + seed legs + `WebhookTestReceiver`). FOLD 3 (→ engineer.md): an identity field with "never changes once set" semantics (AIDX UFI `OriginDate`) is derive-ONCE + persist + reuse, never recompute-from-mutable (DEF-008 UFI-drift). EXP-115 (whole-journey/live+adversarial validation) scored STRONG POSITIVE again + dated note — live/adversarial validation caught the egress outage, the UFI drift, AND the prod-fixture leak, all of which prior synthetic-scale sign-off passed. CFR HONESTY: DEF-008 + the reworks are real DEV-caught change-failures (EXP-108 integrity) — the process WORKING (caught in dev before prod), not decay. Registry unchanged: 8 active — AT cap-8, no rows added/retired. No global-section rules changed; routed changes = tester.md (fold 1) + solution-architect.md (fold 1) + engineer.md (folds 2+3) + EXP-115 confirming note. -->

<!-- v117 (OagEventSource, 2026-07-29; retro-debt INCIDENT gate — DEF-OA1 + DEF-XA4 defect-resolves; RECONCILED onto main v116 via fold-forward-then-reapply after the OAG instance drifted 114 commits / v89→v116 behind main across the multi-day REQ-OAGADMIN + SLC-045 session — a §0a Rule-4 batched-integration failure, logged in principle-failures/reconcile-latency-instance-vskew.md). The divergence was LARGELY SELF-CORRECTING: main independently evolved equivalents of nearly every instance delta, so those were DROPPED at the merge — fold-forward-on-resume (main EXP-113), probe-first (solution-architect.md), false-green read-back (cicd.md), batch/poison (engineer.md), and the render gate (main tester.md EXP-114 painted-pixel is STRONGER than the proposed computed-style check, catching the DEF-OA1 unstyled-render class). Main's canonical board-projection tool (.claude/tools/linear-project.py) superseded this instance's parallel board-projection skill (orphaned; cleanup in open-items). The ONE genuinely net-new delta re-applied: state-graphs.json v5→v6 adds `deploying → blocked` and `registered → blocked` (use-case), so an item built-but-awaiting-an-external-input (e.g. UC-OB1 awaiting the OAG Alerts key, stuck in `deploying`) or registered-but-blocked can be attributed to `external` instead of masquerading as cicd/queue GLT — the exact misattribution this retro's constraint analysis found (external read 1.22% when it was the dominant reality). DEFERRED (parked in open-items, human-reviewed follow-up — too uncertain to force onto main's evolved process autonomously): re-applying pipeline-only-environment-deploys + multi-audience-DoD as explicit rules (main references CI/CD pervasively but lacks the exact mandates). No new experiment row (the graph edge is a machinery correctness fix, not a falsifiable hypothesis; registry left at main's cap-managed state). -->

<!-- v116 (ROC, 2026-07-29; §F8 routine gate 3/3 — UC-064 rework + SLC-ROC-017 close + UC-069 rework; NO prod incident; fold-forward v112→v115 FIRST then this on top). Continuing C4 ("continue c4"): SLC-ROC-017 (site-derivation-pattern authoring: edit→test→publish, live no-redeploy pickup + Simulator parity) CLOSED; SLC-ROC-018 (template authoring w/ blast-radius) crux delivered (UC-067 template edit, UC-068 site↔template link registry, UC-069 dual-gate draft-test + blast-radius confirmation — all done; UC-070 multi-site publish next). All agent-file/plain-practice + one improvement-slice; NO global-section rule changed, NO new experiment row (all changes are fixes/tightenings, not falsifiable hypotheses). Constraint UNCHANGED by raw share (external/queue = env-owner-blocked DEF-004/008/009); the actionable constraint is tester/dev-validation (11.8%), driven by a 3× recurring house-DS-component-VARIANT WCAG non-text-contrast class (UC-056 ACBadge/ACTextInput defaults, UC-064 enumerative-override-doesn't-generalise, UC-069 ACButton color=success UNSTYLED=1.00:1). EXPLOIT: engineer.md real-artifact bar gains class (4) — never rely on un-themed house color/variant; every new testid'd control pinned in index.css override + index.css.contrast.test.ts same-change (enumerative stopgap); IMP-024 queued = a GENERIC compiled-CSS contrast check to beat the enumerative pin (the durable fix). Two safety guards (plain practice, no rows): linear.md+jira.md hard secrets-leak guard (a linear sweep `tail`-dumped the live api_key → transcript; ROTATE flagged to human) and tester.md DEF-006 guard extended to include the LINTER CI runs (2nd recurrence: UC-068 committed live spec left app lint red). EXP-115 POSITIVE again (live painted-pixel + composed acceptances caught all 3 contrast + fan-out parity offline green missed). Registry 7 active (EXP-118 arrived via OFS fold-forward), under cap-8. Founding: principle-failures/2026-07-28-house-component-variant-contrast-recurring.md. -->


<!-- v115 (routine-batch retro, OperationalFlowSimulator 2026-07-28; §F8 routine gate 4/3 — SLC-I1+CHK-I (REQ-OFS-5 bin slider) + SLC-J1+CHK-J (REQ-OFS-6 animate) closed; on main v114 via fold-forward-first, clean; NO incident): both slider requirements shipped clean through full arch-gate→build→validate loops — REQ-OFS-5 (bucket-count slider, μ/σ+stats invariant across bins) and REQ-OFS-6 (Animate mode: log 2–1e6 steps/s slider, per-frame batching, Pause/Resume; a 1,000,000-item run animates to done in ~1.5s with the tab responsive — 8ms FRAME_BUDGET verified by an independent rAF probe; determinism parity with Run). Constraint UNCHANGED (calendar-time/queue-dominated, directional; budget not spent). SCORED: EXP-118 (data-viz faithfulness) →2/3 POSITIVE — applied on UC-I2 (curve stays faithful across bin counts) + UC-J2 (faithful frame-by-frame during animate); registry 7 active (under cap-8, no rows added — the frictions below are fixes, not experiments, per v88). RECURRING FRICTION addressed (the actionable in-system waste): `impacted-tests` SINCE-window UNDER-REPORTS when the arch gate front-loads all `:::changed` marks in one slice-registration commit (a UC's prior-ref SINCE excludes it → false-clean); hit on UC-H2/H3/I2/J1/J2. Routed: tester.md — use the slice's PRE-REGISTRATION baseline SINCE when the result looks empty-but-code-moved + ADD `@covers` at spec authoring (the idinput/ratectrl/analyst/UCG1 tag-gaps); principle-failure opened; machinery follow-up (auto-resolve/warn on a pre-arch-gate SINCE window) → open-items for cicd. No global-rule change beyond the tester.md fold. -->


<!-- v114 (gap-closing retro, OperationalFlowSimulator 2026-07-28; §F8 INCIDENT gate — DEF-004 defect-resolve; on main v113 via fold-forward-FIRST, clean): DEF-004 — the fitted log-normal overlay on the distribution chart rendered a FLAT TOP because buildCurvePath scaled the curve to the tallest histogram bar and CLAMPED at the plot top, misrepresenting the fit P1 must judge by eye (J12). It shipped ACCEPTED: the chart's acceptance (G3) asserted geometry + a11y + "a hump is present" but no clause required a FAITHFUL density — the clamp was rationalized as "by-design". Root: for a data-viz, "renders correctly" was treated as geometry+a11y, not truthful representation. Fixed via the loop (shared honest y-axis = max(maxCount, ceil(curvePeak)); clamp removed; true single-peak hump — screenshot-confirmed, 278 unit + 137 e2e). Change routed (EXP-118): ui-designer.md §3b (data-visualization FAITHFULNESS — TESTABLE: every mark quantitatively represents its datum, no silent clamp/renormalization/truncation that changes the reading; honest shared scale; computed overlay depicts the source's true shape, asserted by sampling rendered marks) + tester.md (validate the DEPICTED RELATIONSHIP, not just that the chart renders). Targets CFR (viz-distortion caught at acceptance, not shipped). Constraint UNCHANGED (calendar-time/queue-dominated, directional; budget not spent on it) — this is a justified quality exploit under the constraint-gate. Registry 6→7 active (EXP-118 added; under cap-8). Secondary findings → open-items.md: comma-in-event-note truncation RECURRED (wi machinery, contradicts the 938db37 'fixed' memory — re-examine); e2e/ not in the tsc build graph for THIS project (a committed tsconfig.e2e.json — the DEF-006 class v112/v113 already addressed at the tester-spec level upstream). Also this cycle: registered REQ-OFS-5 (bin-count slider, 4/3) + REQ-OFS-6 (animate run mode, 6/6) via the requirement gate, and cicd.md gained the private-registry (GitHub Packages design-system) auth pattern (2026-07-24 human directive). -->


<!-- v113 (FOCUSED retro, AdixOut 2026-07-28; RECONCILED onto main v112 via fold-forward-then-reapply — main advanced to v112 (two ROC retros: v111 SLC-ROC-014, v112 SLC-ROC-016) while this AdixOut retro was in flight, so renumbered v111→v113; §F8 retro-debt INCIDENT gate — DEF-AIDX-007 resolve + CHK-AIDX-011/CHK-AIDX-010/SLC-AIDX-012 closes; REQ-004's dev ingest now reliably consuming the LIVE OAG feed end-to-end (real leg F9 3371 folded + served by the egress) + the prod pipeline capability. Constraint UNCHANGED (registered/queue ~69% of GLT = multi-session/dependency artifact, constraint-gate, budget NOT spent; squeezable in-system cost = engineer 20%). TIGHT: THREE plain-practice folds (NO experiment rows) + one EXP score, all from ONE root story — the ENTIRE dev consumer-side was built against a GUESSED OAG contract + SYNTHETICALLY validated green (UC-027 C12 bus + cross-account grant; UC-028 `source=oagEvents.producer`; UC-030 ingest), then a live assert-real-state ("check the data is flowing") revealed it was ENTIRELY ORPHANED against reality: OAG fans `Aerobus`→a SHARED `oag-consumer-bus` in our account (~42k/day) with `source=oag.eventstore`/`detail-type=OagCanonicalEvent` + envelope nested under `.detail`, NOT our separate C12 bus / `oagEvents.producer` / top-level envelope. Forced reconciliation delta 008 (retire C12+grant, rewire C13′ onto `oag-consumer-bus` with real pattern + `inputPath:$.detail`, pin C11 against a REAL captured wire sample, DEF-AIDX-007 gap-tolerate). FOLD 1 (THE BIG ONE → solution-architect.md primary + engineer.md): for a slice integrating an EXTERNAL feed/API whose contract we DON'T own, the arch gate SPIKES the real source + captures a REAL sample FIRST — design + synth-pins pinned against that sample (contract = routing attrs + delivery TOPOLOGY + envelope nesting, not just payload); synthetic-only validation is BUILT-TO-A-GUESS, NOT done; a deferred live-validation is a standing RISK flag, never a green checkbox. Extends v110 verify-reuse-against-real-target + assert-real-state family. FOLD 2 (→ cicd.md): the pre-push gate runs ALL vitest projects (app unit AND root infra synth-pin), via a committed `make test-all` — running only the app project false-greened UC-032 + shipped a red CI cycle (principle-failure `2026-07-28-uc-adix-032-pushed-without-running-root-infra-synth-pin-tier`); sibling of EXP-110 at test-PROJECT granularity. FOLD 3 (→ engineer.md): on a PUSH feed a first event at `eventPosition>0` is the NORMAL join-mid-stream condition, not a dropped delivery — tolerate (log+fold+continue), don't pull-heal from a store that may not be the feed's; select gap behaviour by feed MODE (DEF-AIDX-007). EXP-115 (whole-journey/live validation) scored STRONG POSITIVE + dated note — live assert caught an ENTIRE orphaned integration a full synthetic suite passed. CFR HONESTY: DEF-007 + the UC-028 reworks + the reconciliation are real DEV-caught change-failures (EXP-108 integrity) — the process WORKING (caught in dev before prod), not decay. Registry unchanged: 8 active — AT cap-8, no rows added/retired. No global-section rules changed; routed changes = solution-architect.md (fold 1) + engineer.md (folds 1+3) + cicd.md (fold 2) + EXP-115 confirming note. -->
<!-- v112 (FOCUSED retro, ROC 2026-07-28; on main v111 via fold-forward-FIRST, clean; §F8 routine-batch gate at SLC-ROC-016 close, NO incident): C4 versioning/audit + rollback (SLC-ROC-016, UC-062 view-history+diff / UC-063 restore-prior-version) delivered + live-validated + deployed. HEADLINE: the v111 real-artifact-green-bar fold is VALIDATED — the 8 items built after it (creation UC-059/060/061 + versioning UC-062/063) took 0/8 rework vs the editing slice's 5 live rejects; engineers proactively wrote composed-consumer-vs-populated-store acceptances + fully-themed live-axe checks pre-built_green, catching the DEF-002/DEF-005-class defects (incl. a real CC-3 restore-dedupe bug) at build not at the tester. Routed: (1) tester.md — a validation-as-code spec the TESTER commits must be run through the full build graph (tsc -b incl tests/e2e) before landing (DEF-006-class: engineer's pre-built_green bar doesn't gate a tester-pushed spec; UC-062's committed e2e spec broke dashboard tsc -b). (2) EXP-117 board-push cadence ADOPTED 3/3 into loop-run.md/orchestrator.md, registry 7→6; EXP-115 POSITIVE again. Constraint UNCHANGED + not-agent-squeezable (external 48.75% Azure-block + queue 40.62% backlog; agents ≈10.6%); CFR 9.5% honest dev-catch. Remaining C4: templates (J16/J25), site onboarding (J26), RBAC-UI (J28). -->
<!-- v111 (FOCUSED retro, ROC 2026-07-27; on main v110 via fold-forward-FIRST — clean, no collision; §F8 routine-batch gate at SLC-ROC-014 close, NO prod incident): SLC-ROC-014 delivered the COMPLETE rules-EDITING capability (edit → mandatory draft-test → publish, live no-redeploy pickup, Simulator parity, content-hash attestation gate + who/when attribution) — UC-056/057/058 all live-stack validated + pushed to origin/main + deployed to aas-test. NO global §-body change. Routed outcomes: (1) engineer.md plain-practice fold — the pre-built_green green bar must exercise the REAL artifact for UI/pipeline slices (fully-themed live axe + same-element aria-label; focus preventScroll + no scrollable ancestor; composed-consumer-against-populated-store acceptance driving consume() end-to-end), extending v110's live-caught→offline-pin; recurring root cause logged in principle-failures/2026-07-27-offline-green-ne-live-correct-ui-pipeline.md. (2) work-items.py + linear-project.py + linear-mapping.md machinery fix (human "fix the in-progress clutter"): blocked never maps to In Progress (Todo/Backlog) and an aggregate whose only non-terminal children are all blocked derives blocked — parked-on-external trees drop out of the active lane in queues/stats/board (107 wi-tests green). (3) EXP-115 POSITIVE again (ROC live catches), EXP-117 → 2/3 POSITIVE (board cadence). Constraint UNCHANGED + not-agent-squeezable (external 46.66% Azure-block + queue 41.93% backlog; agents ≈11%); dev-validation 11.1% / CFR 10.1% is HONEST dev-catch (EXP-108), not decay — the in-system lever is shifting live-defect classes LEFT (measured next on SLC-ROC-015). Registry 7 active, under cap, no rows added. -->
<!-- v110 (FOCUSED retro, AdixOut 2026-07-24; RECONCILED onto main v109 via fold-forward-then-reapply — main advanced to v109 (ROC SLC-ROC-013 retro) while this AdixOut retro was in flight, so renumbered v109→v110; retro-debt gate — 3 routine: UC-AIDX-028 rework (TWO reject→rework cycles) + SLC-AIDX-011/CHK-AIDX-010 closes, REQ-004's dev consumer-side walking skeleton: C12 bus+grant → C13 routing → C10/C11 ingest standup → OAG handoff, built + validated LIVE end-to-end (synthetic event → C12 → C13 → C10 → C11 → read model → egress). TIGHT: two fix-derived learnings folded as PLAIN PRACTICE, no experiment rows. Constraint UNCHANGED from v105/v108 (registered/queue = artifact latency, ~70% of GLT; squeezable in-system cost = engineer/multi-tenant-eventing). Both learnings were caught by LIVE assert-real-state validation that offline synth-pins passed. (1) SCOPE-GAP → engineer.md + solution-architect.md: "reuse existing X" must be VERIFIED against the real deployed TARGET account/stack, never assumed from a sibling env — SLC-AIDX-011's "reuse the existing C10/C11 ingest" was wrong (C10/C11 were sandbox-only; the migration moved only the egress to dev-dataout), so the engineer STOPPED (§F7) rather than build against an absent dependency and a predecessor UC-030 + architect delta 007 were inserted at the real edge; the §F7 stop was correct. Extends the v97 assert-real-state family. (2) EVENTBRIDGE TARGET PAYLOAD (the double-rework) → engineer.md: for an EventBridge rule→SQS/target that must forward the event's `detail` object verbatim, use `inputPath: "$.detail"` (JSONPath extraction), NOT an `inputTransformer` with a bare `<detail>` object placeholder — the `<placeholder>` idiom quote-strips a nested OBJECT into invalid JSON (`ERROR_CODE=INVALID_JSON`), it only round-trips STRING fields (why the webhook router's flat string fields worked). Root cause found only by adding a target `DeadLetterConfig` to capture the real `ERROR_CODE`/`ERROR_MESSAGE` — so: always wire a target `DeadLetterConfig` and INSTRUMENT-FIRST before guessing at an opaque cross-service delivery failure. UC-028 rework #1 = default-rule envelope-wrap poison (C11's parseEnvelope rejected the wrapped event); rework #2 = the `<placeholder>` INVALID_JSON. Engineer left OFFLINE synth-pins behind for the inputPath/InputTransformer shape + DeadLetterConfig so the payload-shape class is now caught offline (live-caught infra-shape defect → offline pin). Kept in engineer.md not the aws-architecture skill (no clean EventBridge-target section there; narrowest owner = engineer implementation behaviour). EXP-115 (whole-journey/JTBD live validation) scored POSITIVE again (dated confirming note): the live bus-driven E2E caught the scope-gap + BOTH UC-028 delivery bugs offline pins missed. CFR HONESTY: UC-028's two reworks + UC-027's earlier deploy_failed are real DEV-caught change-failures (EXP-108 integrity) — the process working (caught in dev before OAG/prod), NOT decay; CFR ~39% reflects honest dev-stage rejection accounting. Registry unchanged: 8 active (EXP-101,106,107,112,113,115,116,117) — AT cap-8; no rows added/retired. No global-section rules changed; routed changes = engineer.md (2 folds) + solution-architect.md (reuse-verify note) + EXP-115 confirming note. -->
<!-- v109 (FOCUSED retro, ROC 2026-07-24; RECONCILED onto main v108 via fold-forward-FIRST — main had advanced to v108 (AdixOut tight retro) while this ROC session ran, so this entry is v109; triggered by the §F8 routine-batch gate at SLC-ROC-013 close, NO incident): SLC-ROC-013 (REQ-ROC-003 living-demo foundation, UC-051..055) delivered + validated live-stack + pushed to origin/main on green (CI deploying to aas-test). NO global §-body process change this cycle — the routed outcomes are (1) EXP-116 lean-orchestration ADOPTED into orchestrator.md as plain practice (guards proven safe 2/2, no DORA harm; registry 8→7), (2) EXP-117 board-push cadence advanced to 1/3 POSITIVE. Constraint UNCHANGED and confirmed not-agent-squeezable (`registered`/backlog-aging artifact 57.76% + external-blocked DEF-004 33.55%; agents ≈8.6%); change budget deliberately NOT spent chasing it (constraint-gate). J23 demo-grows DoD + demo-egress isolation pattern kept as ROC project artifacts, not over-generalised. TIGHT retro — score + adopt + drain + fold. -->
# Current Process — v118

<!-- v108 (FOCUSED retro, AdixOut 2026-07-24; RECONCILED onto main v107 via fold-forward — main advanced to v107 + v106 (two ROC retros) while this AdixOut retro was in flight, so this entry renumbered v106→v108; triggered by 3 defect-resolve INCIDENTS — DEF-AIDX-004/005/006, all resolved live on dev-dataout during the adix→aidx account-migration re-verification; a full v105 milestone retro already ran this session so this is TIGHT — one learning + drain + fold, NO full DORA/constraint ceremony): the account migration to dev-dataout (632421564230) + the adix→aidx rename triggered an end-to-end JTBD re-verification on a FRESH account (the v105 "validate the outcome not the code path" fold working exactly as intended), which surfaced 3 pre-existing latent defects, all now fixed+validated live — DEF-AIDX-006 (a stale probe `probe-catchup-subset` that assumed sync catchup, predating UC-026's Pattern-C rule → probe fixed, handler correct); DEF-AIDX-004 (a `DynamoCustomerRegistry.putIfLater` LWW guard that couldn't heal a legacy row lacking `appliedAt` → condition fixed); and the KEY LESSON DEF-AIDX-005. ONE plain-practice fold (NO experiment row): when writing/adjusting an adapter's AWS-(or any-SDK) error-handling branch, the guarding unit test MUST throw the REAL exception class the live service produces — import the actual SDK error type (e.g. `ConflictException` from `@aws-sdk/client-api-gateway`), never a plausible-but-guessed class/name; a mock that throws the wrong exception type FALSE-GREENS the fix. Founding: DEF-AIDX-005's guard+test keyed on `BadRequestException` but the deployed API Gateway throws `ConflictException` on an API-key value-collision — the wrong-exception mock false-greened the first fix (17ae643); only live validation on dev-dataout (CloudWatch `errorName:ConflictException`) caught it, costing one rework cycle; the corrected fix (65c1775) imports the real `ConflictException` in its test. Routed to engineer.md (weave into the mock/live-probe practice — verify error-SHAPE against the live service, not assume it) + tester.md (live validation's value includes catching exception-SHAPE mismatches unit mocks encode wrongly — a defect can be "fixed + unit-green" yet fail live because the mocked exception class ≠ the real one). Extends the v97 assert-real-state-not-proxy + v104/v105 live-JTBD-outcome family. EXP-115 (whole-journey/JTBD-outcome validation) got a CONFIRMING dated note — the migration re-verification catching 3 real latent bugs on a fresh account is the practice working as intended (positive data point). Machinery consideration RECORDED to open-items (NOT built now): a defect BLOCKED-then-unblocked by a sibling fix that needs no new code of its own is stuck in `fixing` (the graph requires an engineer `fixed` before a tester `validated`); handled this cycle by appending `fixed`(engineer, "no new code — sibling fix unblocked it") then `validated`(tester) with correct attribution — a possible future `unblocked`→`validating` transition, minor, constraint-gate. Registry unchanged: 8 active (EXP-101,106,107,112,113,115,116,117) — AT cap-8; no rows added/retired. No global-section rules changed; routed changes = engineer.md + tester.md (the exception-shape fold) + EXP-115 confirming note + open-items machinery note; version bumped as the retro snapshot. Constraint unchanged from v105 (queue = artifact; squeezable in-system cost = engineer/multi-tenant-eventing). -->
<!-- v107 (retro, ROC 2026-07-24; incident gate — DEF-ROC-007 resolve — + the human "push it live" thread): constraint UNCHANGED (registered/queue artifact + external-blocked DEF-004). DEF-007: the first pre-push audit-gate run found pre-existing high/critical vulns on trunk; the ONLY prod-exposed one (fast-xml-parser HIGH, transitive via @azure/core-xml) was bumped 5.10.0->5.10.1 + verified across tiers, the dev-only chain (vitest/vite/esbuild + vendored design-system dev tooling) deferred to the Dependabot drain as no-prod-exposure. GAP-CLOSING routed → cicd.md (plain practice, NO experiment row): the audit gate's PUSH-BLOCKING condition is PROD-RUNTIME-scoped (`npm audit --omit=dev`), NOT the dev-inclusive audit — a prod-runtime high/crit blocks the push; a dev/build-only high/crit is detected+tracked (DEF-/drain, flagged no-prod-exposure) but does NOT hold a prod-clean push. Refines EXP-112; founding = DEF-007's first gate run blocking a prod-clean dev-only-vuln push. THE PUSH (human 'yes', push-hold lifted): work/ROC pushed to origin/main (9 commits — demo.sh, setup.sh, front-door README, DEF-005 e2e spec, fast-xml-parser bump); CI run 30071192281 GREEN (Web App + Function App, no flake) + deploy-test succeeded → both apps deployed to aas-test. Does NOT resolve DEF-004 (device-data topic subscription + Send grant for live UC-023 — external grant being actioned). Still owed (tracked): a committed prod-scoped `make audit` target (DEF-007); the Dependabot drain (IMP-023) once the human adds the Dependabot secret; IMP-023 readiness-poll for the CI sleep-20 flake. Registry unchanged: 8 active (no new experiment rows). Next constraint: unchanged. -->

<!-- v106 (retro, ROC 2026-07-24; reconciled onto main v105 via fold-forward; incident gate — DEF-ROC-005 + DEF-ROC-006 resolves — + human directive: drain dependabot regularly + a red GitHub CI): constraint UNCHANGED (registered/queue artifact + external-blocked DEF-004). TWO escaped defects, one class (cheap-check green ≠ correct where it matters): DEF-005 (C3 changed the pipeline held-until but not the Simulator's parallel evaluateTrace → Simulator showed "Raised" for a fault the pipeline HOLDS; J21 parity regression, escaped because cross-surface parity wasn't in C3's acceptance) + DEF-006 (UC-046's Playwright e2e spec passed vitest+oxlint+Playwright but broke dashboard tsc -b under a dom-less tsconfig — which the CI deploy build runs). Both fixed via the loop. THREE gap-closing guards routed (all defect-preventing safety fixes under the constraint-gate): (1) product.md — a behaviour change to a shared domain must UPDATE every SHIPPED mirror surface (simulator/trace/projection) in its acceptance (DEF-005); (2) engineer.md — "green" includes the FULL build graph (tsc -b ALL projects incl. committed e2e specs), not just unit+lint (DEF-006), cicd folds app/dashboard npm run build into the pre-push gate; (3) cicd.md — Dependabot-drain cadence (enumerate open dependabot PRs each slice-close, run the full gate, merge green, DEF- the failures; respect the local-only push hold — dep bumps are shared-repo maintenance), the human directive, sibling of EXP-112. CI FAILURE diagnosed (cicd): main Test workflow RED — Function App test:acceptance ECONNRESET on uc006 vs the SB emulator, root fragility a blind `sleep 20` readiness wait → likely flake, blocks the aas-test deploy; AND every dependabot PR's Web App job red because DESIGN_SYSTEM_TOKEN is an Actions secret not a Dependabot secret (GitHub withholds Actions secrets from dependabot pull_request runs). Both → IMP-023 (emulator-readiness poll + path-filter for replay-injector + a HUMAN must add the Dependabot secret — a credential Claude cannot set). Registry unchanged: 8 active (no new experiment rows; all routed changes are plain-practice guards + defects/IMPs). Note DEF-006's validated was correctly REJECTED by the state graph when fired as orchestrator (validated is tester-owned) → re-done via tester (role boundary working). Next constraint: unchanged; operational follow-through = IMP-023 once the human adds the Dependabot secret. -->
<!-- v105 (retro, AdixOut 2026-07-24; REQ-005 COMPLETE — the full ADR-0011 external AIDX egress, pull catch-up + push webhook notify, 4 chunks, UC-014..026 + DEF-ADIX-003, all live + validated on dev-shared; fold-forwarded main FIRST — already up to date at v104, this AdixOut retro's own prior fold-back — then bumped on top): focus-Q — constraint is `queue` 71% (the established multi-session/dependency ARTIFACT, not squeezable in-system, budget NOT spent on it, constraint-gate); the squeezable in-system cost is engineer 19.5%, dominated by multi-tenant-eventing REWORK (the DEF-ADIX-003 bad-state chain + UC-025); CFR 38.3% is HIGH but HONEST (EXP-108 integrity) — many DEV-catches from adversarial live/JTBD validation catching real defects before prod, the process WORKING not decay. THREE plain-practice folds (NO experiment rows): (A, the big one → engineer.md + solution-architect.md) an "ensure/resolve" must handle a resource in a BAD/TRANSITIONAL state, not just absent-vs-present — enumerate the resource STATE-MACHINE for AWS provisioning/resolution: a secret SCHEDULED-FOR-DELETION → `RestoreSecret` not treat-as-provisioned; a queue in the ~60s delete-recreate COOLDOWN (`QueueDeletedRecently`) → don't block past the caller timeout, not-found is the real `QueueDoesNotExist`; an SQS DLQ target needs its RESOURCE POLICY not just to exist; a per-container key CACHE must be ROTATION-AWARE (invalidate+refetch on verify failure / bounded TTL); a fresh API-GW/EventBridge resource has ~60s PROPAGATION lag → bounded-retry; solution-architect authors the state-machine acceptance (extends EXP-109 + the v101 multi-tenant-completeness fold), engineer builds ensure/resolve for bad-state + prefers a SHARED recovery helper over per-path duplication (`recoverIfScheduledForDeletion` now shared); founding: DEF-ADIX-003 = THREE sequential bugs in ONE offboard→reactivate flow (secret marked-for-deletion → DLQ cooldown timeout → stale rotation-unaware cache) + UC-025's three, every one an "absent/present but not bad/transitional state" gap. (B → tester.md) validate the JTBD OUTCOME end-to-end, not the code path — a code path that runs is not an outcome that works; DEF-ADIX-003's first "fix" reached the recovery code but the real-JTBD check ("a reactivated customer becomes usable — authenticate + get served") found the customer STILL locked out by two further bugs; sibling of v97 assert-real-state + v104 self-bootstrapping-probe. (C → tester.md + engineer.md) a self-bootstrapping/live probe must decide pass/fail AFTER its `finally`/cleanup block, NEVER `process.exit()` from inside a `try` (Node skips `finally` on exit → orphaned live ephemeral resources); recurred UC-021/024/DEF-003. Improvement-slice IMP-022 (QUEUED, cicd/config): allowlist the AdixOut live-probe make targets (only `probe-live` is committed today → tester relies on an unenforced prompt-bypass, not reproducible headless/CI) + realign the AdixOut impacted-tests `@alias` vocabulary (`ROUTER`/`G_DELIV_EXT`) to the `@covers UC0NN` convention the specs actually use. IMP-019 STILL HEALTHY (3rd confirmation) — the milestone retro BATCHED cleanly AND the DEF-ADIX-003 resolve correctly tripped its own immediate incident (both limbs working); dated note added. EXP-101 STRONG POSITIVE dev-first data (REQ-005 fully validated on real hosted dev across 13 UCs + a defect) but NOT adopted — prod deferred so the dev→prod promotion leg has not run; kept active (0/2). Registry: 8 active (EXP-101,106,107,112,113,115,116,117) — AT cap-8; no rows added/retired; main's scoring preserved. No global-section rules changed; routed changes = engineer.md + solution-architect.md + tester.md (the three folds) + IMP-022 + IMP-019/EXP-101 dated notes; version bumped as the retro snapshot. Next constraint: unchanged (queue = artifact); the squeezable in-system cost is engineer/multi-tenant-eventing rework, which the bad-state + JTBD-outcome folds target; watch CFR normalises as the bad-state class closes and no prod defect follows a batched dev-reject. -->

<!-- v104 (retro, AdixOut 2026-07-23; REQ-005 Chunk C COMPLETE — self-service subscription: customer sets its active subset via a `FlightLegRQ` ⊆ its entitlement ceiling, catch-up filtered to that active subset; fold-forwarded main v102→v103 FIRST — clean automatic merge, no conflicts — then bumped on top, main having advanced to v103 via the ROC retro so this AdixOut retro is v104 not v103): constraint UNCHANGED — `queue` wait, the established calendar-time/dependency ARTIFACT, not squeezable in-system (budget NOT spent on it, constraint-gate). LEAN — ONE plain-practice fold (NO experiment row) across tester.md + engineer.md: a customer-auth acceptance probe MUST SELF-BOOTSTRAP — it onboards a DEDICATED EPHEMERAL test customer with a fresh in-process keypair via the shared `probeBootstrap.ts` helper (generate keypair → onboard through the GOVERNED path → read the provisioned key IN-SCRIPT → mint the JWT), NEVER depending on an out-of-band key file, a key persisted across sessions, or a DIRECT interactive `aws secretsmanager get-secret-value` (blocked by the security guardrail — reading a secret INSIDE a committed probe script is fine, a direct interactive read is not); it must never mutate the shared synthetic customers (`-a`/`-b`) and must self-restore. engineer.md authors acceptance probes self-bootstrapping (reuse `probeBootstrap.ts`); tester.md treats a probe that can't run for want of an out-of-band credential as a TOOLING gap to fix (make it self-bootstrap), not a silently-skipped condition — but never fabricate green. Founding friction: UC-ADIX-021's validation was BLOCKED because `probe-subscription` depended on an out-of-band key; the fix (`probeBootstrap.ts` + self-bootstrapping `synthetic-probe-*` customers) removed a recurring cross-session validation gap that had touched several UCs. Plus a one-line note in the same fold: a probe asserting a FULL result set must follow pagination to EXHAUSTION — dev-shared runs `CATCHUP_PAGE_SIZE=2`, so a single-page compare false-fails (UC-022 probe bug, a test artifact not a defect). IMP-019 STILL HEALTHY (2nd confirmation) — Chunk C's retro batched CLEANLY at the chunk boundary again (the UC-021 self-bootstrap + UC-022 pagination dev-catches accrued ROUTINE, no immediate-retro thrash, no prod defect after a batched dev-reject); dated note added to IMP-019, no change needed. Noted (NO process change): a UC-022 engineer STALL was recovered by re-running all tiers green + committing the already-verified work (the v95 sub-step-commit lesson working) — the existing process handled it. Registry: 8 active (EXP-101,106,107,112,113,115,116,117) — AT cap-8; no rows added/retired; main's v103 scoring preserved. No global-section rules changed; routed changes = tester.md + engineer.md (the self-bootstrapping-probe fold) + IMP-019 dated note; version bumped as the retro snapshot. Next constraint: unchanged (queue = artifact); watch no prod defect appears after a batched dev-reject (would falsify IMP-019). -->
<!-- v103 (retro, ROC 2026-07-23; C3 first slice — soak/de-bounce — delivered local, SLC-ROC-012/UC-ROC-047..050; fold-forwarded main v100→v102 FIRST then bumped): constraint UNCHANGED — `registered`/`queue` 62% (batch-registration + weekend-cadence ARTIFACT) + `blocked`/`external` 31% (DEF-ROC-004 aas-test Azure access, being actioned externally, PARKED); engineer/`building` steady 6% through four heavy C3 builds — in-system constraint wrung out; CFR 0%, rework 0% (a real UC-048/049 fold-seam COLLISION was serialized not reworked; an engineer STALL was re-dispatched with incremental commits — the v95 sub-step-commit lesson working). EXPERIMENT SCORING: EXP-116 (lean-orchestration) 1st scoring POSITIVE (1/3) — guards held with no DORA harm, G5 improved (orchestrator fires ALL stage-appends carrying dispatch tokens; engineers/testers do NOT self-append — fixed the UC-046 TOKENS=0 gap), G4 strong (UC-050 drove the REAL local:soak-poller process); honest limit: the primary lead-time-reduction claim under-exercised because C3 correctly bypassed the lean-authoring path (new chunk → flow-manager + arch gate). EXP-109 (concurrency-acceptance-upfront) 2/2 POSITIVE → ADOPTED (C3 timer-sweep-vs-clear boundary race authored upfront in delta 007 §2 + probed live, 0 concurrency rework; archived). EXP-115 positive data point (UC-050 whole-journey live E2E closed a real-store marker-non-leak gap a fixture masked). TOKEN REVIEW (§24): board projection was the dominant PLUMBING cost (~290k, ~4 linear dispatches/UC through transient states) → **EXP-117** opened (push board at MEANINGFUL transitions only — pulled/blocked/terminal — + step-5b sweep backstop; skip built_green/deployed/dev-validating pushes; guard: terminal/blocked fidelity must not lag >1 cycle) cap-neutral vs EXP-109. PLAIN-PRACTICE FOLD (tester.md, NO row): isolate stateful shared resources across parallel acceptance files (direct-handler pattern not a 2nd wire-path consumer; dedicated table for whole-table sweeps; FRESH stack for re-runs) — founding: ROC UC-006-vs-new-spec Event-Hub consumer-group epoch race. Recurring cross-instance impacted-tests `@covers`-vocabulary gap (ROC + AdixOut same cycle) → **IMP-021** queued (tool resolves id+label + normalises prefix vocabulary natively; drop per-project @alias) + principle-failure reinforced. Board-mapping fix folded (dev/prod-validating states → In Review, were falling back to Backlog). render-diagrams cicd-capability gap also present on ROC (already tracked in IMP-020). Registry: 8 active (EXP-101,106,107,112,113,115,116,117), at cap. Next constraint: unchanged (registered/queue artifact + external-blocked); EXP-117 = token-plumbing exploit, EXP-116 continues under guards. -->

<!-- v102 (retro, AdixOut 2026-07-23; REQ-005 Chunk B COMPLETE — governed customer lifecycle onboard→auth→serve→adjust→suspend/revoke/terminate, all live on dev-shared; fold-forward from main v101 = AdixOut's own prior fold-back, already up-to-date/clean, bumped on top): constraint UNCHANGED — `queue` wait (~72.7%), the established calendar-time/dependency ARTIFACT, not squeezable in-system (budget NOT spent on it, constraint-gate). LEAN — TWO plain-practice folds (NO new experiment rows) + one improvement-slice. FOLD A (engineer.md + product.md): a UC's acceptance conditions are its CONTRACT — never silently dropped under a "thin/reuse" framing. When a UC is framed "thin"/"mostly reuse" the engineer STILL owes EVERY acceptance condition (+ the slice success-measure + the traced architecture-delta requirements); if a condition genuinely cannot/should not be built the engineer ESCALATES to product/solution-architect for an explicit descope that REWRITES the acceptance text — NOT silently omit it and ship a partial UC as green; keep the change-graph (`.mmd`) consistent with the acceptance (no capability left marked "deferred" while the acceptance still requires it). product.md: author "reuse" slices with explicit+complete acceptance so "thin" can't hide a gap. Founding failure UC-ADIX-020: built "thin" (ceiling-adjust only) and silently dropped its own acceptance conditions 2 & 9 (suspend/revoke/terminate) — required by the slice success-measure, delta 005 ("revocable — offboarding = revoke") and the J-CS-ENTITLE root-need; the `.mmd` even marked `offboarding-revoke` "deferred" while the acceptance still required it. The tester caught it at validation (safety net worked) but it cost a rework cycle. Sibling of the green-build-only-as-complete-as-its-acceptance family (EXP-109/110/115). FOLD B (work-items SKILL.md, small): the wi-append NOTE-quoting note EXTENDED to backticks / `$(…)` and commas — SINGLE-QUOTE `NOTE='…'` AND avoid backticks / `$(…)` command-substitution (shell-substituted → mangling/executing) and commas (truncate) in the note text; caller hazard, not a machinery bug; principle-failure `2026-07-23-wi-append-note-backtick-command-substitution-mangled-evidence.md`. IMP-019 VALIDATED this cycle — the v101 retro-cadence machinery fix (dev-rejects batch ROUTINE, defect-resolve stays immediate) batched the retro CLEANLY at the chunk boundary instead of thrashing on the UC-019/020 dev-rejects; NO prod defect followed a batched dev-reject (CFR falsification guard held); dated note added to IMP-019. Improvement-slice IMP-020 QUEUED (owned by cicd): a CI bundle-freshness guard for the recurring OI-BUNDLE-DRIFT (committed `infra/assets/*.mjs` go stale vs `src/app`; UC-ADIX-020 `6a1c88a` stale bundle → incidental regen → mid-validation CI auto-redeploy `6a1c88a`→`9212c9d`, no functional impact but confusing deploy-identity shift) — rebuild bundles and FAIL push if committed `.mjs` differ from a fresh `make bundle-all`; also flags the sibling `make render-diagrams` cicd-capability gap. Registry: 8 active (EXP-101,106,107,109,112,113,115,116) — AT cap-8; no rows added/retired; main's scoring preserved. No global-section rules changed; routed changes = engineer.md + product.md + work-items SKILL.md + IMP-020; version bumped as the retro snapshot. Next constraint: unchanged (queue = artifact); watch no prod defect appears after a batched dev-reject (would falsify IMP-019). -->

<!-- v101 (retro, AdixOut 2026-07-23; REQ-005 Chunk B close — dynamic multi-tenant onboarding, UC-ADIX-019; merged main v100 FIRST — clean automatic merge, no conflicts, then bumped on top): constraint UNCHANGED — `queue` wait, the established calendar-time/dependency ARTIFACT, not squeezable in-system (budget NOT spent on it, constraint-gate). CFR elevated by HONESTLY-recorded dev-catches (EXP-108 integrity): UC-ADIX-019 took 3 dev-validation rework cycles, each an adversarial-e2e dev-catch fixed BEFORE prod (static→dynamic API-GW key; then new-customer-only→pre-existing-row self-heal) — the process WORKING (XP/TDD/dev-first), not decay. CENTERPIECE = **IMP-019 IMPLEMENTED** (a shared-MACHINERY change): `compute_retro_debt` in `work-items.py` now classifies a use-case `rejected`/`build_failed` as ROUTINE (`uc-rework`, batches to the retro threshold) instead of an immediate-trip incident — a dev reject fixed + re-validated is the process working, not an incident; the `defect`-resolve branch STAYS an immediate incident (a defect against SHIPPED work is a real escape); `due = routine>=threshold OR incidents>=1` unchanged so accumulated rework still batch-triggers and a real defect still fires immediately. Module cadence comment updated; machinery self-tests extended + GREEN (107 tests OK). Plus ONE plain-practice fold (NO experiment row): multi-tenant provisioning COMPLETENESS → solution-architect.md + tester.md — for a multi-tenant onboarding/provisioning surface, acceptance MUST enumerate the FULL per-customer resource set and ensure ALL of it idempotently INCLUDING self-healing a customer whose record predates a later-added resource (the migration case), not just the happy-path new-onboard; founding failure UC-ADIX-019 (resource set discovered incrementally + fingerprint idempotency short-circuit skipped pre-existing rows). Sibling of EXP-109 (extends single-resource idempotency to resource-SET completeness + migration). EXP-109 scored: heavy workout, concurrency HELD, the resource-set/migration gap is the newly-surfaced sibling now covered by the fold (dated note, no new row). Registry after fold-forward from main v100: 8 active (EXP-101,106,107,109,112,113,115,116) — AT cap-8; no rows added/retired. Operational note (PROJECT/consumer-doc item, NOT a process change): API-GW API-key propagation ~60s after association before a new customer's key authorizes — flagged for the project docs. No global-section rules changed; the routed changes are the work-items.py machinery + solution-architect.md/tester.md folds; version bumped as the retro snapshot. Next constraint: unchanged (queue = artifact); watch no prod defect appears after a batched dev-reject (would falsify IMP-019). -->

<!-- v100 (retro, ROC 2026-07-23; SLC-ROC-010 close + process-adherence self-assessment; fold-forwarded main v89→v99 FIRST — clean fast-forward, 51 commits, then bumped on top — the `2026-07-16-loop-ran-on-stale-process` correction): constraint = `registered`/`queue` 65.3% of GLT, the ESTABLISHED batch-registration + weekend-cadence ARTIFACT (not squeezable in-system, budget NOT spent on it, constraint-gate); next `blocked`/`external` 28.2% = DEF-ROC-004 (aas-test Azure access gap), genuinely external + correctly PARKED as decision debt; the in-system engineer/`building` constraint FELL 25.6%→6.4% (many small fast local UI UCs), largely wrung out. CFR 0%, rework 0%. The ROC loop ran LEANER than the letter of §F — the orchestrator authored obvious decomposition-gap UCs itself + centralised bookkeeping; the user authorised validating this pragmatism AS AN EXPERIMENT → registered EXP-116 (GUARDED, orchestrator.md), which is the EXPLOIT move on the registration-latency constraint. Its guards fence off the KNOWN-forbidden hand-crank pattern (G3 = v98 rule stands) and encode two honest negatives this cycle: token-coverage regressed 50%→19.5% under centralised appends → EXP-103 KILLED, mechanism kept as guard G5; live-stack E2E only happened after the user demanded it → guard G4 (mandatory per UI/pipeline slice) + memory `roc-local-e2e-validation`. Registry: EXP-103 killed + EXP-114 (already-adopted-v98) physically pruned → 8 active (EXP-101,106,107,109,112,113,115,116), AT cap-8. No global-section rules changed this retro — the routed change is orchestrator.md (EXP-116) + registry hygiene; version bumped as the retro snapshot. Next constraint: registered/queue (artifact) — watch EXP-116 cut registration latency without breaching a guard. -->

<!-- v99 (retro, AdixOut 2026-07-22; merged main v98 first — fast-forward, no conflicts — then re-applied on top; REQ-005 Chunk A close): constraint UNCHANGED — `queue` wait (72.9%), the established calendar-time/dependency ARTIFACT, not squeezable in-system (budget NOT spent on it, constraint-gate). The retro-debt gate tripped on UC-ADIX-017's dev-validation `rejected` — a WAF false-positive CAUGHT in dev + fixed in rework (the process WORKING, dev-first containment before any prod exposure), not an incident. LEAN — TWO plain-practice folds (NO new experiment rows): (A) tester.md + solution-architect.md — an EDGE PROTECTION (WAF managed rules, body inspection, schema/size limits) in front of an endpoint MUST have its acceptance exercised with a REAL representative request PAYLOAD (e.g. an actual AIDX XML `FlightLegRQ` body), never empty-body/query-param/happy-path probes; solution-architect authors the real-payload edge condition, tester exercises it. Founding failure: UC-ADIX-016's WAF was validated only with query-param/empty-body probes, so `AWSManagedRulesCommonRuleSet`'s `CrossSiteScripting_BODY` silently blocked every real AIDX XML body until UC-ADIX-017 sent one (an escaped edge false-positive that would have blocked the real consumer in prod). Sibling of assert-real-state-not-proxy (v97) + concurrency-acceptance (EXP-109). (B) aws-architecture skill — `AWSManagedRulesCommonRuleSet` body sub-rules `CrossSiteScripting_BODY` (XML tags read as XSS) and `GenericRFI_BODY` (namespace URIs `http://…`/`urn:…`, the `://` reads as RFI) BLOCK well-formed XML request bodies; for any XML-body endpoint PLAN UPFRONT a scoped `ruleActionOverrides` setting those sub-rules to `count` (never `allow`) on that route WITH compensating controls (schema/XSD validation + auth + entitlement + keep every other CRS rule and SSRF blocking), route-scope the WebACL — a security-posture decision requiring human approval (cited UC-ADIX-017, human-approved 2026-07-22). Plus ONE meta-finding → improvement-slice IMP-019 (DEFERRED, not done inline): the §F8 retro-debt gate treats ANY `rejected` as an immediate-trip incident, so a dev-validation reject fixed+re-validated green within the same slice forces an immediate full retro (+ cross-instance reconciliation) — 3 retros in one AdixOut drain, largely from dev-catches (the process working); proposed machinery change batches a `rejected`-then-`validated`-on-same-item as ROUTINE, only `deploy_failed` + PROD `DEF-` resolves trip immediately (unresolved/repeated rejects still count); has self-tests, deferred to a tested change not done under time pressure. Registry after reconciling with main v98: 8 active (EXP-101,103,106,107,109,112,113,115) — back AT cap-8 (EXP-114 ADOPTED at main's v98 OFS retro). Note: CFR is elevated this window from the HONESTLY-recorded dev-catches (EXP-108 integrity) — the process working, not decay. Next constraint: unchanged (queue = artifact); exploit landed = real-payload edge-protection acceptance + the WAF-XML gotcha doc. -->

<!-- v98 (gap-closing retro, OperationalFlowSimulator 2026-07-22; §F8 incident gate — DEF-003 defect-resolve, human-reported "cannot see the log-normal curve"): TWO failures, both mine. (1) DEF-003: the shipped distribution chart (UC-G2) + save-config features (E1/E2/E3) were INVISIBLE via `demo.sh` because its hardcoded flag list drifted from flags.ts, while the demo-journey e2e stayed GREEN off its OWN hardcoded flag copy — the validated path was one no user runs. A recurrence of the EXP-115 class at the ENTRY-POINT/RUNNER seam. Fixed via the loop (single code-derived source of truth for the demo flag set, shared by demo.sh + e2e, red→green drift-guard; tester drove the real demo URL and SAW the curve — chart=1 bars=6 curve=1, μ 4.14/σ 0.67). EXP-115 strengthened in tester.md: validate the REAL human entry point (demo.sh/run script/URL), derived the way it does, never a harness copy. (2) ORCHESTRATOR HAND-CRANKING: I diagnosed DEF-003 then edited demo.sh + the e2e MYSELF and nearly committed, skipping the defect gate + loop — the user had to stop me ("you are not ingesting work properly"). Reverted, registered DEF-003, drove it engineer→tester. Principle-failure opened (2026-07-22-orchestrator-hand-cranked-fix-instead-of-defect-loop) — recurring habit. RULE (this version): the orchestrator INGESTS any bug report as a `/defect` and drives the loop (engineer builds TDD, tester validates); it may diagnose/reproduce but NEVER hand-edits the product fix — a fix applied without a tracked defect + owning-agent build is a violation to redo through the loop. Registry: EXP-114 (painted-pixel a11y) ADOPTED 3/3 (UC-G2 chart was its 3rd positive) → back to cap-8; EXP-115 →1/3 (strengthened). Constraint unchanged (calendar-time-dominated, directional); both changes are justified quality/discipline exploits under the constraint-gate. -->

<!-- v97 (retro, AdixOut 2026-07-22; reconciled from a locally-authored v94 that collided with main's concurrent v94/v95/v96 OFS+ROC retros — additive, only version+registry reconciled; REQ-005 Chunk A — external AIDX delivery foundation on dev-shared): constraint = `queue` wait (established calendar-time/dependency ARTIFACT, not squeezable — budget NOT spent on it, constraint-gate). Real signal = CFR spiked 12.5%→28%, ALL at the deploy→validate boundary, one root-cause family: cheap local gates (unit/lint/`sst diff`/synth-pin) assure against MOCKS/PLANS not the real AWS control plane, so 3 real failures surfaced only at CI/live (UC-014 iam:CreateRole least-priv; UC-016 WAFv2 description-charset ValidationException; UC-016/DEF-ADIX-002 SST `$transform` no-op on the ApiGatewayV1 Stage — `sst diff` even FALSELY showed the tag applying) + an escaped false-green (UC-014 AC7 validated on a response HEADER proxy not the real resource tags → DEF-ADIX-002). Root cause = cheap-proxy assurance standing in for real-world state; EXP-108 worked (CFR honestly 28%, not a false 0%). FIVE plain-practice folds (NO new experiment rows): (a) tester.md — assert the REAL deployed resource state (live config, e.g. `aws apigateway get-tags`), never a proxy (header/synth plan); a synth plan is NOT authoritative for apply-time effects. (b) tester.md — scope a re-validation to the DELTA + light regression smoke, not a full expensive campaign re-run. (c) aws-architecture skill — SST v3 child-resource customization uses the component's construction-time `transform.<child>` PROP, not a global `$transform` (permanent no-op for child-at-construction resources). (d) loop-run.md + cicd.md — under pipeline (push→CI) deploys the ORCHESTRATOR fires the CI-confirmed `deployed` (AGENT=cicd, REF=<sha>, NOTE citing the green CI run); engineers/testers must not spoof AGENT=cicd; queued IMP-018 (CI pipeline emits `deployed` itself). (e) work-items skill — SINGLE-QUOTE `make wi-append NOTE='…'` (a `$`-seq in a double-quoted note is shell-mangled: `$transform`→`ransform`); caller hazard, not a machinery bug. Scores: EXP-108 →3/3 VALIDATED/ADOPTED (3 deploy failures in one cycle each recorded a `deploy_failed`; rule already plain practice; row MOVED to archive) — archived; EXP-107 →NEGATIVE/BOUNDARY (local synth catches SHAPE only, not real-control-plane failures — not killed, but subordinate to EXP-108 + live-verify 1a); EXP-101 →PARTIAL POSITIVE (first real hosted-dev validation on dev-shared; dev→prod promotion leg deferred with prod). Registry (reconciled with main v96) = 9 active (EXP-101,103,106,107,109,112,113,114,115) — 1 over cap-8 because EXP-114/115 landed on main after AdixOut's v93 trim (cross-instance additions, not killed; reconcile ≤8 next retro). Next constraint: unchanged (queue = artifact); exploit landed = live-real-state verification + SST gotcha doc, targeting CFR back down from 28%. -->

<!-- v96 (gap-closing retro, OperationalFlowSimulator 2026-07-21; §F8 incident gate — DEF-002 defect-resolve): a demo sample-config artifact I shipped FAILED the actual paste→load→run path (a `batchSize` run-params error, no such UI field) because the single config textarea runs BOTH loadStationChain AND loadRunParams on one blob and the samples carried only `stations` — and it was called "verified" having only been checked against loadStationChain in isolation, never the end-to-end journey. Root: "done/verified" was allowed without executing the whole primary journey with the REAL artifacts; sample/demo data was eyeballed, not validated under test. Change routed (EXP-115, tester.md): any shipped loadable data artifact (sample/demo/seed/fixture) is a VALIDATED artifact with a committed test that loads THAT FILE through the public surface and runs the journey to a terminal outcome; "verified/done" means the whole journey was executed+observed, not that a sub-step is green (the EXP-110 unrun-test rule applied to the JOURNEY). Founding fix: e2e/samples-demo.spec.ts loads the real samples/*.json and drives load→run→occupancy→drill-down to `done` (214 unit + 116 e2e green). Also fixed the samples (linear=fixed-batch, rework=Poisson arrival) + corrected demo.sh instructions (one JSON carries stations + run params; there are no separate fields). Human-surfaced the failure directly. Constraint unchanged (calendar-time-dominated, directional); this is a justified quality/safety exploit under the constraint-gate. -->

<!-- v95 (retro, OperationalFlowSimulator 2026-07-21;

<!-- v95 (retro, OperationalFlowSimulator 2026-07-21; §F8 routine-batch gate, 4/3 closes: SLC-B1+CHK-B+SLC-C1+CHK-C): the live-flow-view work delivered cleanly — CHK-B (live station occupancy + green→red ageing) and CHK-C (item drill-down) both done, so REQ-OFS's entire NON-DEFERRED scope (CHK-A/B/C) is complete (REQ-OFS stays in_progress only because CHK-D is deliberately deferred). Active DORA: lead-time median 612s (still improving, 937→667→612 across retros), deploy-freq 4.75/day; CFR 9.5% and rework 10.5% (2 dev-rejections — UC-B1 chip-border + one prior — both CAUGHT at dev-validation, contained, never shipped) + 1 defect (DEF-001, the founding a11y miss). Constraint: queue/registered 65.9% of GLT (UP from 52%) but calendar-time-dominated (items registered 07-14, pulled 07-21 across a multi-day gap) — DIRECTIONAL, budget NOT spent on it (constraint-gate); the actionable working constraint stays engineer/building (32.8%), stable. Experiments SCORED POSITIVE on first real use: EXP-114 (painted-pixel a11y) →2/3 — applied on UC-B2 (linear-sRGB keeps contrast ≥4.5:1 across the whole scale by construction, 6.37–10.85:1) and UC-C2 (painted-pixel contrast + focus-ring delta), 0 a11y defects shipped, false-green class eliminated; EXP-113 (loop STEP-0 freshness) →1/3 — the restart folded forward and re-hit 0 already-fixed defects (vs 3× the prior stale session). One real waste event: an engineer agent STALLED mid-build on UC-C2 (~600s, watchdog) having committed nothing → full re-dispatch. Change routed (plain practice, no experiment row per v88 leanness): engineer.md — commit at each green SUB-STEP not only the final green, so a stall costs one increment not the whole UC. Minor coverage/tagging findings + a wi-append-EXP=registered doc nit → open-items.md. The tester also fixed a process-layer bug (multi-line `@covers` parser in impacted-tests.js, +regression test) — rides this fold-back. -->

<!-- v94 (gap-closing retro, OperationalFlowSimulator 2026-07-16, reconciled/renumbered from a locally-authored v93 that collided with main's concurrent v93 + EXP-106/CORE-gate; content additive, only version+EXP ids reconciled): both incidents are ONE root cause — contrast asserted from the token, not verified at the rendered surface. DEF-001: a WCAG 2.2 AA miss (Reset button 4.41:1) SHIPPED in already-done UC-A3 and was invisible because (a) the project had no axe wiring until this session and (b) the token nominally passed while a CSS `transition` painted a low-contrast mid-flip pixel — and `getComputedStyle` FALSE-GREENS (returns the declared token, not the painted pixel). UC-B1 dev-reject: a chip border token blind-aliased to the panel border (1.26:1), never checked against the slice's NEW adjacencies. Gap = no painted-pixel a11y/contrast gate; contrast was a nominal assertion, not a rendered check. Change routed (EXP-114): tester.md — contrast verified at the PAINTED PIXEL (screenshot→RGBA, node zlib, no dep), settled + across transitions/states, page-wide axe with NO permanent .exclude(), add @axe-core/playwright as the first UI slice's gate if absent; ui-designer.md — contrast conditions painted-pixel-verifiable, never blind-alias a token without checking its new adjacencies. Targets CFR (a11y defect caught in-loop, never shipped to done; false-green contrast-check class eliminated). GOOD signal this session: the tester ADDED axe ad hoc and caught both — this retro makes that standing, not ad hoc. Constraint note: still calendar-time/queue-dominated on wall-clock; the actionable in-system finding was quality (a11y gate), a justified safety exploit under the constraint-gate. Registry over nominal cap-8 (~13 active from concurrent multi-project retros) — a prune pass is owed, tracked, not blocking this mandatory gap-closing row. -->

<!-- v92 (retro, OperationalFlowSimulator 2026-07-16; §F8 routine-batch gate, 3/3 closes SLC-A2+SLC-A3+CHK-A): SLC-A3 (Poisson arrival + convergence) shipped clean — UC-A9/A10/A11 all done, 0 rework, 0 defects; active DORA HEALTHY and improved (lead-time median 937→667s, CFR 7.7→6.7%). Reported constraint = `queue`/registered 52% + engineer/building 47% of GLT, but the sample is calendar-time-dominated (UC-A10 was a DROPPED WIP — pulled 2026-07-14, session ended mid-build, sat ~1.6 days in `building` until this session resumed it) — DIRECTIONAL, budget NOT spent on the queue number (constraint-gate). REAL root-cause finding (EXPLOIT): the loop STARTED on an 8-versions-stale process (worktree was 66 commits / v83 behind main's v91), so the tester re-hit the ALREADY-FIXED EXP-104 impacted-tests nested-repo bug 3× (UC-A9/A10/A11), each a manual change-map fallback — pure waste re-incurring a fixed defect. Why-chain: tester hit fixed bug → tool was stale → worktree 8 versions behind → `/loop-run` never folds-forward (only `/project-switch` does) → process freshness was not a loop precondition. Change routed: EXP-113 — `/loop-run` STEP 0 = `make project-update` before the first pull (narrowest owner = .claude/commands/loop-run.md); principle-failure 2026-07-16-loop-ran-on-stale-process opened (recurring root cause — impacted-tests now ~8× across projects, all downstream of staleness/parked-spec). Registry: EXP-113 added (targets tester lead-time + reconcile-latency). Next constraint to attack: engineer/building active time once the calendar-time confound is removed (a continuously-resumed loop). -->

<!-- v91 (retro, AdixOut 2026-07-13; incident-triggered — DEF-ADIX-001 defect-resolve): constraint = `queue` wait (73.6% of GLT), but n=7 over a 3-day multi-session window is calendar-time-dominated (spend-limit pause + human gaps + a compaction) — DIRECTIONAL, budget NOT spent on it (constraint-gate). Real win this session: the engineer stage's REWORK fell to 0.68% (from 33% rework-rate last retro) and lead-time median 3022→2000→1284s — because EXP-109 (concurrency-acceptance authored upfront, last retro's exploit) landed and PAID OFF on its first concurrent surface (REQ-002 UC-008 throttle: 0 rework, no repeat of the UC-006 race). Incident: DEF-ADIX-001 — dependency vulns (vitest CRITICAL + vite HIGH + esbuild) accumulated across the whole first requirement with NO audit signal in the loop (only GitHub's Dependabot banner, which no agent reads). Gap-closing change routed: EXP-112 — a `make audit` dependency-vulnerability gate wired into cicd's build/push gate (`npm audit --audit-level=high` across every manifest; a found advisory → a triaged DEF-). Scored: EXP-109 →1/2, EXP-110 →2/3, EXP-111 →2/3 (all POSITIVE); EXP-102 (defect-vs-rework fork) →3/3 ADOPTED (DEF-ADIX-001 correctly a DEF- not rework; woven into §3+tester.md, row retired — cap-neutral with EXP-112). Next constraint: engineer build time (rework largely wrung out); watch EXP-112 gate latency + EXP-109's 2nd opportunity. -->

<!-- v89 (2026-07-12, ROC retro): constraint = registered/queue (74.44% of GLT by owner
`queue`), but per §5b/EXP-100 method it is artifact-dominated — front-loaded batch UC-registration
at decomposition + multi-day human-session cadence on a weekend project; the squeezable in-system
WORKING constraint is engineer/building (25.56%). EXPLOIT enabler landed: EXP-103 fired on ROC
(token coverage 18%→50%, build tokens now visible). DOMINANT quality finding (constraint-gate
SAFETY exception): the §12d/EXP-106 CORE-job done-gate RECURRED on a third project — CHK-ROC-001
(CORE job J1 = a REAL Jira ticket) folded to `done` on its LOCAL/fake-Jira child while its
real-delivery remainder (SLC-ROC-002) was never registered, so CFR read 0.0% blind to it. Remedy:
registered SLC-ROC-002 (CHK-ROC-001 + REQ-ROC-001 reverted to in_progress — honest); opened
principle-failure 2026-07-12-roc-core-slice-local-only; §12d strengthened to point at a MECHANICAL
gate (IMP-011: a `wi-validate` I5 invariant failing a CORE aggregate that reaches `done` without a
job-success validation OR a registered remainder). EXP-106 scored NEGATIVE (1st opp), EXP-100 →2/3,
EXP-103 →1/2 positive. Registry held at the 8-active cap (no new rows — the remedy is a fix +
improvement-slice, not an experiment). -->

<!-- v88 (2026-07-12, ROC — experiment-leanness + honest measurement reform, human-directed):
§25a — HARD WIP cap of 8 active experiments (retire one to open one); a fix is NOT an experiment
(fold as plain practice, no row); 3-strikes score-or-kill (unscored/unmoved at 3 opportunities →
killed); archive-with-outcome mandatory. §F3 — REVERTED the v87 "defer registration" idea as
metric-gaming; the honest lever for chain lead-time is independent decomposition, not deferred
counting; GLT rightly includes all waits/gaps/outages (minimise them indirectly). Plus: agent
per-stage cycle time (duration_ms) recorded alongside GLT; registry backfilled to the cap. -->


<!-- v85 (retro, AdixOut 2026-07-12; renumbered from a v84 that collided with main's concurrent v84 CORE-job-done-gate retro — both sets of learning coexist, only the version number was reconciled): constraint = QUEUE WAIT (ready 48.9% + registered 27.7% = 76.6% of GLT by owner `queue`), sample n=2 and heavily contaminated by non-system waits (mid-session org spend-limit outage, heavy human-steering gaps, deliberate serial-build pacing) — treat DIRECTIONAL, not a capacity signal. CFR 33% from ONE rejection (UC-ADIX-003 deploy-race), a GOOD catch. Changes routed this cycle (all already applied + folded): aws-architecture IaC default CDK→SST v3 Ion; ADR-0006 (release/provenance) + ADR-0007 (tagging) encoded into aws-architecture §9a/§2a; 3 principle-failures (rushed-to-register-before-understanding; skipped-solution-architecture-gate→wrong-IaC; build-identity-claimed-before-code-live); documenter standing duty (living root README); safe-deploy stream-drain (AdixOut cicd). Forward lever for the queue constraint = per-UC worktree isolation so the inner loop's maximal-independent-set actually builds in parallel (improvement-slice IMP-017, deferred — validate on a cleaner sample). Token review: 811k delivery tokens for 2 UCs; dominant WASTE = the CDK→SST full-infra rebuild forced by the skipped architecture gate — the gate fix (check tech choices vs org before build) is the token lever too. -->
<!-- v87 (ROC retro 2026-07-12): §F0 — per-item board push + docs-refresh are HARD in-cycle invariants (board never lags item-file state by >1 cycle; documenter required at each slice close); founding lapse principle-failures/2026-07-11-board-and-docs-lag-during-loop.md. §F3 — register linear dependency-chain use-cases JIT per-UC, not batch up front (ROC: `registered` was 70% of GLT purely as a batch-registration artifact). BOTH folded as PLAIN process practice, deliberately NOT new experiment rows — enacting the same-retro directive to stop over-generating experiments and to fix DORA measurement. -->
<!-- v90 (retro, AdixOut 2026-07-12; incident-triggered — UC-ADIX-006 validation reject; renumbered v86→v90 to sit above main's concurrent v87–v89 retros — additive, no rule collision): constraint = queue WAIT again (ready 45.5% + registered 28.7% = 74.2% of GLT by owner `queue`), but the sample (n=6) is still heavily contaminated by non-system calendar time (org spend-limit pause, a context compaction, deliberate serial-build pacing) — DIRECTIONAL, not a capacity signal, so the change budget was NOT spent on the queue number. The actionable in-process constraint = the ENGINEER stage (19.4% active GLT, top working owner) and its REWORK (33.3% rework rate, CFR 25%). ToC EXPLOIT move taken: remove the rework at source. Incident: UC-ADIX-006 shipped a last-writer-wins concurrency race (silent push-only data loss, breach of REQ-001 J3) to the 0.6.0 deploy; the acceptance specified only happy-path gap-heal, so the engineer's green build could not cover it and only the tester's improvised batched-injection probe caught it (post-deploy → CFR hit). Fixed to 0.6.1 (monotonic conditional write + reload/re-fold/retry + skip pure-dedup saves), re-validated PASS (11-stream concurrent probe, 0 regressions). Changes routed this cycle: EXP-109 — architect authors concurrency/ordering/idempotency ACCEPTANCE conditions for concurrent surfaces (SQS/stream/EventBridge-triggered) + tester runs a concurrency/batch-durability probe as STANDING practice (solution-architect.md + tester.md). Retroactively REGISTERED two prior-session shipped changes never given a retro: EXP-110 (unrun test = failure — all tiers run, start Docker; engineer/tester/cicd) and EXP-111 (truthful build identity — Makefile assert-clean-tree + safe-deploy stream-drain). SUBORDINATE lever noted (the `registered` inventory) but deferred as confound-dominated. Token review: ~2.26M delivery tokens across 11 items (engineer 1.13M, tester 967k — the tester's high share is the concurrency-stress probing that caught the incident, DORA-positive, not waste); plumbing share 0% (coverage 38% — grows as dispatches carry --tokens). Deferred to open-items: committed-bundle-drift (handler .mjs bundles going stale vs source; caused no defect — deploy rebuilds — but recurring reconcile-commit noise). Next constraint to attack: still the engineer stage/rework — score whether EXP-109 lowers it. -->


## What this file is

This is the system's **rulebook** — the cross-agent rules in force, and nothing
else. It holds ONLY the rules; the story of *why* each rule exists lives in the
retro record and git, never inline here (see §27).

**The work item is the single source of truth.** Every unit of work is a typed
item file whose state is an append-only event log; **current state = `fold(events)`**
through the item's type graph. Queues, DORA/flow metrics, the dependency tree and
the human boards are all **derived views**, recomputed on read — never
stored-and-hand-synced. This kills the coherence-defect family (one fact in ≥6
places disagreeing) by construction.

Pointers:
- **Contract** for the machinery (write path, projections, invariants):
  `process/machinery/CONTRACT.md`.
- **State graphs** (per-type transitions, `state_owners`, `queue_map`):
  `process/machinery/state-graphs.json` — edit only via the retro/version-bump gate.
- **Design + rationale**: `design-rationale/work-item-state-model.md`. The prior
  QueueApproach design (pull-system, diagrams, worked retro) is archived at git tag
  `QueueApproach`.
- **Operative cutover rules**: **STAGE F → §F0**. Most of §F1–§F10 (buffers, WIP,
  parallel dispatch, collisions, retro-debt gate, deploy gate) stay valid and now
  operate on the *derived* queues — only the state substrate beneath them changed.

The prior multi-store model (ledger + `state.md` + `items.csv` state + `queues/*.csv` <!-- doc-lint:allow -->
+ `blocks.csv` + board) is archived at git tag **`QueueApproach`**. <!-- doc-lint:allow -->

---

# Table of contents

- **§F0** — CUTOVER: the work item is the single source of truth (READ FIRST)
- **STAGE 0** — Principles & metrics (§0a–§5a)
- **STAGE 1** — Next-work selection & gates (§6–§10)
- **STAGE 2** — Planning: slice / use-cases / acceptance (§11–§12)
- **STAGE 3** — Build (trunk, TDD) (§13–§17a)
- **STAGE 4** — Deploy (§18a–§19b)
- **STAGE 5** — Validate (§20)
- **STAGE 6** — Document (§21)
- **STAGE 7** — Retro & improvement (§22–§27)
- **STAGE F** — Flow & queues (pull-based) (§F1–§F10)

---

# STAGE F — §F0 first (the substrate every later section runs on)

## F0. CUTOVER — the work item is the single source of truth (v82)
<!-- doc-lint:allow-begin — §F0 is the sanctioned anchor that defines old→new; it must name the retired mechanics (§27.3) -->


**State lives ONLY in the per-item file.** One file per item at
`work/<project>/items/active/<ID>.md` (terminal items move verbatim to `items/done/<ID>.md`).
Each file carries an **append-only `events:` list**; the item's **current state is
`fold(events)`** through its type's graph in `process/machinery/state-graphs.json`. There is
NO stored `state` field, NO `queues/*.csv`, NO hand-run `state.md`, NO `dora record`. Because
each fact is stored once and every other view is computed from it, the coherence-defect family
(multiple stores of one fact disagreeing) **cannot occur** — this is the v52 "single writer"
principle taken to completion.

**Changing state = `make wi-append` (the only writer, edge-checked).**
`make wi-append PROJECT=<p> ID=<id> EVENT=<name> AGENT=<role> [REF=<sha>] [NOTE="…"]`.
The append folds the item to its current state and **rejects** any event that is not a legal
transition from that state for that agent (the half-transition that caused the drift — e.g.
`item_done` with no dequeue — is now unrepresentable). Needing a transition the graph lacks is
NOT something an agent may improvise: it opens a **graph amendment = a process experiment**
(EXP-NNN, retro/version-bump gate). Edges are stored **one-directional** (`parents`+`deps` up);
`children`/ancestors/tree are derived, so an edge can't disagree with itself.

**Views are derived, never stored — `make wi-project` after each loop pass.** It recomputes,
from the item set: `views/queues.{md,json}` (the Ready/Rework/Intake/Waiting membership §F2's
buffers now read), `views/state.md`, `views/tree.md`, and `views/stats.{json,md}`. Read the
derived queue views where §F2–§F9 say "queue".

**Metrics come from `wi-project` (the DORA ledger is frozen).** `stats.*` reports the four DORA
metrics AND — via `state_owners` in the graph — **every part of the process's contribution to
gross lead time**, its **quality** (failure/rework rate at its stage), and its **recovery**
(MTTR by failure class): agent-work-time vs `queue` wait-latency vs `external` blocked-time,
each as a share of gross lead time. This replaces `dora.py flow`/`compute`; the old
`process/dora/ledger/*.csv` is retained read-only as the QueueApproach archive.

**Drift gate by construction — `make wi-validate` before every pull.** Invariants I1–I4
(legal history; done ⇒ in no queue; edge consistency; one file per id). Non-zero exit blocks the
pull. This replaces `make ledger-drift` and `reconcile-registry`.

**Boards mirror per item, in-cycle — MANDATORY (§F0 invariant).** Every `wi-append` that
changes an item's state MUST be followed, in the SAME loop cycle, by dispatching the `linear`
and/or `jira` projection agent for that one id (idempotent, independent). The DISPATCH is not
optional or deferrable; only the external API *call* is best-effort (a failure is logged and the
next push/sweep reconciles). **Invariant: an item's board status never lags its item-file state
by more than the current cycle.** The full-sweep run is a periodic structure backstop, NOT the
primary path — if the sweep does real state work every time, per-item pushes are being skipped
(the board/doc-lag lapse). Likewise user-facing docs (README / GitBook, via `documenter`)
are refreshed at each slice close and must not drift from shipped state. Boards and docs are
projections — the item always wins, but a projection left stale is a process failure.

**Command mapping (old → new)** — the ONE sanctioned place naming retired mechanics (§27.3): <!-- doc-lint:allow -->
`dora record … --event enqueue/dequeue/item_done` → <!-- doc-lint:allow -->
`wi-append … --event made_ready/pulled/built_green/deployed/validated/…`; `queues/*.csv` + `state.md` → `views/` (derived); <!-- doc-lint:allow -->
`make ledger-drift` + `reconcile-registry` → `make wi-validate`; `dora.py flow`/`compute` → `make wi-project` (stats.*); `sync-linear.py --item` → the `linear` agent. <!-- doc-lint:allow --> **Applies to** OagEventSource (migrated) and every NEW project; the flow *intent* of the
later STAGE F rules stands, the *substrate* is F0.

---

# STAGE 0 — Principles & metrics

<!-- doc-lint:allow-end -->

## 0a. Multi-instance operating model
More than one Claude instance may run against this shared parent repo at once (a Windows
+ a Mac, sharing one `origin/main`), **in parallel on different projects**. Genuinely
shared state (commit to `main` via reconcile): `.claude/`, `process/` docs, `CLAUDE.md`,
`README.md`, `_TEMPLATE/`. Project output is already isolated — every `work/<project>/`
is its own gitignored repo (§14) and **work items are inherently per-file / per-project**
(§F0), so two instances on two projects touch disjoint file sets; there is no shared
append-only log to merge-race — per-item files ARE the isolation. Four rules:

1. **The active-project pointer is machine-local.** `work/ACTIVE` is gitignored; each
   instance owns its copy. `/project-switch` writes only the local pointer. A flow
   command that finds no `work/ACTIVE` STOPS and asks for `/project-switch` — never falls
   back to another machine's project. There is no global "active project".
2. **Each instance works on its own branch.** Parent-repo commits land on
   `instance/<project>`; `main` is the reconciled baseline no loop writes directly. On
   its own branch an instance is the SOLE writer, so nothing conflicts mid-flight —
   conflicts exist only at the reconcile point. Either instance may `git fetch` the
   other's branch to borrow an experiment before it lands.
3. **Reconcile to `main` CONTINUOUSLY** — as often as the work produces a stable point,
   at latest every retro cadence (§F8) and session boundary. **Batching reconciliation
   is banned** (it repeats the v60 pooled-commit failure). **Reconcile latency**
   (instance-branch commit → landed on `main`) is a component of gross lead time; the
   retro measures and drives it down (§F0 `stats.*` surfaces it as a time thief).
4. **Support tooling is cross-platform, resolved at start.** Scripts resolve the right
   interpreter at invocation and cache it machine-locally (the machinery launcher
   `sh .claude/skills/work-items/scripts/work-items`; all file I/O UTF-8). Agents invoke
   the launcher or `make wi-*`, never bare `python3`. A support tool that runs on only
   one OS is a blocker to fix, not to work around.

Targets: gross lead time / throughput (no cross-instance clobber-and-reconcile rework)
and CFR (no derived-state lies from a merge race). [EXP-089]

## 0b. Production database safety — agents are read-only on prod

A state change against a **production database** — any **non-local, non-Docker**
database (a real shared/hosted server, not a local clone or dev container) — is the
single highest-consequence action in the system. This rule is absolute and overrides
any task instruction, autonomy level, or urgency.

**1. On a production DB, an agent issues SELECT / read-only queries ONLY.** Never a
state-changing statement (`INSERT`/`UPDATE`/`DELETE`/`MERGE`/`TRUNCATE`, any DDL,
side-effecting `EXEC`/stored-proc, bulk load) under any circumstances. Local / Docker
clones are the opposite — the safe target where you DO run updates freely. Prefer a
read-only prod credential; the rule binds regardless of what the credential permits.

**Never modify cloud infrastructure to gain access.** No creating/changing
firewall/network rules, credentials, roles, tenants, or any cloud resource to reach a
DB. If a DB is unreachable, STOP and surface the exact block (error + client IP to
allow-list) for the human to provision. Access provisioning is a human action.

**2. A required production change is NOT applied by the agent — it produces a sign-off
bundle** for a human to apply: (a) the exact idempotent, transactional, reversible,
self-asserting script; (b) a clone of the prod DB (the safe local/Docker target it was
proven against, never prod); (c) evidence of RUNNING it against the clone (before/after
state, RED→GREEN, row counts, rollback proof). A human **and a second reviewer** sign
off (**two-person rule**) before any manual production change.

**3. Prefer an automated reversible path where it exists** — a working reversible
migration / CD pipeline, developed + proven on a clone, human-gated; still never a
hand-write to prod. The sign-off bundle is the fallback when no such path exists.
**Each project records in its OWN space which path applies and how to recognise its
prod instances** (naming/host/tag) — this file names no project.

**4. Cloning prod into a local/Docker instance for local work is allowed — PII
stripped at the read boundary** (retain only fields the work needs; drop non-relational
PII; exclude audit logs; optionally exclude data older than a project-set recency
window). The local clone is where you run updates freely; prod stays SELECT-only.

A prod state change issued by an agent is a **stop-the-line principle failure**, logged
in `principle-failures/`. Binds every DB-touching agent. Target: CFR + data-integrity
+ audit. [EXP-091]

## 1. Operating principles (beliefs)
See `principles/` for the full statements. In force: XP, always-TDD, value
slicing, trunk-based development, continuous deployment, roll-forward-with-
reversible-rollback, defect-as-spec, jobs-to-be-done, version-identifiable
deployments. Treat these as defaults, not laws — deviations are allowed but must
be logged in `principle-failures/`.

## 2. Metric definitions
All figures are computed from item event timestamps by `make wi-project` (§F0);
`stats.*` is the one source.
- **Gross lead time = wall-clock from idea accepted (`registered`) → running in
  prod (`done`).** Includes everything: agent-work time, `queue` wait, `external`
  blocked-time, session idle, overnight, and pipeline iteration loops. `stats.*`
  splits it by `state_owners`, so every part's contribution is visible.
- **Time-to-first-deploy = kickoff → slice-001 done.** Target: < 90 min local-only;
  < 3h for cloud/hosted first deploy.
- **Delivery gap = deploy(N) → engineer `pulled`(N+1).** Target < 15 min in-session.
- **Deploy event by project type:** cloud/hosted — CI/CD pipeline live in
  production (the `deployed` event fired by cicd after the per-UC deploy lands, on
  the engineer's `built_green` build); local CLI / library — tester validation
  passes (the `validated` event).

## 3. CFR convention (definitional)
CFR answers one question: **what fraction of DEPLOYS broke?** A prod issue is one of
two kinds, kept distinct so they are never conflated (the single-bucket convention
inflated CFR — every `/defect` used to count):

- **deploy-failure / deploy-recovery** — a change we **just shipped** failed its own
  validation (a just-deployed item `rejected` back to `reworking`, failed prod smoke,
  user-visible regression from this deploy). **These are the CFR numerator.**
- **defect-intake / defect-resolved** (a `defect` item, `DEF-`) — a defect raised
  against the **standing system** via `/defect`. Real and production-impacting, but
  not a failure *of a specific recent deploy*, so it is **excluded from CFR** and
  reported separately as a **defect-arrival rate**. Counting it in CFR would measure
  how diligently we report, not how often deploys break.
- **pipeline-failure / pipeline-recovery** — a **pre-DEPLOY** CI red (build / test /
  lint / typecheck, before any deploy step runs). Not in CFR/MTTR; a pipeline-iteration
  wait (§5), attacked via cicd pre-flight. **NARROWED [v87]:** this carve-out is ONLY for
  failures *before* a deploy. A **deploy step that fails is NOT a pipeline wait** — see below.

**Deploy failures ARE recorded and ARE counted [v87, EXP-108].** When a DEPLOY to any
environment fails — including a CI job that auto-deploys (the UC-XA2 `ec56025` infra-CI-red
incident) — it is a `deploy_failed` event (`deploying`/`prod-deploying` → `reworking`), fired
by cicd/engineer **even when fixed-forward**. `deploy_failed` is a CFR change-failure:
`wi-project` now computes **CFR = (rejected + deploy_failed) / (validated + rejected +
deploy_failed)**. The old convention let a fixed-forward deploy failure hide as a "pipeline
wait" with no event, so CFR read a falsely-perfect 0% (`principle-failures/2026-07-12-cfr-reads-zero-and-no-cancel-state`).
A green/zero quality reading must reflect *recorded, verified* reality — never *un-recorded*
failure.

**MTTR spans deploy-failures (incl. `deploy_failed`) and defect-intakes** — recovery speed
for *any* prod issue. `wi-project` classifies by item type and event, so the distinction holds.
A genuine deploy regression is a deploy-failure, full stop — a defect item is only for
issues raised against already-shipped, standing work.

## 5. Wait-time taxonomy (the flow model)
The orchestrator reads `stats.*` as a flow model, finds the constraint (the
lowest-throughput stage / largest lead-time contributor via `state_owners`), and
attacks the dominant wait class. Recurring classes and their standing fixes:

| Wait pattern | Fix (where it lives) |
|---|---|
| Session-boundary idle (overnight gaps) | Session continuity (§13) |
| Pipeline iteration loop (fix-push-wait on novelty) | cicd pre-flight + fail-fast (cicd.md) |
| Human gate wait | Auto-approve + one intake gate (§F5) |
| Prod-found defect cycle | Cross-stack contract + walking-skeleton probe at skeleton time (engineer.md, §17) |
| End-of-iteration human prompt | Auto-retro at delivery (§20) |
| Smoke regression / fragile selector | Stable selectors + surface-change done condition (engineer.md, tester.md) |
| Permission prompts | Command-form contract + committed allowlist (§15–§16) |

## 5a. Failure semantics — whose problem is it
A **5xx from a call indicates the CALLED service is failing** — it may recover
(callers use **jittered exponential backoff** before concluding failure) or be
defective: **if we own the failing service, a 5xx concludes as a DEFECT item raised**,
never just an error log. A **4xx indicates the INPUT to the call was wrong — the caller
owns the problem**: inbound 4xx = our caller's data; a 4xx we RECEIVE from a dependency
= our request construction, our defect. Acceptance cases, validation specs, and runbooks
classify on these semantics. (Operational detail per role: agent definitions.)

## 5b. Theory of Constraints — the full five-step loop, not just "identify"
Identifying the constraint is step one of FIVE; the system runs the whole loop every
close/retro against `views/stats.md` §B `by_owner` (and `by_stage`). Do not stop at
naming it.
1. **IDENTIFY** — the constraint is the top GLT-share owner (largest contribution to
   gross lead time) in `stats.*` `by_owner`. Record it.
2. **EXPLOIT** — get more out of the constraint WITHOUT adding capacity: remove that
   owner's WASTE and REWORK first. Attack its `failure_rate`/rework-rate at its stage,
   its re-reads and redundant dispatches (§25/§26 token waste), its avoidable waits —
   everything that makes the constraint do work it should not. This is always the FIRST
   move after identify.
3. **SUBORDINATE** — make the non-constraint stages serve the constraint: cap the
   UPSTREAM queues' `wip_limit` (§F2) so non-constraint stages do not pile inventory on
   the constraint (WIP ages in front of it, inflating dwell). Non-constraints run at the
   constraint's pace, not their own.
4. **ELEVATE** — ONLY after exploit+subordinate are exhausted, add capacity: raise `N`
   (§F6), move the constraint agent to a stronger model tier (§7a). Elevation is the
   last resort because it costs (tokens/tier) and every tier move is a scored experiment
   with a revert condition.
5. **REPEAT** — the constraint moves once elevated; re-run from step 1 at the next
   close/retro. A constraint that has NOT shifted after a change targeting it is
   evidence the change did not exploit/subordinate/elevate the RIGHT thing.
The retro WALKS these steps (retro.md); a routed change-set that does not target the
current constraint must justify itself (a subordinate/exploit move or a safety fix) or
be deferred. Per-close, the loop does a cheap parts-check (loop-run.md) and escalates to
a full retro only when the constraint SHIFTS. Target: gross lead time.

---

# STAGE 1 — Next-work selection & gates

## 6. Loops
- **Requirement intake** → `/requirement` — a NEW requirement enters here, is
  ELABORATED by the discovery agent (personas across the four operator classes;
  jobs-to-be-done drilled to root need via 5-whys; per-persona failure modes) into a
  human-signed dossier, then JTBD-framed, valued/costed; the one upstream human gate
  for new value (§F5). Defects enter via `/defect`. (`/intake` is a retired shim.)
- **Continuous pull** → `/loop-run` — the inner dev loop pulls ready use-cases
  (parallel by independence, §F2/§F6) until queues drain; replenishes just-in-time
  (§F3). `/slice-next` is product's internal replenishment routine, not a human gate.
- **Flow status** → `/flow-status` — queues, buffers, time thieves (§F4), read from
  the derived `views/`.
- **New-requirement workflow** — one workflow, two triggers: auto-kicked by
  `/project-new` or run standalone by `/requirement-new`. Sequence: product vision →
  architecture + security review → chunk plan → capabilities → first slice.
- **Retro** → `/retro` — fires at the §F8 cadence (routine slice/chunk closes batch
  to threshold 3; prod defects / deploy failures trigger immediately).
- **Defect** → `/defect` — structured intake (expected/actual/intent/importance),
  reproduce-to-confirm (no phantom fixes), prioritise (§10), fix defect-as-spec +
  prod re-check, then a gap-closing retro that names the process gap and proposes a
  closing experiment with its applies-to predicate.

## 7. Agent roster
| Agent | When dispatched |
|-------|----------------|
| discovery | requirement elaboration at `/requirement`: personas (4 operator classes) + jobs-to-be-done (5-whys root need) + per-persona failure modes -> signed dossier |
| product | vision + slice definition (and parallel N+1 per §9b) |
| solution-architect | architecture delta + security review (and parallel N+1) |
| cicd | capabilities (environments, pipeline, rollback, flags, allowlist) |
| engineer | TDD build on trunk |
| tester | in-prod / public-surface validation |
| documenter | dispatched in parallel, in the background, at delivery (§21) |
| linear / jira | per-item board projection, non-blocking (§F0) |

### 7a. Model tiering
Each agent's `model:` frontmatter is a tunable lever, scored like any other change:
match the tier to the **judgment density** of the agent's task, not its prestige.
Current: **opus** = engineer (long-horizon TDD build, the CFR lever), orchestrator
(the ToC constraint), solution-architect, ui-designer; **sonnet** = product, cicd,
tester, flow-manager, discovery; **haiku** = documenter. On any model release the retro
re-assesses; every tier move is a registered experiment with a named DORA metric and
a revert condition (cost without a metric move = revert).

**Availability resilience.** An agent's `model:` must name a model the session can
actually run — a pinned-but-unavailable model is a hard stop, not a degraded run
(a mid-run unavailable model killed engineer/orchestrator builds on dispatch). When a
model is retired/unreachable, re-tier its agents to the next-available model that best
preserves the judgment-density intent **in the same retro**, before resuming.

**In-session bridge.** Agent `model:` is resolved/cached at session start, so editing
it does NOT rescue a running session — pass the Agent tool's per-call `model` override
(it takes precedence) on every spawn of the affected agent; the frontmatter edit is
the durable fix for the next session.

**Scoring quarantine.** A model-tier change confounds every DORA-scored experiment.
When any agent's `model:` changes, the retro opens a quarantine window (note it on the
registry header with date + agents moved). Experiments scored inside the window flag
`model-confounded` and may not be `validated` on a DORA move alone — they need a
mechanism-level confirmation or a scoring opportunity after the window closes. The
window closes when the next retro judges the tier stable (default: 2 slices, no
further model change).

## 8. Project classification
- **Cloud/hosted**: full AWS Well-Architected, IAM, the `aws-architecture` skill.
- **Local-only** (CLI, library, script): skip cloud scaffolding.

(Architect effort per posture: `solution-architect.md`.)

## 9. Gate auto-approval (the deploy gate is automated)
The **two-gate model (§F5) is the baseline**; the deploy gate now auto-approves
(§F5a). Every gate decision is appended to `work/<project>/decision-log.md`; between
gates, run unattended.

**a. Auto-approve where the outcome is clear:**
- Go/no-go to deploy: auto-approve when tests pass AND lint clean AND build succeeds
  AND no blocking deviations. App-only diffs auto-approve directly; infra-bearing
  diffs auto-approve under the §F5a automated policy assurance.
- **Gate timing under trunk-CD:** every push deploys, so for a route containing
  infra-bearing commits the go/no-go answer is settled AT ROUTE COMPLETION — before
  the build wave that pushes them — not after build. An engineer never holds a green
  commit waiting on a gate (that breaks §14); the orchestrator schedules the gate
  ahead of the wave.
- Arch + security for local-only projects with no new infra: architect
  self-certifies; orchestrator confirms; no human wait.
- **Security review auto-accept (all project types):** when the architect's delta
  states an explicit "no new attack surface, no new data flow, no new trust boundary"
  conclusion, the orchestrator confirms it is present and auto-accepts. A review that
  surfaces any new control, open risk, or deferred recommendation is not auto-accepted.

**b. Parallel N+1 planning.** Because decisions are logged, planning the NEXT slice
(product + architect) may begin while the CURRENT slice is built/tested, provided the
two are sequentially independent; otherwise serialise.

## 10. Next-work selection — the open-items register
"What runs next" is decided against the full set of unaddressed items, not just the
chunk plan. System-learning residue lives in `/process/improvement-slices/` +
`process/open-items.md` (project-agnostic carry-forward); project residue lives in
`work/<project>/open-items.md`.

When work is selected, also identify and log which ACTIVE experiments
(`/process/experiments.md`) it will exercise (match to each experiment's applies-to
predicate, §25a) — the known-up-front scoring opportunity set.

**A finding that is new customer value or newly-discovered scope** (not a defect, not a
collision, not process/system residue) is framed by product as a JTBD and REGISTERED as
a requirement/chunk/UC item via the intake path (`registered`), so it enters costing +
prioritisation here — distinct from `open-items.md` (process/system residue); a finding
needing a human value-judgement routes through the `/requirement` human gate (§F5, product.md).

Selection rule, applied at every "what next" decision and logged:
1. **DORA-helping process improvements first** — system learning is this repo's goal
   (bounded by judgement: don't starve a real customer need).
2. **User-value items ranked by job served** — core jobs beat secondary jobs.
3. **Risk items** (security hardening, debt) scheduled before the slice that widens
   the surface they guard.

(Register mechanics: `orchestrator.md`; job classification: `product.md`; chunk-plan
ownership: `product.md`.)

---

# STAGE 2 — Planning (slice / use-cases / acceptance)

## 11. Slice → use-case hierarchy
> chunk (capability) → slice (customer value, gated) → use case
> (separately buildable/testable unit) → route steps (red→green commits)

A slice is decomposed at planning into **use cases** so the build is not serialised as
one lump. Each use case states actor, trigger → observable outcome, its own done
condition, the acceptance cases it pins, and its **dependency edges** (only where
genuinely required — a false edge costs parallelism). The flow-manager reads the edges
as the parallelism plan; genuinely sequential mutations of one seam stay sequential.
(Decomposition is product's craft — `product.md`; engineer routes per use case,
tester validates the slice as one increment.)

## 11a. Every chunk maps to a Job-to-Be-Done with articulated value
**A chunk whose value we cannot articulate cannot be prioritised.** A job *code* is
not a value statement. Every chunk MUST carry a JTBD value statement answering, in
user/beneficiary terms: (1) **who gets value** — the named beneficiary, never "the
system"; (2) **what they can now do** they could not before; (3) **why this takes
priority** — for secondary/enabling chunks this MUST name the CORE value it unblocks
and why it is on the critical path. Each also carries a **Purpose** (a few words of
WHY) that becomes the chunk's board title suffix (`CHK-N · <name> — <purpose>`).
Product authors this in the chunk's definition; it is the basis for prioritisation.
A chunk that cannot be articulated this way is **not prioritisable** — surface it, do
not cost or pull it; **never fabricate value to make it schedulable**. If articulating
reveals several JIT chunk-wrappers are really one job, consolidate them. [EXP-073]

## 11b. Use-case flow — deploy-per-UC
Use cases do not wait for the slice to batch-deploy; each runs its own thin
build→deploy→probe loop on trunk:
1. **A use case with a deployable surface is DONE only when it is deployed and its
   committed probe is green in prod** (flag-OFF deploys count — dark code deployed
   early is the §40 norm). The probe is ENGINEER-owned, committed, parameterised —
   never a tester dispatch. The tester still validates the SLICE exactly once; per-UC
   probes shrink what reaches it, they do not multiply it (protects the constraint).
2. **Deploys never overwrite each other by construction:** same-pipeline deploys
   serialise via the pipeline's concurrency group; cross-pipeline order is a §19
   schedule edge in the route. A UC deploy that must wait on another's is a route
   edge — never a human watching two pipelines.
3. **Builds overlap freely** wherever seams allow — build start order is never the
   constraint; deploy ORDER is.
4. **Event sequence (state-graphs — dev-then-prod path):** a UC is validated in DEV
   BEFORE it reaches prod, and the whole path is UNATTENDED (no human touch after
   intake — dev-AC-green is an automated promotion assurance, §F5a, not a checkpoint):
   `building --built_green(engineer)--> deploying(deploy-to-dev) --deployed(cicd)-->
   dev-validating --dev_validated(tester)--> prod-deploying --promoted(cicd)-->
   prod-validating --validated(tester)--> done`.
   - The engineer fires `built_green` (building→deploying) on the green build.
   - **cicd deploys to DEV and fires `deployed` (deploying→dev-validating)** once the
     per-UC dev deploy lands green.
   - **The tester dev-validates against the ORIGINAL FROZEN `acceptance.md`** (the
     dev-validation oracle) and fires `dev_validated` (dev-validating→prod-deploying)
     on pass — dev AC green is the automated promotion gate to prod.
   - **`dev_validated` AUTOMATICALLY triggers the prod deploy** (like §F5a's infra
     auto-approve): **cicd deploys to PROD and fires `promoted` (prod-deploying→
     prod-validating)** — no human approves the promotion.
   - **The tester prod-validates and fires `validated` (prod-validating→done)** on the
     prod probe.
   Each is an edge-checked `make wi-append`, so a UC cannot reach a validating state
   without a real deploy, cannot promote to prod without dev AC green, and cannot reach
   `done` without a real prod validation. A failing validation appends `rejected`
   (either validating state → `reworking`, §5b/tester.md). **LOCAL-ONLY collapse
   (dev==prod, §8):** on a local-only project the dev surface IS the running surface, so
   the tester fires `validated` directly from `dev-validating` (→done) and there is no
   separate prod deploy; dev-first is the DEFAULT and straight-to-prod only this explicit
   local-only exception.

**Infra-flag — defer an unconfirmed external dependency, don't block the skeleton.**
The §40 use-case-flag pattern extends to INFRA: when an infra capability depends on an
external resource whose identifier is not yet confirmed (§17.1), the capability ships
**behind a default-OFF infra flag** so the CORE walking skeleton deploys NOW and the
unconfirmed dependency defers to an open item — never held back until the dependency
resolves. The flag default is OFF (promotion flips it once §17.1's check passes).
Target: deployment frequency + lead time, guarded by CFR. [EXP-057]

## 11c. Decision-debt — accepted tradeoffs with a revisit trigger
Some scope decisions are **removals/acceptances we do not expect to revisit** —
distinct from tech-debt (a shortcut *queued* to be paid back) and the decision-log (a
record of a decision made). A **decision-debt** entry is a deliberate long-term
decision carrying a known tradeoff and a **revisit trigger**: we accept the tradeoff
and do not spend cost re-evaluating it until the trigger fires. Recorded in
`work/<project>/decision-debt.md` (append-only): `id (DD-nnn)`, the decision, the
tradeoff accepted, and the revisit trigger (a concrete future condition — a new
requirement pressuring the same axis, or a defect — NOT a cadence, NOT "someday").
This keeps a settled decision from being silently relitigated and keeps the queues
free of work we have decided not to do. [EXP-076]

## 12. Acceptance cases
Product and architect co-author the slice's acceptance cases; the architect supplies
the technical/observable conditions and security controls (which become policy tests
at build time). Every acceptance case is tagged with its use case.

## 12a. Every use-case is board-ready: title, why, acceptance
The human-facing board (one issue per use-case, mirrored per item by the `linear`/`jira`
projection agent, §F0) shows, **sourced from the use-case's own item definition and
never invented at sync time**: a human-readable title; a why-it-matters statement (the
observable outcome/value); and its acceptance criteria. These live in the item's
`## Definition` (§11, §12); the board **mirrors** them. A use-case the sync finds with
**no acceptance criteria** is flagged **`needs-acceptance`** and is **not Ready** — it
cannot be pulled or built until product authors them (§F definition-of-ready). Genuine
gaps are flagged, **never back-filled with fabricated criteria**. [EXP-072]

## 12d. CORE-job done-gate + no-silent-partial delivery [v84]
Aggregate state folds **structurally** (all children `done` → `done`). For a CORE `job`
that is necessary but **NOT sufficient**: a slice/chunk carrying a CORE job is
"done-in-fact" only when its acceptance is validated against **that job's success measure
for the named persona(s)** — not merely when its child use-cases are `done`. Two
obligations:
1. **Job-anchored acceptance.** A CORE-job item's acceptance cases MUST cite the job's
   success measure and the persona(s) it serves (§11a, §12). The tester prod-validates a
   CORE-job item against that success measure, not incidental behaviour.
2. **No silent partial.** When a value-slice deliberately delivers only PART of a CORE
   job (a legitimate thin slice — e.g. same-account before cross-account), the
   **undelivered remainder MUST be registered as a tracked item (child/sibling) BEFORE the
   slice closes**. A CORE job may not leave `items/active/` empty while unfulfilled — an
   empty backlog is truthful only when every CORE job's success measure is met.
(Per-role: product anchors acceptance to the job's success measure + persona; tester
validates against it; flow-manager confirms the remainder is tracked before a partial CORE
slice closes.) Rationale + pattern:
`principle-failures/2026-07-11-core-slice-false-done-and-delivery-model-inversion`
(SLC-030 closed `done` having built same-account only; the cross-account CORE remainder
fell off the backlog and the inversion propagated to the consumer skill; CFR read 0.0%
throughout). [EXP-106]

**This gate is being made MECHANICAL (IMP-011, ROC retro 2026-07-12) after a THIRD
recurrence** — ROC's `CHK-ROC-001` (CORE job J1 = a real Jira ticket) folded to `done` on
its LOCAL/fake-Jira child while the real-delivery remainder `SLC-ROC-002` was never
registered (`principle-failures/2026-07-12-roc-core-slice-local-only-real-delivery-untracked`).
A text-only gate on a CORE invariant is not load-bearing; IMP-011 adds `wi-validate`
invariant **I5** — a CORE-job aggregate may not be `done` without EITHER a job-success
validation event in its subtree OR a registered, not-yet-done remainder child. Until I5
lands, the slice-close parts-check (§F8/EXP-100, loop-run) must explicitly verify this for
every CORE aggregate before it closes.

## 12e. Cancelling obsoleted work items [v87]
Work items have a **`cancelled`** terminal (state-graphs v5) for the item that is no longer
wanted — obsoleted by a design change, superseded by a better slice, or descoped. When work
is obsoleted, **fire `cancelled`** via `make wi-append … EVENT=cancelled AGENT=orchestrator`
(or flow-manager) — do NOT repurpose an item's definition in place, and do NOT hack an
illegal transition. A `cancelled` item is terminal: it archives to `items/done/`, sits in no
queue, and is **excluded from lead-time and deployment-frequency** (it never shipped). An
aggregate whose children are all terminal bubbles to `done` if ≥1 child is `done`, else
(all children cancelled) to `cancelled`; a cancelled child never blocks its parent. Rationale:
`principle-failures/2026-07-12-cfr-reads-zero-and-no-cancel-state` (a re-decomposition had to
repurpose items in place because no cancel path existed — forcing silent edits or illegal
transitions).

## 12b. Multi-party / multi-instance modelling
When a use case involves MORE THAN ONE PARTY operating SEPARATE INSTANCES (two
browsers, two devices, a sharer and a joiner), the happy-path of one instance is not
the use case — model BOTH sides:
1. **A state machine per instance.** Name each party's states/transitions. A change in
   one that must surface in the other is a transition with a SYNC POINT.
2. **Classify every sync point as in-band or out-of-band.** *In-band* = the app carries
   it (a WS frame; a join that triggers a state change visible in both boards — model
   the fan-out). *Out-of-band* = a human carries it outside the app (a code by chat).
   Out-of-band sync is still part of the use case: the affordance that feeds it
   (copy/display) must serve the RECEIVING party's actual need.
3. **Acceptance covers the cross-instance transition, not just one side.** A defect
   found only by a human driving two instances by hand is a modelling gap, not a
   test-count gap.
(Per-role: product models both parties' state machines + sync-point table; engineer
builds to both; tester validates from each instance's vantage.)

## 12c. Shared change-impact model
Every project maintains a small, shared, committed dependency model in
`work/<project>/architecture/dependencies/` — mermaid, load-bearing:
- **`use-case-deps.mmd`** — use-case/behavioural dependency graph (product at slice
  planning per §11; engineer extends as use cases land).
- **`class-deps.mmd`** — module/class dependency at SEAM granularity (engineer-owned;
  node = module/port/adapter, never every class).
- **`data-flow.mmd`** — runtime data-flow with **platform gates as explicit nodes**
  (WAF, authorizers, cache layers, TTL semantics, CSP). Solution-architect-owned; each
  slice's delta is a diagram delta. A platform gate that isn't a node is how
  strike-class defects hide.

Rules: (1) **read-before-build** — engineer routes against the model; hard edges ARE
§19 schedule constraints. (2) **updated-in-commit** — any commit that adds/removes/
redirects an edge updates the `.mmd` in the SAME commit, marking changed nodes/edges;
an unmarked change is a principle failure. (3) **read-before-test** — the tester
derives its plan from the model diff since the last validated sha; specs are tagged
`@covers <node-id>` so the impacted set is mechanically listable and spec VALIDITY is
reassessed when a covered node changes. (4) **load-bearing or deleted** — an artifact
no agent reads at decision time is ornamental; keep node granularity coarse. (5) **one
canonical node-id form (kebab-case)** — a node id and its `@covers` tag must be the
identical string; `make impacted-tests` will NOT fuzzy-match camelCase↔kebab.
Targets: tester (constraint), CFR (impact-blind testing misses the changed area), MTTR
(data-flow is the diagnosis map).

---

# STAGE 3 — Build (trunk, TDD)

## 13. Session continuity (primary wait-reduction lever for local-only)
- **a.** Start a session, finish a deliverable.
- **b.** Requirement workflow + first slice in one session.
- **c.** Don't dispatch the tester near end of session.
- **d.** Retro runs in the same session as delivery — automatic (§20).
- **e.** Never leave a defect recovery pending validation at a session boundary — if a
  roll-forward fix deploys, re-validate immediately in the same session (an overnight
  gap once inflated one MTTR pair to ~9h).

## 14. Commit discipline
The engineer commits to trunk every time the full test suite **and lint** go green (lint
passes inside the done-condition, not discovered post-commit).
- **Commit when green and lint clean, never when red.** One logical change per commit;
  the message states intent, not mechanics.
- **Infra-bearing push gate — "green" means green WHERE CI RUNS IT [v86, EXP-107].** A
  change that touches deploy-time infrastructure (`sst.config.ts`, `infra/`, IaC, deploy-role
  policies) is NOT push-green on unit + lint alone: CI auto-deploys such changes, so the
  pre-push done-condition MUST include the **synth/deploy gate CI will run** —
  `make -C work/<project> deploy-sst` (or at minimum `sst diff`/synth) passing locally —
  before push-on-green. Unit + lint green is necessary but NOT sufficient for infra: a
  statement that passes offline shape-tests can still be rejected at the AWS API on deploy
  (e.g. an invalid principal). Pushing infra green-locally-but-unsynthed is a deploy-failure
  waiting to turn CI red. Rationale: `principle-failures/2026-07-12-infra-pushed-green-locally-red-in-ci`.
- **Conventional Commits format.** Subject `type(scope): <intent>`, `type` ∈ {feat,fix,
  docs,style,refactor,perf,test,build,ci,chore,revert}; append `!` / `BREAKING CHANGE:`
  footer for a breaking change; keep the `Co-Authored-By` trailer.
- **Reference the tracked item — ISO traceability.** Every implementing commit names its
  **work-item id** (the board id it is mirrored to) plus the customer ticket where one
  exists, so an auditor can trace change ⇄ requirement (e.g. `fix(pnl): … (VF-003,
  PP-127)`); binds in BOTH repos. An item not yet mirrored is wired to its board before
  its first commit lands (no orphan commits); a genuine chore with no item is `chore: …`,
  never a fabricated id.
- **Commit TARGET — two separate repositories.** Each `work/<project>/` is its own
  independent git repo (liftable standalone). **Project output** — code, `items/active/`,
  `items/done/`, derived `views/`, slices, decision-log — commits INSIDE the project repo
  (`git -C work/<project> …`). **Agent-structure / process** (`.claude/`, `process/`,
  `CLAUDE.md`, `README.md`) commits in THIS parent repo on `instance/<project>`, reconciled
  to `main` continuously (§0a Rules 2–3). Parent `.gitignore`s `/work/*/`; `work/ACTIVE` is
  machine-local + gitignored (§0a Rule 1). **Never mix the two repos in one commit** — the
  cross-boundary leak this split exists to prevent.
- **Push to a VERIFIED remote as part of the done-condition** — integration is part of
  *done*, not deferred (batching once reached 44-ahead then failed CI). No verifiable
  origin (`git remote get-url origin` resolves to the known origin) → do NOT push, report
  and stop. Verified → push trunk each time a UC's full done-condition is met (suite + lint
  green); one UC's green trunk is one push, never accumulate. Each push sets off the
  non-blocking CI watch (§19b); a green-local / red-CI run is a defect (§19b), never silent.
- **Parallel-committer isolation = worktree.** When 2+ agents COMMIT concurrently on one
  repo, a file boundary is not enough — `git add` over a shared index sweeps a co-worker's
  staged files into your commit. Dispatch such committers in git WORKTREE isolation
  (`git worktree add`, private index). The ONE §14 exception to the no-worktree default,
  orthogonal to §40 flag-isolation; single-committer cycles keep the plain trunk tree with
  explicit-pathspec (`git commit -- <your-paths>`) as the fallback. [EXP-097]
- **Never `git stash` a shared tree** — stash-all hides OTHER agents' uncommitted work.
  Commit ONLY your explicit pathspec; `git pull --rebase --autostash` for just your own
  staged change; leave every file you do not own untouched.

## 15. Command form — the allowlist contract (all agents)
Every Bash command matches the committed allowlist in `.claude/settings.json` so it
runs without a prompt:
- Run everything from the project root. NEVER `cd … && …`, `pushd`, or `source … && …`
  — compound prefixes match no allowlist pattern and always prompt. Use
  `npm --prefix <dir> run <script>`, `make -C <dir> <target>`, `git -C <dir> …`, and
  root-relative script paths.
- Commands must not hand-assemble env-var prefixes or long argument strings inline.
  Defaults live in config; parameterised invocation lives in the root `Makefile`
  (`make wi-append …`, `make validate ITER=… SLICE=…`).
- A command class the allowlist lacks is a capability gap: name it so cicd extends the
  allowlist in the same slice — never work around it with a novel one-off shape.
- **Edit files with the file tools, never Bash.** Mutating a file with `cat >> f`,
  `echo … >>`, `tee`, `sed -i`, or any shell redirection always prompts. Use Edit/Write
  for every prose/markdown file (decision-log, open-items, experiments, item
  definitions, project.md). For item STATE use the committed writer
  (`make wi-append …`), never a hand-edit of an item's `events:`. Reach for Bash only
  to RUN things. A prompt caused by editing a file through the shell is a principle
  failure. [EXP-032]

## 16. Tools over permissions
Permission prompts are a wait class to engineer away, not a safety mechanism. Safety
comes from tests, gates, scoped IAM, and committed reviewable tooling.
1. **Recurring command class → committed tool + narrow allowlist** (exact path/target,
   never an interpreter or task-runner wildcard).
2. **Mutating actions are protected by the process, not the prompt** — `git push` to
   trunk is allowlisted because tests+lint must be green (§14) and gates precede
   deploys (§9).
3. **New surface → allowlist in the same slice** — cicd OWNS `.claude/settings.json`
   and applies the narrow scoped patterns the surface needs in the capability step.
4. **Tooling self-service** — every agent CREATES the committed tooling its role
   depends on in the same slice, tested and documented. Flag-don't-fix applies only to
   what an agent cannot own (permissions → cicd).
5. **Session-start config-resolution rule.** Harness config read at session start —
   `.claude/settings.json` `env`, agent `model:` frontmatter (§7a), allowlist patterns
   — does NOT take effect for shells/dispatches already running. Editing it mid-session
   is the durable fix for the NEXT session, never a rescue for this one. A capability
   whose only mechanism is session-start config must be bridged mid-session by a
   mechanism that does NOT depend on the inherited shell env (a committed wrapper /
   Make target whose recipe sets what it needs internally, or the per-call override).
   The hand-typed inline `PATH=…` prefix is NOT the bridge — it is the §15
   novel-shape violation. Such a change is scored on the FIRST relevant command of the
   next fresh session. [EXP-050]

(The root `Makefile` is agent-ops; the per-project `src/infra/Makefile` is deploy-ops
only — never conflate them.)

## 17. Defect-prevention contracts (cross-agent principle)
Defects whose root cause is detectable before production must be pinned by an executable
test/probe **at the level the risk lives** and at the earliest point visible — never a
written note, never found in live validation. Each standing defect class is a scored
experiment graduated from a real prod defect. The **catalogue of standing classes** (cross-
stack/synth-time contracts, IAM verb-completeness, ESM require-shim, external-resource-ARN
resolution, walking-skeleton probe with a REAL browser, wire-on-deploy contract tests, and
the "defect not closed until the end-to-end USER symptom is reproduced" rule) lives in the
**`delivery-principles` skill** — load it before synth/build/validate design. Per-role
mechanics live in the agent files. Target: tester constraint, CFR, MTTR.

## 17a. Test evidence attaches to the item
When the tester validates a use-case **in prod** (§11b), it attaches its validation
evidence **to the work item** (`## Definition`/evidence block, and mirrored to the
board by the projection agent) — not only to the slice `result.md`. Evidence records:
the public-facing surface exercised (browser flow / API call), the inputs, the observed
result vs the acceptance criteria, the captured artefacts, and the **prod version +
commit SHA** validated (§18a). **The `validated` event carries the evidence ref** —
an item cannot reach `done`/`resolved` without it, so the item → test-evidence link an
auditor follows is enforced by the write path (§F0), not by a checklist. On a
validation FAILURE the tester attaches the failing evidence and appends `rejected`
(item returns to `reworking`); the roll-forward fix re-validates and re-attaches. Binds
tester (produces + attaches) and the board projection. [EXP-090]

---

# STAGE 4 — Deploy

## 18a. Release versioning + prod-resource tagging (ISO)
When a change is promoted past dev **into prod**, the shipping repo and prod resources
are stamped so any running production artifact traces back to the exact commit,
version, and requirement. On each prod promotion:
1. **Version-tag the shipping repo.** Annotated git tag on the deployed commit carrying
   the version (e.g. `v1.4.2`), pushed to `origin` so it is durable and shared.
2. **Tag the production resources** with BOTH the deployed **commit SHA** and the
   **version** — whatever an operator/auditor inspects to answer "what version is
   running here?" (AWS `GitSha`/`Version` tags; a container image tag; an assembly
   build version). cicd / solution-architect owns the per-platform mechanism as a
   capability (it differs by infra).
3. **The deploy event records version + SHA** (cicd's `deployed` event `--ref` /
   `--note`, the deploying→validating leg — §11b state-graphs v3) so `stats.*` carries
   release identity — an incident pins to an exact shipped version instantly (MTTR/CFR).
4. **Version scheme is a PER-PROJECT policy.** Each project declares its scheme (in
   `capabilities.md` / a versioning ADR): SemVer for APIs, CalVer for desktop, an
   internal release counter for internal tools. **Default SemVer until the project's
   versioning ADR lands** — do NOT hardcode one scheme into tooling; read the project's
   declared scheme.
Rationale: ISO/audit change-control — the version id threads repo tag → resource tag →
deploy event; combined with §14 (item id) and §17a (evidence) the trail requirement →
commit → test evidence → prod version is unbroken. [EXP-090]

## 19. Scheduling over compensation
**Trunk-CD corollary:** every push is a deploy attempt — a prerequisite (role grant,
bootstrap, variable) must be in place before the FIRST PUSH of code that needs it, not
before a notional later "deploy phase". Route deploy-prereq steps ahead of the build
steps whose pushes trigger the pipeline. A hard sequential dependency is a scheduling
constraint, not an error to tolerate. **Configuration follows its resource**
(capture-output-then-set), and **no compensating logic** for out-of-order execution
(no sentinels, exists-checks-that-skip, retry-until-created, or tolerant guards
absorbing an order designed never to occur). Graceful degradation for genuine runtime
conditions remains correct. A hidden hard edge found during parallel work is a
scheduling finding: re-serialise and record the edge (§F7). (Detail: `cicd.md`,
`orchestrator.md`.)

## 19a. A framework migration completes its pipeline
When a slice MIGRATES the deploy framework (CDK→SST, a runtime or IaC change),
**converting the CI/CD pipeline and DELETING the dead deploy path is part of the
migration's done-condition — never a deferred follow-up.** A migration that
re-platforms the deploy mechanism but leaves the old pipeline running the old commands
produces a CI deploy pipeline that has never run and would FAIL — silently
non-functional because all deploys are now by hand. In the migration slice cicd
rewrites the workflow to the new framework's command, updates path triggers + role, and
deletes the dead steps IN THE SAME CHANGE; the architect's migration delta names the
pipeline conversion. **A converted/new pipeline is "proven" only once it has actually
EXECUTED GREEN at least once in the slice that introduced it** — conversion-in-code is
not proof; deferring the first real run to an open item is the deferral this rule
forbids, applied to the *proof*. The migration slice triggers the pipeline and watches
it green (§19b). Target: CFR + deployment frequency. [EXP-062]

## 19b. Push integrates; a green-local / red-CI run is a DEFECT
A CI/CD run is the integration truth; a local green is a prediction of it. The two must
agree.
- **Every push sets off a non-blocking CI watch.** The push does not block the loop,
  but a committed watcher tails the run to completion: `make -C work/<project> ci-watch`
  (wraps `gh run watch <id> --exit-status`, returns only the failing step's error on
  red).
- **A run that fails while the local suite + lint were green is a DEFECT** (raised via
  `/defect`, pre-empts per §F5). Exactly one of two things is true, and the fix MUST be
  one of them (never re-run-and-hope): (1) **local checks did not cover what CI
  exercised** → close the coverage gap so the local suite would have caught it (e.g. the
  CI-only OIDC-cred path — add a check exercising the env-cred branch); (2) **out-of-band
  manual configuration was required** → capture it in the runbook AND automate it as a
  committed script / Make target (a config done by hand each time is itself the defect).
- A red CI run is never left red and never silently abandoned: it is closed by category
  1 or 2, permanently removing that divergence class.
Target: MTTR + CFR. (Per-role: `engineer.md`, `cicd.md`.) [EXP-070]

---

# STAGE 5 — Validate

## 20. Tester scope & auto-retro
The tester validates **customer-observable outcomes** through the public surface
(browser for web, public API for backend); it does not re-implement exhaustive
correctness checks. Target for frontend-only validation < 300s; first-backend slices
may run longer. (How the tester validates — validation-as-code, run provenance,
identity-before-behaviour, stable selectors — lives in `tester.md`.)

**Validate against the INPUT REQUIREMENT, not only the derived acceptance.** The
acceptance cases and slice success measures are a *proxy* for the customer's job —
the tester's oracle of record is the **input requirement the item traces to** (its
`REQ-…` ancestor via `parents:` edges — its JTBD, stated outcome, and success
measures). The tester reads that requirement first and asks, at the public surface,
"does what is running satisfy the job the requirement asked for?" — not merely "do
the acceptance cases pass?". A green acceptance run that does not deliver the
requirement's stated outcome is a **fail** (and a signal the acceptance cases
under-encode the requirement — name it so planning tightens them); a requirement
outcome with no covering acceptance case is a finding, same as any uncovered changed
node. Acceptance cases remain the frozen dev/prod oracle mechanics (§11b); the
requirement is what they are held accountable to.

**Auto-retro at delivery:** when a slice is `done` (validation passed, decision-log row
written), the orchestrator runs the retro immediately and automatically in the same
session — no human prompt, no wait. The human may interrupt or redirect, but their
absence must not delay it.

---

# STAGE 6 — Document

## 21. Documenter runs in parallel
Nothing in the process depends on documentation output. At delivery the orchestrator
dispatches the documenter **in the background, in parallel** with the retro (and with
N+1 planning). No gate, agent, or loop step waits on it. The documenter commits its own
changes and documents what shipped, not what was planned. (Detail: `documenter.md`.)

---

# STAGE 7 — Retro & improvement

## 22. Change-set queued for next iteration
The project-agnostic carry-forward register (unscored anticipated effects + queued
obligations) lives in **`process/open-items.md`** — held outside this rulebook so the
file stays rules, not a work queue. Referenced by §10 (next-work) and §24 (improvement
slices); the retro harvests and re-prioritises it each cycle.

## 23. Per-change DORA discipline
At the end of each slice retro the orchestrator records, in the retro record (and
the `process-v<NN>` tag annotation): slice, change, expected DORA effect, actual,
regression flag, reflection, time-to-first-deploy (s001 only), delivery gap. The
numbers are DERIVED — read from `views/stats.{json,md}` (§F0, `make wi-project`),
never recomputed by hand. A regression graduates to a `principle-failures/` entry.

## 24. Improvement slices
Process, tooling, and automation improvements are specified and delivered as slices,
exactly like product work, in `/process/improvement-slices/IMP-NNN-<name>.md`
(project-agnostic). Each states its **job** (the delivery friction it removes,
evidenced from `stats.*` / principle-failures / observed waits), its **DORA target**
(named metric + anticipated effect), its **done condition** (observable, testable — not
"agents try harder"), and its **protection** (the test, gate, or committed artifact
that protects it once human approval leaves the path). Retro change-sets either land as
immediate process-text changes (pure rules) or graduate into improvement slices (when
they need tooling/tests built).

## 25. Improvement routing — narrowest owner
The retro and orchestrator route every improvement to the **narrowest artifact that
owns the behaviour**:

| Learning concerns | Lands in |
|---|---|
| One agent's behaviour | `.claude/agents/<agent>.md` |
| Cross-agent rules of the game (gates, commit discipline, command form, metric defs) | `process-current.md` |
| A repeated manual action | a committed tool: Makefile target, script, or skill — parameterised |
| A heavy reference document | a skill (abstract it; don't make agents hold it) |
| Project-specific facts | the project's `/work` artifacts — never `/process` |

Content earns its place by being general and load-bearing (and is removed for being
misplaced or redundant — see §27's ceiling). **The DORA metrics are the control loop:**
every routed change names its target metric and the next retro scores
anticipated-vs-observed. A change-set is a net win only if throughput, quality,
frequency, and recovery improve or hold in aggregate — an improvement that buys one
metric by degrading another is reverted or reworked.

**Token cost is the explicit COST side of this economic ledger.** Every run consumes
tokens (the VALUE side is DORA). The two are optimised TOGETHER: the goal is the most
DORA value per token, not the fewest tokens. A token reduction that degrades a DORA
metric is rejected exactly as a one-metric win that degrades another is; a token
INCREASE that buys a real DORA gain (a capable tier on the constraint agent, a
verification pass that cuts CFR) is an accepted, scored bet. Spend that buys no DORA
value — re-reading files already in context, redundant dispatches, oversized context
loads, dead scaffolding — is pure waste and is removed.

## 25a. Changes are experiments
**Every routed change — agent-file edit, process section, tool, skill note — is an
EXPERIMENT**, not a permanent acquisition. Text earns its place by measurably improving
a DORA metric; text that cannot demonstrate its value is removed. The registry is
`/process/experiments.md` — one row per routed change.

**THE VALIDITY BAR — a row is a falsifiable HYPOTHESIS, never a piece of work.** Every
row MUST state, explicitly and checkably: (1) **Problem** — the specific evidenced
friction; (2) **Solution** — the concrete change tested; (3) **Target DORA metric** — a
NAMED metric (lead time / deployment frequency / CFR / MTTR; a proxy such as
agent-context-size is allowed only where the row justifies it as a DORA proxy); (4)
**Measurement** — the observable signal + scoring horizon, phrased so the result CAN
come back NEGATIVE. A row that merely describes a feature, has no named metric, or has a
measurement that cannot fail is NOT an experiment: rejected at creation, deleted on
sight. The lifecycle is **adopt-or-delete**. A sound shipped behaviour whose row was
only MIS-PHRASED is handled by deleting the ROW while KEEPING the behaviour as plain
agent practice; never undo a defect-preventing behaviour because its row failed the bar.

**LEAN REGISTRY — a HARD WIP cap of 8 active experiments (v88).** The registry is a
WIP-limited queue, not a museum: **at or above 8 `active` rows you may NOT open a new
experiment without first retiring one** (adopt or kill). Reduction is therefore a hard
constraint every retro must satisfy, not an aspiration. Corollaries:
- **A fix is NOT an experiment.** A broken process/rule that simply needs correcting is
  folded straight into its owning agent/process file as PLAIN practice, with NO row. Reserve
  an experiment for a genuinely UNCERTAIN change whose named metric could move either way.
  Most routed changes are fixes — they must not enter the registry at all. (This is the
  main inflow valve: if you cannot say honestly "this might not work," it is a fix, not an
  experiment.)
- **3-strikes score-or-kill.** Every `active` row is scored at each retro that gives it a
  scoring opportunity. **At 3 scoring opportunities with no measurable movement — or still
  unscored (`0/N`) at its horizon — the row is KILLED.** There is no indefinite `active
  (0/N)` limbo; an experiment either shows a measurable effect or it goes.
- **Archive-with-outcome is MANDATORY.** A retired row never just vanishes: adopted →
  behaviour folded into the owning agent + row moved to `experiments-archive.md` WITH the
  measured result; killed → moved to `experiments-archive.md` WITH "no measurable effect /
  never validated." An empty or skipped archive means the learning was lost — itself a
  process failure. The live registry holds only what is currently being tested.

**The status-lifecycle mechanics** (active → validated/integrated → under-question →
retirement-trial → failed, the null-hypothesis retirement test, the concurrency guard,
and scoring-honesty under a confounded window) live in the **`process-framework` skill** —
load it to run the registry. This section keeps ONLY the validity bar above; the mechanics
of moving rows through their statuses are the skill's.

## 26. Retro mechanics
At each retro the orchestrator: recomputes the metrics via `make wi-project` (§F0);
reviews `principle-failures/` and the per-change DORA note (§23); **updates
`/process/experiments.md`** — scores every active experiment that had a scoring
opportunity, advances under-question / retirement-trial states per §25a; tags the
current process (§27.2) and writes a new `process-current.md` (version+1) whose changes
target a specific DORA metric justified by evidence, stating the anticipated effect so
the next retro can score it — **and registers every routed change as an experiment row
at routing time**. A principle is never changed on a single data point — require a
pattern across principle-failures. When the process file has visibly accreted, run
`/refactor-process` (§27.6).

**Scriptify the cycle's mechanical operations to save context.** Every retro, the
orchestrator names the operations it performed REPEATEDLY by hand this cycle and builds
or extends a committed script for the most-repeated one, so that mechanical work leaves
the context window (one allowlisted command, not N Read+Edit cycles). A mechanical op
done ≥3× by hand is a script waiting to be written. [EXP-038]

**Review token usage every retro and balance it against DORA.** Alongside the metric
recompute, run a standing token-efficiency review: (1) estimate the cycle's token
consumption and where it went (dispatch count/fan-out, context-load size, re-reads,
model-tier mix, the share already absorbed by scripts); (2) name the single
highest-leverage reduction and route it like any change; (3) score it against DORA,
never in isolation — a token cut that would slow lead time or raise CFR is REJECTED; a
token increase that buys a real DORA gain is an accepted, scored bet. Register the
chosen optimisation as an experiment with both its token target and the DORA metric it
must not harm.

**See the plumbing share — running-the-OS vs delivering value.** `stats.*` (§F0) splits
logged time + tokens via `state_owners` into **plumbing** (orchestrator + flow-manager +
retro/gate/bookkeeping — running the agent OS) vs **delivery** (engineer/tester/ui/
product/architect/cicd/documenter producing & validating value), and prints the
**plumbing share** of each. The retro reads the share AND its trend; if it rises or
exceeds target, route the single highest-leverage overhead reduction (scriptify per
EXP-038, cut a redundant dispatch, restructure a step), guarded so delivery (lead time /
CFR) is not harmed. [EXP-067]

## 27. Process-doc discipline — keep the rulebook precise (prevents rot)
The v82 cutover was needed partly because the docs themselves rotted (2834 lines, ~990 of retro-narrative already in git, one mechanic named in 50 places, overlapping registers). These rules are to the docs what `wi-validate` is to the items.
1. **Rules, not narrative.** `process-current.md` holds ONLY the rules in force. Rationale/retro-stories/"why we changed" live in the retro record + git, never as inline `>` blocks. A retro EDITS the rule and records its story in the retro artifact; it does not paste narrative into the rulebook.
2. **Snapshots are git tags, not files.** Each version bump is an annotated tag `process-v<NN>`; `process-history/` holds only its README. No per-version copy files — git keeps every state losslessly.
3. **Name a mechanic once.** Tool/command/file names live in ONE place (§F0's command-map + the command index); rules refer to capabilities by ROLE ("append a state event", "regenerate the views"), so a substrate change is a few edits, not a scatter hunt.
4. **One register per concern.** Each obligation lives in exactly one register (experiment→`experiments.md`; improvement build-item→`improvement-slices/`; learned failure→`principle-failures/`). No cross-posting.
5. **Conformance is checkable — `make doc-lint`.** A denylist gate fails if any live doc names a retired mechanic. Run it in the rationalization gate and before every version bump.
6. **Rationalization gate.** At every major cutover, and at least every 10 versions, run `/refactor-process`: doc-conformance audit + prune. The rulebook has a soft ~800-line ceiling; exceeding it signals narrative crept back.

---

# STAGE F — Flow & queues (pull-based)

The cross-agent rules of the pull system. **§F0 (above) is the substrate**; the rules
below name flow behaviour and now operate on the *derived* views (§F0). Full rationale
is in `design-rationale/work-item-state-model.md` (the prior QueueApproach design —
diagrams and a worked retro — is archived at git tag `QueueApproach`). Each rule names
the DORA metric it targets, per §25a.

## F1. Work items — hierarchy, links, and honest closes
Every unit of work is a typed item — `REQ-`/`CHK-`/`SLC-`/`UC-`/`DEF-` — as a per-item
file (§F0). Hierarchy: requirement → chunk → slice → use-case (→ route steps). **Edges
are stored one-directional (`parents`+`deps` up); `children`, ancestors, and the whole
tree are DERIVED**, so the tree traverses both ways without drift. `value`/`cost` are
product estimates; per-item DORA is COMPUTED from the item's event timestamps (§F0),
never stored.

**Done bubbles UP.** Aggregate state (slice/chunk/requirement) is a fold over children:
a slice is done when all its use-cases are done; a chunk when all its slices are done; a
requirement when all its chunks are done (→ ask for more work, §F3). The aggregate has
no independent state event to keep in sync — its state is recomputed by `wi-project`
from the children the moment the last one closes. There is no "close-drift" to reconcile
because the close is not a separate stored fact: **the atomic close is `wi-append` on
the last child, by construction** — the child's `validated`/`built_green` event is the
only write, and the parent's done-ness follows on the next `wi-project`. A green push
with no matching `built_green`/`validated` event on the item is the defect (the derived
state would otherwise lie), and `wi-validate` catches it before the next pull.

**RED CI = NOT DONE; never fake green by guarding.** A red CI run means the engineering
+ cicd steps have NOT succeeded — the item is not done and the loop MUST NOT advance past
it. **Making CI green by skipping or guarding the failing job** (an `if:`-guard that
no-ops it, disabling the check, `continue-on-error`, marking a lane allowed-to-fail) is a
**false-green** and is forbidden — it re-admits the false-green defect family. The only
legitimate way to clear a red CI is to make it genuinely green: do the work the red is
demanding — finish the code, provision the missing infra/secret, fix the config. A job
that is legitimately not-yet-runnable because it awaits §F5 human provisioning stays red
and blocking until provisioned; that red IS the accurate signal. [EXP-090]

## F2. Queues — a uniform model: two buffer knobs + four metrics
Work is handed over through queues. Queue **membership is a derived view**
(`views/queues.{md,json}`, computed from item state via the graph `queue_map`, §F0) —
never a stored CSV. The queues are **Intake → Ready → Deploy → Rework**; every queue is
modelled IDENTICALLY (same two buffer knobs, same four metrics) so they compose and
compare.

**Buffer control = `min_items` + `wip_limit`** (both per queue, owned and tuned by the
retro, never hardcoded — held in the project's queue-policy config, applied over the
derived membership):
- `min_items` — the replenish/pull FLOOR: below it, signal upstream to refill so the
  queue never starves the stage it feeds. Targets **throughput**.
- `wip_limit` — the CAP: the queue never holds more than this, so work cannot age and
  WIP stays small. Targets **gross lead time**.
Defaults seed (retro tunes from evidence): intake 2/10, ready 3/4, deploy 0/1 (WIP =
pipeline concurrency group, §11b), rework 0/2.

**Statistical metrics (uniform, from `wi-project` `stats.*`):** queue length (depth
now); throughput frequency (dequeues per active-day); dwell time (the queue's slice of
gross lead time, from state entry→exit timestamps); rework rate (re-entries ÷ items).
Every metric ties back to the two system numbers — Σ dwell across queues is the WAIT
part of GLT; the throughput of the binding queue is system throughput; rework inflates
both. The retro reads these to size `min_items`/`wip_limit`.

On every insertion the flow-manager re-costs `vc_ratio` (= value ÷ cost) and re-sorts
(defects pre-empt, §F5). **`vc_ratio` sorts WITHIN a §10 tier, never across tiers:**
selection is LEXICOGRAPHIC — first by §10 tier (process-improvement > core-job value >
secondary-job value > risk), then by `vc_ratio` inside that tier — so a core-job item is
never out-ranked by a high-`vc_ratio` secondary-job item. The ranking function is
isolated so Cost of Delay can replace `vc_ratio` later with no structural change. Target:
gross lead time + throughput. [EXP-022]

## F3. The pull loop & replenishment (`/loop-run`)
The inner dev loop runs continuously: each cycle the flow-manager selects the **maximal
independent set** of ready use-cases (§F6) up to capacity `N` and the orchestrator
dispatches them as concurrent inner-loop instances — cicd? → ui-structure? → engineer
(TDD on trunk) → ui-validate? → deploy (gate only if infra-bearing) → tester (validate
in prod). Pass → `validated` (bubbles up); fail → `rejected` (Rework). **Replenishment
is PROACTIVE, CONTINUOUS, parallel — it works AHEAD of the engineer, not at boundaries.**
Product is never idle while engineers build; it keeps the Ready buffer **at or above
`min_items` AT ALL TIMES**. Operationally:
- **Look ahead, don't wait for empty.** Trigger is `depth(Ready) < min_items` OR
  projected-below-floor after the next pull — replenish the moment the buffer would dip.
  The very FIRST build wave of a slice is dispatched together with a product look-ahead
  for the NEXT work.
- **Decompose for INDEPENDENCE so parallelism can cut real serial wait (ROC retro
  2026-07-12 → gross lead time).** When a slice is a LINEAR dependency chain
  (UC-a→UC-b→UC-c, each needing its predecessor's output), the maximal independent set is 1
  and use-cases build one-at-a-time, so downstream UCs genuinely wait — and that wait is
  REAL gross lead time, honestly counted (ROC C1 + dashboard: `registered` ≈ **70% of GLT**
  at 0% rework/CFR). Do NOT try to shrink that number by DEFERRING the `registered` birth
  event — that only stops *counting* the wait, it does not reduce it (metric-gaming, not
  flow improvement; register work when it is committed, honestly). The real lever is
  UPSTREAM, in decomposition: prefer use-cases that are genuinely INDEPENDENT where the
  domain allows, so the maximal independent set (§F6) is >1 and `N` actually reduces the
  serial wait. Where a stage truly serialises (a pipeline walking skeleton), accept the
  inherent lead time as honest — raising `N` cannot relieve a real chain.
- **Across chunk boundaries.** Product decomposes the next slice — and the next chunk's
  first slice — WHILE the current chunk is still building, so there is no decompose-gap
  at a chunk edge. Order: (a) more use-cases from the current slice; (b) next slice from
  the chunk (unattended — no slice gate); (c) advance to the next chunk; (d) only when
  the WHOLE requirement is decomposed-and-done does the loop report *starved +
  requirement complete* and ask the human for more work.
- **Below-floor is never "expected" or tolerated.** A `depth(Ready) < min_items` signal
  is a hard call to replenish NOW, in parallel — the orchestrator must NOT rationalise
  it away ("scaffold-constrained", "will refill after this UC") and let the engineer's
  next work go un-prepared (a logged principle failure).
Product estimates value+cost on every item; batch small: replenish more often, less each
time. Target: gross lead time (no engineer-waits-for-decompose gap), throughput.

## F3a. Upstream pipelining — the WHOLE planning stage runs ahead of the build
While the engineer builds the pulled use-case(s), the orchestrator keeps **every
upstream role working the NEXT independent item in parallel**, so by the time the
engineer finishes, the next item is fully planned — vision/slice AND architecture AND
capabilities — and can be pulled with zero wait. The engineer is the constraint; never
let it idle waiting for an upstream artifact that could have been prepared during the
previous build.
- **product** — the next slice + use-cases + acceptance (§F3), costed and made ready.
- **solution-architect** — the next item's architecture delta + security review +
  policy-test notes, produced WHILE the current item builds.
- **cicd** — the next item's capabilities provisioned ahead of the build that needs them
  (flags, env/infra/pipeline prep, deploy-role grants).
- **ui-designer** — the next UI-bearing item's structure pass (IA, decomposition, a11y
  conditions) prepared the same way.
Bounds: only pipeline items **sequentially independent** of the in-flight build (§F6);
respect each queue's `wip_limit`; look-ahead depth ≈ the buffer (`min_items`). These
upstream agents write to disjoint artifacts (items/ , architecture/ , infra/), so no
commit collision (§14). Target: gross lead time (eliminate engineer-waits-for-upstream
gaps), throughput. [EXP-075]

## F4. Time thieves — wait, attributed to its cause
`wi-project` `stats.*` reports per-queue length + wait, per-item lead time (service vs
wait split via `state_owners`), and the time-thief table. A time thief is wall-clock on
item A's lead time spent waiting on something else, each attributed to its cause: `queue`
wait (depth/batch), displacement (the higher-priority or defect item inserted ahead),
seam serialisation (the blocking UC), worker contention (capacity `N`), deploy-queue
wait (pipeline), gate wait (the gate), session idle (§13), `external` blocked-time. The
retro reads the ranked thieves as its primary input (extends §5's taxonomy from
per-slice to per-item with attribution). Each thief also carries a **plumbing vs
delivery** class feeding the plumbing-share view §26 watches. Target: gross lead time.
[EXP-028]

## F5. One human gate; the deploy gate is automated; defects pre-empt
**The blocking human gate is exactly one:** requirement/defect **INTAKE** (JTBD value
framed before anything enters). The former second gate — DEPLOY-to-prod for
infra-bearing change — is **no longer a human gate**: it auto-approves under an
automated policy assurance (§F5a); app-only diffs already auto-approve per §9a. The human
is not touched at deploy at all — the only residual human touch is a genuinely
destructive/irreversible **data** op (not a deploy), see §F5a. Each removed gate is
replaced by a named assurance, not dropped: vision → folded into intake; slice-accepted
→ just-in-time slicing + §10 selection; arch+security → §9a security auto-accept + the
§12c data-flow gate-node discipline + synth-time contract tests. **Defects re-enter
through intake**, are JTBD-framed/costed, and **pre-empt** (a defect on delivered value
is a failure in something of higher value than anything merely queued); the displacement
is logged as a time thief so the cost of interrupting is visible (§5a ownership semantics
unchanged). Target: gross lead time (gate wait) guarded by CFR; MTTR. [EXP-025]

## F5a. Prod promotion is continuous — no review gate; the tester validates in prod
Once an established CD promotion pipeline exists, **code flows to prod automatically on
green — there is NO human review-to-promote gate.** The gate IS the automated evidence:
unit+integration green on trunk **and the DEV-VALIDATION stage passing** — the item
reaches the `dev-validating` state (cicd's `deployed` deploys it to DEV) and the tester
validates the dev surface against the ORIGINAL FROZEN `acceptance.md`; a pass fires
`dev_validated` (§11b), which is the automated promotion assurance. `dev_validated`
**AUTOMATICALLY triggers the prod deploy** — cicd deploys to prod (`promoted`) and the
**tester prod-validates** (`validated`, §20) as the safety net — all UNATTENDED. A
"someone approves the prod deploy" step is explicitly rejected — it masks upstream
weakness and adds idle. Dev-first is about VALIDATING in dev BEFORE prod (de-risking),
NOT a human approving the promotion. **If what lands in prod is wrong, the failure is
UPSTREAM** (requirements, engineering, test coverage) — fix it *there* and let the fix
flow; never add a promotion gate to compensate (build quality in; roll-forward with
reversible rollback). [EXP-091]

**Infra-bearing deploys auto-approve under an automated policy assurance** (§9a → this
is where infra-bearing goes). The former human gate on new stacks, new IAM grants, and
first-time provisioning is replaced, not dropped, by an assurance the pipeline asserts
before it deploys. An infra-bearing deploy **auto-approves** when ALL hold, else it
fails RED (a real signal, not a human queue):
  1. tests + lint + build are green;
  2. **every new IAM action is in the least-privilege allowlist** (`infra/policies/*.json`
     is the SSOT) — a grant outside it fails the check;
  3. **every IAM `Resource` is ARN-scoped** — no `Resource:"*"` except documented
     platform-global exceptions (e.g. `ecr:GetAuthorizationToken`, CloudFront) carrying
     an inline justification;
  4. the change is **reversibly rollable** (§F5b).
The tester still validates in prod; if an infra deploy regresses prod as a PATTERN, that
is the §F5b feature-flagging trigger, NOT a reason to reintroduce a human gate.
**The one residual human touch is a genuinely destructive or irreversible DATA op**
(e.g. a prod event-store truncate) — that is data-safety (§0b), not a deploy gate, and
stays human-confirmed because it cannot be rolled back. Reinstate the human deploy gate
via §25a only if evidence shows the automated assurance let a real IAM/blast-radius
defect through. [EXP-093]

**Promoting to a NEW stage re-applies that stage's deploy-role policy as a self-healing
pre-flight.** A per-stage deploy role's policy CONTENT being correct in
`infra/policies/*.json` is not enough — it must be APPLIED to *that stage's* IAM role,
and promoting to a new stage is exactly when it has not been. So the CD `deploy-<stage>`
job **re-applies the target stage's managed deploy-role policy** at the TOP of the job,
before any deploy — the role's policy is always current-with-source and cannot go
stale-per-stage. For manual promotions the same guarantee is a committed
`make promote-preflight STAGE=<s>` that applies + asserts the policy. This is a
self-healing check, not a written reminder (a "remember to run bootstrap" note is
precisely what was missed). Owner: cicd; this §F5a rule is the contract. Distinct from
the IAM verb-completeness rule (§17) which makes the granted CONTENT complete; this makes
the correct content APPLIED to each stage's role. Target: CFR on cross-stage promotions +
deploy MTTR. [EXP-096]

## F5b. Feature-flagging is the escalation when CD starts failing in prod
The §F5a safety net is the tester validating in prod, and its **CFR is the signal**. If
deploys start causing **prod test failures as a PATTERN** (not a one-off), that is the
trigger to **decouple DEPLOY from RELEASE via proper feature-flagging**: deploy dark,
release behind a flag, roll a release back WITHOUT a redeploy (beyond the §40
within-slice use-case flags, which isolate in-flight builds but give no release-level
control). **When that need is evidenced, RAISE it** — do not silently absorb rising prod
CFR or quietly reintroduce a manual gate. And **spin it up as its OWN separate PROJECT**
— feature-flagging is a shared delivery-capability (§F10), not folded into a product
project. Until evidenced, CD-with-prod-validation stands; **premature flag infrastructure
is cost without an evidenced need**. [EXP-092]

## F6. Parallel dispatch by independence (the maximal independent set)
Parallelism is the **default, not an option**. The flow-manager treats
`use-case-deps.mmd ∪ class-deps.mmd` as a DAG and each cycle dispatches the
highest-priority set of *ready* use-cases that are mutually independent — **no edge/path
between them AND disjoint claimed seams/paths** — up to capacity `N`, isolated by
use-case flags in code (§40 — never branches/worktrees/stash for behavioural isolation).
Each use-case declares the seams/paths it will own; the flow-manager holds the
**claimed-path registry** of in-flight UCs. `achieved` and `theoretical-max` concurrency
are recorded so **parallelism efficiency** is visible. Target: build wall-clock = the
slowest dependency chain, not the sum of steps; gross lead time.

**A claimed path includes every SOURCE FILE a UC's route mutates.** The independence
test has two halves and both bind: no behavioural edge in `use-case-deps.mmd` AND
disjoint claimed paths. A shared SOURCE FILE is a shared claimed path — under §40 (trunk,
no branches) two UCs editing one working-tree file collide, so they are seam-serialised
and NOT co-schedulable even with no behavioural edge. `theoretical-max` is the achievable
set under §40, so N ready UCs all claiming one file form a serial chain (M=1) and that
schedule is CORRECT — the flow-manager must NOT report the shared-file seam as a
parallelism time-thief (reporting a forbidden parallelism as lost opportunity is the
phantom-max failure). The genuine remedy is a STRUCTURAL refactor — split the file so
each UC owns a distinct file — pursued as a §F7 false-edge trial, not by inflating the
max. [EXP-051]

## F7. Collisions teach the dependency tree
A **collision** = concurrent work proving a declared independence false, detected
mechanically: a claimed-path violation (build/commit time), a composition failure (a
flag-ON-green UC goes red when another integrates), or a §19 hidden hard edge at deploy.
On a collision the flow-manager records it, **stops the pair**, hands the missing edge to
product/architect/engineer to ADD to the model (`classDef changed`, recorded in
`architecture/dependencies/edge-ledger.md`), re-serialises (§19, scheduling not
compensating logic), and bills the rework as a hidden-edge time thief. The system attacks
**both** error classes: **hidden edges** (false independence — collisions per slice → 0)
and **false edges** (false dependency — needless serialisation), the latter found by an
**edge null-hypothesis trial** (§25a on a dependency edge: relax it for 4–5
opportunities; an attributable collision reinstates, none retires it and reclaims
parallelism; ≤1 trial per seam). Driving both toward zero IS the system learning to slice
and structure work for flow. Target: CFR (hidden edges), gross lead time (false edges).
[EXP-027]

## F7a. Blocked items must say WHY — on block and on unblock
When an item moves to **blocked** (a §F5 gate hold, a §F7 collision stop, or a Rework
re-entry), the cause is recorded **as the `note` on the `blocked` event** appended via
`wi-append` (§F0) — no separate blocked-reason file. The board projection reads that note and
shows a **🚫 Blocked: <why>** banner; when the item leaves blocked (an `unblocked`
event), an **✅ Unblocked** comment is posted. So a human reading the board always knows
*why* something is stuck and *when* it freed up, without asking. A blocked item whose
event carries no reason note is itself a smell (the banner says so). The reason is free
text on the event; the metrics come from the event itself (§F0). [EXP-074]

## F8. Retro cadence (pull mode) — MECHANICALLY ENFORCED
**ROUTINE** closes (slice/chunk `done`) batch to `--threshold` (default **3**) before a
retro is due — a clean run of small closes does not pay per-slice overhead. **INCIDENTS**
(a prod defect `resolved`, a deploy-failure; plus MTTR-pair / queue-wait-spike triggers)
are **never batched** — a single one forces RETRO DUE immediately. `--threshold` is
per-project tunable; retro-debt is counted over the ITEM EVENTS since the last retro,
computed by `wi-project` (never by scanning rows). At every retro the orchestrator tunes
the per-queue buffers (§F2) and `N` (§F6) from the flow evidence, each tune a scored
experiment.

**The gate is MECHANICAL, never orchestrator discretion or a human choice.** `make
retro-debt PROJECT=P` exits non-zero (code 2 = RETRO DUE) at the threshold. A non-zero
exit blocks **EVERY advance action** — next-pull, RE-DEPLOY, and any orchestrator hand-run
recovery step on main; the ONLY permitted action is the `/retro` that drains it (via
`make retro-mark`). The retro may **never** be offered to the human as a choice. Recovery
is therefore not hand-cranked: run the retro FIRST, then dispatch the fix as a
flow-manager-prioritised LOOP item (a defect pre-empts, §F5) to the owning specialist,
appending each failure/recovery leg (§F0) so CFR/MTTR never lie while the loop advances.

Pointers: cadence + gate operation in `loop-run.md` / `retro.md`. Citations: cadence is a
tunable meta-experiment [EXP-029]; mechanical enforcement [EXP-083]; gates every advance
incl. re-deploy/recovery [EXP-095]; routine-batches / incidents-immediate [EXP-085].

## F9. Continuous operation & autonomous wake
The loop is a **continuously-running background process**, not a command the human starts
on demand. It runs while there is ANY work to do (any queue non-empty OR anything
replenishable against the chunk plan) and only EXITS when **all queues are empty AND
nothing is replenishable** (requirement complete). Four rules make this autonomous:
1. **Two processes, both automatic, both parallel.** (a) the dev loop pulls and builds
   ready work; (b) replenishment breaks work down to lift any below-floor queue above its
   floor (§F3). Independent, concurrent — neither waits on the other. The orchestrator
   runs BOTH; it never makes the operator choose between them.
2. **Enqueue-to-empty wakes the loop.** When an item is made ready onto a queue that was
   empty (e.g. intake adds the first ready item while the loop has drained), the
   flow-manager (re)starts the loop — without being asked. An enqueue is an event, not a
   prompt for a human decision.
3. **The orchestrator never asks the human a flow-mechanics question.** "Start the
   loop?", "replenish or pull?" are NOT human decisions — they run automatically. The
   human is touched at **exactly** the §F5 intake gate and when the requirement is
   **complete**. Presenting parallel flow processes as an exclusive human choice is a
   principle failure.
4. **Keep trucking through boundaries.** Slice completion, the §F8 retro, and chunk
   advance are autonomous boundaries, not human checkpoints. **ENDING THE TURN *IS* the
   stop, even with a polite report** — parking the loop with "I'll resume / refresh to
   confirm" still forces the human to re-prompt, and every restart is idle gross lead
   time. **RULE: do not end the turn at a non-gate boundary.** After ANY unit completes (a
   UC done, a defect closed, the §F8 retro written, a chunk bubbled) IMMEDIATELY pull and
   dispatch the next ready work in the same turn, and keep chaining. A report is INLINE
   and terse; it never replaces the next dispatch. The turn ends ONLY at: the §F5 intake
   gate, requirement-complete, or a genuine blocker needing a human answer.
Target: gross lead time (removes avoidable human-decision idle) + deployment frequency,
guarded by CFR.

## F10. Fleet — isolated per-project loops, one shared process spine
Multiple projects run CONCURRENTLY, each as its own isolated loop, feeding ONE shared,
project-agnostic process. Two layers, deliberately decoupled:
1. **Per-project loop — isolated.** Each active project runs its own `/loop-run` in its
   OWN background runner/context, holding ONLY that project's `work/<project>/` — its
   items, derived views, claimed-path registry, and board initiative. Loops are
   independent: different repos/domains, parallel, no shared mutable *work* state. One
   project's churn never enters another's context. This is **isolation, not a
   context-inheriting fork**.
2. **Shared spine — informed, not coupled.** `/process` (principles, rules, learned
   failures) and the orchestrator role are SHARED and **MUST NOT reference any project**.
   N `work/` spaces feed ONE `/process`.
3. **The integration seam.** A project retro's lesson is **abstracted — de-projected —
   before it lands in `/process`**: the project retro records "in project X, Y happened"
   (stays in `work/<project>`); the process change states "when Y-shaped situation, do Z"
   as an experiment, rule, or principle-failure. So `/process` is INFORMED BY every
   project yet INDEPENDENT OF any — delete a project and the process still stands.
   Per-project retros tune that project's own queues off its own items; a periodic
   **fleet retro** rolls the abstracted lessons up into `/process`. The main thread is a
   **fleet supervisor** (launch / monitor / route human decisions), not a per-UC worker;
   its cost is O(decisions), not O(UCs × projects). [EXP-075]
