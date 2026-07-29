# Experiment registry (process v88 §25a — LEAN, HARD WIP cap = 8 active)

Every genuinely-uncertain routed change is an experiment. One row per change. The
orchestrator scores rows at every retro (§26 / retro step 5a). Statuses: `active` |
`validated` | `validated-by-null-hypothesis` | `under-question` | `retirement-trial` |
`failed`.

**THE VALIDITY BAR + the lean-registry rules now live in process-current.md §25a**
(a row is a falsifiable HYPOTHESIS with Problem + Solution + a NAMED target DORA metric
+ a Measurement that CAN come back negative; a fix is NOT an experiment; a HARD WIP cap
of 8 active — retire one to open one; 3-strikes score-or-kill; archive-with-outcome is
mandatory). The status-lifecycle mechanics live in the `process-framework` skill. This
file holds ONLY the live experiments under test; everything retired is in
`experiments-archive.md` WITH its outcome (the index of what we've learned + folded in).

> **v88 backfill-triage (2026-07-12, ROC).** The registry had grown to 41 `active` rows
> (most `active (0/N)`, unscored) while the archive was empty. Applying §25a it was cut to
> the 8 live rows below: 29 rows ADOPTED (behaviour sound + load-bearing + already in force
> in its owning agent/process file — folded where missing) and 4 KILLED (superseded
> mechanism / under-question-negative / really-a-fix). All 33 retired rows are in
> `experiments-archive.md` with their disposition + the full original row text.
>
> **Model-tier quarantine: CLOSED** (v49 fable→opus window closed cleanly at SLC-003; no
> experiment was false-validated on a model-confounded DORA move).


| id | routed | artifact(s) | change | target metric | anticipated effect | horizon | status | scoring notes |
|----|--------|-------------|--------|---------------|--------------------|---------|--------|---------------|
| EXP-101 | v82 (2026-07-06) | process-current.md §11b + §F5a + tester.md (dev-then-prod validation) + cicd.md (deploy-to-dev then deploy-to-prod) | **Problem:** §F5a referenced a "dev acceptance stage" that was a PHANTOM — no such state existed in the use-case graph; the actual path (`building → deploying → validating → done`) validated ONLY in prod, so a broken change was first observed by real customers in production instead of being caught in dev first. This violates the vital "dev-first, acceptance before prod" principle: there was no de-risking dev validation before the prod deploy, so every validation failure was a prod CFR hit rather than a contained dev-stage catch. **Solution:** the locked dev→prod path `deploying(deploy-to-dev) → dev-validating --dev_validated(tester)--> prod-deploying --promoted(cicd)--> prod-validating --validated(tester)--> done` — cicd deploys to DEV (`deployed`), the tester dev-validates against the ORIGINAL FROZEN acceptance.md (the dev-validation oracle) and fires `dev_validated`, which AUTOMATICALLY (no human gate — an automated promotion assurance like §F5a infra auto-approve) triggers cicd's prod deploy (`promoted`), then the tester prod-validates (`validated`). Local-only projects collapse dev==prod (validate straight from `dev-validating`). | CFR (a defect is caught in the dev-validation stage BEFORE it reaches prod, so it is a contained dev catch, not a prod deploy-failure) + MTTR (a dev-stage catch has no prod-blast recovery) | over the next 2 cloud/hosted slices, every UC is dev-validated against the frozen acceptance.md BEFORE the prod deploy AND ≥1 validation failure is caught at `dev-validating` (a `rejected` from dev, no prod impact) with 0 rejected-in-prod that a dev-validation would have caught; if a UC reaches prod-validating without a passing dev-validation, or a prod deploy-failure occurs that the frozen dev-oracle would have caught, FAILED | 2 cloud/hosted slices (or 3 retros) | active (0/2) | applies-to: any cloud/hosted (non-local-only) slice whose UCs deploy. Depends on the state-graph amendment (dev-validating/prod-deploying/prod-validating states, owned by a parallel agent). Honours the user's "dev-first, acceptance before prod" principle. Distinct from EXP-091 (tester-validates-in-prod safety net still stands — this ADDS the dev-first validation ahead of it) and EXP-099 (deploy as a first-class cicd-owned stage — this splits it into dev+prod legs). ‖ AdixOut retro (REQ-003, 2026-07-16): still 0 real opportunity — REQ-003 was AdixOut sandbox-only (no cloud dev→prod promotion). Kept — first real opportunity expected on the dev-shared/prod-shared bus ingestion thread (imminent), which WILL be its first real cloud dev→prod opportunity. ‖ AdixOut v94 retro (2026-07-22): PARTIAL POSITIVE / FIRST real opportunity — REQ-005 Chunk A deployed to a REAL hosted dev env (dev-shared) and was dev-validated THERE, the first non-local dev validation (the local-only collapse no longer applies). BUT prod is DEFERRED for REQ-005, so the dev→prod PROMOTION leg did not run — `validated` fired directly from `dev-validating` (deferred-prod collapse). Dev-first validation on real infra is now DEMONSTRATED; the full dev→prod promotion still awaits a prod-in-scope slice. Stays active. ‖ AdixOut v99 retro (2026-07-22): POSITIVE data point — the WAF XML-body false-positive (UC-ADIX-017) was CAUGHT IN DEV validation and fixed in rework before any prod exposure, exactly the dev-first containment this experiment is for. Prod promotion leg still deferred for REQ-005, so no dev→prod promotion to score; stays active (0/2). ‖ AdixOut v105 retro (2026-07-24, REQ-005 COMPLETE): STRONG POSITIVE data, but the measure does NOT yet permit adoption. REQ-005's full external AIDX egress (13 UCs + DEF-ADIX-003) was validated on the REAL hosted dev env (dev-shared) end-to-end, and the adversarial live/JTBD validation CAUGHT REAL DEFECTS IN DEV before any prod exposure (the DEF-ADIX-003 bad-state chain, the WAF XML false-positive, the UC-019 dynamic-key rework) — this is exactly the dev-first containment the experiment is for, now heavily demonstrated. BUT prod stays deferred for REQ-005, so the dev→prod PROMOTION leg the measure requires still has not run (`validated` fires from `dev-validating` under the deferred-prod collapse). NOT an adopt yet — the measure explicitly needs the promotion leg over 2 cloud/hosted slices. Kept active (0/2) with the strong dev-first positive; first real dev→prod promotion still awaits a prod-in-scope slice. |
| EXP-106 | v84 (2026-07-11) | process-current.md §12d + product.md + tester.md + documenter.md | **Problem:** an aggregate's `done` folds structurally (all children `done`), with NO linkage to the job's success measure or persona — so a slice can be `done` while its CORE job is undelivered, and the undelivered remainder can fall off the backlog silently. SLC-030 (`job: J0` CORE, "live delivery to consumers") was marked `done` having built the bus SAME-ACCOUNT only; the cross-account CORE remainder was registered nowhere, `items/active/` read empty ("CORE-DELIVERED"), and the pull-vs-push delivery-model inversion then propagated into the consumer-facing skill. CFR read 0.0% and rework 0.0% the whole time — the metrics were blind to an escaped requirement-level defect. Same class as the presence-not-correctness / false-green / actual-docs-incoherent failures (2026-06-23/25). **Solution:** §12d — a CORE-`job` aggregate is "done-in-fact" only when acceptance is validated against that job's success measure for the named persona(s) (product anchors it, tester validates against it); and a deliberately-partial CORE slice MUST register its undelivered remainder as a tracked item before it closes (flow-manager confirms), so a CORE job never leaves `items/active/` empty while unfulfilled. Plus: consumer-facing docs/skills state their "primary path" by tracing to the authoritative delivery model, never a peer/derived doc (documenter). | CFR (escaped requirement-level defects — a CORE job marked done-but-undelivered — are caught at close instead of read as 0% success) + MTTR (the gap is caught at slice-close, not discovered cycles later) | over the next 3 CORE-job slices: every slice carrying a CORE job is validated against that job's success measure + persona at close, AND any deliberately-partial CORE slice has its remainder registered as a tracked item BEFORE it closes (0 CORE jobs left with an empty active backlog while unfulfilled); if a CORE slice closes `done` without a job-success-measure validation, or a partial CORE slice closes with its remainder untracked, FAILED | 3 CORE-job slices (or 3 retros) | active (1/3) | ROC retro (1st opp): NEGATIVE — the gap §12d/EXP-106 exists to prevent RECURRED on a third project. `CHK-ROC-001` (CORE job J1, done-condition "one **real** Jira PPSM Alert ticket end to end") folded to `done` on its LOCAL child (`SLC-ROC-001`, fake Jira adapter); the real-delivery remainder (`SLC-ROC-002`) was never registered — it lived only as a `chunk-plan.md` forecast — so `REQ-ROC-001` read `done` and CFR/rework read 0.0%, blind to it. Root cause = the gate is TEXT enforced by operator memory, not mechanical. Remedy applied this retro: registered `SLC-ROC-002` (CHK-ROC-001 reverted done→in_progress, REQ→in_progress) + opened principle-failure 2026-07-12-roc-core-slice-local-only + queued **IMP-011** (a `wi-validate` I5 invariant that fails a CORE aggregate reaching `done` without a job-success validation OR a registered remainder). IMP-011 is the enforcement half — score it here. applies-to: every slice ‖ ROC v112 (EXP-115 confirm): POSITIVE again — the composed-consumer/live acceptances across creation+versioning caught a REAL CC-3 dedupe bug (restore of an older-identical version no-op'd, undo-a-bad-change would fail) + the pickup-wiring class; offline unit/component green missed all of them. ‖ ROC v111 (EXP-115 confirm): POSITIVE again — SLC-ROC-014 live-stack tester caught 5 real defects (no-reflow, label-title-only ×2, draft-test fault-gate parity, publish pickup wiring) that ALL offline green bars (524 app + 336 dashboard) passed; every one a genuine dev-catch (CFR 10.1% honest)./chunk carrying a CORE `job`. Founding failure: principle-failures/2026-07-11-core-slice-false-done-and-delivery-model-inversion. Distinct from EXP-101 (dev-first validation — WHERE a UC is validated) and EXP-102 (defect-vs-rework fork + findings→requirement loop — this USED EXP-102's V5a to register REQ-XACCT-PUSH); EXP-106 governs WHETHER an aggregate's `done` means its CORE job is delivered. ‖ AdixOut retro (REQ-003, 2026-07-16): light POSITIVE / no-regression — no CORE-PARTIAL slice this cycle, so no untracked-remainder risk arose. REQ-003 FULLY delivered its core job J-ACDM-PREDICT and was validated against the success measure at close (no false-done). No opportunity to score the partial-remainder limb; the done-in-fact limb held. Stays active (1/3). ‖ AdixOut v94 retro (2026-07-22): no scoring opportunity this cycle (no CORE-partial slice; no untracked-remainder risk arose). Stays active (1/3). |
| EXP-107 | v86 (2026-07-12) | process-current.md §14 + engineer.md (infra-bearing push gate) | **Problem:** the push-on-green done-condition was unit + lint only. For infra-bearing changes (`sst.config.ts`/`infra/`/IaC/deploy-role policy) CI auto-deploys, so green-locally-on-unit-lint is NOT the green CI enforces — an infra statement that passed offline shape-tests was rejected at the AWS API on deploy (EventBridge `PutPermission` invalid-principal), turning the shared infra CI pipeline red (UC-XA2 first push ec56025), fixed forward at 76a7e58. Same "green in the cheap check ≠ correct where it matters" family as v84 / the 2026-06-23 false-green class. **Solution:** infra-bearing push gate — a change touching sst.config.ts/infra/IaC/deploy-role policy is not push-green on unit+lint alone; the pre-push done-condition MUST include `make deploy-sst` (or `sst diff`/synth) passing locally before push. Routed to process-current.md §14 (cross-agent) + engineer.md (woven into push-when-done). | CFR (infra deploy-failures caught pre-push instead of turning CI red post-push) | over the next 3 infra-bearing pushes: each runs the synth/deploy gate BEFORE push and 0 turn the infra CI pipeline red for a cause the local synth/deploy would have surfaced; if an infra push goes red in CI for a synth/deploy-detectable cause, FAILED | 3 infra-bearing pushes (or 3 retros) | active (0/3) | applies-to: any push touching sst.config.ts/infra/IaC/deploy-role policy. Founding incident: principle-failures/2026-07-12-infra-pushed-green-locally-red-in-ci. Sibling of EXP-101 (dev-first validation) — this is the pre-PUSH analog (catch the deploy failure before it reaches CI at all). ‖ AdixOut retro (REQ-003, 2026-07-16): no opportunity — REQ-003 was domain-mapping only, no IaC/sst.config.ts/deploy-role touched, so no infra-bearing push occurred. Stays active (0/3). ‖ AdixOut v94 retro (2026-07-22): NEGATIVE/BOUNDARY — REQ-005 Chunk A had 3 infra-bearing changes and the local synth/`sst diff` gate did NOT catch any of the 3 real deploy failures (UC-014 iam:CreateRole least-priv gap; UC-016 WAFv2 description-charset ValidationException; UC-016/DEF-ADIX-002 SST `$transform` no-op on the ApiGatewayV1 Stage — where `sst diff` even FALSELY showed the tag applying). HONEST BOUNDARY recorded: local synth catches SHAPE errors only, NOT real-control-plane failures (least-priv IAM, service-API validation, child-construction-order) — those need the real CI apply + live post-deploy verification (fold 1a). NOT killed (running `sst diff` cheaply is still worth it), but its measure must NOT claim to catch the real-control-plane class; its value is now SUBORDINATE to EXP-108 (record the failure) + the live-verify practice (tester fold 1a). Stays active (0/3). |
| EXP-112 | v91 (2026-07-13) | cicd.md (dependency-vulnerability audit gate) + per-project `make audit` target | **Problem:** DEF-ADIX-001 — vulnerable dev/build/test dependencies accumulated SILENTLY across the whole first requirement with NO signal any agent reads: a **CRITICAL** vitest UI-server arbitrary-file-read/exec advisory, a HIGH vite `server.fs.deny` bypass, and 3 MEDIUMs sat open in BOTH lockfiles (`package-lock.json` + `src/app/package-lock.json`) until the human pointed at the GitHub Dependabot banner. Nothing in the loop ever ran an audit, so supply-chain risk grew unbounded between deploys — a change-failure waiting to surface, invisible to CFR. **Solution:** a standing, committed dependency-audit gate — a `make audit` target running `npm audit --audit-level=high` in EVERY manifest (root + each sub-package), wired into the build/push gate cicd owns (alongside lint/test); a high/critical advisory is a gate failure and becomes a `DEF-` through intake (dev-only advisories still fixed but flagged no-prod-exposure for correct prioritisation); a toolchain bump to remediate is verified green across all tiers (EXP-110) before push, never pinned back. | CFR (a high/critical advisory is caught at the next push instead of accumulating unaddressed across a whole requirement) + MTTR (a caught-early vuln is a cheap bump, not a critical-severity scramble) | over the next 3 cycles with an npm project: `make audit` runs as part of the build/push gate AND 0 high/critical advisories accumulate UNADDRESSED across a cycle boundary (each is either fixed or registered as a triaged DEF- within the cycle it appears); if a high/critical advisory sits open across a full cycle with no audit-gate signal, FAILED | 3 cycles (or 3 retros) | active (0/3) | applies-to: any npm/dependency-bearing project (extends naturally to other ecosystems' audit tools). Founding: DEF-ADIX-001 (2026-07-13), principle-failure `2026-07-13-adixout-dependency-vulns-accumulated-no-audit-gate.md`. Opened cap-neutral against EXP-102's adoption this retro (retire-one-open-one, v88 WIP cap). Sibling of EXP-088 (render-diagrams gate) / EXP-087 — all make "did you actually check?" an executable committed gate, not a banner someone must notice. ‖ AdixOut retro (REQ-003, 2026-07-16): light / no-opportunity — npm project but no new dependencies added this cycle, so no new advisory surfaced; `make audit` remains wired into the build/push gate. Stays active (0/3). ‖ AdixOut v94 retro (2026-07-22): LIGHT POSITIVE — `make audit` ran in CI on every push this cycle and reported 0 high/critical vulns; the gate is executing as intended (no advisory accumulated unaddressed). Not yet a full horizon hit (no advisory to catch), so not adopted. Stays active (0/3). |
| EXP-113 | v92 (2026-07-16) | .claude/commands/loop-run.md (STEP 0 freshness precondition) + process-current.md §F STAGE-F note | **Problem:** the OFS loop STARTED on an 8-versions-stale process layer — the worktree was 66 commits / v83 behind main's v91 because entering via "start the loops" (`/loop-run`) never folds the process forward (only `/project-switch` does, on resume). Consequence: the tester ran the pre-EXP-104 `impacted-tests` tool and re-hit the ALREADY-FIXED nested-repo `bad revision` bug 3× (UC-A9/A10/A11), each forcing a manual change-map fallback — pure waste re-incurring a defect fixed weeks earlier on `main`. Process freshness was not a precondition of the loop, so an instance can run arbitrarily stale tools/agents for a whole session and re-pay for solved problems. **Solution:** `/loop-run` STEP 0 runs `make project-update PROJECT=$1` (the same fold-forward `/project-switch` runs) BEFORE the first pull, handling exit 0/3/4 exactly as §0a; skip only for non-worktree/standalone projects. | tester lead time + reconcile-latency (main→instance staleness at loop start → an instance never re-incurs an already-fixed defect because it starts on the current process) | over the next 3 loop-run starts on a worktree project: STEP 0 runs and the instance begins each session on main's current process (0 recurrences of an already-fixed tool/agent defect that a fold-forward would have prevented); if a loop starts stale and re-hits a defect already fixed on main, FAILED | 3 loop-run starts (or 3 retros) | active (1/3) | OFS retro 2026-07-21 (1st opp): POSITIVE — the loop RESTART this session ran STEP 0 (`make project-update`) before the first pull; the instance began on main's current process (v94) and did NOT re-hit any already-fixed defect — impacted-tests worked, and the tester even found+fixed a NEW impacted-tests bug (multi-line `@covers`) rather than re-hitting the old EXP-104 one. 0 stale-defect recurrences (vs 3× the prior session when STEP 0 didn't exist). ‖ applies-to: every worktree-based project loop. Founding: principle-failure `2026-07-16-loop-ran-on-stale-process.md` (impacted-tests recurrence now ~8× across OFS+AdixOut, all downstream of staleness or a parked spec). Opened cap-neutral against EXP-100's adoption this retro (retire-one-open-one, v88 WIP cap). Sibling of the §0a fold-forward/fold-back reconcile-latency discipline — this closes the ENTRY side (start fresh) as fold-back closes the EXIT side (reintegrate continuously). | ‖ AdixOut v94 retro (2026-07-22): did NOT fire — `/loop-run` this session predated v113 landing in THIS tree, so STEP 0 was not yet present when the loop started. No score (mechanism had not landed at loop-start). Stays active (1/3).
| EXP-115 | v96 (2026-07-21) | tester.md (validate the whole user journey with the real shipped artifacts) | **Problem:** DEF-002 — sample config JSON shipped to demo the app FAILED the actual paste→load→run path with a `batchSize` run-params error (no such UI field), because the single config textarea runs BOTH `loadStationChain` AND `loadRunParams` on the same blob and the samples carried only `stations`. It was called "verified" having only been checked against `loadStationChain` in isolation — a component check, never the end-to-end journey a user/demo takes. Root: "done/verified" for a deliverable was allowed without executing the whole primary journey with the REAL artifacts; sample/demo data was treated as eyeballed docs, not a validated artifact under test. **Solution:** tester.md — (1) any data artifact the project ships to be loaded (sample/demo/seed/fixture) is a VALIDATED artifact with a committed test that loads THAT FILE through the public surface and runs the primary journey to a real terminal outcome; (2) "verified/done" means the whole journey was executed+observed at the public surface (load real input → act → reach real end state), not that a sub-step is green — the EXP-110 unrun-test-is-failed rule applied to the JOURNEY. Founding fix on OFS: `e2e/samples-demo.spec.ts` loads the real `samples/*.json` and drives load→run→occupancy→drill-down to `done`. | CFR (a broken demo/sample/seed artifact, or a journey-level break a component test misses, is caught before it ships — not by the user on first use) | over the next 3 slices that ship or touch a loadable data artifact / a multi-surface journey: a committed end-to-end test loads the real artifact and runs the journey to a terminal outcome, and 0 such artifacts/journeys break at the public surface after being called done; if a shipped artifact fails to load/run at the public surface, or a "verified" claim is made without an executed end-to-end journey, FAILED | 3 slices (or 3 retros) | active (0/3) | applies-to: any project shipping loadable data (samples/seed/fixtures) or a multi-surface user journey. Founding: DEF-002 (2026-07-21, gap-closing retro). Sibling of EXP-110 (unrun test = failed) — extends it from the test SUITE to the user JOURNEY + shipped artifacts. Registry over nominal cap-8; a prune pass is owed (tracked, not blocking this mandatory gap-closing row). ‖ OFS v98 retro (1st opp, 2026-07-22): RECURRED → strengthened. DEF-003 — the log-normal chart was invisible via `demo.sh` (its flag list drifted from flags.ts) while the demo-journey e2e stayed green off its OWN hardcoded flag copy. The gap re-appeared at the ENTRY-POINT/RUNNER seam: EXP-115 said "validate the real journey/artifacts" but the test exercised a flag list no user runs. Fix landed via the loop (DEF-003): single code-derived source of truth for the demo flag set, shared by demo.sh + the e2e, with a red→green drift-guard. Scope STRENGTHENED in tester.md: drive the real human entry point (demo.sh/run script/URL), derived the way it does, not a harness copy. Counts as 1/3 (partial — the principle held for the artifact/journey but not the entry-point; now closed). ‖ AdixOut v106 focused-retro (2026-07-24): CONFIRMING evidence — the adix→aidx account-migration re-verification validated the JTBD outcome end-to-end on the FRESH dev-dataout (632421564230) account and surfaced 3 pre-existing latent defects (DEF-AIDX-004/005/006), all fixed + validated live BEFORE any prod escape — the whole-journey/live-outcome validation working exactly as intended (the v105 "validate the outcome not the code path" fold in action). Positive data point. ‖ AdixOut v109 focused-retro (2026-07-24): CONFIRMING again — the REQ-004 dev consumer-side walking skeleton was validated by a real live bus-driven E2E (synthetic event → C12 → C13 → C10 → C11 → read model → egress) that OFFLINE synth-pins passed. It caught the SLC-AIDX-011 scope-gap (C10/C11 sandbox-only, not on dev-dataout) AND both UC-AIDX-028 EventBridge→SQS delivery bugs (envelope-wrap poison; `inputTransformer` `<placeholder>` → `INVALID_JSON`) that component tests missed — each fixed live, then pinned offline. Live assert-real-state validation earning its keep on infra-shape defects. Positive data point. ‖ AdixOut v111 focused-retro (2026-07-28): STRONG POSITIVE — live assert-real-state caught an ENTIRE ORPHANED integration that a FULL synthetic suite passed green. REQ-004's whole dev consumer-side (C12 bus + cross-account grant + `source=oagEvents.producer` + top-level envelope) was synth-validated done, then the live "check the data is flowing" assert revealed OAG actually fans `Aerobus`→a shared `oag-consumer-bus` (~42k/day, our account) with `source=oag.eventstore`/`detail-type=OagCanonicalEvent` + envelope under `.detail` — forcing reconciliation delta 008 + DEF-AIDX-007. Only after the live rewire did real leg F9 3371 fold + serve end-to-end. The whole-journey/live-assert principle catching a topology/source/envelope orphaning no synthetic self-consistent test could — its strongest data point yet. ‖ AdixOut v118 focused-retro (2026-07-29): STRONG POSITIVE again — the dedicated-fan-out increment's live/adversarial validation caught THREE escapes a synthetic-scale suite passed: (1) DEF-AIDX-008 — REQ-004's live ingest grew the read model to ~9k real legs at ~50–90/min, breaking the already-"done"/validated egress `Catchup` (`POST /flightlegs` 502 for every customer, single-partition `byType` GSID page-until-entitled scan didn't scale); (2) the AIDX UFI/`OriginDate` drift (`deriveOriginDate` recomputed from mutable operational timestamps) found by adversarial validation → fixed to derive-once + pin-at-ingest; (3) the prod-fixture leak (dev `synthetic-customer-a` seed + hand-seeded legs + `WebhookTestReceiver` carried into the prod stack by a verbatim mirror) caught + stripped before any prod deploy. A feed going live + adversarial + mirror-hygiene checks each caught a real escape prior sign-off missed. |
| EXP-118 | v114 (2026-07-28) | ui-designer.md §3b (data-visualization faithfulness — TESTABLE) + tester.md (validate the depicted relationship) | **Problem:** DEF-004 — the fitted log-normal overlay on the distribution chart rendered a FLAT TOP: `buildCurvePath` scaled the curve to the tallest histogram bar (`maxCount`) and CLAMPED any point above the plot to `PLOT.top`, so whenever the true peak exceeded the bars the curve clipped flat — MISREPRESENTING the fit P1 must judge by eye (J12). It shipped because the chart's acceptance (G3) asserted geometry + a11y + "a hump is present" but NO clause required the curve to be a FAITHFUL density; the clamp was even rationalized as "by-design". A viz that "fits in the box" by distorting the data passed as done. **Solution:** ui-designer §3b — for any chart, emit a checkable FAITHFULNESS condition per encoded quantity (marks quantitatively represent their datum with no silent clamp/truncation/renormalization that changes the reading; series share an honest common scale sized to hold all series; a computed overlay depicts the source data's true shape — single real peak, correct tail — asserted by sampling rendered marks, e.g. one interior maximum / no ≥3-point top plateau). tester validates the DEPICTED RELATIONSHIP at the painted surface, not just that the chart renders. | CFR (a data-viz distortion defect is caught at acceptance/dev-validation, never shipped to a done item) | over the next 3 chart-bearing slices/defects: each chart's acceptance carries a faithfulness condition per encoded quantity AND 0 viz-distortion defects (clamp/renormalization/truncation that changes the reading) reach a done item; if a chart ships with a mark that distorts its datum, or a chart acceptance asserts only geometry/a11y/presence, FAILED | 3 chart-bearing slices (or 3 retros) | active (2/3) | OFS v115 retro (2 opps, UC-I2 + UC-J2): POSITIVE ×2 — UC-I2 (bin slider) keeps the fitted curve a faithful density (μ/σ invariant; no flat-clip; asserted by sampling the rendered path) across every bin count as maxCount varies; UC-J2 (Animate) keeps occupancy/ageing/distribution faithful frame-by-frame at 2/s→1e6/s. Both validated the depicted relationship at the painted surface, not just presence. ‖ applies-to: any chart/plot/graph surface. Founding: DEF-004 (2026-07-28, gap-closing retro). Sibling of §3a (visual-structural geometry) — 3a says "shape that carries meaning is asserted as geometry"; 3b says "quantity that carries meaning is asserted as faithful magnitude". Extends the EXP-114 painted-pixel + EXP-115 real-journey family from "is it rendered/accessible?" to "does it tell the truth about the data?". |



