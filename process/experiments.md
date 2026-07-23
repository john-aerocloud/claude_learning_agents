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
| EXP-101 | v82 (2026-07-06) | process-current.md §11b + §F5a + tester.md (dev-then-prod validation) + cicd.md (deploy-to-dev then deploy-to-prod) | **Problem:** §F5a referenced a "dev acceptance stage" that was a PHANTOM — no such state existed in the use-case graph; the actual path (`building → deploying → validating → done`) validated ONLY in prod, so a broken change was first observed by real customers in production instead of being caught in dev first. This violates the vital "dev-first, acceptance before prod" principle: there was no de-risking dev validation before the prod deploy, so every validation failure was a prod CFR hit rather than a contained dev-stage catch. **Solution:** the locked dev→prod path `deploying(deploy-to-dev) → dev-validating --dev_validated(tester)--> prod-deploying --promoted(cicd)--> prod-validating --validated(tester)--> done` — cicd deploys to DEV (`deployed`), the tester dev-validates against the ORIGINAL FROZEN acceptance.md (the dev-validation oracle) and fires `dev_validated`, which AUTOMATICALLY (no human gate — an automated promotion assurance like §F5a infra auto-approve) triggers cicd's prod deploy (`promoted`), then the tester prod-validates (`validated`). Local-only projects collapse dev==prod (validate straight from `dev-validating`). | CFR (a defect is caught in the dev-validation stage BEFORE it reaches prod, so it is a contained dev catch, not a prod deploy-failure) + MTTR (a dev-stage catch has no prod-blast recovery) | over the next 2 cloud/hosted slices, every UC is dev-validated against the frozen acceptance.md BEFORE the prod deploy AND ≥1 validation failure is caught at `dev-validating` (a `rejected` from dev, no prod impact) with 0 rejected-in-prod that a dev-validation would have caught; if a UC reaches prod-validating without a passing dev-validation, or a prod deploy-failure occurs that the frozen dev-oracle would have caught, FAILED | 2 cloud/hosted slices (or 3 retros) | active (0/2) | applies-to: any cloud/hosted (non-local-only) slice whose UCs deploy. Depends on the state-graph amendment (dev-validating/prod-deploying/prod-validating states, owned by a parallel agent). Honours the user's "dev-first, acceptance before prod" principle. Distinct from EXP-091 (tester-validates-in-prod safety net still stands — this ADDS the dev-first validation ahead of it) and EXP-099 (deploy as a first-class cicd-owned stage — this splits it into dev+prod legs). ‖ AdixOut retro (REQ-003, 2026-07-16): still 0 real opportunity — REQ-003 was AdixOut sandbox-only (no cloud dev→prod promotion). Kept — first real opportunity expected on the dev-shared/prod-shared bus ingestion thread (imminent), which WILL be its first real cloud dev→prod opportunity. ‖ AdixOut v94 retro (2026-07-22): PARTIAL POSITIVE / FIRST real opportunity — REQ-005 Chunk A deployed to a REAL hosted dev env (dev-shared) and was dev-validated THERE, the first non-local dev validation (the local-only collapse no longer applies). BUT prod is DEFERRED for REQ-005, so the dev→prod PROMOTION leg did not run — `validated` fired directly from `dev-validating` (deferred-prod collapse). Dev-first validation on real infra is now DEMONSTRATED; the full dev→prod promotion still awaits a prod-in-scope slice. Stays active. ‖ AdixOut v99 retro (2026-07-22): POSITIVE data point — the WAF XML-body false-positive (UC-ADIX-017) was CAUGHT IN DEV validation and fixed in rework before any prod exposure, exactly the dev-first containment this experiment is for. Prod promotion leg still deferred for REQ-005, so no dev→prod promotion to score; stays active (0/2). |
| EXP-106 | v84 (2026-07-11) | process-current.md §12d + product.md + tester.md + documenter.md | **Problem:** an aggregate's `done` folds structurally (all children `done`), with NO linkage to the job's success measure or persona — so a slice can be `done` while its CORE job is undelivered, and the undelivered remainder can fall off the backlog silently. SLC-030 (`job: J0` CORE, "live delivery to consumers") was marked `done` having built the bus SAME-ACCOUNT only; the cross-account CORE remainder was registered nowhere, `items/active/` read empty ("CORE-DELIVERED"), and the pull-vs-push delivery-model inversion then propagated into the consumer-facing skill. CFR read 0.0% and rework 0.0% the whole time — the metrics were blind to an escaped requirement-level defect. Same class as the presence-not-correctness / false-green / actual-docs-incoherent failures (2026-06-23/25). **Solution:** §12d — a CORE-`job` aggregate is "done-in-fact" only when acceptance is validated against that job's success measure for the named persona(s) (product anchors it, tester validates against it); and a deliberately-partial CORE slice MUST register its undelivered remainder as a tracked item before it closes (flow-manager confirms), so a CORE job never leaves `items/active/` empty while unfulfilled. Plus: consumer-facing docs/skills state their "primary path" by tracing to the authoritative delivery model, never a peer/derived doc (documenter). | CFR (escaped requirement-level defects — a CORE job marked done-but-undelivered — are caught at close instead of read as 0% success) + MTTR (the gap is caught at slice-close, not discovered cycles later) | over the next 3 CORE-job slices: every slice carrying a CORE job is validated against that job's success measure + persona at close, AND any deliberately-partial CORE slice has its remainder registered as a tracked item BEFORE it closes (0 CORE jobs left with an empty active backlog while unfulfilled); if a CORE slice closes `done` without a job-success-measure validation, or a partial CORE slice closes with its remainder untracked, FAILED | 3 CORE-job slices (or 3 retros) | active (1/3) | ROC retro (1st opp): NEGATIVE — the gap §12d/EXP-106 exists to prevent RECURRED on a third project. `CHK-ROC-001` (CORE job J1, done-condition "one **real** Jira PPSM Alert ticket end to end") folded to `done` on its LOCAL child (`SLC-ROC-001`, fake Jira adapter); the real-delivery remainder (`SLC-ROC-002`) was never registered — it lived only as a `chunk-plan.md` forecast — so `REQ-ROC-001` read `done` and CFR/rework read 0.0%, blind to it. Root cause = the gate is TEXT enforced by operator memory, not mechanical. Remedy applied this retro: registered `SLC-ROC-002` (CHK-ROC-001 reverted done→in_progress, REQ→in_progress) + opened principle-failure 2026-07-12-roc-core-slice-local-only + queued **IMP-011** (a `wi-validate` I5 invariant that fails a CORE aggregate reaching `done` without a job-success validation OR a registered remainder). IMP-011 is the enforcement half — score it here. applies-to: every slice/chunk carrying a CORE `job`. Founding failure: principle-failures/2026-07-11-core-slice-false-done-and-delivery-model-inversion. Distinct from EXP-101 (dev-first validation — WHERE a UC is validated) and EXP-102 (defect-vs-rework fork + findings→requirement loop — this USED EXP-102's V5a to register REQ-XACCT-PUSH); EXP-106 governs WHETHER an aggregate's `done` means its CORE job is delivered. ‖ AdixOut retro (REQ-003, 2026-07-16): light POSITIVE / no-regression — no CORE-PARTIAL slice this cycle, so no untracked-remainder risk arose. REQ-003 FULLY delivered its core job J-ACDM-PREDICT and was validated against the success measure at close (no false-done). No opportunity to score the partial-remainder limb; the done-in-fact limb held. Stays active (1/3). ‖ AdixOut v94 retro (2026-07-22): no scoring opportunity this cycle (no CORE-partial slice; no untracked-remainder risk arose). Stays active (1/3). |
| EXP-107 | v86 (2026-07-12) | process-current.md §14 + engineer.md (infra-bearing push gate) | **Problem:** the push-on-green done-condition was unit + lint only. For infra-bearing changes (`sst.config.ts`/`infra/`/IaC/deploy-role policy) CI auto-deploys, so green-locally-on-unit-lint is NOT the green CI enforces — an infra statement that passed offline shape-tests was rejected at the AWS API on deploy (EventBridge `PutPermission` invalid-principal), turning the shared infra CI pipeline red (UC-XA2 first push ec56025), fixed forward at 76a7e58. Same "green in the cheap check ≠ correct where it matters" family as v84 / the 2026-06-23 false-green class. **Solution:** infra-bearing push gate — a change touching sst.config.ts/infra/IaC/deploy-role policy is not push-green on unit+lint alone; the pre-push done-condition MUST include `make deploy-sst` (or `sst diff`/synth) passing locally before push. Routed to process-current.md §14 (cross-agent) + engineer.md (woven into push-when-done). | CFR (infra deploy-failures caught pre-push instead of turning CI red post-push) | over the next 3 infra-bearing pushes: each runs the synth/deploy gate BEFORE push and 0 turn the infra CI pipeline red for a cause the local synth/deploy would have surfaced; if an infra push goes red in CI for a synth/deploy-detectable cause, FAILED | 3 infra-bearing pushes (or 3 retros) | active (0/3) | applies-to: any push touching sst.config.ts/infra/IaC/deploy-role policy. Founding incident: principle-failures/2026-07-12-infra-pushed-green-locally-red-in-ci. Sibling of EXP-101 (dev-first validation) — this is the pre-PUSH analog (catch the deploy failure before it reaches CI at all). ‖ AdixOut retro (REQ-003, 2026-07-16): no opportunity — REQ-003 was domain-mapping only, no IaC/sst.config.ts/deploy-role touched, so no infra-bearing push occurred. Stays active (0/3). ‖ AdixOut v94 retro (2026-07-22): NEGATIVE/BOUNDARY — REQ-005 Chunk A had 3 infra-bearing changes and the local synth/`sst diff` gate did NOT catch any of the 3 real deploy failures (UC-014 iam:CreateRole least-priv gap; UC-016 WAFv2 description-charset ValidationException; UC-016/DEF-ADIX-002 SST `$transform` no-op on the ApiGatewayV1 Stage — where `sst diff` even FALSELY showed the tag applying). HONEST BOUNDARY recorded: local synth catches SHAPE errors only, NOT real-control-plane failures (least-priv IAM, service-API validation, child-construction-order) — those need the real CI apply + live post-deploy verification (fold 1a). NOT killed (running `sst diff` cheaply is still worth it), but its measure must NOT claim to catch the real-control-plane class; its value is now SUBORDINATE to EXP-108 (record the failure) + the live-verify practice (tester fold 1a). Stays active (0/3). |
| EXP-112 | v91 (2026-07-13) | cicd.md (dependency-vulnerability audit gate) + per-project `make audit` target | **Problem:** DEF-ADIX-001 — vulnerable dev/build/test dependencies accumulated SILENTLY across the whole first requirement with NO signal any agent reads: a **CRITICAL** vitest UI-server arbitrary-file-read/exec advisory, a HIGH vite `server.fs.deny` bypass, and 3 MEDIUMs sat open in BOTH lockfiles (`package-lock.json` + `src/app/package-lock.json`) until the human pointed at the GitHub Dependabot banner. Nothing in the loop ever ran an audit, so supply-chain risk grew unbounded between deploys — a change-failure waiting to surface, invisible to CFR. **Solution:** a standing, committed dependency-audit gate — a `make audit` target running `npm audit --audit-level=high` in EVERY manifest (root + each sub-package), wired into the build/push gate cicd owns (alongside lint/test); a high/critical advisory is a gate failure and becomes a `DEF-` through intake (dev-only advisories still fixed but flagged no-prod-exposure for correct prioritisation); a toolchain bump to remediate is verified green across all tiers (EXP-110) before push, never pinned back. | CFR (a high/critical advisory is caught at the next push instead of accumulating unaddressed across a whole requirement) + MTTR (a caught-early vuln is a cheap bump, not a critical-severity scramble) | over the next 3 cycles with an npm project: `make audit` runs as part of the build/push gate AND 0 high/critical advisories accumulate UNADDRESSED across a cycle boundary (each is either fixed or registered as a triaged DEF- within the cycle it appears); if a high/critical advisory sits open across a full cycle with no audit-gate signal, FAILED | 3 cycles (or 3 retros) | active (0/3) | applies-to: any npm/dependency-bearing project (extends naturally to other ecosystems' audit tools). Founding: DEF-ADIX-001 (2026-07-13), principle-failure `2026-07-13-adixout-dependency-vulns-accumulated-no-audit-gate.md`. Opened cap-neutral against EXP-102's adoption this retro (retire-one-open-one, v88 WIP cap). Sibling of EXP-088 (render-diagrams gate) / EXP-087 — all make "did you actually check?" an executable committed gate, not a banner someone must notice. ‖ AdixOut retro (REQ-003, 2026-07-16): light / no-opportunity — npm project but no new dependencies added this cycle, so no new advisory surfaced; `make audit` remains wired into the build/push gate. Stays active (0/3). ‖ AdixOut v94 retro (2026-07-22): LIGHT POSITIVE — `make audit` ran in CI on every push this cycle and reported 0 high/critical vulns; the gate is executing as intended (no advisory accumulated unaddressed). Not yet a full horizon hit (no advisory to catch), so not adopted. Stays active (0/3). |
| EXP-113 | v92 (2026-07-16) | .claude/commands/loop-run.md (STEP 0 freshness precondition) + process-current.md §F STAGE-F note | **Problem:** the OFS loop STARTED on an 8-versions-stale process layer — the worktree was 66 commits / v83 behind main's v91 because entering via "start the loops" (`/loop-run`) never folds the process forward (only `/project-switch` does, on resume). Consequence: the tester ran the pre-EXP-104 `impacted-tests` tool and re-hit the ALREADY-FIXED nested-repo `bad revision` bug 3× (UC-A9/A10/A11), each forcing a manual change-map fallback — pure waste re-incurring a defect fixed weeks earlier on `main`. Process freshness was not a precondition of the loop, so an instance can run arbitrarily stale tools/agents for a whole session and re-pay for solved problems. **Solution:** `/loop-run` STEP 0 runs `make project-update PROJECT=$1` (the same fold-forward `/project-switch` runs) BEFORE the first pull, handling exit 0/3/4 exactly as §0a; skip only for non-worktree/standalone projects. | tester lead time + reconcile-latency (main→instance staleness at loop start → an instance never re-incurs an already-fixed defect because it starts on the current process) | over the next 3 loop-run starts on a worktree project: STEP 0 runs and the instance begins each session on main's current process (0 recurrences of an already-fixed tool/agent defect that a fold-forward would have prevented); if a loop starts stale and re-hits a defect already fixed on main, FAILED | 3 loop-run starts (or 3 retros) | active (1/3) | OFS retro 2026-07-21 (1st opp): POSITIVE — the loop RESTART this session ran STEP 0 (`make project-update`) before the first pull; the instance began on main's current process (v94) and did NOT re-hit any already-fixed defect — impacted-tests worked, and the tester even found+fixed a NEW impacted-tests bug (multi-line `@covers`) rather than re-hitting the old EXP-104 one. 0 stale-defect recurrences (vs 3× the prior session when STEP 0 didn't exist). ‖ applies-to: every worktree-based project loop. Founding: principle-failure `2026-07-16-loop-ran-on-stale-process.md` (impacted-tests recurrence now ~8× across OFS+AdixOut, all downstream of staleness or a parked spec). Opened cap-neutral against EXP-100's adoption this retro (retire-one-open-one, v88 WIP cap). Sibling of the §0a fold-forward/fold-back reconcile-latency discipline — this closes the ENTRY side (start fresh) as fold-back closes the EXIT side (reintegrate continuously). | ‖ AdixOut v94 retro (2026-07-22): did NOT fire — `/loop-run` this session predated v113 landing in THIS tree, so STEP 0 was not yet present when the loop started. No score (mechanism had not landed at loop-start). Stays active (1/3).
| EXP-115 | v96 (2026-07-21) | tester.md (validate the whole user journey with the real shipped artifacts) | **Problem:** DEF-002 — sample config JSON shipped to demo the app FAILED the actual paste→load→run path with a `batchSize` run-params error (no such UI field), because the single config textarea runs BOTH `loadStationChain` AND `loadRunParams` on the same blob and the samples carried only `stations`. It was called "verified" having only been checked against `loadStationChain` in isolation — a component check, never the end-to-end journey a user/demo takes. Root: "done/verified" for a deliverable was allowed without executing the whole primary journey with the REAL artifacts; sample/demo data was treated as eyeballed docs, not a validated artifact under test. **Solution:** tester.md — (1) any data artifact the project ships to be loaded (sample/demo/seed/fixture) is a VALIDATED artifact with a committed test that loads THAT FILE through the public surface and runs the primary journey to a real terminal outcome; (2) "verified/done" means the whole journey was executed+observed at the public surface (load real input → act → reach real end state), not that a sub-step is green — the EXP-110 unrun-test-is-failed rule applied to the JOURNEY. Founding fix on OFS: `e2e/samples-demo.spec.ts` loads the real `samples/*.json` and drives load→run→occupancy→drill-down to `done`. | CFR (a broken demo/sample/seed artifact, or a journey-level break a component test misses, is caught before it ships — not by the user on first use) | over the next 3 slices that ship or touch a loadable data artifact / a multi-surface journey: a committed end-to-end test loads the real artifact and runs the journey to a terminal outcome, and 0 such artifacts/journeys break at the public surface after being called done; if a shipped artifact fails to load/run at the public surface, or a "verified" claim is made without an executed end-to-end journey, FAILED | 3 slices (or 3 retros) | active (0/3) | applies-to: any project shipping loadable data (samples/seed/fixtures) or a multi-surface user journey. Founding: DEF-002 (2026-07-21, gap-closing retro). Sibling of EXP-110 (unrun test = failed) — extends it from the test SUITE to the user JOURNEY + shipped artifacts. Registry over nominal cap-8; a prune pass is owed (tracked, not blocking this mandatory gap-closing row). ‖ OFS v98 retro (1st opp, 2026-07-22): RECURRED → strengthened. DEF-003 — the log-normal chart was invisible via `demo.sh` (its flag list drifted from flags.ts) while the demo-journey e2e stayed green off its OWN hardcoded flag copy. The gap re-appeared at the ENTRY-POINT/RUNNER seam: EXP-115 said "validate the real journey/artifacts" but the test exercised a flag list no user runs. Fix landed via the loop (DEF-003): single code-derived source of truth for the demo flag set, shared by demo.sh + the e2e, with a red→green drift-guard. Scope STRENGTHENED in tester.md: drive the real human entry point (demo.sh/run script/URL), derived the way it does, not a harness copy. Counts as 1/3 (partial — the principle held for the artifact/journey but not the entry-point; now closed). |

| EXP-116 | v100 (2026-07-23, ROC) | orchestrator.md (lean-orchestration trial, guarded) | **Problem:** on ROC the orchestrator ran a LEANER loop than the letter of §F — it authored small decomposition-gap use-cases directly (UC-ROC-024/025/026/036) rather than a full `product` dispatch per UC, and centralised all stage-event `wi-append`s. The user authorised validating this AS AN EXPERIMENT ("you can be pragmatic if it's an experiment and we're validating if it's better or not"). Open question: does lean orchestration cut registration/coordination latency (the #1 GLT contributor — `registered`/`queue` = 65% this cycle) WITHOUT losing the guarantees the specialist roles provide? An early NEGATIVE signal already surfaced: centralised appends REGRESSED token-coverage 50%→19.5% (the killed EXP-103) because appends landed `TOKENS=0`. **Solution:** for small, well-understood work INSIDE an already-signed-off slice the orchestrator MAY author decomposition-gap UCs (inheriting the parent's signed-off persona/job, introducing NO new scope) and centralise bookkeeping — under FIVE HARD GUARDS; any breach = revert that class to full role dispatch: **(G1)** every orchestrator-authored UC carries persona/job from the signed-off dossier; **(G2)** NO product/architecture DECISION (new scope/persona/tech choice) is taken by the orchestrator — those still dispatch product/solution-architect; **(G3)** NO code fix is EVER hand-cranked by the orchestrator — every bug is a `/defect` built by engineer + validated by tester (the v98 rule + principle-failure `2026-07-22-orchestrator-hand-cranked-fix` STAND, explicitly NOT relaxed by this trial); **(G4)** every UI/pipeline slice still gets a real live-stack tester E2E (stand up the FE + push data through the running pipeline, EXP-115 family); **(G5)** every centralised stage append carries the dispatch-return `TOKENS` (absorbs EXP-103 — no coverage regression). | gross lead time (registration/coordination latency on the `registered`/`queue` constraint FALLS) | over the next 3 slices: lead-time median does not rise (target: falls) AND all five guards hold with 0 breaches — 0 orchestrator-authored UCs missing persona/job, 0 orchestrator-taken product/arch decisions, 0 hand-cranked code fixes, every UI/pipeline slice live-E2E'd, token-coverage does NOT regress vs this cycle; if lead time does not improve OR any guard breaks, FAILED (revert to full role dispatch) | 3 slices (or 3 retros) | active (1/3) | applies-to: ROC (and any project trialing lean orchestration). ‖ ROC v103 retro (1st opp): POSITIVE — 2 slices delivered; guards held (G4 strong: every UC live-validated, UC-050 drove the real poller process; G5 IMPROVED: orchestrator-fires-all-stage-appends-with-tokens fixed the UC-046 self-append TOKENS=0 gap; G3 held: 0 hand-cranked fixes; G1/G2: lean-authoring fired once cleanly on UC-046 and correctly NOT on C3 new-chunk). HONEST LIMIT: primary lead-time-reduction claim under-exercised (C3 bulk correctly bypassed the lean path); what's validated is the guards hold with no DORA harm (CFR/rework 0%). Founding: user authorisation 2026-07-23 + honest self-assessment that the ROC loop ran leaner than §F. FENCES OFF the known-forbidden hand-crank pattern (G3) — this trial is ONLY about authoring obvious decomposition-gap UCs + centralised bookkeeping, never skipping engineer/tester or making product/arch calls. Absorbs killed EXP-103's token-stamping as G5. |

| EXP-117 | v103 (2026-07-23, ROC) | .claude/commands/loop-run.md (board-push cadence) + orchestrator.md | **Problem:** the mandated per-item board push (loop step 4, after ANY state change) was the single largest PLUMBING token cost of the C3 session — ~18 `linear` projection dispatches at ~15–20k tokens each (~290k total) mirroring registered→building→dev-validating→done for each UC, most of it re-rendering the same issue through transient intermediate states (built_green/deployed/dev-validating) that a human watching the board barely distinguishes from "In Progress". Delivery agents (engineer/tester) are the right place to spend tokens; board mirroring is pure plumbing (§24/EXP-055 — cut plumbing tokens per delivered UC WITHOUT losing board fidelity). **Solution:** push the board at MEANINGFUL transitions only — `pulled` (work started), `blocked`/`unblocked`, and any TERMINAL state (`validated`/`done`/`rejected`/`resolved`) — plus the periodic step-5b full-sweep as the reconciling backstop; SKIP the intermediate `built_green`/`deployed`/`dev-validating` per-item pushes (they collapse to the same "In Progress" band). | plumbing token-share per delivered UC (a §24 DORA-cost-per-token reduction) — GUARD: board fidelity (a TERMINAL/blocked state must never lag its item-file state by >1 cycle) | over the next 3 slices: plumbing board-push token cost per delivered UC falls materially vs this session's ~4-pushes-per-UC baseline, AND 0 incidents where a TERMINAL (done/validated/rejected/resolved) or blocked state is wrong/stale on the board for >1 cycle (the step-5b sweep catches drift); if board fidelity regresses OR the token cost does not fall, FAILED | 3 slices (or 3 retros) | active (0/3) | applies-to: every loop board push. Founding: v103 ROC token review — board projection was the single largest plumbing cost of the C3 session. Opened cap-neutral against EXP-109's adoption this retro (retire-one-open-one, cap-8). The step-5b full-sweep already exists as the structural backstop, so skipping intermediate pushes cannot silently lose terminal fidelity. |

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