## Retro 2026-07-29 (ROC) — v119 — FOCUSED: SLC-ROC-018 CLOSE (templates complete) + DEF-ROC-010 resolve (test-harness batch-runnable); v116 folds score EARLY-POSITIVE

- **Trigger:** §F8 gate — the retro-debt classifier scored DEF-ROC-010's resolve as a **defect-resolve INCIDENT (immediate)** (+ SLC-ROC-018 slice-close routine). Fold-forward FIRST (v116→v118: another instance's native board-projection tool + IMP-018) THEN this on top → **v119**. FOCUSED retro (score + fold + drain) — the substantive learning was all in v116 an hour ago; this cycle VALIDATED it.
- **Focus-Q (constraint):** UNCHANGED. `external` 49.9% + `queue` 37.9% (env-owner-blocked DEF-004/008/009 — not squeezable). Actionable = tester/dev-validation **11.7%** (9/77) — flat vs v116's 11.8%, and the recent contrast-rework tail is closing (below).
- **v116 change-set scored — EARLY POSITIVE:**
  - **engineer.md class-(4) contrast guard → POSITIVE (early):** UC-ROC-069 (the 3rd contrast reject) was the LAST pre-guard instance; the very next UI-touching UC after the guard, **UC-ROC-070, took ZERO contrast rework** (and its engineer explicitly reused UC-058/069's painted control, adding no new un-themed variant). One clean data point that the "never rely on un-themed house variant + pin every new control" guard shifts the class left. Keep; IMP-024 (generic compiled-CSS check) remains the durable fix.
  - **tester.md lint-gate guard → POSITIVE:** every tester-committed spec this cycle (UC-067/069/070 + DEF-010) ran `oxlint`/`eslint` before landing — 0 red-trunk lint escapes after the v116 fold (vs the UC-068 escape that prompted it).
  - **linear.md/jira.md secrets-leak guard → POSITIVE:** every board dispatch after the fold honoured "never read secrets/*"; 0 further api_key materialisations. (Human still owes the ROTATE of the already-exposed key.)
  - **EXP-115 POSITIVE again:** the live tester independently re-proved multi-site publish parity (UC-070) + caught the stale AC-062-5 cross-UC assertion during DEF-010 (→ DEF-011).
- **SLC-ROC-018 CLOSED — C4 config-authoring feature COMPLETE** (rules + site patterns + templates, all edit→test→publish with live no-redeploy pickup + Simulator parity, local-validated per DEF-009). UC-067/068/070 zero-rework; only UC-069 took one (contrast, now guarded). **DEF-ROC-010 RESOLVED**: the e2e battery is now batch-runnable (per-spec reset→seed→right-read-api runner, 20/20 gating green) + acceptance-tier run-scoped identities — the test safety net the retro flagged is now real. Filed **DEF-ROC-011** (stale AC-062-5: UC-063's shipped restore superseded UC-062's "no-restore" assertion — a knownIssue the battery excludes, backlog).
- **ONE new nuance (routed to open-items.md, DEFERRED — not the constraint, needs design):** the retro-debt classifier trips the IMMEDIATE incident gate on ANY `defect-resolve`, but §F8's incident intent is a **PROD** defect / deploy-failure. DEF-ROC-010 was a DEV-caught test-tooling defect with zero prod exposure — batching it as routine (not an immediate incident) would have been correct. Refinement candidate: the fold distinguishes prod-exposed defect-resolves (immediate) from dev-only tooling/test defect-resolves (routine-batch). Deferred because the signal (prod-exposure of a resolved defect) needs a clean derivation in the event fold; over-tripping costs one cheap focused retro, so low urgency.
- **Registry:** unchanged — **7 active** (EXP-101/106/107/112/113/115/118), under cap-8. No new rows (all v116 changes are fixes/tightenings already folded; this retro only SCORED them). No new agent-file changes this cycle.
- **Constraint to attack next:** UNCHANGED (external/queue — env-blocked). In-system lever remains the contrast class (guard early-positive; IMP-024 the durable fix). Next work: J25 template relinking (SLC-ROC-019, delta 015 gated, UC-071/072 Ready) — pull now that DEF-010 freed capacity.

## Retro 2026-07-28 (ROC) — v116 — SLC-ROC-017 + SLC-ROC-018-crux CLOSE (site + template authoring); contrast-variant recurrence (3×), secrets-leak + lint-gate guards

- **Trigger:** §F8 routine-batch gate (3/3 — UC-ROC-064 uc-rework + SLC-ROC-017 slice-close + UC-ROC-069 uc-rework; NO prod incident). Continuing C4 per the human ("continue c4"). Fold-forward FIRST (main v112→v115: OFS v114/v115 data-viz gate + AdixOut v111 + agent folds) THEN this retro on top → **v116** (the fold-forward-first lesson, honoured; my 5 process commits auto-merged clean, no conflicts).
- **Focus-Q (largest GLT contributor + strategy):** by raw share the constraint is UNCHANGED and NOT agent-squeezable — `external` **49.9%** (Azure/env-owner-blocked DEF-004/008/009 + UC-022/023) + `queue` **38.0%** (backlog/wait). The largest **ACTIONABLE** contributor is `tester`/dev-validation (**7.4%** GLT, **11.8%** dev-validation failure rate, 9/76), and its DOMINANT driver is a recurring **house-component-variant WCAG non-text-contrast** class. Change budget spent on the EXPLOIT (remove that rework), not on the un-squeezable external/queue.
- **WHY-CHAIN (recurring root cause, 3× → principle-failure):** dev-validation fails 11.8% → the live-stack tester keeps rejecting UI slices on painted-pixel non-text contrast → because house DS component VARIANTS paint sub-AA by default (`ACBadge warning` 1.11:1, `ACTextInput` border 1.47:1, `ACButton color="success"` UNSTYLED = 1.00:1) and it's invisible offline (jsdom axe + vitest-browser approximated CSS both pass) → because the offline guard (`index.css.contrast.test.ts`) is ENUMERATIVE, pinning only the testids/variants already known to fail → ROOT: no GENERIC offline check asserts every house-component instance meets AA for its variant; the guard grew reactively per-reject, so each new surface/variant re-enters the failing state. Logged: `principle-failures/2026-07-28-house-component-variant-contrast-recurring.md`.
- **EXPLOIT routed (constraint-targeted):**
  - **engineer.md (plain practice, NO row — a fix/tightening of the v111 real-artifact bar):** added class (4) — never rely on an un-themed house color/variant for a painted affordance; EVERY new testid'd control carrying a house component with a color/variant/border MUST be added to the shared `index.css` override AND pinned in `index.css.contrast.test.ts` in the SAME change (required coverage, the enumerative stopgap).
  - **IMP-024 (improvement-slice, QUEUED):** a GENERIC offline non-text-contrast check driven from the COMPILED `index.css` (real cascade) + component usages — fails the build the FIRST time any variant renders sub-AA, beating the enumerative pin; and/or an eslint/wrapper ban on the known-unstyled variants. Targets CFR + lead time (next UI slices' contrast-reject rate → ~0). This is the durable fix; score when built.
- **Two process-gap guards this cycle (safety fixes, plain practice, NO rows — "a fix is not an experiment"):**
  - **Secrets-leak guard → linear.md + jira.md:** a `linear` full-sweep dispatch ran `tail -100 secrets/linear.json` to "verify the id→issue map persisted", dumping the LIVE Linear `api_key` into the transcript (file is gitignored, so not committed — but exposed in-session; **flagged to the human to ROTATE**). The prior "never prints the api_key" wording was too weak. Hardened: NEVER cat/tail/head/print/Read any `secrets/*` file; the projection script is the sole reader; inspect only `id_to_issue` if needed.
  - **Tester lint-gate guard → tester.md (extends the v112 DEF-006 guard):** 2nd recurrence of a TESTER-committed spec breaking a gate — UC-068's live spec tripped `@typescript-eslint/no-empty-object-type` and left `src/app` lint RED on trunk (v112 covered `tsc -b`, not lint). Tightened "full build graph" to explicitly include the LINTER CI runs (`eslint .` / `oxlint`). One-line trunk fix applied; the tester honoured the tightened guard immediately on the very next spec (ran oxlint+tsc before landing).
- **Scoring — previous change (v112) + registry:** v112's DEF-006 `tsc -b` guard HELD (no tsc false-green this cycle) and was EXTENDED to lint (above) — net positive, kept. **EXP-115 (whole-journey/real-artifact live validation) — POSITIVE again (strong):** the live painted-pixel tier caught all 3 contrast defects + independently re-proved the DEF-005 mirror-surface parity (site + template fan-out) that offline green missed; the tester also added supplemental live specs (UC-065 gains/no-data, UC-067 e2e, UC-069 repro) closing gaps in engineer-committed specs. Registry: **7 active** (EXP-101, 106, 107, 112, 113, 115, 118 — EXP-118 arrived via the OFS fold-forward) — under cap-8, nothing retired.
- **Token-efficiency (§24, DORA-balanced):** dominant sinks = the engineer + tester live-stack cycles (real value, kept) and the 2 contrast REWORK loops (UC-064, UC-069 — each ~a full extra engineer+tester cycle, ~300–600k tokens). The single highest-leverage reduction = eliminate the contrast rework class — SAME as the DORA fix (EXPLOIT + IMP-024), so DORA-value-per-token and token reduction are aligned; no separate token change. Also removed a stray `scratchpad_readapi.log` a read-api run wrote to the worktree root (blocked fold-forward) — minor hygiene, watch for recurrence (read-api should write to scratchpad).
- **Non-blocking findings (tracked, not new defects):** the acceptance/e2e-tier shared-`AlertDecisions`/UYD-partition pollution under parallel runs (uc006/007/048/049/050 fixed identities; seed-uc069-tst `Date.now()` non-idempotency) is the SAME test-isolation family as DEF-ROC-010 (e2e batch-seed gap) — fold into DEF-010's scope rather than new defects.
- **Constraint to attack next:** UNCHANGED by raw share (external/queue — env-owner-blocked, DEF-004/008/009). The in-system lever remains the contrast-variant class → measure: next UI slice's dev-validation contrast-reject rate should fall (engineer.md class-4 guard now; IMP-024 the durable fix). Remaining C4: UC-ROC-070 (template multi-site publish — closes SLC-018), then J25 relink (deferred) + RBAC/SSO (REQ-ROC-005, human-deferred).

## Retro 2026-07-28 (ROC) — v112 — SLC-ROC-016 CLOSE (versioning/audit + rollback); v111 fold VALIDATED, DEF-006-class tester-spec guard

- **Trigger:** §F8 routine-batch gate (3/3 — SLC-ROC-015 + CHK-ROC-009 + SLC-ROC-016 closes; NO prod incident). Continuing C4 per the human ("continue c4").
- **Focus-Q (largest GLT contributor + strategy):** constraint UNCHANGED + not-agent-squeezable — `external` 48.75% (Azure-blocked DEF-004/008 + UC-022/023) + `queue` 40.62% (backlog/wait); agents ≈10.6% (tester 7.16%, engineer 3.42%). Change budget NOT spent chasing it.
- **HEADLINE — the v111 "real-artifact green bar" fold is VALIDATED (measured):** the rules-EDITING slice (pre-fold) took 5 live rejects (real defects offline green missed); the two slices built AFTER the fold — CREATION (UC-059/060/061) and VERSIONING (UC-062/063) — took **0/8 rework** (the recent-window rework rate is 0.0% vs 7.0% all-time). Engineers proactively wrote the composed-consumer-against-populated-store acceptances + fully-themed live-axe checks BEFORE built_green, so the DEF-002/DEF-005-class defects were caught at build, not at the tester (rejects). The exploit (shift live-defect classes left) works; keep it as standing engineer.md practice (already folded v111). dev-validation 10.3% (7/68) is honest and entirely pre-fold; CFR 9.5% is honest dev-catch (EXP-108).
- **DEF-006-class escape → tester.md guard (plain practice, no experiment row):** UC-062's TESTER-committed validation-as-code e2e spec had a `tsc -b` false-green that broke the dashboard build graph (rolled-forward by the UC-063 engineer). Root cause: the engineer's pre-built_green bar gates the engineer's OWN commits, not a spec the tester pushes afterward — so a tester-committed spec with a type error lands false-green. Routed: tester.md — a validation-as-code spec you COMMIT must be run through the FULL build graph (`tsc -b` incl `tests/e2e`) before landing. Extends the DEF-006 lesson to the tester's own commits.
- **EXP-117 (board-push cadence) ADOPTED — 3/3 POSITIVE (registry 7→6).** Terminal-only per-item pushes + periodic full-sweeps held board fidelity across the whole config-authoring effort (In-Progress lane honest every cycle, incl. after the v111 blocked-mapping fix). Folded into loop-run.md/orchestrator.md as standing practice; row archived. **EXP-115 POSITIVE again** (composed/live acceptances caught the real CC-3 bug + pickup class).
- **Findings logged (not defects):** the delta-012 template-403 restore guard has no live-reachable path until link/break (J25) ships — proven at unit tier, flagged for arch. A co-authored a11y clause (non-text-element ≥3:1) doesn't map to the ghost-styled history drawer — ui-designer to tighten wording on the next slice touching it.
- **Registry:** **6 active** (EXP-117 adopted-and-pruned). No new rows. Constraint next: unchanged (external/queue); remaining C4 = templates (J16/J25), site onboarding (J26), RBAC-enforcement UI (J28).

## Retro 2026-07-27 (ROC) — v111 — SLC-ROC-014 CLOSE (rules-editing: edit→draft-test→publish); live-defect-class fold + board-mapping fix

- **Trigger:** §F8 routine-batch gate (4/3 — UC-056/057/058 uc-reworks + SLC-ROC-014 slice-close; NO prod incident). Human directive mid-slice: "prioritise rules creation and editing" + "fix the [Linear] in-progress clutter".
- **Focus-Q (largest GLT contributor + strategy):** constraint UNCHANGED and confirmed NOT agent-squeezable — `external` 46.66% (Azure-blocked DEF-004/008 + UC-022/023) + `queue` 41.93% (backlog/wait); agents combined ≈11.4% (tester 7.77%, engineer 3.58%). NOTABLE SHIFT: **dev-validating failure rate 11.1% (7/63)** and CFR **10.1%** (up from 3.3%) — HIGH but HONEST (EXP-108 integrity): every reject was a REAL defect the live-stack tester caught in DEV before prod, that all offline green bars missed. The squeezable cost is the REWORK, so the change budget targets shifting the live-defect classes LEFT (exploit), not the un-squeezable external/queue.
- **WHY-CHAIN (recurring root cause → principle-failure):** dev-validation fails 11.1% → the live-stack tester keeps finding defects the engineer's pre-built_green bar (unit + component + build-graph, all GREEN) misses → because that bar tests the artifact in ISOLATION (jsdom axe, no-layout jsdom, mocked/empty stores, hand-rolled makeDecide) not the RENDERED/DRIVEN real artifact → ROOT: for UI/pipeline slices the meaningful defects live in the integration/rendered/driven layer the local green bar structurally does not exercise. Same family as v110/EXP-115 (offline-green ≠ live-correct) — convergent cross-project evidence.
- **EXPLOIT routed → engineer.md (plain practice, NO new experiment row):** the green bar for a UI/pipeline slice must exercise the REAL artifact — (1) fully-themed LIVE axe (jsdom axe misses the house-`ACTextInput` `aria-invalid` `label-title-only`; prophylactic same-element `aria-label` on every input); (2) real-layout no-reflow (`focus({preventScroll:true})` + no scrollable ancestor above the panels); (3) a committed acceptance that BOOTS THE REAL COMPOSITION (`composeConsumer`) against a POPULATED store + drives `consume()` end-to-end (never assert pickup/parity through a mocked seam). Extends v110's live-caught→offline-pin. Recurring-class → `principle-failures/2026-07-27-offline-green-ne-live-correct-ui-pipeline.md`.
- **Board-mapping machinery fix (human "fix it", plain-practice correctness fix, already committed + folded):** `blocked` no longer falls back to In Progress (Todo/Backlog; workspace has no Blocked state), and an aggregate whose only non-terminal children are all `blocked` itself derives `blocked` (`_bubble` in work-items.py) — so a parked-on-external tree (SLC-002→CHK-001→REQ-001, on the Azure grant) drops out of the active lane in queues/stats AND the board. 107 wi-tests green, wi-validate clean.
- **EXP-115 (whole-journey live validation) POSITIVE again** (2nd cross-project confirm this window): the ROC live catches above. **EXP-117 (board-push cadence) → 2/3 POSITIVE**: terminal-only per-item pushes + 2 full-sweeps, In-Progress lane truthful, plumbing tokens low.
- **Registry:** **7 active** (unchanged; under cap-8). No new rows — the exploit is plain practice + a recurring principle-failure, not a falsifiable-DORA experiment (a fix is not an experiment). Constraint next: unchanged (external/queue); the in-system lever remains shifting live-defect classes left (measure: dev-validation failure rate should fall on the next UI/pipeline slices — SLC-ROC-015 rule-creation is the test).

## Retro 2026-07-24 (ROC) — v109 — SLC-ROC-013 close (living-demo foundation); EXP-116 ADOPTED, EXP-117 1/3

- **Trigger:** §F8 routine-batch gate (4/3 — 2 uc-reworks + CHK-ROC-008/SLC-ROC-013 slice-closes; NO incident this cycle). Clean, high-quality run → FOCUSED retro (score + fold + drain), no full ceremony.
- **Focus-Q (largest GLT contributor + strategy):** constraint UNCHANGED and confirmed NOT agent-squeezable. `registered`/`queue` = **57.76%** of GLT — but `ready` is only 0.42%, so the flow ready→pulled→done is fast; the mass is **backlog-aging** (REQ-ROC-003's forward scenario checklist + future slices sitting `registered`, a metric artifact of intentional backlog, not WIP-wait) plus **external `blocked` = 33.55%** (the Azure Service Bus device-data grant, DEF-ROC-004, being actioned by the human — outside the system). Agents combined ≈ 8.6% (engineer 5.67%, tester 2.91%). Quality excellent: CFR 3.3%, 0 build failures, rework 3.2%, both dev-rejects recovered fast. **Change budget deliberately NOT spent chasing the constraint** (constraint-gate) — no agent-capacity/tier change would move a backlog-aging + external-block constraint. WHY-CHAIN: registered-share high → because product decomposes forward backlog (12-item demo checklist) that shows on the board but isn't pulled → because REQ-ROC-003's dossier enumerates the full scenario set → the metric counts backlog-age as GLT; this is visibility, not waste. No principle-failure (intentional, low-risk).
- **EXP-116 (lean orchestration) ADOPTED — validated 2/2 on guards (registry 8→7).** 2nd scoring: guards held with zero DORA harm (product correctly ran the full new-scope gate for REQ-ROC-003; G3 held — DEF-005/006/007 all went through the defect loop; G4 strong — live-stack tester E2E ran the whole scenario suite through the real pipeline). Literal pass condition (lead-time median does not rise AND 5 guards hold) met both cycles. HONEST LIMIT: the named lead-time-REDUCTION claim stayed under-exercised (the lean-authoring trigger didn't recur). Sound load-bearing behaviour → INTEGRATED into orchestrator.md as plain practice ("Lean orchestration (guarded — plain practice)"), scaffolding removed, 5 guards intact; row archived with outcome.
- **EXP-117 (board-push cadence) → 1/3 POSITIVE.** SLC-ROC-013 close mirrored the board via per-item terminal pushes + ONE full-sweep dispatch (86 items, ~19.5k tokens total) vs the ~290k C3 baseline; terminal fidelity intact (SLC-013 + UC-054/055 all Done on Linear). Keep active.
- **Genuine new learning (NOT folded to process — kept as project artifact):** J23 living-demo DoD ("the demo GROWS — every new supported feature gets a runnable scenario") + the two-layer demo-egress isolation pattern (deny-guard + allow-list + label decorator + session registry + teardown reconciliation) are ROC-specific and already recorded (jtbd-map J23; architecture/security/demo-jira-egress.md). Not over-generalised to the global process from one project (constraint-gate + don't-revise-on-one-data-point).
- **Registry:** **7 active** (was 8; EXP-116 adopted-and-pruned). No new rows (all this cycle's changes are an adoption + a plain-practice project artifact, not falsifiable-DORA experiments). Constraint next: unchanged (registered/backlog artifact + external-blocked DEF-004); the only in-system follow-through remains IMP-023 (CI `sleep 20` readiness-poll flake) once the human adds the Dependabot secret.

## Retro 2026-07-24 (ROC) — v107 — DEF-007 resolve (prod-scoped audit gate) + dashboard/demo/setup PUSHED live

- **Trigger:** §F8 incident gate (DEF-ROC-007 resolve) + the human "push it live" thread (demo.sh + setup.sh + front-door README to the remote). Constraint UNCHANGED (registered/queue artifact + external-blocked DEF-004). CFR-relevant this window = the audit-gate CATCH (the process working, not decay).
- **DEF-007 (audit gate red on first run):** the pre-push audit found pre-existing high/critical vulns on trunk. The ONLY prod-exposed one — `fast-xml-parser` HIGH (transitive via `@azure/core-xml`) — was bumped 5.10.0→5.10.1 + verified across tiers (fresh-stack acceptance, real AIDX parsing intact). The dev-only chain (vitest/vite/esbuild + the vendored design-system's own dev tooling) is no-prod-runtime-exposure, deferred to the Dependabot drain. Human chose "fix the prod one, flag dev-only, push."
- **Gap-closing routed → cicd.md (plain practice, NO experiment row):** the audit gate's PUSH-BLOCKING condition is **PROD-RUNTIME-scoped** (`npm audit --omit=dev`), not the dev-inclusive audit — a prod-runtime high/crit blocks the push; a dev/build-only high/crit is detected+tracked (DEF-/drain, flagged no-prod-exposure) but does NOT hold a prod-clean push. Refines EXP-112. Founding: DEF-007's first gate run blocked a prod-clean, dev-only-vuln push; once fast-xml-parser was bumped, `--omit=dev` was 0 while the dev chain stayed red and correctly did not block.
- **The push (human "yes", push-hold lifted):** work/ROC pushed to origin/main (9 commits: demo.sh, setup.sh, front-door README, DEF-005 e2e spec, fast-xml-parser bump). CI run 30071192281 GREEN (Web App + Function App, no flake) + deploy-test succeeded → Web App + Function App deployed to aas-test. Dashboard + demo + setup now on the remote + deployed. Does NOT resolve DEF-004 (device-data topic subscription + Send grant for live UC-023) — still the external grant being actioned.
- **Still owed (tracked, NOT this retro's budget):** a committed prod-scoped `make audit` target (DEF-007 done-condition); the Dependabot drain (IMP-023) once the human adds the Dependabot secret — drains the dev-tooling vulns + the 5 open bump PRs; IMP-023 readiness-poll for the CI `sleep 20` flake.
- **Registry:** unchanged — **8 active** (no new experiment rows; the routed change is a plain-practice refinement of the EXP-112 audit gate). Constraint next: unchanged.

## Retro 2026-07-24 (ROC) — v106 — incident gap-closing (DEF-005/006 escaped defects) + dependabot/CI directive

- **Trigger:** §F8 incident gate (DEF-ROC-005 + DEF-ROC-006 resolves) + human directive (drain dependabot regularly; a red GitHub CI). Constraint UNCHANGED (registered/queue artifact + external-blocked DEF-004).
- **Two escaped defects, one class (cheap-check green ≠ correct where it matters):** DEF-005 — C3 changed the pipeline (`held-until`) but not the Simulator's parallel `evaluateTrace`, so the Simulator showed "Raised" for a fault the pipeline HOLDS (J21 parity regression; escaped because cross-surface parity wasn't in C3's acceptance). DEF-006 — UC-046's Playwright e2e spec passed vitest+oxlint+Playwright but broke the dashboard `tsc -b` (dom-less tsconfig), which the CI DEPLOY build runs → would have turned CI red post-push. Both fixed via the loop (engineer TDD → tester validate). Note: DEF-006's `validated` via an orchestrator ground-truth build-probe was REJECTED BY THE STATE GRAPH (validated is tester-owned) → re-done via a tester dispatch — the role boundary working as intended (a clean EXP-116/G3 data point).
- **Three gap-closing guards routed (constraint-gate: defect-preventing safety fixes):** (1) **product.md** — a behaviour change to a shared domain must UPDATE every SHIPPED mirror surface (simulator/trace/projection/report) in its acceptance (DEF-005). (2) **engineer.md** — "green" includes the FULL build graph (`tsc -b` ALL projects incl. committed e2e specs), not just unit+lint (DEF-006); cicd folds app/dashboard `npm run build` into the pre-push gate. (3) **cicd.md** — Dependabot-drain cadence (enumerate open dependabot PRs each slice-close, run the full gate, merge green, `DEF-` the failures; respect the local-only push hold — dep bumps are shared-repo maintenance) — the human directive; sibling of EXP-112 (detector + remediation).
- **CI failure diagnosed (cicd, no fix yet):** (a) main `Test` workflow (deploy-ROC.yml) RED — `Function App` job's `npm run test:acceptance` `ECONNRESET` on uc006 vs the servicebus-emulator; root fragility = a blind `sleep 20` readiness wait (preceding identical run green; merge didn't touch the test) → likely a transient FLAKE, blocking the aas-test deploy. Durable fix queued → **IMP-023** (replace blind sleep with an emulator-readiness poll in deploy-ROC.yml; cicd). (b) EVERY dependabot PR's `Web App` job fails at the design-system vendor step: `DESIGN_SYSTEM_TOKEN` is an Actions secret but NOT a Dependabot secret (GitHub withholds Actions secrets from dependabot `pull_request` runs) — config gap BLOCKING the drain; needs a HUMAN to add the Dependabot secret (a credential Claude cannot set) + a workflow path-filter fix for `src/tools/replay-injector` (2 PRs get no CI at all). Both captured in IMP-023 + surfaced to the human.
- **Recurring-class reinforcement:** the CI flake (emulator readiness) is the SAME emulator-state/readiness class as the local acceptance wire-path/fresh-stack fragility (folded to tester.md v103); the two `@covers` mismatches DEF-005/049 hit are the SAME impacted-tests-vocabulary class (IMP-021). Convergent evidence the queued fixes are worth building.
- **Registry:** unchanged — **8 active** (no new experiment rows; all routed changes are plain-practice guards + defects/improvement-slices, not falsifiable-DORA experiments). Constraint next: unchanged (registered/queue artifact + external-blocked); operational follow-through = IMP-023 (CI robustness + dependabot-CI config) once the human adds the Dependabot secret.

## Retro 2026-07-24 (AdixOut) — v105 — REQ-005 COMPLETE (full external AIDX egress, both loops); bad-state-completeness + outcome-validation folds

- **Focus-Q (largest GLT contributor + strategy):** the constraint is `queue` at **71%** —
  the ESTABLISHED multi-session/dependency ARTIFACT (human cadence + inter-item wait), NOT
  squeezable in-system, so the change budget was NOT spent chasing it (constraint-gate). The
  squeezable in-system cost is **engineer 19.5%**, dominated by the multi-tenant-eventing
  REWORK (the DEF-ADIX-003 bad-state chain + UC-025) — which the folds below target. **CFR is
  38.3% — HIGH but HONEST** (EXP-108 integrity): it reflects MANY dev-catches — the adversarial
  live/JTBD validation caught real defects in DEV before prod (the bad-state chain, the WAF XML
  false-positive, the UC-019 dynamic-key rework), the process WORKING, not decay. Constraint
  UNCHANGED.
- **REQ-005 is COMPLETE** — the full ADR-0011 external AIDX egress (pull catch-up + push webhook
  notify), 4 chunks, UC-014..026 + DEF-ADIX-003, all live + validated on dev-shared.
- **Fold A (plain practice, THE big one → engineer.md + solution-architect.md): an
  "ensure/resolve" must handle a resource in a BAD/TRANSITIONAL state, not just
  absent-vs-present.** For any idempotent provisioning ("ensure") or resource resolution against
  AWS (secrets, queues, eventing targets, per-container caches), the logic + its acceptance MUST
  enumerate the resource STATE-MACHINE, not only there-or-not-there: a secret
  SCHEDULED-FOR-DELETION → `RestoreSecret` (not treat-as-provisioned); a queue in the ~60s
  delete-recreate COOLDOWN (`QueueDeletedRecently`) → don't block the caller past its timeout,
  not-found is the real `QueueDoesNotExist`; an SQS DLQ target needs its RESOURCE POLICY not
  just to exist; a per-container key CACHE must be ROTATION-AWARE (invalidate+refetch on verify
  failure / bounded TTL); a fresh API-GW/EventBridge resource has ~60s PROPAGATION lag →
  bounded-retry. solution-architect authors the state-machine acceptance (extends EXP-109 + the
  v101 multi-tenant-completeness fold); engineer builds ensure/resolve for bad-state and prefers
  a SHARED recovery helper over per-path duplication (`recoverIfScheduledForDeletion` now
  shared). Founding chain: DEF-ADIX-003 = THREE sequential bugs in ONE offboard→reactivate flow
  (secret marked-for-deletion → DLQ cooldown timeout → stale rotation-unaware cache) + UC-025's
  three — every one a "handled absent/present but not the bad/transitional state" gap. NO
  experiment row (deterministic plain practice).
- **Fold B (plain practice → tester.md): validate the JTBD OUTCOME end-to-end, not the code
  path.** Exercise the ACTUAL user-facing outcome/JTBD live end-to-end — a code path that runs
  is not an outcome that works. DEF-ADIX-003's first "fix" reached the secret-recovery code but
  validating the real JTBD ("a reactivated customer becomes usable — authenticate + get served")
  found the customer STILL locked out by two further bugs (DLQ timeout, stale cache) a code-path
  view would miss. Sibling of the v97 assert-real-state-not-proxy + v104 self-bootstrapping-probe
  folds — the outcome-level of the same family. NO experiment row.
- **Fold C (plain practice, small → tester.md + engineer.md): probe cleanup ordering.** A
  self-bootstrapping/live probe must decide pass/fail AFTER its `finally`/cleanup block, NEVER
  call `process.exit()` from inside a `try` (Node does not unwind `finally` on `process.exit`,
  so cleanup is skipped and live ephemeral resources are orphaned). Recurred across
  UC-021/024/DEF-003 probes. NO experiment row.
- **Improvement-slice IMP-022 (QUEUED, owned by cicd/config): allowlist the live-probe make
  targets.** The AdixOut live-probe `make` targets (`onboard-auth-probe`,
  `entitlement-adjust-probe`, `probe-router-fanout`, `probe-delivery-isolation`,
  `probe-reactivation`, `probe-webhook-push`, `probe-subscription`, `probe-catchup*`, …) are NOT
  in the committed `.claude/settings.json` allowlist (only `probe-live` is), so tester runs rely
  on an unenforced prompt-bypass — validation is not reproducible headless/CI. Add a
  `make -C work/<project> probe-*` (or explicit-target) allow rule. Sibling tooling note: the
  AdixOut `impacted-tests` `@alias` vocabulary (`ROUTER`/`G_DELIV_EXT`) uses domain-tag names
  never adopted in source (specs tag `@covers UC0NN`), false-flagging covered nodes — realign
  the alias to the UC-number convention (a cheap fix; the AdixOut instance of IMP-021's class).
- **IMP-019 STILL HEALTHY (3rd confirmation).** The retro-cadence machinery held across the whole
  milestone: this retro BATCHED at the REQ-005 milestone (dev-catches accrued ROUTINE, no thrash)
  AND the DEF-ADIX-003 resolve correctly tripped its own IMMEDIATE incident — both limbs
  (milestone-batched + defect-immediate) working as designed, no prod defect after a batched
  dev-reject (CFR falsification guard held). Dated note added to IMP-019.
- **Experiment scores:** LEAN — no rows added or retired. **EXP-101 (dev-then-prod validation):**
  STRONG POSITIVE dev-first data — REQ-005 was fully validated on the real hosted dev env
  (dev-shared) across 13 UCs + a defect, the adversarial dev validation catching real defects
  before prod — but the measure does NOT yet permit adoption because prod stays deferred (the
  dev→prod PROMOTION leg has not run). Kept active (0/2) with the strong positive; dated note
  added. Main's scoring preserved as-is. Registry: **8 active** (EXP-101, 106, 107, 112, 113,
  115, 116, 117) — AT the v88 cap-8.
- **Constraint to attack next:** UNCHANGED (`queue` = artifact, not squeezable in-system). The
  squeezable in-system cost is engineer/multi-tenant-eventing rework, which the bad-state
  ensure/resolve + JTBD-outcome-validation folds directly target. Watch that CFR normalises as
  the bad-state class is closed and no prod defect follows a batched dev-reject.

## Retro 2026-07-23 (AdixOut) — v104 — REQ-005 Chunk C complete (self-service subscription); self-bootstrapping probe pattern

- **Constraint:** UNCHANGED — `queue` wait remains the dominant GLT share, the ESTABLISHED
  calendar-time/dependency ARTIFACT (multi-session human cadence + inter-item wait), not
  squeezable in-system, so the change budget was NOT spent chasing it (constraint-gate).
  REQ-005 Chunk C is COMPLETE: self-service subscription — a customer sets its active subset
  via a `FlightLegRQ` ⊆ its entitlement ceiling, and catch-up is filtered to that active subset.
- **Fold (plain practice → tester.md + engineer.md, NO experiment row): a customer-auth
  acceptance probe MUST SELF-BOOTSTRAP.** A live acceptance probe that needs customer
  authentication must be self-contained — it onboards a DEDICATED EPHEMERAL test customer with
  a fresh in-process keypair via the shared `probeBootstrap.ts` helper (generate keypair →
  onboard through the GOVERNED path → read the provisioned key IN-SCRIPT → mint the JWT), NEVER
  depending on an out-of-band key file, a key persisted across sessions, or a DIRECT interactive
  `aws secretsmanager get-secret-value` (blocked by the security guardrail — reading a secret
  INSIDE a committed probe script is fine, a direct interactive read is not). It must never
  mutate the shared synthetic customers (`-a`/`-b`) and must self-restore. engineer.md: author
  acceptance probes self-bootstrapping (reuse `probeBootstrap.ts`). tester.md: a probe that
  can't run for want of an out-of-band credential is a TOOLING gap to fix (make it
  self-bootstrap), not a silently-skipped condition — but never fabricate green. Founding
  friction: UC-ADIX-021's validation was BLOCKED because `probe-subscription` depended on an
  out-of-band key; the fix (`probeBootstrap.ts` + self-bootstrapping `synthetic-probe-*`
  customers) removed a recurring cross-session validation gap that had touched several UCs.
  Sibling of the re-apply-heals migration probe (v101) and validation-as-code.
- **Probe-pagination note (tester.md, same fold):** a probe asserting a FULL result set must
  follow pagination to EXHAUSTION — dev-shared runs `CATCHUP_PAGE_SIZE=2`, so a single-page
  compare false-fails (UC-022 probe bug). A test artifact, not a product defect.
- **IMP-019 STILL HEALTHY (2nd confirmation).** The v101 retro-cadence machinery fix batched
  Chunk C's retro CLEANLY at the chunk boundary again — the dev-catches (the UC-021
  self-bootstrap tooling gap + the UC-022 pagination probe bug) accrued ROUTINE with no
  immediate-retro thrash, and no prod defect followed a batched dev-reject (the CFR
  falsification guard held). No change needed; dated note added to IMP-019.
- **Engineer-stall → orchestrator-recovery on UC-022 (noted, NO process change).** A UC-022
  build STALLED, but its already-verified work was recovered by re-running all tiers green and
  committing — the v95 sub-step-commit lesson working. The recovery worked with the existing
  process; recorded here as a positive data point, no new rule.
- **Experiment scores:** LEAN — no rows added or retired. Main's scoring preserved as-is (this
  retro fold-forwarded main v103 FIRST — clean automatic merge, no conflicts — then bumped on
  top; main had advanced to v103 via the ROC retro, so this AdixOut retro is v104). Registry:
  **8 active** (EXP-101, 106, 107, 112, 113, 115, 116, 117) — AT the v88 cap-8.
- **Constraint to attack next:** UNCHANGED (queue = artifact, not squeezable in-system). The
  changes that landed = the self-bootstrapping acceptance-probe fold (tester.md + engineer.md)
  + the probe-pagination note. Watch that no prod defect follows a batched dev-reject (would
  falsify IMP-019).

## Retro 2026-07-23 (ROC) — v103 — C3 first slice (soak/de-bounce) delivered; EXP-116 first scoring

- **Focus Q:** constraint = `registered`/`queue` **62%** (established batch-registration + weekend-cadence ARTIFACT, not squeezable in-system) + `blocked`/`external` **31%** (DEF-ROC-004 aas-test Azure access, being actioned externally, PARKED). Engineer/`building` steady at **6%** THROUGH C3's four heavy builds (150k–230k tokens each) — the in-system working constraint is wrung out and stable. **CFR 0%, rework 0%** across the whole slice: a real collision (UC-048/049 sharing the `foldAlertState` seam) was handled by SERIALIZATION (blocked→build-048→unblock-049), and an engineer STALL (UC-049 watchdog) by re-dispatch with incremental commits (the v95 sub-step-commit lesson worked — 4 committed sub-steps) — neither became rework.
- **EXP-116 (lean-orchestration) — 1st scoring, POSITIVE (1/3):** guards held with no DORA harm; G5 improved (orchestrator-fires-all-stage-appends-with-tokens fixed the UC-046 self-append TOKENS=0 gap); G4 strong (UC-050 drove the REAL poller process, not a test). Honest limit: the primary lead-time-reduction claim is under-exercised because C3 (the bulk) correctly bypassed the lean-authoring path (new chunk → flow-manager + arch gate). Keep active.
- **EXP-109 (concurrency-acceptance authored upfront) — 2nd opp, POSITIVE → ADOPTED:** C3 is a concurrent surface (timer sweep vs clear handler); the architect authored the boundary-race/idempotency acceptance UPFRONT (delta 007 §2; AC-049-5, AC-050-6) and the tester probed it live — the race resolved to a single event-time-arbitrated terminal, 0 concurrency rework. 2/2 positive; already in force in solution-architect.md + tester.md; row archived.
- **EXP-115 (whole-journey/real-artifact validation) — POSITIVE data point:** UC-050 drove the real running poller end-to-end on real stack data, and the tester found+closed a real-store marker-non-leak gap a unit fixture had masked. Stays active.
- **Token-efficiency review (§24):** delivery tokens (engineer/tester) are real value, kept. Dominant PLUMBING cost = board projection (~290k, ~4 pushes/UC through transient states). Named reduction → **EXP-117** (push at meaningful/terminal transitions + step-5b sweep backstop). Cap-neutral vs EXP-109 adoption.
- **Recurring cross-instance finding — impacted-tests coverage vocabulary:** ROC hit it again (tester fixed project-locally via `%% @alias`; `@covers` use a `domain-/functions-/adapter-/config-` prefix the bare `.mmd` node ids never match; 4 port/interface nodes also read UNCOVERED). Main independently logged the SAME class this cycle (principle-failure `2026-07-23-uc-adix-018-impacted-tests-label-text-false-positive-nodes`). Multi-project recurring, past per-project @alias workarounds → the shared `.claude/tools/impacted-tests.js` should understand the prefixed `@covers`/label convention natively. Routed to improvement-slice **IMP-021** + reinforced the principle-failure.
- **Plain-practice fold (deterministic, NO experiment row) — acceptance wire-path testing (tester.md):** vitest runs acceptance FILES in parallel and persistent emulator state pollutes re-runs, so a 2nd SB→EH wire-path consumer races UC-006's on the shared consumer group (epoch fight → false failures). Standing practice: wire-path-sensitive acceptance specs use the DIRECT handler/sweep pattern (not a 2nd live wire-path consumer), run against a FRESH stack (local:down && up), and isolate to a dedicated table when the spec itself sweeps whole-table.
- **Board-mapping fix (this session, folded):** dev-validating/prod-validating/prod-deploying were unmapped → fell back to Backlog, mislabelling active validation; fixed in linear-project.py + linear-mapping.md.
- **Registry after:** **8 active** (EXP-101, 106, 107, 112, 113, 115, 116, 117) — EXP-109 adopted/archived, EXP-117 opened, at cap-8.
- **Constraint to attack next:** UNCHANGED — registered/queue artifact + external blocked (DEF-ROC-004 being actioned). EXP-117 is the token-plumbing exploit; EXP-116 continues under its guards.

## Retro 2026-07-23 (AdixOut) — v102 — REQ-005 Chunk B complete (governed customer lifecycle); IMP-019 validated

- **Constraint:** UNCHANGED — `queue` wait (~72.7% of GLT), the ESTABLISHED
  calendar-time/dependency ARTIFACT (multi-session human cadence + inter-item wait), not
  squeezable in-system, so the change budget was NOT spent chasing it (constraint-gate).
  REQ-005 Chunk B is COMPLETE: the governed customer lifecycle
  (onboard→auth→serve→adjust→suspend/revoke/terminate) is all live on dev-shared.
- **Fold A (plain practice → engineer.md + product.md): a UC's acceptance conditions are its
  CONTRACT — never silently dropped under a "thin/reuse" framing.** When a use-case is framed
  "thin"/"mostly reuse", the engineer STILL owes EVERY acceptance condition on the UC (plus the
  slice success-measure and the traced architecture-delta requirements). If a condition
  genuinely cannot/should not be built, the engineer ESCALATES to product/solution-architect for
  an explicit descope that REWRITES the acceptance text — never omits it and ships a partial UC
  as green; the change-graph (`.mmd`) stays consistent with the acceptance (no capability marked
  "deferred" while the acceptance still requires it). product.md: when authoring a "reuse"
  slice, make the acceptance conditions explicit and complete so "thin" cannot hide a gap.
  Founding failure: UC-ADIX-020 was built "thin" (ceiling-adjust only) and silently dropped its
  own acceptance conditions 2 & 9 (suspend/revoke/terminate) — required by the slice
  success-measure, delta 005 ("revocable — offboarding = revoke") and the J-CS-ENTITLE
  root-need; the `.mmd` even marked `offboarding-revoke` "deferred" while the acceptance still
  required it. The tester caught it at validation (the safety net worked) but it cost a rework
  cycle. Sibling of the green-build-only-as-complete-as-its-acceptance family
  (EXP-109/110/115). NO new experiment row (deterministic plain practice).
- **IMP-019 VALIDATED this cycle (worked).** The v101 retro-cadence machinery fix (a use-case
  `rejected`/`build_failed` classifies ROUTINE and batches to the threshold; the defect-resolve
  branch stays an immediate incident) did exactly its job: REQ-005 Chunk B's UC-019/020
  dev-rejects were batched and the retro batched CLEANLY at the chunk boundary instead of
  thrashing an immediate full retro per dev-catch. No prod defect appeared after a batched
  dev-reject (the CFR falsification guard held). Dated note added to IMP-019.
- **Fold B (plain practice, small → work-items SKILL.md): note-quoting extends to backticks /
  `$(…)`.** Extended the existing `wi-append` NOTE-quoting note: SINGLE-QUOTE `NOTE='…'` AND
  avoid backticks, `$(…)` command-substitution, and commas in the note text — a backtick/`$(…)`
  in a double-quoted note is shell-command-substituted (mangling/executing), and commas can
  truncate. Caller hazard, not a machinery bug. principle-failure
  `2026-07-23-wi-append-note-backtick-command-substitution-mangled-evidence.md`.
- **Improvement-slice IMP-020 (QUEUED, owned by cicd): CI bundle-freshness guard.** Recurring
  OI-BUNDLE-DRIFT: committed `infra/assets/*.mjs` deploy bundles go stale vs their `src/app`
  source (UC-ADIX-020 commit `6a1c88a` carried a stale bundle → an incidental later commit
  regenerated it → a mid-validation CI auto-redeploy `6a1c88a`→`9212c9d`; no functional impact
  since `deploy-sst` re-bundles fresh, but a confusing deploy-identity shift + git-hygiene gap).
  Proposed: a `build-and-test` CI check / `make` target that rebuilds bundles and FAILS if the
  committed `.mjs` differ from a fresh `make bundle-all`, catching a stale bundle at push not by
  luck. Also flags the sibling `make render-diagrams` gap (documenter-flagged) — both are
  project-level cicd-capability gaps. Target metric: fewer confusing deploy-identity shifts /
  CFR-noise from bundle drift.
- **Experiment scores:** no experiment rows added or retired. Main's scoring preserved as-is.
  Registry: **8 active** (EXP-101, 106, 107, 109, 112, 113, 115, 116) — AT the v88 cap-8.
- **Constraint to attack next:** UNCHANGED (queue = artifact, not squeezable in-system). The
  changes that landed = the acceptance-is-the-contract fold (engineer.md + product.md), the
  note-quoting extension (work-items SKILL.md), and improvement-slice IMP-020. Watch that no
  prod defect follows a batched dev-reject (would falsify IMP-019).

## Retro 2026-07-23 (AdixOut) — v101 — REQ-005 Chunk B (dynamic multi-tenant onboarding; IMP-019 retro-cadence fix landed)

- **Constraint:** UNCHANGED — `queue` wait remains the dominant GLT share, the ESTABLISHED
  calendar-time/dependency ARTIFACT (multi-session human cadence + inter-item wait), not
  squeezable in-system, so the change budget was NOT spent chasing it (constraint-gate). CFR
  is elevated this window by the HONESTLY-recorded dev-catches (EXP-108 integrity): REQ-005
  Chunk B's UC-ADIX-019 (dynamic per-customer auth) took **3 dev-validation rework cycles**,
  each an adversarial-e2e dev-catch fixed BEFORE prod (static→dynamic API-GW key, then
  new-customer-only→pre-existing-row self-heal) — the process WORKING (XP/TDD/dev-first), not
  quality decay.
- **IMP-019 IMPLEMENTED (the centerpiece — a shared-machinery change).** The §F8 retro-debt
  gate (`compute_retro_debt` in `work-items.py`) treated ANY use-case `rejected`/`build_failed`
  as an immediate-trip incident, so a dev-validation reject that is fixed + re-validated within
  the same slice forced an immediate full retro (+ cross-instance reconciliation) — the thrash
  IMP-019 targets (a reject trips an immediate retro). CHANGED: a use-case `rejected`/
  `build_failed` is now classified **routine** (`uc-rework`, batches to the threshold), NOT an
  immediate incident; the `defect`-resolve branch stays an immediate incident (a defect against
  SHIPPED work is a real escape). `due = routine>=threshold OR incidents>=1` unchanged — so
  accumulated dev-rework still triggers a BATCHED retro at the threshold and a real defect still
  fires immediately. Module cadence comment updated; machinery self-tests extended and GREEN
  (uc-reject→routine, reject-then-validated→routine, rework-batches-to-threshold, build_failed
  →routine; defect-resolve still immediate-incident — 107 tests OK). IMP-019 marked IMPLEMENTED
  at v101.
- **One plain-practice fold (deterministic → NO experiment row): multi-tenant provisioning
  completeness → solution-architect.md + tester.md.** For a multi-tenant onboarding/provisioning
  surface, the acceptance MUST enumerate the FULL set of per-customer resources required for the
  customer to be served and require onboarding to ensure ALL of them idempotently
  (create-if-absent), INCLUDING self-healing a customer whose record PREDATES a later-added
  resource (the migration case) — not just the happy-path new-onboard. Founding failure:
  UC-ADIX-019 took 3 cycles because the per-customer resource set (EntitlementStore row,
  Secrets-Manager JWT key, dynamic key resolution, API-Gateway API-key, usage-plan association)
  was discovered incrementally and the fingerprint idempotency short-circuit skipped ensuring
  resources for pre-existing rows. solution-architect enumerates the per-customer resource set +
  the self-heal/migration acceptance; tester exercises re-apply-heals-a-pre-existing-customer.
  Sibling of EXP-109 (concurrency/idempotency) — extends it to resource-set-completeness +
  migration.
- **Operational note (project/consumer-doc item, NOT a process change):** API-Gateway API-key
  propagation takes ~60s after association before a new customer's key authorizes — flagged for
  the PROJECT docs (consumer onboarding guidance), not folded into the process layer.
- **Experiment scores (light):** EXP-109 got a HEAVY WORKOUT this cycle — the concurrency
  handling HELD (no last-writer-wins/regression class), and the resource-set-completeness +
  migration-heal gap is a newly-surfaced SIBLING now covered by the plain-practice fold above
  (dated note added to EXP-109; NO new experiment row forced). Main's v100 scoring preserved
  as-is. Registry after fold-forward from main v100: **8 active** (EXP-101, 106, 107, 109, 112,
  113, 115, 116) — AT the v88 cap-8; no rows added or retired this retro.
- **Constraint to attack next:** UNCHANGED (queue = artifact, not squeezable in-system). The
  changes that landed = the IMP-019 retro-cadence machinery fix (dev-rejects batch, defects
  immediate — targeting retro-trigger frequency / reconciliation overhead per delivered UC) +
  the multi-tenant provisioning-completeness fold. Watch that no prod defect appears after a
  batched dev-reject (that would falsify IMP-019).

## Retro 2026-07-23 (ROC) — v100 — SLC-ROC-010 close (rule-coverage visibility); process-adherence self-assessment

- **Focus Q:** largest GLT contributor + strategy. **Answer:** top share is `registered`/`queue`
  at **65.3%** — the ESTABLISHED batch-registration + weekend human-session-cadence ARTIFACT
  (front-loaded UC registration at decomposition), not squeezable in-system, so the change
  budget was NOT spent chasing it directly. Next is `blocked`/`external` **28.2%** = DEF-ROC-004
  (aas-test Azure access gap), genuinely external and correctly PARKED as decision debt. The
  in-system working constraint — engineer/`building` — **fell 25.6%→6.4%** this cycle (many
  small fast local UI UCs), so it is largely wrung out. CFR 0%, rework 0%, MTTR 226s.
- **Process-adherence self-assessment (the user's question):** the ROC loop used the real
  substrate + specialist agents + gates (discovery/product/architect/ui-designer/cicd/engineer/
  tester/linear/documenter; wi-validate/retro-debt/foldback; defect flow), BUT ran LEANER than
  the letter of §F — the orchestrator authored obvious decomposition-gap UCs itself and
  centralised bookkeeping. The user authorised validating this pragmatism AS AN EXPERIMENT →
  registered **EXP-116** (guarded). Two honest negatives folded in: (a) token-coverage regressed
  (→ EXP-103 killed, mechanism kept as EXP-116 G5); (b) live-stack E2E only happened after the
  user demanded it → now EXP-116 G4 (mandatory per UI/pipeline slice) + memory `roc-local-e2e-validation`.
- **Fold-forward correction:** this loop had been running on STALE process (v89) while main was
  at v99 (51 commits behind) — the exact `2026-07-16-loop-ran-on-stale-process` failure. Fixed by
  a clean fold-forward to v99 BEFORE this retro's bump (EXP-113's STEP-0 precondition is meant to
  prevent this at loop-start; it had not yet landed in this tree — now it has via the fold).
- **Experiment scores:** **EXP-103 →KILLED** (token-coverage: OFS 1st +, AdixOut mixed/regressed,
  ROC NEGATIVE 50%→19.5% — 3 scoring opportunities, target >80% never reached; mechanism sound
  but operator-discipline-dependent, folded as EXP-116 G5; archived with outcome). **EXP-114
  →physically pruned** (already ADOPTED at main's v98; row was stale-in-table, archived). Others
  no ROC scoring opportunity (EXP-101/107 need cloud/infra — Azure parked; EXP-106 no CORE-partial
  slice; EXP-109 no concurrent surface; EXP-112 npm audit unexercised; EXP-113 landed via this
  fold; EXP-115 covered by EXP-116 G4). Registry after: **8 active** (EXP-101, 106, 107, 109, 112,
  113, 115, 116) — AT the cap-8.
- **Constraint to attack next:** `registered`/`queue` (artifact) — EXP-116 is the exploit move
  (orchestrator authoring obvious decomposition-gap UCs cuts registration latency); watch it does
  not breach a guard while doing so. Engineer/building is wrung out; DEF-ROC-004 stays external.

## Retro 2026-07-22 (AdixOut) — v99 — REQ-005 Chunk A close (WAF XML-body false-positive; retro-cadence thrash)

- **Constraint:** UNCHANGED — `queue` wait remains the dominant GLT share (72.9%), the
  ESTABLISHED calendar-time/dependency ARTIFACT (multi-session human cadence + inter-item
  wait), not squeezable in-system, so the change budget was NOT spent chasing it
  (constraint-gate). CFR is elevated this window — but that is the HONESTLY-recorded
  dev-catches (EXP-108 integrity), which are the process WORKING (XP/TDD/dev-first catching
  defects before prod), NOT quality decay.
- **Two plain-practice folds (deterministic → NO experiment rows) + one improvement-slice:**
  - **Fold A — tester.md + solution-architect.md: edge-protection acceptance exercises a REAL
    representative payload.** When a slice adds/relies on an edge protection (WAF managed
    rules, body inspection, schema/size limits) in front of an endpoint, its acceptance MUST
    be exercised with a REAL representative request body (e.g. an actual AIDX XML
    `FlightLegRQ`), not empty-body/query-param/happy-path probes. Founding failure:
    UC-ADIX-016's WAF was validated only with query-param/empty-body requests, so
    `AWSManagedRulesCommonRuleSet`'s `CrossSiteScripting_BODY` silently BLOCKED every real
    AIDX XML body — invisible until UC-ADIX-017 sent one (an escaped edge false-positive that
    would have blocked the real consumer in prod). solution-architect authors the real-payload
    edge condition; tester exercises it. Sibling of "assert real state not proxy" (v97) +
    the concurrency-acceptance family (EXP-109).
  - **Fold B — aws-architecture skill: managed-WAF body rules false-positive on XML-body
    APIs.** `AWSManagedRulesCommonRuleSet` body sub-rules `CrossSiteScripting_BODY` (XML tag
    structure reads as XSS) and `GenericRFI_BODY` (namespace URIs `http://…`/`urn:…` → `://`
    reads as RFI) BLOCK well-formed XML request bodies. For any XML-body endpoint, PLAN UPFRONT
    a scoped `ruleActionOverrides` setting those sub-rules to `count` (never `allow`) on that
    route, WITH compensating controls (schema/XSD validation + auth + entitlement + keep every
    other CRS rule and SSRF blocking); route-scope the WebACL. This WEAKENS a managed control →
    human-approval security-posture decision. Cited AdixOut UC-ADIX-017 (human-approved
    2026-07-22).
  - **Meta-finding → IMP-019 (improvement-slice, NOT done inline).** The §F8 retro-debt gate
    treats ANY `rejected` as an immediate-trip incident, so a dev-validation reject FIXED and
    re-validated green within the same slice forces an immediate full retro (+ cross-instance
    reconciliation) — 3 retros in one AdixOut drain, largely from dev-catches (the process
    WORKING, not incidents). Proposed machinery change: a `rejected` followed by a `validated`
    on the SAME item before the debt check batches as ROUTINE (learning still captured at the
    batched retro); only `deploy_failed` and PROD `DEF-` resolves trip immediately; unresolved
    or repeated rejects still count. Highest-leverage fix for the thrash, DEFERRED to a tested
    machinery change (has self-tests), not done under time pressure. Target: retro-trigger
    frequency / GLT overhead per delivered UC, WITHOUT letting a real regression escape (a prod
    defect after a batched dev-reject would falsify).
- **Experiment scores:** LEAN — no new rows, no forced re-scoring. Dated notes added below to
  EXP-101 (dev-first: the WAF false-positive was CAUGHT IN DEV, a genuine dev-first positive)
  and EXP-109 (sibling family of the edge-payload fold). Registry after reconciling with main
  (v98): **8 active** (EXP-101, 103, 106, 107, 109, 112, 113, 115) — back AT the v88 cap-8 (EXP-114
  ADOPTED at main's v98 OFS retro is no longer active). Cross-instance-additions note: EXP-114/115
  arrived from OFS's parallel retros; EXP-114 has since adopted, leaving the registry at cap.
- **Constraint to attack next:** UNCHANGED (queue = artifact, not squeezable in-system). The
  exploit that landed = real-payload edge-protection acceptance (Fold A) + the WAF-XML gotcha
  doc (Fold B), closing an escaped edge false-positive class; IMP-019 targets the retro-cadence
  thrash. Watch that CFR normalises as dev-catches taper, confirming the elevation was
  honest-recording, not decay.

## Retro 2026-07-22 (AdixOut) — v97 — REQ-005 Chunk A (external AIDX delivery foundation on dev-shared)

- **Focus Q:** largest GLT contributor + strategy. **Answer:** `queue` wait remains the
  top GLT share — the ESTABLISHED calendar-time/dependency ARTIFACT (multi-session human
  cadence + inter-item wait), not squeezable in-system, so the change budget was NOT spent
  chasing it (constraint-gate). The real signal this cycle is a QUALITY regression: **CFR
  spiked 12.5%→28%**, ALL of it at the **deploy→validate boundary**, one root-cause family.
  Why-chain (≥3 levels): 3 real failures surfaced only at CI/live (UC-014 iam:CreateRole
  least-priv gap; UC-016 WAFv2 description-charset ValidationException; UC-016/DEF-ADIX-002
  SST `$transform` no-op on the ApiGatewayV1 Stage) → because the cheap local gates
  (unit/lint/`sst diff`/synth-pin) run against MOCKS/PLANS, not the real AWS control plane
  → because a synth plan is not authoritative for apply-time effects (`sst diff` even
  FALSELY showed the Stage tag applying) → so real-control-plane failures (least-priv IAM,
  service-API validation, child-construction-order) are structurally invisible to pre-push
  assurance. PLUS an escaped false-green: UC-014's AC7 was validated against a response
  HEADER proxy, not the real resource tags (→ DEF-ADIX-002). **Root cause = cheap-proxy
  assurance standing in for real-world state.** EXP-108 worked: CFR is HONESTLY 28%, not a
  false 0%.
- **Five plain-practice folds (deterministic → NO experiment rows):**
  (a) **tester.md — assert REAL deployed resource state, never a proxy** (read the live
  resource config, e.g. `aws apigateway get-tags`, not a response header or a synth/`sst
  diff` plan; a synth plan is NOT authoritative for apply-time effects). Founding escape:
  UC-014 AC7 false-green → DEF-ADIX-002.
  (b) **tester.md — scope a re-validation to the DELTA + a light regression smoke**, not a
  full expensive campaign re-run (a 360s sustained-WAF + burst-cooldown loop stalled a
  tester this cycle).
  (c) **aws-architecture skill — SST v3 child-resource customization gotcha**: tag/customize
  a component's CHILD (e.g. `sst.aws.ApiGatewayV1`'s Stage) via the component's
  construction-time `transform.<child>` PROP, NOT a global `$transform` (child resources
  inherit only transforms registered before the parent is constructed → a global
  `$transform` is a permanent no-op; bit 2 rework cycles on UC-ADIX-016).
  (d) **loop-run.md + cicd.md — deployed-event ownership under pipeline (push→CI) deploys**:
  no agent fires `deployed` automatically, so the ORCHESTRATOR fires the CI-confirmed
  `deployed` (AGENT=cicd, REF=<sha>, NOTE citing the green CI run) after confirming the
  pipeline deploy landed green; engineers/testers must not spoof AGENT=cicd. Founding:
  `2026-07-22-uc-adix-015-missing-cicd-deployed-event-blocks-tester.md`. Queued **IMP-018**
  (the CI pipeline emits the `deployed` event itself, retiring the orchestrator step).
  (e) **work-items skill — SINGLE-QUOTE `make wi-append NOTE='…'`**: a `$`-sequence in a
  double-quoted note is shell-expanded and silently mangled (`$transform`→`ransform`); a
  caller hazard, not a machinery bug. Founding:
  `2026-07-22-wi-append-note-dollar-expansion-mangled-evidence.md`.
- **Experiment scores:** **EXP-108 →3/3 VALIDATED/ADOPTED** (3 deploy failures in one cycle,
  each a recorded `deploy_failed`, CFR honestly 28%; rule already plain practice in
  cicd.md+engineer.md; row MOVED to experiments-archive.md). **EXP-107 →NEGATIVE/BOUNDARY**
  (local synth caught none of the 3 real-control-plane failures and `sst diff` lied about the
  Stage tag; NOT killed — cheap `sst diff` still worth it — but its value is subordinate to
  EXP-108 + the live-verify practice 1a; measure must not claim the real-control-plane class).
  **EXP-101 →PARTIAL POSITIVE** (first REAL hosted-dev validation on dev-shared; dev→prod
  promotion leg deferred with prod). EXP-103/106/109 no scoring opportunity; EXP-112 light
  positive (`make audit` ran in CI every push, 0 vulns); EXP-113 did not fire (loop predated
  v113 in this tree). Registry after reconciling with main (v96): EXP-108 archived → **9
  active** (EXP-101, 103, 106, 107, 109, 112, 113, 114, 115). This is **1 over the v88 hard
  cap-8**: EXP-114/115 (OFS's painted-pixel-a11y + whole-journey-validation rows) landed on
  main AFTER AdixOut's v93 registry trim, so they arrive via cross-instance parallel additions
  — NOT killed (a validly-open cross-instance experiment is worth more than hitting the number),
  to be reconciled back to ≤8 at the next retro.
- **Constraint to attack next:** UNCHANGED — the queue-wait remains the established
  calendar-time/dependency artifact (not squeezable in-system). The EXPLOIT that landed this
  cycle = **live-real-state verification** (assert the deployed resource, not a proxy) + the
  **SST child-transform gotcha doc**, targeting CFR back DOWN from 28% toward its prior band.
  Watch the deploy→validate boundary next cycle to confirm the cheap-proxy class is closed.

## Retro 2026-07-16 (AdixOut) — REQ-003 AIDX conformance-completeness (ELDT/EIBT/TKO)

- **Focus Q:** largest GLT contributor + strategy. **Answer:** `queue` wait stays the
  top share (~75% of GLT) but is the ESTABLISHED calendar-time/dependency ARTIFACT
  (multi-session human cadence + inter-item wait) — not squeezable in-system, so the
  change budget was NOT spent chasing it (constraint-gate). The real in-system exploit
  target is the tester stage + impacted-tests waste. The in-system WORKING constraint
  (engineer) was wrung further: rework down to **0.58%**, lead-time median
  **1284→1053s**, and ZERO real rework this cycle — the two dev-validating events were
  tester-SELF-CORRECTED stale probe assertions (test artifacts, not product defects),
  not deploy-failures.
- **Two new plain-practice fixes (deterministic → NO experiment rows):**
  (1) **tester probe-tuple-matching** — a probe/acceptance assertion on an AIDX
  `OperationTime` (or any code+qualifier element) matches the FULL
  `(OperationQualifier, TimeType)` tuple, never a bare-qualifier substring, so a new
  EST twin cannot false-fail an ACT assertion (recurring 3x; principle-failure
  2026-07-16-probe-assertion-untimescoped-substring-recurring). (2) **engineer
  mark-changed-node** — a behaviour change to a modelled `.mmd` node marks it
  `:::changed` in the SAME commit, so `make impacted-tests` reports it IMPACTED and
  does not false-clean (principle-failure 2026-07-16-uc-adix-013-changed-node-not-marked).
- **Scores:** **EXP-100 →3/3 ADOPTED** (ToC walk; in-system constraint share fell
  engineer 19.4%→17.1%, rework→0.58%). **EXP-110 →3/3 ADOPTED** (all-tier counts incl.
  Docker local on UC-011/012/013, 0 silent skips). **EXP-111 →3/3 ADOPTED** (3 deploys
  0.11.0/0.12.0/0.13.0 GitCommit==HEAD off clean tree, stream-drained). **EXP-102
  archived** (already ADOPTED 2026-07-13; row physically moved). **EXP-104 →ADOPTED**
  (the nested-repo git-root fix `resolveDiffRoot` shipped with 22 self-tests and is in
  force; the residual UC-013 false-clean was NOT the tool but an unmarked changed node,
  now covered by the engineer mark-changed-node plain-practice added this retro).
  **old-EXP-105 KILLED** (0/3, load/replace stale-prior-state — no applicable slice
  across v83/ROC/OFS/AdixOut; re-open if a UI load/replace surface arises). EXP-103
  MIXED (coverage regressed ~50%→~43%), EXP-106/107/108/109/112 no-opportunity.
  Registry trimmed 13→**8 active** (cap = 8): EXP-101, 103, 106, 107, 108, 109, 112,
  113.
- **Reconciliation with main v92 (OFS retro):** merged main (v92) into this retro and
  bumped to **v93**. Adopted EXP-100/102/104/110/111 (archived with outcomes), killed
  old-EXP-105 (load/replace), and RENUMBERED OFS's new "loop-run STEP 0 freshness
  precondition" row from its clashing EXP-105 to **EXP-113** (next free number). Final
  active set is exactly 8: EXP-101, 103, 106, 107, 108, 109, 112, 113.
- **Constraint to attack next:** UNCHANGED — the queue-wait remains the established
  calendar-time/dependency artifact (not squeezable); the in-system engineer/tester
  waste continues to be squeezed (impacted-tests false-clean + stale-probe artifacts
  are the residual targets, both addressed by the two plain-practice fixes this retro).

## Retro 2026-07-13 (AdixOut) — DEF-ADIX-001 incident + REQ-002 close

- **Focus Q:** largest GLT contributor + strategy. **Answer:** `queue` wait stays the top share (73.6%: ready 45.3% + registered 28.3%), but n=7 over a 3-day multi-session window makes it calendar-time-dominated (spend-limit pause + human gaps + a compaction), so it is DIRECTIONAL not a capacity signal — the change budget was NOT spent chasing it (constraint-gate). The squeezable in-system constraint is the engineer stage (19.4%), and its REWORK is now down to 0.68% (was 33% rework-rate last retro) — a real improvement: REQ-002's UC-007/008 both passed first validation with **zero rework**, and lead-time median fell 3022→2000→**1284s** across the session. EXPLOIT that produced it: EXP-109 (concurrency-acceptance authored upfront) landed and paid off on its first concurrent surface (UC-008) — no repeat of the UC-006 race. So the exploit is working; keep scoring it.
- **Incident (forced this retro):** DEF-ADIX-001 — dep vulns accumulated to CRITICAL with no audit signal in the loop. Gap-closing change = **EXP-112 dependency-audit gate** (cicd.md + `make audit`), a genuine safety fix (constraint-gate exception). principle-failure logged.
- **Scores:** EXP-109 →1/2 POSITIVE (exploit worked first time). EXP-110 →2/3 POSITIVE (all tiers run every item). EXP-111 →2/3 POSITIVE (0.7.0/0.8.0 GitCommit==HEAD, clean-tree held). **EXP-102 →3/3 ADOPTED** (defect-vs-rework fork: DEF-ADIX-001 correctly a DEF- not rework; behaviour already plain practice in §3+tester.md; row retired from active — cap-neutral with EXP-112's open).
- **Constraint to attack next:** unchanged (engineer stage / build time), but rework is largely wrung out; the remaining engineer share is mostly irreducible build work. Watch whether EXP-112's audit gate adds meaningful push-gate latency (it should be seconds); watch EXP-109 to its 2nd concurrent-surface opportunity.

- **EXP-099 (deploy as a first-class `cicd`-owned stage)** — POSITIVE data point (1/2). AdixOut produced REAL `deployed` events (not migration-synthesised): UC-ADIX-006 was deployed by `cicd` twice, and `views/stats.md` now shows `deploying` as its own state at 2.22% GLT attributed to `cicd`, distinct from the engineer's `building` span (18.73%). Deploy latency is visible and attributable exactly as intended. Remains `active` — horizon is 2 projects with real deploy events.
- **EXP-100 (walk the full ToC loop)** — POSITIVE data point (1/3). This retro walked exploit→subordinate→elevate (not identify-only): named the constraint (engineer rework / `queue` wait with the calendar-time confound called out), took the EXPLOIT move (remove the rework at source via EXP-109 concurrency acceptance), noted the SUBORDINATE lever (the `registered` 28.7% inventory) but deferred it as confounded rather than spend budget off-constraint, opened a `principle-failures/` entry for the recurring root cause, and gated the change-set on the constraint. Remains `active`.
- **EXP-102 (defect-vs-rework fork)** — POSITIVE data point (2nd opp → 2/3; main scored the 1st at v83), limb (b). The tester's UC-ADIX-006 concurrency failure was correctly classified as `rejected` (rework on the UC under validation, a deploy-failure, no `DEF-` raised) — not conflated into a defect against shipped work. CFR counted it as a deploy-failure per §3, MTTR tracked the validation-rejection recovery (2434 s median). 0 misclassifications this cycle. Remains `active`.
- **EXP-101 (dev-then-prod validation)** — N/A this cycle (no scoring data): AdixOut is sandbox/local-only for the live-bus slice (the `dev-shared` bus is not yet live), so UC-ADIX-006 took the documented local-only collapse (`validated` fired straight from `dev-validating`, dev==prod). Not a violation — the collapse case is explicitly in-scope. No cloud/hosted dev→prod promotion occurred to score.
