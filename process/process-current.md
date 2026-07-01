---
process_version: 73
effective_from: 2026-07-01
supersedes: v72
status: active
---

# Current Process — v73

> **v73 (DEFECT-004 ledger↔trunk close-drift — make CLOSE-ON-GREEN mechanical +
> RECONCILE-FIRST on resume, 2026-07-01).**
> Target: **gross lead time / throughput** (reconciliation rework + double-dispatch
> of already-built work) **and CFR** (derived state lies about what shipped).
>
> **Evidence (a PATTERN, not a point).** On loop resume a whole build wave built +
> pushed to trunk in the prior (pre-wipe) session was never closed in the ledger:
> SLC-031 UC-O1..O6/O9/O10 (8 UCs — 25c0aac/fa87cef/37112e1/e96a602/5804d32/800ff57/
> eecf29f/ee7d483), UC-FF1 (d77b04b, prod-validated), UC-FF3 (2a72a45), UC-DA1
> (2dccfc6) — all green on trunk, none `item_done`'d. Because item current-state is
> DERIVED from the ledger (§F1 v52), the derived state LIED: two engineers were
> dispatched to build UC-R3/UC-DA1 that were **already built** (both collapsed to
> validation/pin work, dc6bdc6), the orchestrator nearly mis-routed done UCs to the
> tester, DEFECT-OAG-032 sat as a phantom rework item though its fix (7f0aa02) was on
> trunk, and a full flow-manager reconciliation (~85k tokens) plus one wrong-close +
> reversal (UC-EB2) were needed to true it up.
>
> **Why a NEW rule and not another reminder.** v71 already named this exact
> DEFECT-004 §F1 close-drift class and chose to *"reinforce, not re-legislate."* It
> RECURRED and worsened within one cycle. Reinforcement of a human-remembered rule
> failed; the fix follows the v72 pattern — make the invariant **executable**, not
> exhortatory.
>
> **The change (two mechanical rules, routed narrowly to STAGE F §F1):**
> 1. **CLOSE-ON-GREEN is atomic.** The agent that pushes a build green records
>    `stage_exit`+`item_done` (with the pushed SHA) **in the same turn as the push** —
>    never deferred to "a later cycle" or a batch reconcile. A push with no matching
>    `item_done` in the same turn is itself a defect (derived state now lies).
> 2. **RECONCILE-FIRST on resume.** Before the FIRST pull of any resumed loop, the
>    orchestrator runs `make ledger-drift PROJECT=<p>` (new gate): it diffs trunk
>    `git log` UC/SLC SHAs against ledger `item_done` refs and exits non-zero listing
>    any built-but-unclosed items. The loop MUST close/repair the drift before it may
>    pull. This turns "reconcile on resume" from a thing the orchestrator might
>    remember into a checkable precondition.
>
> **Anticipated effect (score next retro):** built-but-unclosed count at any resume
> → **0** (mechanically enforced); zero re-dispatch of already-built UCs; the
> per-resume reconciliation-rework token cost (~85k this cycle) → near-zero. If a
> future resume still shows drift, rule 1 was skipped — escalate to a push-time hook.

# Current Process — v72

> **v72 (DEFECT-OAG-033 gap retro — render-validate diagrams, 2026-06-30).**
> Target: **CFR** (silently-broken diagrams shipped as "done"). DEFECT-OAG-033: 7
> OagEventSource Mermaid diagrams were un-renderable, and the orchestrator committed
> a `fix(diagram)` (0f96d3e) without re-rendering. Root cause: agents emit Mermaid
> without ever rendering it — "diagrams mandatory" had no executable check. Fix: the
> committed `make render-diagrams` gate (mmdc; exits non-zero on any parse error) +
> a §17 cross-agent contract — no diagram (or diagram fix) is reported done until the
> gate is green; binds documenter, solution-architect, and the orchestrator. [EXP-088]

# Current Process — v71

> **v71 (SLC-029 retro — kill the build-identity-pin-drift class + action the
> normaliser split, 2026-06-30).**
> Target: **CFR** (the build-identity-pin-drift family is the headline) + **gross
> lead time / throughput** (the normaliser seam-concentration). One INCIDENT drove
> this retro: DEFECT-OAG-032 (resolved 75cedbf) — the `retro-debt` gate read
> "RETRO DUE [incident (immediate)]" at routine 2/3, so the incident-never-batched
> leg of EXP-085 fired for the first time.
>
> **Stale-ledger reconciliation (DEFECT-004 §F1 currency class).** SLC-029's
> UC-ON2/UC-CS2/UC-SR1 shipped + validated PASS in prod 2026-06-26 (carrier.name
> live: Delta/Virgin Atlantic/WestJet; codeshares arrays [VS,WS]/[VIR,WJA]; SR1
> bundle-proof + 14 unit, validated UNVALIDATABLE-IN-WINDOW) and the tester GO +
> orchestrator `item_done` rows WERE recorded — but the **flow dequeues were never
> recorded**, and the gate items UC-ON1/UC-CS1 still showed GATED though both gates
> were resolved by the architect (delta-030) at that ship. v71 recorded the missing
> events (2× `gate_resolved`, 5× `dequeue`, ref `RETRO-V71-RECONCILE`) so queue
> depths and the retro counter are honest. The recurring lapse — recording the
> ledger `item_done` but NOT the flow-manager dequeue as a UC ships — is exactly the
> §F1 three-views-must-stay-current rule (orchestrator.md v45); no NEW rule, the
> existing rule was under-applied. Reinforced in this retro, not re-legislated.
>
> **THE HEADLINE — EXP-087: prod-smoke build-identity = injected EXPECTED_SHA,
> never a literal.** DEFECT-OAG-032 is the THIRD sighting of one class: a prod-smoke
> / live-integration test asserting the deployed build identity against a HARDCODED
> expected sha goes stale every deploy and false-reds the lane on every push between
> a source change and its redeploy (FIDS UC-FD1 stale `EXPECTED_SHA` literal → SLC-026
> main.mjs embed-proof → the REST `serviceVersion` pin asserting `e5587a7` while the
> service was `40ade754`). UC-SR1 is offline-pure, so the red was a pure build-identity
> drift, NOT a functional regression — yet it false-reds CI and masks real reds. Each
> was fixed reactively per-lane. Durable fix (routed to **cicd.md** as standing
> practice + EXP-087): any live/prod-smoke build-identity assertion derives the
> expected sha from an injected `EXPECTED_SHA` (defaulting to the deployed/CI
> `github.sha`) and SKIPS when unset — never a frozen literal; plus a deploy-then-smoke
> ordering note (the identity assertion holds only AFTER the CD redeploy lands;
> running it against a not-yet-redeployed service is expected-skip). Generalises the
> FIDS `e2e-fids EXPECTED_SHA ?= $(BUILD_SHA)` seam (and the DEFECT-OAG-032 fix
> 75cedbf) to ALL prod-smoke lanes. → CFR (build-identity drift is not a deploy
> failure; no false-red masking real reds) + GLT (no per-lane whack-a-mole / wasted
> adjudication).
>
> **EXP-086 ACTIONED (the normaliser split).** v70 deferred the genesis-handler
> split until after SLC-029 so it would measure real parallelism across the full
> handler set. SLC-029 has now landed — and added two MORE handlers to the same
> `src/core/normaliser-core.ts`, so par_eff stayed 0.84 across the COMPLETE handler
> set, confirming the seam-concentration is the constraint on every backend wave.
> Decision: **action it now** — routed to `process/improvement-slices/IMP-011-
> normaliser-handler-split.md` (owner=engineer, pure structural refactor guarded by
> the corpus regression suite). EXP-086 `planned`→`active`. → GLT + throughput
> (par_eff toward 1.0 on a multi-handler pull), guarded by CFR (output must not
> change). Scores on the first multi-event-type backend pull after the split lands.
>
> **UC-FR1 RETIRED.** Obsolete: its FlightRemoved-as-reuse-of-OagFlightScheduleUpdated
> (DELETED) ruling (SLC-028, EXP-047 one-writer) was SUPERSEDED 2026-06-26 when the
> human chose Option B = a distinct `OagScheduleRemoved` canonical event (UC-SR1,
> delta-031, shipped). The schedule-removed semantic is now carried by UC-SR1; UC-FR1
> never had code (decision-only). Recorded `item_retired` (ref RETRO-V71-RECONCILE).
>
> **Experiment scores this retro:** EXP-083 (mechanical retro-debt gate) **VALIDATED
> 2/2** (v71 incident fire + the prior routine 3/3 fire; loop never advanced past,
> never offered to human) → INTEGRATED as plain loop machinery + PRUNED to archive.
> EXP-085 (cadence right-sized) **2/3 positive — INCIDENT leg now exercised** (a
> single defect resolve forced RETRO DUE at routine 2/3, not batched; both legs now
> confirmed) — 1 more retro then integrate. EXP-082 (deploy preflight) carries 1/2
> (no §F5 deploy this window). Registry: active rows 33 → 33 (added EXP-087, pruned
> EXP-083, EXP-086 planned→active = net 0 — EXP-084 leanness held).
>
> **DORA (cumulative, refreshed):** lead=2543s freq=5/day cfr=16% (deploys only; 43
> defect-intakes excluded) mttr=2218s; window(12) cfr=0%. **Constraint = engineer**
> (the build is the binding step; the normaliser seam-concentration is its dominant
> structural time-thief, which EXP-086/IMP-011 now attacks). Buffers/N UNCHANGED — no
> queue starvation or over-WIP this window; the only flow anomaly was the dequeue
> currency lapse, now reconciled.
>
> **Token estimate (EXP-067/§26).** Retro-only cycle, ~0 build dispatches; dominant
> cost was this orchestrator main-loop reconciliation + scoring (judgment-dense, not
> scriptifiable). The scriptified path (`dora.py record` for the 8 reconciliation
> rows) kept the ledger-currency fix cheap — the right shape. No plumbing cut routed
> this cycle (the cycle was almost entirely delivery-adjacent bookkeeping that the
> recorder already absorbs); EXP-067's plumbing/delivery split continues to trend.
>
> v70 change-set scored in `process-history/v70-2026-06-30.md`.

# Current Process — v70

> **v70 (LIGHT retro — clean-wave scoring, no new rule, 2026-06-26).**
> Target: **CFR/quality** (the false-green family was the headline) confirmed by
> a clean wave, plus the EXP-085 retro-overhead balance (this is its first
> batched fire). Per EXP-085 this is a LIGHT retro: the SLC-026/027/028 backend
> wave (OagFlightTakenOff / recovery+generalAviation genesis / FlightRemoved+
> diversion-enrichment) closed CLEAN — 0 new defects, 0 MTTR pairs, 0 deploy
> failures, 0 queue starvation, DLQ 0 — so NO new cross-agent rule is added; the
> retro SCORES the active machinery and banks one planned experiment.
>
> **Headline — the v68/v69 anti-false-green machinery is VALIDATED.** This wave
> is the direct contrast to the prior serviceType wave (DEFECT-028/030/031
> false-greens) on the SAME surface. The bundles-current gate (DEFECT-030 fix)
> PASSED (rebuilt+committed bundles → deployed artifact matches source); CI green
> BOTH lanes; the consumer rolled to primary (e5587a7); and the tester validated
> the NEW fields on events the NEW consumer ACTUALLY ingested (recovery/
> generalAviation booleans observed on a live FlightCreated; 14 live
> OagFlightTakenOff with correct offGround). NO false-green, NO defect.
> **Scores:** EXP-082 (deploy preflight / verify-at-source in the deploy env)
> **1/2 positive**; EXP-083 (mechanical retro-debt gate) **1/2 positive** (fired
> at routine 3/3, loop did not advance, not offered to human); EXP-085 (retro
> cadence right-sized) **1/3 positive — FIRST BATCHED FIRE** (3 clean routine
> closes batched before RETRO DUE; incident leg unexercised, carried).
>
> **DORA (clean wave, CFR did NOT rise):** cumulative lead=2543s freq=5/day
> cfr=17% mttr=2189s; window(12) cfr=0% lead=166s. Constraint computes
> **orchestrator** (plumbing) at the cumulative level; at the build level the
> backend SERIALIZED on `src/core/normaliser-core.ts` (par_eff=0.84) exactly as
> the flow-manager predicted (§F6 shared-file seam). **Buffers/N UNCHANGED** — no
> starvation, no over-WIP (backend serial-by-seam + FIDS parallel both ran as
> scheduled).
>
> **The one bank — EXP-086 (planned, trial-after-SLC-029).** The
> `normaliser-core.ts` seam-concentration is a confirmed §F7 false-edge candidate:
> RG1/RG2/TO1/DA1 are behaviourally independent but serialize on one file. The
> per-event-type genesis-handler split (dispatch table → one file per event-type)
> would let the flow-manager dispatch them as a true parallel set. TRIAL DEFERRED
> until AFTER SLC-029 (the last backend slice on the same seam) so it measures
> real parallelism gain across the full handler set, not a synthetic one. Pure
> structural refactor, guarded by the corpus regression suite. See EXP-086.
>
> **One coherence gap logged (not fixed here):** the tester reported the
> architecture *.mmd node-marks for SLC-026/027/028 did not register a diff →
> OI-022, routed to the documenter coherence sweep (the deltas ARE in
> architecture/deltas + edge-ledger; only the model node-mark sync is open).
>
> v69 change-set scored in `process-history/v69-2026-06-26.md`.

# Current Process — v69

> **v69 (FOCUSED retro — retro cadence right-sized, 2026-06-26).**
> Target: **retro-overhead vs missed-learning balance** (a gross-lead-time proxy),
> guarded by CFR/MTTR (incident learning stays immediate). LIGHT retro: no new
> defects, no MTTR events, no queue starvation; the only closes since v68 were
> trivial (SLC-009 — a validation-only close of pre-built observability dashboards,
> CHK-5 done; TD-002 — dead `oag-feed.ts` deleted; the AOS alignment doc reframed
> "prefix-is-intentional"). DORA: no regression — cumulative lead=2543s freq=5/day
> cfr=18% mttr=2189s; window(12) cfr=0% lead=1334s. Constraint stays **engineer**;
> buffers/N UNCHANGED.
>
> **The change — EXP-085 (retro cadence right-sized).** The v68 retro-debt gate
> (EXP-083) shipped at threshold=1 (a retro DUE the moment ANY slice/chunk closes).
> Its FIRST real firing — on SLC-009, a validation-only close — proved that too
> aggressive: a per-slice-close cadence reintroduces the very retro-overhead/bloat
> churn v68 fought, and treats a clean routine close (little to learn) the same as
> a real incident (much to learn). Fix: SPLIT the gate's events by class.
> **ROUTINE** slice/chunk closes **batch** up to `--threshold` (default raised
> 1→3) before a retro is due; **INCIDENT** events (prod defect resolve,
> deploy_failure) are **never batched** and force RETRO DUE immediately (effective
> threshold 1), alongside the existing MTTR-pair / queue-wait-spike triggers.
> **This is the v68 gate SELF-CORRECTING on its first firing — the intended
> behaviour, not a bypass:** enforcement stays mechanical (the loop still may not
> advance past a due retro; the retro still may NOT be offered to the human), only
> the routine cadence is right-sized and incidents stay immediate. Routed to
> `dora.py cmd_retro_debt` (routine/incident split, default --threshold 3) +
> Makefile + §F8 + loop-run.md step 7 + §6. Anticipated: fewer low-yield per-slice
> retros free the constraint while CFR/MTTR protection is unchanged. Scored over
> the next 3 retros [EXP-085, active 0/3].
>
> v68 change-set scored in `process-history/v68-2026-06-26.md`: EXP-083 mechanical
> gate VALIDATED-as-mechanism (fired correctly, the loop did not advance) — its
> threshold is what needed tuning, not its enforcement; EXP-084 leanness held.

# Current Process — v68

> **v68 (OVERDUE retro + process-leanness refactor — make the auto-retro
> MECHANICAL; graduate proven rules to skills, 2026-06-26).**
> Target: **CFR** (the false-green family is the headline) + **process leanness**
> (a DORA proxy: a leaner active process is faster to load/apply and removes the
> rule-bloat that doesn't even guarantee adherence). Three linked subjects:
>
> **(1) META-FAILURE — the automatic §F8 retro did not run.** Since v67 a LOT
> shipped with NO retro (SLC-021, SLC-025/serviceType, the Oag-prefix +
> OagBagBeltSet rename delta-026, an event-store drop + clean reset, DEFECT-OAG-028/
> 030/031, a prematurely-closed CC3) — retro-debt measured **8 slice/chunk closes**.
> Root cause: the orchestrator repeatedly OFFERED the retro to the human instead of
> running it (the EXP-030 / 2026-06-06 anti-pattern recurring). The §F8/§F9.4 RULE
> already forbade this and was still violated → another rule won't fix it.
> **Structural fix — enforcement is now MECHANICAL [EXP-083]:** a **retro-debt
> gate** in the loop machinery — `dora.py retro-debt` counts slice/chunk closes +
> defect resolves + deploy failures since the last `retro` ledger row and **exits
> non-zero (code 2 = RETRO DUE)** at the threshold; `make retro-debt PROJECT=…`
> wraps it; `loop-run.md` step 7 makes it a **hard loop-state precondition** — the
> loop MUST run /retro to drain the debt before pulling next work and may NOT offer
> it to the human. "Retro fires at the cadence" is now a checkable property of the
> loop, not orchestrator discretion. Principle-failure recorded
> (`2026-06-26-auto-retro-offered-to-human-instead-of-firing.md`).
>
> **(2) THE FALSE-GREEN FAMILY → graduated to a SKILL.** DEFECT-028 (FIDS header
> false-green), 030 (stale committed bundles deployed), 031 (unpackaged
> airports.json consumer crash-loop) + the CI-green CC3 close are ALL "green
> build/CI ≠ running service." The durable rule — **for backend/contract/event
> slices, validate the RUNNING service in prod (consumer UP + the field/behaviour
> observed on a live event/response), never close on CI-green alone; the deployed
> ARTIFACT is what runs, not the source** — is banked in the **delivery-principles
> skill** ("Green build ≠ running service"), NOT as another standalone /process EXP.
>
> **(3) RULE-BLOAT → graduate-to-skill lifecycle [EXP-084].** /process was accruing
> rules/EXPs faster than it shed them (36 active EXP rows) and (per subject 1) the
> bloat didn't even buy adherence. Defined the explicit lifecycle in the
> **process-framework skill**: experiment (EXP in /process) → integrate into the
> owning agent file (single-agent) OR **GRADUATE into the relevant skill**
> (cross-agent methodology, proven ≥K + stable) → prune from active /process. Ran
> the FIRST PASS: graduated 10 proven cross-agent rows (EXP-025/062/064/065/066/068/
> 072/073/074/081) into delivery-principles (the validation/fitness-function +
> ground-truth-oracle + invariant-not-incidental families) + cicd.md + agent files,
> pruning their EXP rows. **Leanness gain: active EXP rows 36 → 26.**
>
> DORA since v67 (cumulative): lead=2543s freq=5/day **cfr=18% (18/93 deploys)**
> mttr=2189s; defect-intake 2/active-day. The **CFR headline** is the false-green
> spike: DEFECT-OAG-030 + -031 were both prod regressions of the SLC-025 deploy
> caught by tester live validation (UC-ST1 NO-GO → Rework), recovered same-session
> at f8ad95c (SLC-025 GO, 25/25 green). Constraint stays **engineer**. Buffers/N
> UNCHANGED (no queue starvation/over-WIP this window).

# Current Process — v67

> **v67 (SLC-015/023 + DEFECT-OAG-028/029 retro — the deploy hits its
> prerequisites and binds to the verified target, 2026-06-25).**
> Target: **gross lead time** (guarded by CFR). SLC-015 (FIDS flight-detail) +
> SLC-023 (board fix) shipped and validated GO (e2e-fids 32-pass/4-skip, sha
> `d45fdce` confirmed live); DEFECT-OAG-028 (FIDS deploy false-green) +
> DEFECT-OAG-029 (11 dev-toolchain CVEs — vitest/vite/esbuild/otel-core, all
> cleared, `npm audit` 0) resolved. Build wasn't the friction this slice — the
> §F5 FIDS deploy was: the FIRST `deploy-fids` attempt failed TWICE before
> landing — on a STALE SST state lock (left by the killed prior loop) AND a
> Docker-daemon-down bundling failure — and `ci-watch` then MISREPORTED "no runs"
> because the CI/deploy lookup resolved to the WRONG repo
> (`john-aerocloud/claude_learning_agents`) instead of the real `origin`
> (`AeroCloudSystems/Spike-FlightEventSource-OAG`). All three are the same class
> as v65/EXP-080 (verify-status-at-source) but in the deploy ENVIRONMENT + its
> BINDING, not the build artifact. Routed:
> (1) **Deploy preflight + verified-target binding** [EXP-082 → cicd.md §20a].
> The deploy target runs a FAIL-FAST preflight before any irreversible step:
> (a) release/clear any stale state lock (SST), (b) assert the build daemon
> (Docker) is up, (c) credential valid (already present), (d) the CI/deploy
> binding resolves to the verified `origin`/account — never an ambient `gh`
> default. A missing prerequisite is an actionable message, not a mid-deploy
> crash; `ci-watch` passes the resolved `origin` repo explicitly. → GLT (no
> failed-deploy retries inside the gate) + CFR (no status read against the wrong
> target). Buffers/N UNCHANGED — the constraint stays the engineer; the flow
> evidence (`ready` dwell, par_eff 0.81, 1 historical collision) shows no queue
> starvation or over-WIP this slice, so `min_items=2 / wip_limit=4 / N=4` hold.
> (2) **EXP-080 verify-at-source → INTEGRATED + pruned** (2/2: SLC-014 caught 3
> spec-not-code false-fails; SLC-023 cited the verified deploy sha + caught the
> ci-watch wrong-repo read). Folded into engineer.md/tester.md/orchestrator.md as
> plain practice; row pruned to the archive. EXP-082 is its natural extension to
> the deploy environment.
> Scored POSITIVE this slice: **EXP-081** (specs assert the invariant — UC-FD1's
> raw framenavigated-count spec recalibrated to the reload-sentinel invariant;
> 1/2, toward integration), **EXP-073** (real-source fixtures — UC-BF2 validated
> vs real-aggregate + real-schedule-event-4Y65 folded fixtures), **EXP-074**
> (render-observed validation — board non-empty ~1.5s confirmed in prod).
> Confirmed (1 data point, NOT yet a pattern): single-writer-per-tree held while
> concurrent engineers on a shared tree produced an orphan unpushed commit —
> reinforces §14, no rule change. Constraint stays **engineer**.

# Current Process — v66

> **v66 (SLC-014 retro — specs assert the INVARIANT, not the incidental, 2026-06-25).**
> Target: **CFR + GLT**. SLC-014 (FIDS schedule fold) shipped + clean — but 3 e2e/contract
> specs FALSE-FAILED this batch by asserting an incidental live-data condition instead of
> the acceptance invariant: BIDS `rows>0` (empty board is valid per AC-B2.6), oi-020-4
> global-feed-order (per-stream order ≠ category position; fold was correct), AC-B3.5
> backward-REQUEST-count (real invariant = ONE bootstrap subscription). Each looked like a
> regression/defect (DEFECT-OAG-027 raised) and burned an adjudication cycle before proving
> to be a SPEC bug — and inflated CFR with false alarms. Routed:
> (1) **Specs assert the invariant, not the incidental** [EXP-081 → tester.md/engineer.md]:
> an e2e/integration/contract spec asserts the acceptance INVARIANT; where the surface
> depends on live data it branches on the data state (assert the sanctioned empty-state) or
> derives expected from per-entity ground truth (getFlight/OOOI) — never from incidental
> global ordering / row-or-request counts / presence-when-absence-is-valid. Generalizes
> EXP-074 from the render gate to ALL specs. → CFR (no false-defect inflation) + GLT (no
> wasted adjudication).
> (2) **cicd: committed `ci-watch` make target** — the role contract references
> `make -C work/<project> ci-watch` but none exists; agents hand-roll `gh run watch`. → GLT.
> Scored POSITIVE: **EXP-080** (verify-at-source — orchestrator+tester source-verification
> caught all 3 false-fails as spec bugs, not code; gh-run + getFlight evidence cited
> throughout), **EXP-074** (BIDS empty-tolerant gate landed; weakness #2 closed).
> Constraint stays **engineer**.

# Current Process — v65

> **v65 (SLC-012/013 slice retro — verify status at the SOURCE, 2026-06-25).**
> Target: **CFR**. The friction this slice wasn't build (DEFECT-OAG-026 was a
> false-alarm metric artifact, 0 data lost, ~39min MTTR) — it was AGENTS
> MISREPORTING CI/DEPLOY/VALIDATION STATUS (3 data points: a CI skip read as a live
> pass; an auto-deploy read as "no CI runs"; a slice the flow-manager closed before
> the tester's NO-GO). Each was caught ONLY by orchestrator verification against the
> source. Routed:
> (1) **Verify status at the source** [EXP-080]: any done-condition resting on
> CI/deploy/validation cites the VERIFIED signal — the `gh run` conclusion + the
> job/step, the deployed `X-Service-Version`, or the actual metric value — never
> inferred ("green"/"no runs"/"deployed"). The orchestrator verifies any such claim
> against the source before closing a slice or passing a gate. → CFR.
> (2) **flow-manager never projects an in-flight item to a terminal state**: a slice
> closes only on the validating agent's recorded GO, never assumed while that agent
> runs (the SLC-012 premature-closure race). → CFR.
> Scored POSITIVE this slice: **EXP-078** (authoritative-source — both the Flight-Info
> AND Master-Data endpoints came from the portal, never guessed; the Master-Data 401
> surfaced cleanly as a subscription gate), **EXP-079** (disjoint dispatch — CC1/CC5/CC4
> seams partitioned + SLC-013 held behind the DEFECT-026 normaliser seam, 0 collisions),
> **EXP-069** (push-on-green — verified origin recorded in decision-log, guard friction
> removed). Constraint stays **engineer**.

# Current Process — v64

> **v64 (OI-021 slice retro — external-discovery + dispatch hygiene, 2026-06-24).**
> Target: **gross lead time**. Focus answer: OI-021's biggest GLT thieves were
> avoidable DETOURS, not build work — chiefly the external-API-spec discovery
> detour (architect best-guessed the REST endpoint + auth header, both wrong; the
> orchestrator then brute-forced the live API — ~5 dead calls + a human round-trip
> before the authenticated portal gave the real contract in one shot). Routed:
> (1) **Architect verifies external-interface facts at the authoritative source**
> [EXP-078 → solution-architect.md]: endpoint/header/params/envelope verified at the
> portal (human-assisted when `⚠ PORTAL`) BEFORE encoding — never guessed, never
> brute-forced. EXP-066 ground-truth discipline extended from payload semantics to
> the interface contract. → GLT + CFR.
> (2) **Disjoint artifacts on same-item parallel dispatch** [EXP-079 →
> orchestrator.md]: when >1 agent runs on one item concurrently, partition owned
> paths — UC test+code = engineer, cicd wires lane/infra only. Fixes the UC-R1
> cicd/engineer double-claim collision. → GLT + CFR.
> (3) **Slice completion is automatic end-to-end** [orchestrator.md, §F9 reinforce]:
> retro → next-slice, NEVER offered as a human choice (the over-ask recurred). → GLT.
> (4) **documenter.md** (human-directed): as-built docs follow the canonical chain
> service-design → use-cases → architecture → components → sequence-diagrams;
> `05-sequence-diagrams.md` = Mermaid sequence diagrams (data contracts → the event
> catalogue); `04-components.md` added.
> Follow-ons → cicd: stale `OAG_EVENT_STORE_TABLE` default (→ `-v3`); write-only
> `oag-event-store-seed` stack role (EXP-060 — grant the full reads-then-writes set).
> Scored positive this slice: EXP-073 (real-source fixtures — UC-R4 pinned to the
> real probe fixture; the live test caught a real-data bug), EXP-069 (push-on-green —
> clean per-UC pushes), EXP-076 (catalog absorbed the `oag-rest` source with no
> poison). Constraint stays **engineer**.

# Current Process — v63

> **v63 (DEFECT-OAG-025 retro — consumer-brittleness as a versioning failure, 2026-06-24).**
> Target: **CFR + MTTR**. The OagEventSource defect line showed a recurring class —
> DEFECT-OAG-024 then -025 were the SAME failure: a completeness/guard fix not
> propagated to a sibling read path, so a consumer **poisoned on a stored event
> shape it should have mapped** (trailing MTTR 12299s, defect-intake 3/active-day).
> Two routed fixes:
> (1) **principles/03 — event versioning + total mapping + event catalog** [EXP-076]:
> consuming a valid stored event must never have a failure mode; events are
> versioned, every consumer supports all versions, schema changes are
> non-destructive + total-mappable vN→vN+1, and new data ships with a sensible
> default defined in the new version. The solution-architect maintains the versioned
> event catalog (per-type version history + forward-mapping rules + per-field
> defaults); the documenter keeps it a CORE `actual/` doc; consumers carry
> version-coverage tests. Reframes 024/025 from defensive-guard whack-a-mole into a
> structural guarantee. (process/principles/03 + solution-architect.md +
> documenter.md, committed a6f48d8.)
> (2) **impacted-tests must see the project sub-repo** [EXP-077 → IMP-007]:
> `make impacted-tests` is blind to project sub-repo dep-model changes because the
> parent `.gitignore`s `/work/*/`, so DEFECT-025's `class-deps.mmd` change returned
> "no changed nodes" — test selection under-covered the very sibling path that broke.
> Extend the tool to diff the project sub-repo when the parent diff is empty.
> Constraint remains the **engineer** (median 900s, n=99); attacking the defect class
> reduces its rework load.

# Current Process — v62

> **v62 (upstream pipelining, 2026-06-23 — human-directed).** New **§F3a**: the
> whole planning stage runs AHEAD of the build, not just product. While the
> engineer builds the pulled item, the orchestrator keeps **solution-architect**
> (next architecture delta + security review), **cicd** (next item's capabilities /
> flags / deploy-role grants), and **ui-designer** (next structure pass) working the
> NEXT sequentially-independent item in parallel — so the engineer's next pull finds
> design + capabilities already done and never idles waiting for an upstream
> artifact. Bounded by §F6 independence + queue `wip_limit` + the buffer look-ahead
> depth; agents write disjoint artifacts (no §14 collision). orchestrator.md updated
> to dispatch this look-ahead each cycle. Target: gross lead time / throughput
> (the engineer is the constraint; upstream never blocks it) [EXP-075].

# Current Process — v61

> **v61 (SLC-010 FIDS retro — the empty-board escape, 2026-06-23).** Target metric:
> **CFR** (a broken UI surface shipped through GATE 2 and was found only post-deploy,
> forcing a full re-design→build→deploy→validate rework cycle — the slice's largest
> lead-time hit). Root causes + routed fixes:
> (1) **False-green from code-matching fixtures** — FIDS unit tests (152 green) used
> hand-authored fixtures mirroring the code's WRONG data shape (`departure.scheduled.*`,
> absent in real OAG data), so the board was empty while tests passed. → **engineer.md §2**:
> external/live-data fixtures MUST be captured from the real source, never hand-authored
> to match the code [EXP-073].
> (2) **UI "validated" without observing the render** — the tester gave GO-for-DONE on
> the data pipeline; the rendered board was never looked at (Playwright "not committed"
> → checks DEFERRED). → **tester.md**: a UI surface is not validated until the RENDER is
> observed showing real content; missing tooling is a BLOCKER to fix, never a defer; +
> Playwright e2e render suite installed for fids-app [EXP-074].
> (3) **Orchestrator did the tester's job** — when the browser extension wasn't connected
> the main loop ran headless Chrome itself instead of dispatching the tester. →
> **orchestrator.md**: never run validation/engineering yourself; route missing tooling to
> the owning agent.
> (4) **stash-all swept peers' WIP** — a ui-designer `git stash` captured other agents'
> uncommitted work + the flow `edge-ledger.md` learning (nearly lost). → **§14**: never
> stash a shared tree; explicit pathspec + `--rebase --autostash` only.
> (5) **IAM 10KB inline-policy limit** hit on the deploy role (DEFECT-OAG-014). →
> **cicd.md**: chunky deploy-role grants go to an attached managed policy (recurring with
> EXP-060). Anticipated effect: the wrong-shape-fixture and unrendered-UI escape classes
> close → lower CFR / less rework lead-time.

# Current Process — v60

> **v60 (push integrates, 2026-06-21 — human-directed).** Supersedes v59. The
> blanket "never `git push`" (§14/EXP-049) batched 44 commits locally on
> OagEventSource before anything integrated, and the first real CI run then failed
> twice. Three reconnected changes: (1) **§14** — push trunk to a *verified* remote
> as part of each use-case's done-condition (the unverified-destination guard
> stays); (2) **§19b (new)** — every push sets off a non-blocking CI watch, and a
> red CI run where local was green is a DEFECT closed by exactly one of {close the
> local coverage gap | runbook + automate the manual config}; (3) **§19a/EXP-062
> tightening** — a pipeline is "proven" only once it has executed green in its
> introducing slice, never deferred to an open item. [EXP-069, EXP-070]

# Current Process — v59 (superseded; notes retained)

> **v59 (consolidation re-baseline, 2026-06-19).** Supersedes v58. No new rules —
> a snapshot consolidation that resets the learning loop to a clean baseline:
> validated experiments **EXP-023** (two-gate model → §F5) and **EXP-055**
> (token-efficiency retro review → §26) graduated to plain practice and pruned
> from the registry; the superseded push-mode four-gate model dropped from §9
> (the deploy-gate auto-approve mechanics kept); the §22 carry-forward list moved
> to `process/open-items.md`; the new-requirement workflow named once with its two
> triggers (§6). The experiment/retro learning loop restarts from here. Prior v58
> detail is retained below for continuity; the full v58 snapshot is in
> `process-history/v58-2026-06-18.md`.
>
> **v58 (mega-session retro, 2026-06-18 — OagEventSource: CDK→SST v3 migration +
> delta-005 real Lambda ingest + delta-007 Fargate persistent consumer cutover +
> delta-006 Streams read model).** Target metric: **CFR** (recurring prod-found
> defect classes) guarded by **MTTR** and **token cost** (failed-prod-deploy →
> fat-cicd-remediation re-spawn is the cycle's most expensive token + lead-time
> sink). The session shipped a lot live but recovered THREE recurring prod defect
> CLASSES (a pattern, not a data point), none of which v57's §17.1/§11a.1 covered:
> **(1) IAM scoped write-only on a reads-then-writes code path** — hit 3× in prod
> (ingest missing `dynamodb:Query`, then `kms:Decrypt`, then the append-path
> loadStreams read). The existing code↔policy pin asserts code-matches-grant but
> the GRANT itself was authored write-only at design time. v58 routes the
> completeness rule to BOTH owners: an **event-store APPEND grant = the READ ops +
> the WRITE ops** (architect derives the grant from the full SDK-op set of the code
> path, not its name; engineer's pin asserts it) — EXP-060. **(2) ESM-bundle
> `Dynamic require` crash** — recurred across fold-demo, the Fargate consumer, AND
> the feed-projector when `@aws-sdk`/`@azure` were bundled as ESM; bundles clean,
> crashes only when the path runs in prod. v58 routes a standing cicd bundling rule
> (createRequire banner OR CJS, pinned by an import-the-bundle smoke; reserved-
> keyword aliasing is the same build-clean/run-fail class) — EXP-061. **(3) CI
> pipeline went stale after the framework migration** — `infra.yml` still runs
> `npx cdk synth` though the project deploys on SST; the CI deploy pipeline has
> never run and would fail. v58 routes a **§19a migration-completeness rule**
> (converting the pipeline + deleting the dead path is PART of the migration, not a
> deferred follow-up) — EXP-062. Scored this retro: EXP-049 already integrated;
> EXP-055 VALIDATED (2/2, integrate the token-review step next retro); EXP-016/026/
> 031/041/043/044/045/052 VALIDATED and INTEGRATED+pruned this retro. v57 change-set
> scored in `process-history/v57-2026-06-18.md`.
>
> **v58 addendum (2026-06-18, human-directed experiment-validity fix, EXP-063).**
> §25a now states an explicit, checkable **validity bar**: every registry row must
> be a falsifiable HYPOTHESIS — Problem + Solution + a NAMED target DORA metric +
> a Measurement that can come back NEGATIVE — never a piece-of-work / feature /
> capability description. Drift-purge applied: EXP-058 (architect enumerates
> fitness functions) and EXP-059 (documenter produces a consumer-skill) were
> deleted as work-item-shaped rows (no DORA metric; a did-we-do-the-work
> "measurement" that cannot fail); both behaviours are SOUND and KEPT as plain
> agent practice (solution-architect.md / documenter.md). The bar is enforced at
> creation (this section), in the registry header, and in the retro command
> (steps 5a + 7). Target: registry validity + agent-def simplicity.

The process all agents follow right now. Updated only by the Orchestrator at a
retro, which snapshots the prior version into `process-history/` first.

> **v40 — pull-based flow.** Delivery moves from push (a human runs `/slice-next`
> then `/iteration-run`, pausing at four gates) to **pull**: a continuous inner
> dev loop pulls ready work from costed, prioritised, per-queue-buffered queues,
> planning happens just-in-time to keep those queues from starving, parallel work
> is dispatched by independence, collisions teach the dependency tree, and **only
> two gates remain** (intake + deploy). The cross-agent rules are **STAGE F**
> below; they supersede the four-gate list in §9 and the command-stepped loop in
> §6 for pull-based projects. Rationale + diagrams + a worked retro live in
> `Version2-design/`. Every v40 change is a registered experiment (§25a,
> EXP-020…EXP-029) and is scored/repealed by evidence like any other.

This file holds **cross-agent rules of the game** — gates, metric definitions,
selection rules, commit and command discipline, and the improvement loop.
Single-agent behaviour lives in `.claude/agents/<agent>.md` (the unit of agent
improvement); heavy reference lives in skills; project facts live in `/work`.
The file is structured by process **stage**, not by the order rules were
invented. It is allowed to grow when a genuinely cross-agent rule needs
stating — necessity and correct placement are the metric, not length.

---

# STAGE 0 — Principles & metrics

## 1. Operating principles (beliefs)
See `principles/` for the full statements. In force: XP, always-TDD, value
slicing, trunk-based development, continuous deployment, roll-forward-with-
reversible-rollback, defect-as-spec, jobs-to-be-done, version-identifiable
deployments. Treat these as defaults, not laws — deviations are allowed but
must be logged in `principle-failures/`.

## 2. Metric definitions
- **Gross lead time = wall-clock time from idea accepted → running in prod.**
  Includes everything: agent processing, gate waits, session idle, overnight,
  and pipeline iteration loops.
- **Time-to-first-deploy = kickoff → slice-001 deploy.** Tracked per project.
  Target: < 90 min for local-only; < 3h for cloud/hosted first deploy.
- **Delivery gap = deploy(N) → engineer task_start(N+1).** Target < 15 min
  in-session. Recorded in `dora/per-project.md`.
- **Deploy event by project type:** cloud/hosted — CI/CD pipeline live in
  production (logged by cicd or engineer on pipeline success); local CLI /
  library — tester validation passes (logged by the orchestrator after tester
  `task_end`).

## 3. CFR ledger convention (definitional)
CFR answers one question: **what fraction of DEPLOYS broke?** A prod issue is one
of two kinds, logged distinctly so they are never conflated (the v49 retro found
the old single-bucket convention inflated CFR — 06-10 logged 11 "failures"
against 2 deploys because every `/defect` counted):

- **`deploy_failure` / `deploy_recovery`** (legacy alias: `failure`/`recovery`
  whose ref is NOT a `DEFECT-` id) — a change we **just shipped** failed its own
  validation (tester sent a just-deployed UC to Rework, failed prod smoke,
  user-visible regression from this deploy). **These are the CFR numerator.**
- **`defect_intake` / `defect_resolved`** (ref `DEFECT-NNN…`) — a defect raised
  against the **standing system** via `/defect`. Real and production-impacting,
  but not a failure *of a specific recent deploy*, so it is **excluded from CFR**
  and reported separately as a **defect-arrival rate**. Counting it in CFR would
  measure how diligently we report, not how often deploys break.
- **`pipeline_failure` / `pipeline_recovery`** — CI/CD red **before** prod. Not
  in CFR/MTTR; pipeline-iteration waits (§5), attacked via cicd pre-flight.

**MTTR spans both deploy_failures and defect_intakes** — it measures recovery
speed for *any* prod issue. `dora.py` classifies retroactively by ref, so the
distinction holds for historical rows too; going forward agents log the explicit
event types. The orchestrator must not use this to hide real failures: a genuine
deploy regression is a `deploy_failure`, full stop — `defect_intake` is only for
issues raised against already-shipped, standing work.

## 4. Current DORA baseline (one source of truth)
The orchestrator keeps exactly ONE current baseline here; older baselines live
in `process-history/`. Recompute at each retro via `make dora-compute` (writes
`/process/dora/baseline.md`).

**As of 2026-06-18 (mega-session retro, OagEventSource — migration + ingest +
Fargate + read-model):** cumulative `lead=2543s freq=6/day cfr=20% (15/74
deploys) mttr=843s`; window(last 12 deploys) `cfr=17% (2/12) lead=1823s`. The
window MTTR figure (32951s) remains history-dominated by old observatory
overnight rework pairs (§13e), NOT this cycle — this session's recoveries were
in-session and fast: the IAM read-then-write misses were caught + fixed inside
UC-27's live-ingestion validation (deploy_recovery `7a31d8a` same-stage), the ESM
bundle crash inside the Fargate cutover validation (`6df7d79`, fixed by the
createRequire banner, no CJS switch needed), and the Fargate crossover completed
green (Lambda poller DISABLED, kept for rollback). CFR held at 20% — the new prod
defects were RECOVERED within their own deploy validation, so they read as
deploy-and-recover rounds, not standing failures (the deploy_failure vs
defect_intake classing held; none were `defect_intake` against the standing
system).
**Named constraint: the prod-found-defect recovery loop on infra deploys** — not
an agent median but the deploy→prod-found-class→re-deploy round-trip, whose token
+ lead-time cost is dominated by re-spawning a fat cicd subagent to remediate.
The standing attack moves UPSTREAM of the deploy: pin the recurring classes at
BUILD time so they never reach a real deploy — EXP-060 (IAM grant = full op set),
EXP-061 (ESM bundle createRequire/CJS + import-smoke), EXP-062 (migration converts
+ deletes the CI pipeline). Orchestrator (median 900s) and tester (830s) remain
the medians-table constraints for app-only cycles; engineer (720s, n=65) is the
volume agent.

**Token estimate (EXP-055, cost side of §24) — mega-session cycle (≈20 subagent
dispatches).** This was a VERY large session; where the tokens went, ranked:
1. **The cicd subagent around infra deploy round-trips** (still the dominant
   single consumer) — large spawns (≈80k–140k each) for the SST migration, the
   ingest IAM remediation re-spawn, the Fargate cutover + the UC-35/38 tail, the
   read-model UC-A3 deploy. Each prod-found defect that reached a deploy forced a
   FRESH fat-cicd re-spawn to remediate (re-loading infra context from scratch).
2. **Engineer dispatches** (n=65 stage rows this project; ~9 build UCs this
   session) — necessary build cost on the CFR-bearing constraint; NOT a cut target.
3. **Orchestration of the multi-delta sequence** — gate-holding, ledger/flow
   recompute, registry scoring (judgment-dense, not scriptifiable).
**Single highest-leverage reduction, scored on DORA-per-token (not tokens
alone):** the build-time prod-defect pins (EXP-060/061) and the migration-
completeness rule (EXP-062). Each prevented prod-found defect removes one full
fat-cicd remediation re-spawn (the most expensive token unit in the cycle) AND
improves CFR/MTTR — the ideal case where a token cut also helps DORA. REJECTED as
before: any engineer/cicd model-tier downgrade (would risk CFR on the constraint);
a cut to the consumer-skill or fitness-function design work (buys observability
that protects MTTR). Accepted token INCREASE: the import-the-bundle smoke and the
grant-completeness pin tests add a little build cost to remove a prod round-trip.

Targets in force: lead time < 3600s wall in-session; deployment frequency
≥ 3/active-day; CFR → 0%; MTTR < 600s validated same-session.

## 5. Wait-time taxonomy (the flow model)
The orchestrator reads the baseline as a flow model, finds the constraint, and
attacks the dominant wait class. Recurring classes and their standing fixes:

| Wait pattern | Fix (where it lives) |
|---|---|
| Session-boundary idle (overnight gaps) | Session continuity (§13) |
| Pipeline iteration loop (fix-push-wait on novelty) | cicd pre-flight + fail-fast (cicd.md) |
| Human gate wait | Auto-approve + batch gates (§9) |
| Prod-found defect cycle | Cross-stack contract + walking-skeleton probe at synth/skeleton time (engineer.md, §17) |
| End-of-iteration human prompt | Auto-retro at delivery (§20) |
| Smoke regression / fragile selector | Stable selectors + surface-change done condition (engineer.md, tester.md) |
| Permission prompts | Command-form contract + committed allowlist (§15–§16) |

---

## 5a. Failure semantics — whose problem is it (v30 — human-directed)

A **5xx from a call indicates the CALLED service is failing** — it may come
back (callers use **jittered exponential backoff** before concluding failure)
or it may be defective: **if we own the failing service, the conclusion of a
5xx is a DEFECT TASK raised** into the open-items register / defect flow —
never just an error log. A **4xx indicates the INPUT to the call was wrong —
the caller owns the problem**: inbound 4xx = our caller's data; a 4xx we
RECEIVE from a dependency = our request construction, our defect. Acceptance
cases, validation specs, and runbooks classify on these semantics.
(Operational detail per role: agent definitions.)

# STAGE 1 — Next-work selection & gates

## 6. Loops
- **Intake (v40)** → `/intake` — requirement OR defect enters here, JTBD-framed,
  valued/costed; the one upstream human gate (§F5).
- **Continuous pull (v40)** → `/loop-run` — the inner dev loop pulls ready
  use-cases (parallel by independence, §F2/§F6) until queues drain; replenishes
  just-in-time (§F3). `/iteration-run` is now the SINGLE-use-case pass this loop
  invokes; `/slice-next` is product's internal replenishment routine, no longer a
  human gate.
- **Flow status (v40)** → `/flow-status` — queues, buffers, time thieves (§F4).
- **New-requirement workflow** — ONE workflow, two triggers: auto-kicked by
  `/project-new` (a brand-new project) or run standalone by `/requirement-new` (a
  new requirement on an existing project). Sequence: product vision → architecture
  + security review → chunk plan → capabilities → first slice.
- **Per iteration (push mode)** → `/iteration-run` (ends at retro-complete, §20)
- **Retro** → `/retro` — fires at the §F8 cadence (routine slice/chunk closes batch
  to threshold 3; prod defects / deploy failures trigger immediately — v69 EXP-085)
- **Defect** → `/defect` — structured intake (expected/actual/intent/importance;
  prompts for anything missing), reproduce-to-confirm (no phantom fixes),
  prioritise (§38), fix defect-as-spec + prod re-check, then a gap-closing
  retro that names the process gap and proposes a closing experiment with its
  applies-to predicate.

## 7. Agent roster
| Agent | When dispatched |
|-------|----------------|
| product | vision + slice definition (and parallel N+1 per §9b) |
| solution-architect | architecture delta + security review (and parallel N+1) |
| cicd | capabilities (environments, pipeline, rollback, flags, allowlist) |
| engineer | TDD build on trunk |
| tester | in-prod / public-surface validation |
| documenter | dispatched in parallel, in the background, at delivery (§21) |

### 7a. Model tiering
Each agent's `model:` frontmatter is a tunable lever, scored like any other
change: match the model tier to the **judgment density** of the agent's task,
not its prestige. Current assignment: **opus** = engineer (long-horizon TDD
build, the CFR lever), orchestrator (the ToC constraint; boundary judgment),
solution-architect, ui-designer (design reasoning); **sonnet** = product, cicd,
tester, flow-manager (well-structured, procedure-led work); **haiku** =
documenter (short rewriting tasks). On any model release the retro re-assesses;
every tier move is a registered experiment with a named DORA metric and a
revert condition (cost without a metric move = revert).
**Availability resilience (v49):** an agent's `model:` must name a model the
session can actually run — a pinned-but-unavailable model is a hard stop, not a
degraded run (the v48→v49 trigger: Fable 5 went unavailable mid-run and the
engineer/orchestrator builds died on dispatch). When a model is retired or
unreachable, re-tier its agents to the next-available model that best preserves
the validated judgment-density intent **in the same retro**, before resuming the
loop. Prefer models with confirmed session access over nominal capability.
**In-session bridge:** agent `model:` frontmatter is resolved/cached at session
start, so editing it does NOT rescue an already-running session — the dispatch
re-resolves to the dead model and fails again. Until the session reloads, the
orchestrator passes the Agent tool's per-call `model` override (it takes
precedence over frontmatter) on every spawn of the affected agent; the
frontmatter edit is the durable fix for the next session.
**Scoring quarantine.** A model-tier change is a confound for every DORA-scored
experiment, because a metric move during the change could be the model, not the
change. When any agent's `model:` changes, the retro **opens a quarantine window**
(note it on the experiment registry header with the date + which agents moved).
Experiments scored inside the window MUST flag `model-confounded` and **may not be
marked `validated` on a DORA move alone** — they need either a mechanism-level
confirmation (the behaviour demonstrably fired, independent of the metric) or a
scoring opportunity after the window closes. Where feasible, hold one comparable
agent on the prior tier as a control. The window closes when the next retro judges
the tier stable (default: 2 slices on the new tier with no further model change).

## 8. Project classification
Two postures the slice planning and capability work follow:
- **Cloud/hosted**: full AWS Well-Architected, IAM, the `aws-architecture` skill.
- **Local-only** (CLI, library, script): skip cloud scaffolding.

(Architect effort per posture is detailed in `solution-architect.md`.)

## 9. Deploy-gate auto-approval

The **two-gate model (§F5) is the baseline** — the only blocking human gates are
requirement/defect **intake** and **infra-bearing deploy**. This section defines
how the deploy gate *auto-approves*. (The historical push-mode four-gate sign-off
model is retired in v59; it survives in `process-history/` and as the §F5 "each
removed gate → a named assurance" mapping.) Every gate decision is appended to
`work/<project>/decision-log.md`; between gates, run unattended.

**a. Auto-approve where the outcome is clear:**
- Go/no-go to deploy: orchestrator auto-approves when all tests pass AND lint is
  clean AND build succeeds AND no blocking deviations — **application-only diffs
  only**. Infra-bearing diffs (new stacks, IAM changes, new attack surface)
  remain a human gate.
- **Gate-4 timing under trunk-CD (v35):** every push deploys, so for a slice
  whose route contains infra-bearing commits the human go/no-go is obtained
  AT ROUTE COMPLETION — before the build wave that will push them — not after
  build. An engineer never holds a green commit waiting on a gate (that breaks
  §14); the ORCHESTRATOR schedules the gate ahead of the wave instead. A
  deploy that lands before its gate answer is a gate-timing principle failure
  even when the content was pre-approved at gate 3 (s007 evidence).
- Arch + security for local-only projects with no new infra: architect
  self-certifies; orchestrator confirms; no human wait.
- **Security review auto-accept (all project types):** when the architect's
  delta states an explicit conclusion of "no new attack surface, no new data
  flow, no new trust boundary", the orchestrator confirms the conclusion is
  present and auto-accepts. Gate 3 still requires human approval if the review
  surfaces any new control, open risk, or deferred recommendation.

**b. Parallel N+1 planning.** Because decisions are logged, planning the NEXT
slice (product + architect) may begin while the CURRENT slice is built/tested,
provided the two are sequentially independent; otherwise serialise.

**c. Batch gate decisions.**

## 10. Next-work selection — the open-items register
"What runs next" is decided against the full set of unaddressed items, not just
the chunk plan. System-learning residue lives in `/process/improvement-slices/`
+ `process/open-items.md` (the project-agnostic carry-forward register);
project residue lives in `work/<project>/open-items.md`.

When work is selected, also identify and log which ACTIVE experiments
(`/process/experiments.md`) it will exercise (match the work to each
experiment's applies-to predicate, §25a) — this is the scoring opportunity set
for that work, known up front.

Selection rule, applied at every "what next" decision and logged:
1. **DORA-helping process improvements first** — system learning is this repo's
   goal (bounded by judgement: don't starve a real customer need).
2. **User-value items ranked by job served** — core jobs beat secondary jobs
   (product classifies each job core/secondary).
3. **Risk items** (security hardening, debt) scheduled before the slice that
   widens the surface they guard.

(Register mechanics — harvesting residue from every agent return — are in
`orchestrator.md`; job classification in `product.md`; chunk-plan ownership in
`product.md`.)

---

# STAGE 2 — Slice planning (slice / use-cases / acceptance)

## 11. Slice → use-case hierarchy
> chunk (capability) → slice (customer value, gated) → use case
> (separately buildable/testable unit) → route steps (red→green commits)

A slice is decomposed at planning into **use cases** so the build is not
serialised as one lump. Each use case states actor, trigger → observable
outcome, its own done condition, the acceptance cases it pins, and its
**dependency edges** (only where genuinely required — a false edge costs
parallelism). The orchestrator reads the edges as the parallelism plan;
genuinely sequential mutations of one seam stay sequential.

(Decomposition is product's craft — `product.md`; engineer routes per use case
and tester validates the slice as one increment — their defs. Chunk plans keep
slices adding up to capability — owned in `product.md`.)

## 11b. Every chunk maps to a Job-to-Be-Done with articulated value (v72 — human-directed)
**A chunk whose value we cannot articulate cannot be prioritised.** A job *code*
(`J0`, `J3`, …) is not a value statement. Every chunk MUST carry a JTBD value
statement that answers three questions, in user/beneficiary terms:
1. **Who gets value** — the named beneficiary (a specific consuming system, an
   operator, the dev team), never "the system".
2. **What they can now do** that they could NOT before this chunk exists.
3. **Why this takes priority** — the value/sequencing rationale. For SECONDARY /
   enabling chunks (e.g. most J3 "normalise+store" work), this MUST name the CORE
   value it unblocks and why it is on the critical path — otherwise the chunk
   reads as mechanism with no value, which is the failure this rule fixes.

Each block also carries a **Purpose** — a few words of WHY (not what) — that
becomes the chunk's board title suffix (`CHK-N · <name> — <purpose>`), so the
board reads as value at a glance, not mechanism. Product authors this
(`product.md`) in `chunks.md` (CHK-keyed block); it is the basis for
prioritisation (flow-manager costing/sequencing, §10/§F) and is mirrored to the
chunk's human-board Project title + body (`process/linear-mapping.md`).
A chunk that cannot be articulated this way is **not prioritisable** — surface it
(the board flags `⚠ JTBD value not articulated`), do not cost or pull it until
product states the value; **never fabricate value to make it schedulable**. If
articulating forces the realisation that several JIT chunk-wrappers are really
one job, consolidate them (a fragmented value is a planning smell). Evidence:
human directive 2026-06-30 — chunk Projects shipped as bare mechanism titles with
no who/what-now/why; 15/15 back-filled from the JTBD catalogue, and the exercise
surfaced two chunk-consolidation actions (CHK-9-* AOS-alignment; CHK-6-SLC-016
into CHK-6). [EXP-073]

## 11c. Decision-debt — accepted tradeoffs with a revisit trigger (v73 — human-directed)
Some scope decisions are **removals/acceptances we do not expect to revisit** —
distinct from tech-debt (a shortcut *queued* to be paid back) and from the
decision-log (the record of a decision made). A **decision-debt** entry is a
deliberate long-term decision that **carries a known tradeoff** and a **revisit
trigger**: we accept the tradeoff and **do not spend cost re-evaluating it until
the trigger fires**. Recorded in `work/<project>/decision-debt.md` (append-only):
each entry has `id (DD-nnn)`, the decision, the **tradeoff accepted**, and the
**revisit trigger** (a concrete future condition — a new requirement pressuring
the same axis, or a defect — NOT a cadence, NOT "someday"). When a requirement is
descoped/removed on a tradeoff, log it here and reference it from any tech-debt
entry it supersedes (that entry becomes `ACCEPTED → DD-nnn`, off the remediation
queue). This keeps a settled decision from being silently relitigated and keeps
the board/queues free of work we have decided not to do. Evidence: DD-001 removed
the live OAG `/locations` airport-reference adapter (static is permanent; revisit
only on a freshness-pressure requirement), reclassifying TD-001. [EXP-076]

## 11a. Use-case flow — deploy-per-UC (v33 — human-directed)

Use cases do not wait for the slice to batch-deploy; each runs its own thin
build→deploy→probe loop on trunk:

1. **A use case with a deployable surface is DONE only when it is deployed and
   its committed probe is green in prod** (flag-OFF deploys count — dark code
   deployed early is the §40 norm). The probe is ENGINEER-owned, committed,
   parameterised (the `make ws-skeleton` pattern) — never a tester dispatch.
   The tester still validates the SLICE exactly once (Set C); per-UC probes
   shrink what reaches it, they do not multiply it (protects the constraint).
2. **Deploys never overwrite each other by construction, not by coordination:**
   same-pipeline deploys serialise via the pipeline's concurrency group
   (cicd.md); cross-pipeline order is a §19 schedule edge in route.md (e.g.
   infra route deploy precedes the SPA flag flip that consumes it). If a UC's
   deploy must wait on another's, that is a route edge — never a human
   watching two pipelines.
3. **Builds overlap freely** wherever §37 seams allow — build start order is
   never the constraint; deploy ORDER is. (The "start build 2 when build 1
   begins deploying" stagger is strictly weaker than seam-based parallel
   builds and is not used.)

Targets: lead time (no end-of-slice deploy batch), deployment frequency,
MTTR attribution (smaller blast radius per deploy). Anticipated: defects
surface at the UC probe, not at slice validation. (Per-role detail:
engineer.md.)

**Infra-flag — defer an unconfirmed external dependency, don't block the
skeleton (§11a.1, v57).** The §40 use-case-flag pattern extends from app code to
INFRA: when an infra capability depends on an external resource whose identifier
is not yet confirmed (per §17.1), the capability ships **behind a default-OFF
infra flag** so the CORE walking skeleton deploys NOW and the unconfirmed
dependency is deferred to an open item — never held back from deploy until the
dependency is resolved. The flag default is OFF (the skeleton's promotion
condition flips it once §17.1's check passes); the deferred capability and its
confirm-check become an open-items entry. Evidence: DEFECT-OAG-001 — guarding
OTel telemetry behind `otelEnabled=false` shipped the pull-feed skeleton (UC-21
AC-21a-f green in prod) while AC-21g (OTel) was deferred, instead of the whole
slice rolling back on the layer ARNs. Target: deployment frequency + lead time
(skeleton ships) guarded by CFR (the OFF default carries no live risk). [EXP-057]

## 12. Acceptance cases
Product and architect co-author the slice's acceptance cases; the architect
supplies the technical/observable conditions and security controls (which become
policy tests at build time). Every acceptance case is tagged with its use case.

## 12d. Every use-case is board-ready: title, why, acceptance (v72 — human-directed)
The human-facing plan/progress board (the one-way Linear **state** mirror —
mechanism in `process/linear-mapping.md`) shows ONE issue per use-case, and each
issue MUST carry, **sourced from the use-case's own artifact and never invented
at sync time**:
- a **human-readable title** — the use-case heading, not a bare id;
- a **why-it-matters** statement — the observable outcome / value the use-case
  delivers, so a human reading the board knows why it exists;
- its **acceptance criteria** — the AC cases it pins.

These already live in `use-cases.md` / `acceptance.md` (§11, §12); the board
**mirrors** them, it does not author them. A use-case the sync finds with **no
acceptance criteria** is flagged **`needs-acceptance`** and is **not Ready** —
it cannot be pulled or built until product authors them (§F definition-of-ready).
Genuine gaps are flagged, **never back-filled with fabricated criteria**. The
mirror stays state-only (no DORA — those live in the ledger, §0). Product owns
the title/why/acceptance in the artifact (`product.md`); running the sync is the
orchestrator's. Evidence: human directive 2026-06-30 — board issues had shipped
as bare `id — job` with no rationale or acceptance; 96/101 back-filled from real
artifacts, 5 true gaps flagged rather than invented. [EXP-072]

## 12b. Multi-party / multi-instance modelling (v38 — human-directed)
When a use case involves MORE THAN ONE PARTY operating SEPARATE INSTANCES
(two browsers, two devices, a sharer and a joiner), the happy-path narrative
of one instance is not the use case — model BOTH sides:
1. **A state machine per instance.** Each party's instance has its own states
   and transitions; name them. A change in one instance that must surface in
   the other is a transition with a SYNC POINT.
2. **Classify every sync point as in-band or out-of-band.** *In-band* =
   the application carries it (a WS frame; a join writes Games and triggers a
   state change visible in BOTH boards — model that fan-out). *Out-of-band* =
   a human carries it outside the app (sharing a code by chat; reading it off
   the screen). Out-of-band sync is still part of the use case: the affordance
   that feeds it (copy/display) must serve the RECEIVING party's actual need
   (the joiner who TYPES needs the code; the joiner who CLICKS needs the link —
   serving one while labelling for the other is the s008 copy-URL defect).
3. **Acceptance covers the cross-instance transition, not just one side.**
   The two-browser tests already exist (skeletons); extend the THINKING to the
   affordances and state each party sees — a defect found only by a human
   driving two instances by hand is a modelling gap, not a test-count gap.
(Per-role: product models both parties' state machines + sync-point table in
use-cases.md; engineer builds to both; tester validates from each instance's
vantage incl. the receiving party's expectation.)

## 12a. Shared change-impact model (v31 — human-directed)

Every project maintains a small, shared, committed dependency model in
`work/<project>/architecture/dependencies/` — mermaid format, load-bearing:

- **`use-case-deps.mmd`** — use-case / behavioural dependency graph (product
  authors at slice planning per §11; engineer extends as use cases land).
- **`class-deps.mmd`** — module/class dependency graph at SEAM granularity
  (engineer-owned; node = module/port/adapter, never every class).
- **`data-flow.mmd`** — runtime data-flow including **platform gates as
  explicit nodes** (WAF, authorizers, identity-source checks, cache layers,
  TTL/lazy-deletion semantics, CSP). Solution-architect-owned; each slice's
  delta is expressed as a diagram delta. A platform gate that isn't a node is
  how strike-class defects hide.

Rules of the game:
1. **Read-before-build** — the engineer constructs the route against the model;
   hard edges in the model ARE §19 schedule constraints (DEFECT-H2-001's
   mint-before-secret push is the evidence: the edge existed, no one had to
   read it).
2. **Updated-in-commit** — any commit that adds/removes/redirects a dependency
   edge updates the relevant `.mmd` in the SAME commit, marking changed
   nodes/edges (mermaid `classDef changed`). An unmarked dependency change is a
   principle failure.
3. **Read-before-test** — the tester derives its test plan from the model diff
   since the last validated sha: changed nodes/edges name the areas to test.
   The plan is a tick-off list in the slice directory, progressed as validation
   runs. Specs are tagged to the node(s) they cover (`@covers <node-id>`) so
   the impacted-spec set is mechanically listable, and spec VALIDITY is
   reassessed (not just re-run) when a covered node changes.
4. **Load-bearing or deleted** — an artifact no agent reads at decision time is
   ornamental; keep node granularity coarse enough that updating is one minute
   of work, not a parallel codebase.
5. **One canonical node-id form (kebab-case)** — a mermaid node id and the
   `@covers <node-id>` tag that points at it MUST be the identical string,
   kebab-case (`port-game-store`, not `portGameStore`). A mismatch is a §12a
   authoring failure: `make impacted-tests` (IMP-007) reports the node as
   false-uncovered and will NOT fuzzy-match camelCase↔kebab — silently
   equating them would hide exactly the drift the model exists to expose.

Targets: **tester** (constraint — discovery replaced by reading a diff),
**CFR** (impact-blind testing misses the changed area), **MTTR** (data-flow is
the diagnosis map). Tooling: IMP-007 (`make impacted-tests`). Per-role detail:
agent defs.

---

# STAGE 3 — Build (trunk, TDD)

## 13. Session continuity (primary wait-reduction lever for local-only)
- **a. Start a session, finish a deliverable.**
- **b. Requirement workflow + first slice in one session.**
- **c. Don't dispatch the tester near end of session.**
- **d. Retro runs in the same session as delivery — automatic (§20).**
- **e. Never leave a defect recovery pending validation at a session boundary.**
  If a roll-forward fix deploys, re-validate immediately in the same session
  (an overnight re-validation gap inflated one MTTR pair to ~9h).

## 14. Commit discipline
The engineer commits to trunk every time the full test suite **and lint** go
green (lint passes inside the done-condition, not discovered post-commit).
- **Commit when green and lint clean, never when red.**
- **Message states intent, not mechanics.**
- **One logical change per commit.**
- **Commit TARGET — two separate repositories.** Each `work/<project>/`
  is its **own independent git repo** so a project can be lifted out and exist
  standalone. **Project output** (code, slices, decision-log, items.csv, queues,
  the project's DORA `per-project.md`) is committed INSIDE the project repo:
  `git -C work/<project> add <paths> && git -C work/<project> commit -m "…"`.
  **Agent-structure and process changes** (`.claude/`, `process/`, `CLAUDE.md`,
  `README.md`) are committed in THIS parent repo. The parent repo does not track
  project contents (`.gitignore`: `/work/*/`); the shared process DORA ledger
  (`process/dora/ledger.csv`) and `work/ACTIVE` stay in the parent (agent-system
  state). Never mix the two in one commit — a project-output commit in the parent
  repo (or vice-versa) is the cross-boundary leak this split exists to prevent
  (cf. the bare-root-`slices/` principle failure).
- **Push to a VERIFIED remote as part of the done-condition (v60 — human-directed).**
  The blanket "never push" of v59/EXP-049 is superseded: it batched work locally
  (OagEventSource reached **44 commits ahead** of `origin/main` before anything was
  integrated — the entire integration+deploy risk pooled into one big-bang event
  that then failed CI twice). Integration is part of *done*, not a deferred human
  step. Rule:
  - **No remote, or a remote the agent cannot verify is the project's intended
    origin → do NOT push.** Report and stop. (The v50 local-by-default guard and
    the 2026-06-17 unverified-push failure still bind: an unknown destination is
    never a push target.)
  - **A configured, verified remote exists → push trunk to it each time a use-case's
    full done-condition is met** (suite **and** lint green, §14 commit rule
    satisfied). Do not accumulate; one UC's green trunk is one push. "Verified"
    means `git remote get-url origin` resolves to the project's known origin
    (recorded in the decision-log / project.md), not a destination the agent
    invented.
  - **After every push, set off the non-blocking CI watch (§19b)** and keep working;
    a red run where local was green becomes a defect, never a silent failure.
  Target: deployment frequency + gross lead time (work integrates continuously
  instead of pooling), guarded by CFR (each push is already green locally). [EXP-069]
- **Parallel-engineer commit isolation (v39).** When two+ engineers work the
  same slice on one working tree, a file BOUNDARY is not enough — `git add`
  over a shared index sweeps a co-worker's pre-staged files into your commit
  (logged 3×: route-sweep, and both sides of the s009 split). Isolate the
  commit: either dispatch parallel engineers in **worktree isolation** (the
  orchestrator's wave-plan choice for genuinely concurrent seams), OR commit
  with an explicit pathspec — `git commit -- <your-paths>` — never `git add`
  then bare `git commit`. The orchestrator names which in the wave plan.
- **Never `git stash` a shared tree (v61, DEFECT-OAG learning).** Do not run
  `git stash`/stash-all to clear the tree for your own rebase: it captures OTHER
  agents' uncommitted changes and flow bookkeeping, hiding their work in a stash
  the next agent doesn't know to restore (a ui-designer stash-all swept an
  engineer's WIP + the flow `edge-ledger.md` learning, which was nearly lost and
  needed manual recovery). Commit ONLY your explicit pathspec and `git pull
  --rebase --autostash` for just your own staged change; leave every file you do
  not own untouched. Target: gross lead time (no rework from lost work), CFR.

## 15. Command form — the allowlist contract (all agents)
Every Bash command matches the committed allowlist in `.claude/settings.json`
so it runs without a permission prompt:
- Run everything from the project root. NEVER `cd … && …`, `pushd … && …`, or
  `source … && …` — compound prefixes match no allowlist pattern and always
  prompt. Use `npm --prefix <dir> run <script>`, `make -C <dir> <target>`,
  `git -C <dir> …`, root-relative script paths, and `make -C
  work/<project>/src/infra <target>` instead of `cd`-ing into infra.
- Commands must not hand-assemble env-var prefixes or long argument strings
  inline. Defaults live in config (spec files, package.json, playwright config);
  parameterised invocation lives in the root `Makefile` (`make dora-record …`,
  `make validate ITER=… SLICE=…`).
- A command class the allowlist lacks is a capability gap: name it so cicd
  extends the allowlist in the same slice — never work around it with a novel
  one-off command shape. A prompt caused by an avoidable command form is a
  principle failure.
- **Edit files with the file tools, never Bash (v43).** Mutating a file with
  `cat >> f <<EOF`, `echo … >> f`, `tee`, `sed -i`, or any shell redirection is
  a novel command shape that ALWAYS prompts and adds gross lead time. Use the
  **Edit/Write tools** for every prose/markdown/CSV file (decision-log,
  open-items, experiments, slice artifacts, project.md, …) — they need no
  approval. For the DORA ledger use the committed recorder
  (`python3 .claude/skills/dora-ledger/scripts/dora.py record …` / `make
  dora-record …`), never `cat >> ledger.csv`. Reach for Bash only to RUN things
  (tests, build, git, scripts), not to write files. A permission prompt caused
  by editing a file through the shell is a principle failure. [EXP-032]

## 16. Tools over permissions
Human permission prompts are a wait class to engineer away, not a safety
mechanism. Safety comes from tests, gates, scoped IAM, and committed reviewable
tooling.
1. **Recurring command class → committed tool + narrow allowlist** (exact path
   or target, never an interpreter or task-runner wildcard).
2. **Mutating actions are protected by the process, not the prompt** — `git
   push` to trunk is allowlisted because tests+lint must be green (§14) and
   gates precede deploys (§9).
3. **New surface → allowlist in the same slice** — cicd OWNS
   `.claude/settings.json` and applies the narrow read-only/scoped patterns the
   surface needs in the capability step, before the build.
4. **Tooling self-service** — every agent CREATES the committed tooling its role
   depends on (make targets, scripts, spec helpers) in the same slice, tested
   and documented. Flag-don't-fix applies only to what an agent cannot own
   (permissions → cicd). A committed parameterised tool is the opposite of an
   improvised workaround.

5. **Session-start config-resolution rule (v55, EXP-050).** Harness config that
   is read **at session start** — `.claude/settings.json` `env` (the agent-shell
   PATH and other exported vars), agent `model:` frontmatter (§7a), allowlist
   patterns — does NOT take effect for shells/dispatches already running in the
   current session. Editing it mid-session is the **durable fix for the NEXT
   session**, never a rescue for this one: a fresh subagent shell spawned later in
   the SAME session still inherits the session-start snapshot (evidence: a
   committed `env` PATH-prepend did not reach UC-16's fresh engineer shell — plain
   `npm` still command-not-found — exactly as a `model:` edit doesn't rescue a
   cached session, §7a). Consequences:
   - A capability whose only mechanism is session-start config (PATH via `env`)
     must be **bridged mid-session by a mechanism that does NOT depend on the
     inherited shell env** — a committed wrapper / Make target whose recipe sets
     what it needs INTERNALLY (e.g. `make -C <dir> test` exporting the toolchain
     bin), or the per-call override where one exists (the Agent tool `model`
     override for `model:`, §7a). The hand-typed inline `PATH=…` / env prefix is
     NOT the bridge — it is the §15 novel-shape violation the capability exists to
     remove.
   - Such a config change is **scored on the FIRST relevant command of the next
     fresh session** (where it can actually take effect), not on the session in
     which it was applied; a same-session failure is "unvalidatable yet", not a
     refutation.

(The root `Makefile` is agent-ops; the per-project `src/infra/Makefile` is
deploy-ops only — never conflate them.)

## 17. Defect-prevention contracts (cross-agent principle)
Defects whose root cause is detectable before production must be pinned by a
test or probe **at the level the risk actually lives** and at the earliest point
they are visible — not found in live validation. Standing classes:
- **Cross-stack / cross-boundary contracts** are asserted at **synth time**
  (synthesise both templates; assert the path/name contract between them).
- **IAM grant = the FULL operation set of the code path, not its name (§17.2,
  v58).** A grant scoped to a path's HEADLINE verb breaks in prod the first time
  the path's *other* operations run. A "write"/"append"/"ingest" path is almost
  always READS-THEN-WRITES — it queries the current head/sequence, does
  conditional gets, and `kms:Decrypt`s encrypted items before writing. So an
  **event-store APPEND grant = the read ops + the write ops**
  (`dynamodb:Query`+`GetItem`+`PutItem`/`UpdateItem`, plus `kms:Decrypt`+
  `GenerateDataKey` for an encrypted table), never `PutItem` alone. The architect
  derives the grant from the full SDK-op set the code path issues (security note,
  §65); the engineer's code↔policy pin asserts the grant covers exactly that set.
  A write-only grant on a reads-then-writes path is not "tighter" — it is a latent
  prod `AccessDenied`. Evidence: OagEventSource ingest hit it 3× (missing
  `dynamodb:Query`, then `kms:Decrypt`, then the append-path loadStreams read).
  Target: CFR (prod AccessDenied on the first real event) + MTTR. [EXP-060]
- **Diagrams are render-validated before they are reported done (§17.5, v72).** A
  Mermaid diagram (a `.mmd` file or a ` ```mermaid ` block) is NOT done until it
  passes the committed `make -C work/<project> render-diagrams` gate (mmdc over
  every diagram; exits non-zero on any parse error or scanned "Parse error"). This
  binds EVERY diagram-emitting agent — **documenter, solution-architect** — AND the
  **orchestrator**: no agent reports a diagram, or a diagram *fix*, complete without
  a green gate run. "Diagrams are mandatory" is a content rule WITH an executable
  check behind it; a diagram claimed fixed without re-rendering is a process
  failure. Evidence: DEFECT-OAG-033 — 7 OagEventSource diagrams silently
  un-renderable; a `fix(diagram)` committed without re-rendering (0f96d3e). Target:
  CFR (silently-broken diagrams shipped as done) + GLT (no reactive per-diagram
  defect cycles). [EXP-088]
- **Node ESM bundles get a `Dynamic require` shim + an import-the-bundle smoke
  (§17.3, v58).** An ESM-bundled Node handler whose transitive deps (`@aws-sdk/*`,
  `@azure/*`) do an internal `require()` crashes at RUNTIME with `Dynamic require
  of "X" is not supported` — it bundles clean and fails only when the path runs,
  so it surfaces in prod. cicd's `bundle:<target>` injects the CJS shim banner
  (`createRequire(import.meta.url)`) or bundles as CJS, and a committed smoke that
  `node`-imports the bundle fails until the shim is present (DynamoDB
  reserved-keyword crashes — `ttl`, `name`, `status` — are the same
  build-clean/run-fail class, aliased via `ExpressionAttributeNames`). Evidence:
  the crash recurred across fold-demo, the Fargate consumer, AND the
  feed-projector this session. Target: CFR + MTTR. [EXP-061]
- **External / cross-account resource identifiers (§17.1, v57).** A resource
  identifier the stack does NOT create — a Lambda layer ARN, a resource shared
  from another AWS account, a third-party endpoint or token reference — must be
  **asserted to resolve BEFORE the first real `cdk deploy`**, never discovered by
  a deploy rollback. A written "CONFIRM at build: <id>" note is **not** a
  confirmation; the confirmation is a committed check that FAILS until the
  identifier actually resolves (a synth-time existence/permission probe —
  `lambda:GetLayerVersion`, `sts:GetCallerIdentity` on the owning account, a
  cheap describe — or a `--require-approval` diff a human reads). Evidence:
  DEFECT-OAG-001 — the first OagFeedStack deploy rolled back on `dash0-*` layer
  ARNs that do not exist in the OTel-community account; the delta-001 confirm-note
  was written but never executed, so the un-confirmed cross-account dependency
  reached a real deploy. Target: CFR (first-deploy rollback) + MTTR. [EXP-056]
- **New platform-integration mechanisms** (first WebSocket, first CDN behaviour
  class, first auth flow, first queue) get an early **walking-skeleton probe**:
  one real request through the full deployed path with the REAL client
  technology, BEFORE use cases are built on top.
- **Wire-on-deploy hand-offs** ("the deploy/app wires X"): the receiving role
  lands a contract test that FAILS until X is wired — an un-pinned hand-off is
  undetectable until a human watches a browser.

**"Real client" for a web surface means a real BROWSER, never a node probe.**
A node `ws`/`fetch` probe runs below the browser's security/transport layer and
returns a FALSE GREEN — it bypasses CSP `connect-src`, runtime-config injection
ordering, mixed-content rules, and browser event ordering (the s-defect class:
4 of 6 root causes were browser-only, invisible to node). Drive the probe in a
browser via committed Playwright; use an interactive browser (Playwright MCP)
for exploratory DISCOVERY before a spec exists, then convert each finding into a
committed spec for REGRESSION. Discovery and committed specs are complementary,
not redundant: you cannot write the regression assertion for a failure mode you
have not yet discovered. **A defect is not closed until the end-to-end USER
symptom is reproduced and pinned** — not just the first true-but-secondary cause.

This is the lever on the **tester constraint**: the tester is the slowest step,
and its cost is driven by the QUALITY of work arriving at it. Surfacing
browser/transport/policy breaks at skeleton time keeps them out of the tester's
hand-off and out of re-validation rounds.

**Local standability (v28, principles/02).** Most of the system can stand up
locally (a committed `run-local` class entry point; hexagonal adapters with
local substitutes), and the ENGINEER builds real-browser Playwright tests in
the BUILD phase against that stand-up — browser behaviour is developed with a
browser, not discovered by the tester in prod. What cannot stand locally is
enumerated in the delta, each gap mapped to its covering control (skeleton
probe / synth contract / policy pin / prod validation).

The architect's delta names when a mechanism is new AND what stands locally
vs cloud-only; the engineer's route places the contract test / browser probe,
builds the local stand-up + browser suite, and schedules the thin early
deploy it implies; the tester carries ≥1 browser-transport spec and an honest
harness, re-exercising (not re-discovering) the engineer's browser flows.
(Operational detail: `engineer.md`, `tester.md`, `solution-architect.md`,
principles/02; capability: IMP-006.)

---

# STAGE 4 — Deploy

## 18. Deploy logging & duration
- The orchestrator logs the `deploy` event row immediately when the tester
  passes (or cicd/engineer on pipeline success for cloud/hosted, §2).
- Each agent brackets its work with `task_start`/`task_end` ledger rows; the
  engineer populates `duration_s` with wall-clock seconds.

## 19. Scheduling over compensation

**Trunk-CD corollary (v29, from s005-h1):** in continuous deployment EVERY
push is a deploy attempt — a prerequisite (role grant, bootstrap, variable)
must be in place before the FIRST PUSH of code that needs it, not before a
notional later "deploy phase". Route deploy-prereq steps ahead of the build
steps whose pushes will trigger the pipeline. (Original section follows.)
A hard sequential dependency is a scheduling constraint, not an error to
tolerate. **Configuration follows its resource** (set a value that references a
resource in the step AFTER the resource exists — capture-output-then-set), and
**no compensating logic** for out-of-order execution (no sentinels,
exists-checks-that-skip, retry-until-created, or tolerant guards absorbing an
order designed never to occur). Graceful degradation for genuine runtime
conditions remains correct. A hidden hard edge found during parallel work is a
scheduling finding: re-serialise and record the edge. (Pipeline detail:
`cicd.md`; orchestration: `orchestrator.md`.)

## 19a. A framework migration completes its pipeline (v58)
When a slice MIGRATES the deploy framework (CDK→SST, Serverless→CDK, a runtime
or IaC change), **converting the CI/CD pipeline and DELETING the dead deploy path
is part of the migration's done-condition — never a deferred follow-up.** A
migration that re-platforms the deploy mechanism but leaves the old pipeline
running the old commands produces a CI deploy pipeline that has never run and
would FAIL, silently non-functional because all deploys are now by hand. That
stale pipeline is a misleading asset of the same class as a comment describing
misbehaviour (EXP-042): it asserts a capability the system does not have.
Evidence: OagEventSource migrated to SST v3 (CDK `OagFeedStack` destroyed, SST
deployed) yet `infra.yml` still runs `npx cdk synth` / "Install CDK dependencies"
/ "Build CDK TypeScript". Rule: in the migration slice the cicd agent rewrites the
workflow to the new framework's deploy command, updates path triggers + role, and
deletes the dead steps IN THE SAME CHANGE; the architect's migration delta names
the pipeline conversion as part of the delta; the EXP-056 pre-flight and the §40
walking-skeleton probe run THROUGH the converted pipeline so it is proven, not
assumed. Target: CFR (a non-functional CI deploy path is a latent failure) +
deployment frequency (a working pipeline replaces by-hand deploys). (Per-role:
`cicd.md` migration-completeness; `solution-architect.md` migration delta.)
**A converted/new pipeline is "proven" only once it has actually EXECUTED GREEN
at least once in the slice that introduced it (v60).** Conversion-in-code is not
proof; deferring the first real run to an open item (OagEventSource OI-007 deferred
the infra.yml proof, so it ran for the first time a session later and failed twice
— `AWS_PROFILE=default` profile-not-found, then a deploy role with zero permissions
attached) is the deferral §19a forbids, applied to the *proof* rather than the
conversion. The migration slice triggers the pipeline and watches it green (§19b).
[EXP-062]

## 19b. Push integrates; a green-local / red-CI run is a DEFECT (v60 — human-directed)
A CI/CD run is the integration truth; a local green is a prediction of it. The two
must agree.
- **Every push sets off a non-blocking CI watch.** The push (§14) does not block
  the loop, but a committed watcher tails the triggered run to completion. Use the
  parameterised tool, never hand-assembly: `make -C work/<project> ci-watch`
  (wraps `gh run watch <id> --exit-status` and returns *only* the failing step's
  error on red — a token-minimal summary, not the whole log).
- **A run that fails while the local suite + lint were green is a DEFECT** (raised
  via `/defect`, JTBD-framed, pre-empts per §F5). "There is no reason a CI run
  should fail when local passes" — when it does, exactly one of two things is true,
  and the defect's fix MUST be one of them (never a re-run-and-hope):
  1. **Local checks did not cover what CI exercised** → close the coverage gap so
     the local suite would have caught it (the CI-only credential path that broke
     this session — local always has an AWS profile, CI uses OIDC env creds — is
     this class: add a check that exercises the env-cred branch).
  2. **Out-of-band manual configuration was required** → capture it in the runbook
     AND automate it as a committed script / Make target. We prefer automation over
     a recurring manual step; a config that must be done by hand each time is itself
     the defect (the deploy-role permission grant this session → `bootstrap-deploy-role.sh`).
- A red CI run is never left red and never silently abandoned: it is closed by
  category 1 or 2, which permanently removes that divergence class.
Target: MTTR (a red push is caught and raised within one watch-cycle, not discovered
later) + CFR (each divergence permanently removes a local/CI gap). (Per-role:
`engineer.md` push+watch+raise; `cicd.md` divergence dichotomy.) [EXP-070]

---

# STAGE 5 — Validate

## 20. Tester scope & auto-retro
The tester validates **customer-observable outcomes** through the public surface
(browser for web, public API for backend); it does not re-implement exhaustive
correctness checks. Target for frontend-only validation < 300s; first-backend
slices may run longer. (How the tester validates — validation-as-code, run
provenance, identity-before-behaviour, stable selectors — lives in `tester.md`.)

**Auto-retro at delivery:** when a slice is marked `delivered` (validation
passed, decision-log row written), the orchestrator runs the retro immediately
and automatically in the same session — no human prompt, no wait. The human may
interrupt or redirect, but their absence must not delay it.

---

# STAGE 6 — Document

## 21. Documenter runs in parallel
Nothing in the process depends on documentation output. At delivery the
orchestrator dispatches the documenter **in the background, in parallel** with
the retro (and with N+1 planning). No gate, agent, or loop step waits on it. The
documenter commits its own changes and documents what shipped, not what was
planned. (Doc + runbook detail: `documenter.md`.)

---

# STAGE 7 — Retro & improvement

## 22. Change-set queued for next iteration
The project-agnostic carry-forward register (unscored anticipated effects + queued
obligations) lives in **`process/open-items.md`** as of the v59 consolidation —
held outside this rulebook so the file stays rules, not a work queue. It is
referenced by §10 (next-work selection) and §24 (improvement slices); the retro
harvests and re-prioritises it each cycle.

## 23. per-project.md discipline
The orchestrator updates `work/<project>/dora/per-project.md` at the end of each
slice retro: slice, change, expected DORA effect, actual, regression flag,
reflection, time-to-first-deploy (s001 only), delivery gap.

## 24. Improvement slices
Process, tooling, and automation improvements are specified and delivered as
slices, exactly like product work, in
`/process/improvement-slices/IMP-NNN-<name>.md` (project-agnostic). Each states
its **job** (the delivery friction it removes, evidenced from the ledger /
principle-failures / observed waits), its **DORA target** (named metric +
anticipated measurable effect), its **done condition** (observable, testable —
not "agents try harder"), and its **protection** (the test, gate, or committed
artifact that protects it once human approval leaves the path). The orchestrator
queues them alongside product slices and picks by best expected DORA return.
Retro change-sets either land as immediate process-text changes (pure rules) or
graduate into improvement slices (when they need tooling/tests built).

## 25. Improvement routing — narrowest owner
The retro and orchestrator route every improvement to the **narrowest artifact
that owns the behaviour**:

| Learning concerns | Lands in |
|---|---|
| One agent's behaviour | `.claude/agents/<agent>.md` |
| Cross-agent rules of the game (gates, commit discipline, command form, metric defs) | `process-current.md` |
| A repeated manual action | a committed tool: Makefile target, script, or skill — parameterised |
| A heavy reference document | a skill (abstract it; don't make agents hold it) |
| Project-specific facts | the project's `/work` artifacts — never `/process` |

The process file may grow when a genuinely cross-agent rule needs stating;
content earns its place by being general and load-bearing and is removed only
for being misplaced or redundant, never for being long. **The DORA baseline is
the control loop:** every routed change names its target metric and the next
retro scores anticipated-vs-observed. A change-set is a net win only if
throughput, quality, frequency, and recovery improve or hold in aggregate — an
improvement that buys one metric by degrading another is reverted or reworked.

**Token cost is the explicit COST side of this economic ledger (v56 — human-
directed).** Every run consumes tokens (the agents' compute cost); DORA
(throughput, quality, frequency, recovery) is the VALUE side. The two are
optimised TOGETHER, not in isolation: the goal is the most DORA value per token,
not the fewest tokens. So a token reduction that degrades a DORA metric (slower
lead time, higher CFR, lost quality) is rejected exactly as a one-metric win
that degrades another is; and a token INCREASE that buys a real DORA gain (e.g.
a capable model tier on the constraint agent, an extra verification pass that
cuts CFR) is accepted as a deliberate, scored bet. Token spend that buys no
DORA value — re-reading files already in context, redundant agent dispatches,
oversized context loads, prompt scaffolding that no longer earns its place — is
pure waste and is removed. Token efficiency is a tracked dimension, never a
master metric that overrides quality.

## 25a. Changes are experiments (v32 — human-directed)

**Every routed change — agent-file edit, process section, tool, skill note —
is an EXPERIMENT**, not a permanent acquisition. The goal is agents that are as
simple and effective as possible: text earns its place by measurably improving
a DORA metric, and text that cannot demonstrate its value is removed.

The registry is `/process/experiments.md` — one row per routed change:
id, date, artifact(s) touched, target metric, anticipated effect, scoring
horizon, status.

**THE VALIDITY BAR — a row is a falsifiable HYPOTHESIS, never a piece of work
(v58 — human-directed, EXP-063).** Every row admitted to the registry MUST state
all four, explicitly and checkably: (1) **Problem** — the specific evidenced
friction/gap; (2) **Solution** — the concrete change tested; (3) **Target DORA
metric** — a NAMED metric (lead time / deployment frequency / CFR / MTTR; a
meta/proxy metric such as agent-context-size or registry-validity is allowed only
where the row explicitly justifies it as a DORA proxy); (4) **Measurement** — the
observable signal + scoring horizon, phrased so the result CAN come back NEGATIVE.
A row that merely describes a feature / capability / "work to be done", has no
named DORA metric, or has a measurement that cannot fail (a did-we-do-the-work
checklist — "the documenter produces consumer docs", "the architect states
fitness functions") is **NOT an experiment**: it is rejected at creation and
deleted on sight. The lifecycle is **adopt-or-delete** — run enough trials, then
either ADOPT (metric moved → fold the behaviour into the owning agent as plain
practice and prune the row) or DELETE (metric did not move → undo the change). A
sound, load-bearing shipped behaviour whose row was only MIS-PHRASED as a
work-item is handled by deleting the ROW while KEEPING the behaviour as plain
agent practice; never undo a behaviour that prevents a known defect class because
its row failed the bar. Statuses and lifecycle:

1. **active** — every routed change enters at routing time **already meeting the
   validity bar above** (Problem + Solution + named DORA metric + falsifiable
   Measurement), with a target metric, an anticipated effect, a **scoring
   horizon** (default: 2
   scoring opportunities — slices/iterations where the change could have
   shown its effect; "no opportunity yet" extends the horizon, it does not
   count against it), and an **applies-to** predicate — the KIND of work that
   exercises it (e.g. "UI-bearing slices", "multi-party use cases", "any
   slice with a model diff", "new-platform-mechanism slices"). Not all work
   tests all experiments: an experiment is a scoring opportunity ONLY for work
   matching its applies-to. At work selection (§10/§38) the orchestrator reads
   the registry, lists which active experiments THIS work will exercise, and
   records that list with the selection — so scoring is honest (a UI slice is
   not "no opportunity" for a backend-only experiment; it simply doesn't
   apply) and the agents know up front which experiments their work feeds.
2. **validated** — anticipated effect observed at retro scoring. The change is
   then **INTEGRATED (v34 — human-directed)**: the owning agent file(s) are
   REWRITTEN so the validated behaviour becomes part of the agent's core
   working instructions — woven into "How you work"/the relevant craft
   section, phrased as plain operating practice — rather than remaining a
   bolted-on dated section carrying experiment scaffolding ("process vNN",
   EXP references, trial caveats). Provenance lives in the registry row and
   git, not in the agent's prompt. Integration is a SIMPLIFICATION pass — but simplicity is measured as
   SCAFFOLDING-FREEDOM and NON-ACCRETION, not raw line count (EXP-011 finding:
   integrating 8 validated experiments removed citations/EXP-ids/caveats and
   merged overlapping sections, yet net lines barely moved because genuine
   new behaviour also lands each slice). The bar: no experiment scaffolding
   (vNN/EXP/trial caveats) remains in the prose the agent reads; overlapping
   sections are merged; the file does not grow monotonically retro-over-retro
   from accretion alone; and the behaviour survives intact (next retro
   spot-checks the mechanism still fires). A file may legitimately grow when a
   slice adds real new craft — that is not an integration failure. **After
   integration the row is PHYSICALLY REMOVED from `experiments.md` (v45 —
   human-directed)** and replaced by a single terse line in
   `process/experiments-archive.md` (`EXP-NNN — <one-phrase lesson> — integrated
   <sha>`). `experiments.md` holds ONLY live experiments — `active`,
   `under-question`, `retirement-trial`; everything `integrated` / `retired` /
   `reworked→` is pruned to the archive, and `failed` rows are DELETED outright
   (no archive line — §25a.6), so the working registry (read every
   retro) stays small. Provenance survives in the agent file (the behaviour),
   the one-line archive (the index), and git (the full row). The registry must
   not grow monotonically: each retro prunes the rows that reached a terminal
   state. Spot re-check an integrated mechanism only if its metric later
   regresses (recover its row from git). The integration policy is
   itself an experiment (EXP-011): if integrated agents do not perform at
   least as well (per-agent median task time, mechanism compliance), the
   policy is questioned like anything else.
3. **under-question** — horizon reached with no measurable improvement. The
   retro must do one of: REWRITE (sharper mechanism → new experiment, new
   horizon) or mark for **retirement-trial**.
4. **retirement-trial (null-hypothesis test)** — the text is physically
   REMOVED from its artifact (git + the registry row keep it recoverable; a
   removal that "feels risky" is exactly the experiment) and the system runs
   **4–5 scoring opportunities** without it — one or two opportunities is not
   a sample, it's an anecdote; "retired" may only be concluded on the full
   window:
   - targeted metric DROPS attributably → the change was load-bearing:
     **reinstate**, mark validated-by-null-hypothesis. A clear, attributable
     drop may trigger EARLY reinstatement before the window completes (the
     safety valve) — but early reinstatement on a noisy signal voids the
     trial; re-run it later rather than half-conclude.
   - no drop across the full 4–5 opportunities → the text was ornament:
     **retired** permanently (registry row records the evidence; the artifact
     stays simpler).
5. Concurrency guard (NOT a sample-size statement): at most ONE
   retirement-trial RUNNING per agent artifact at a time — two simultaneous
   removals from the same artifact confound attribution. Never trial a rule
   whose failure mode is a prod outage class still open elsewhere —
   null-hypothesis tests are run where the blast radius is a metric, not a
   user.
6. **failed (terminal — DELETED, not archived; v56 — human-directed)** — the
   change's anticipated effect was NOT observed AND the change is being
   abandoned or fully superseded by a re-route to a successor experiment. It is
   neither integrated as behaviour nor a useful null result. Unlike `retired` —
   where the null result IS the lesson and earns a one-line archive entry — a
   `failed` row carries no folded-in behaviour and no standalone lesson worth
   indexing (any durable lesson is carried forward by its successor experiment
   or a `principle-failures/` note). Because failed rows are also the most
   VERBOSE (they accrete diagnosis and re-route prose) and contribute no live
   scoring thread, they **POLLUTE the working registry the orchestrator re-reads
   every retro**. Therefore a `failed` experiment is **DELETED OUTRIGHT from
   `experiments.md` with NO archive line** — git retains the full row if it is
   ever needed. Guard: a failed experiment that has a LIVE re-route must FIRST
   land its successor (a new experiment row or a principle note) so the thread
   is not lost, THEN the failed row is deleted in the same change. Failed rows
   may be deleted at ANY time they are recognised (not only at a retro) — they
   carry no scoring obligation.

Scoring honesty: a change with a confounded window (multiple changes landed on
the same metric in the same slice) is scored against its own MECHANISM
(did the behaviour it prescribes actually occur and visibly help?), not just
the aggregate metric. The §22 queue remains the list of obligations queued for
NEXT work; the registry is the scoring view over everything already routed.

## 26. Retro mechanics
At each retro the orchestrator: recomputes DORA; reviews `principle-failures/`
and `dora/per-project.md`; **updates `/process/experiments.md`** — scores every
active experiment that had a scoring opportunity, advances under-question /
retirement-trial states per §25a; snapshots the current process to
`process-history/vNN-<date>.md` (filling its anticipated-vs-observed scoring for
the previous change-set); writes a new `process-current.md` (version+1) whose
changes target a specific DORA metric justified by evidence; and states the
anticipated DORA effect of each change so the next retro can score it — **and
registers every routed change (including agent-file edits) as an experiment row
at routing time**. A principle is never changed on a single data point —
require a pattern across principle-failures.

When the process file has visibly accreted (many same-day versions,
agent-specific detail creeping in), run `/refactor-process`.

**Scriptify the cycle's mechanical operations to save context (v47 — human-
directed).** Every retro, the orchestrator names the operations it performed
REPEATEDLY by hand this cycle — bookkeeping, record-writing, file appends,
verify/restart sequences — and builds or extends a committed script for the
most-repeated one, so that mechanical work leaves the context window (it becomes
one allowlisted command, not N Read+Edit cycles). This is §36's "repeated manual
action → committed tool" made a STANDING retro step, because hand-bookkeeping is
the orchestrator's own dominant overhead (e.g. observatory: 272 ledger rows + 21
decision-log appends + 9 defect records in one project, constraint=orchestrator).
A mechanical op done ≥3× by hand is a script waiting to be written. First
instances: `dora.py record` (ledger) and `dora.py log-decision` (decision-log
append). Target: orchestrator context/overhead (the standing constraint) + lead
time. [EXP-038]

**Review token usage every retro and balance it against DORA (v56 — human-
directed).** Token spend is the cost side of §24's economic ledger, so each retro
runs a standing **token-efficiency review** alongside the DORA recompute:
1. **Estimate the cycle's token consumption and where it went** — which agents /
   stages / operations dominated. Use the signals available: agent-dispatch count
   and fan-out width, context-load size (whole-file reads vs targeted reads, the
   `process-framework` skill's load-only-what-you-need discipline), re-reads of
   material already in context, model-tier mix (§15a), and the share already
   absorbed by scripts (EXP-038). The harness reports per-run token totals; record
   the estimate beside the DORA baseline so it is trackable cycle-over-cycle.
2. **Name the single highest-leverage reduction** and route it like any change —
   e.g. tighten a bloated prompt/agent-def, replace whole-file reads with targeted
   reads or a skill, kill a redundant agent dispatch or duplicate search, scriptify
   a repeated mechanical op, drop scaffolding that no longer earns its place.
3. **Score it against DORA, never in isolation (§24).** Pick the change with the
   best DORA-value-per-token: a token cut that would slow lead time, raise CFR, or
   lose quality is REJECTED; a token *increase* that buys a real DORA gain (a
   capable tier on the constraint agent, an extra verification pass that cuts CFR)
   is an accepted, scored bet. The aim is maximum DORA per token, not minimum
   tokens. Register the chosen optimisation as an experiment with both its token
   target AND the DORA metric it must not harm.

**See the plumbing share — split the cost into running-the-OS vs delivering value
(v59 — EXP-067).** The token-efficiency review above sees *total* cost; this step
sees *where it goes*. Run `dora.py cost-split [--project <p>] [--window N]` (it
also lands in `baseline.md`): it splits logged **time + tokens** into **plumbing**
(orchestrator + flow-manager + retro/gate/bookkeeping events — running the agent
OS) vs **delivery** (engineer/tester/ui/product/architect/cicd/documenter
producing & validating customer value), and prints the **plumbing share** of each.
The retro reads the plumbing share AND its TREND across retros; if it rises or
exceeds target, route the single highest-leverage overhead reduction (scriptify a
mechanical op per EXP-038, cut a redundant dispatch, restructure a process step) —
guarded so delivery (lead time / CFR) is not harmed. Caveat: the split is precise
for *delegated, logged* work; inline orchestrator coordination is under-counted on
time and main-loop tokens aren't auto-logged, so pair the cost-split with the
token-estimate above for the orchestrator's own overhead. Token coverage is
printed; it improves as dispatches log `--tokens` (the orchestrator records each
agent's `subagent_tokens` on its `task_end`).

---

# STAGE F — Flow & queues (pull-based, v40)

The cross-agent rules of the pull system. They supersede §6's command-stepped
loop and §9's four-gate list for pull-based projects. Full rationale, diagrams,
and a worked retro are in `Version2-design/`; this is the rulebook the agents
follow. Each rule names the DORA metric it targets, per §25a.

## F1. Work items — hierarchy with two-way links
Every unit of work is a typed item — `REQ-`/`CHK-`/`SLC-`/`UC-`/`DEF-` — in
`work/<project>/items/items.csv` (canonical; `items-tree.md` is the rendered
view, flow-manager-regenerated). Hierarchy: requirement → chunk → slice →
use-case (→ route steps). **Parent is canonical; the `children` index is rebuilt
from parents on every mutation**, so the tree traverses both ways without drift.
`value`/`cost` are product estimates; per-item DORA is COMPUTED from the ledger
(keyed by `id`), never stored. Done bubbles UP: a slice is done when all its
use-cases are done; a chunk when its done-condition is met; a requirement when
all chunks are done (→ ask for more work, §F3d). Target: measurement granularity
(GLT decomposable down the tree). [EXP-021]

**Single source of truth (v52, EXP-048) — new projects.** The append-only
ledger is the ONE writer of dynamic state. **Item current-state and queue
membership are DERIVED** from ledger events via `dora.py project-state`
(→ `state.md`), never independently written: `items.csv` holds static facts only
(no `state` column — state, `vc_ratio`, `done_ts` are all derived), and
`queues/` holds only `policy.csv` (buffers). To change state, append a ledger
event — never edit a CSV. One writer ⇒ nothing to keep in sync ⇒ the
coherence-defect family (multiple stores of one fact disagreeing — 10/16 of
observatory's defects) cannot occur, and the atomic-pull/reconcile/staging
discipline (EXP-037/041) is unnecessary. **Existing pre-v52 projects keep their
hand-maintained `items.csv` + queue CSVs and that discipline — they are not
migrated.**

**CLOSE-ON-GREEN is atomic + RECONCILE-FIRST on resume (v73, EXP-089 — the
DEFECT-004 close-drift kill).** Since item current-state is DERIVED from the
ledger, an unrecorded close makes the derived state LIE — and a lying state
double-dispatches already-built work (the v73 evidence: a whole trunk build wave
never `item_done`'d). Two mechanical rules, binding on engineer + flow-manager +
orchestrator:
1. **Atomic close.** The agent that pushes a build green appends
   `stage_exit`+`item_done` (with the pushed SHA in `--ref`) **in the same turn as
   the push** — never deferred. A green push with no same-turn `item_done` is
   itself a defect. Slice/chunk bubble-up (§F1 "done bubbles up") is recorded in
   that same turn once the last child closes.
2. **Reconcile-first on resume.** Before the FIRST pull of a resumed loop the
   orchestrator runs `make ledger-drift PROJECT=<p>` — diffs trunk `git log`
   UC/SLC SHAs against ledger `item_done` refs; non-zero (drift) is a hard pull
   precondition: close/repair every built-but-unclosed item BEFORE pulling. This
   supersedes v71's "reinforce, not re-legislate" for this class (reinforcement
   demonstrably failed → make it executable, per the v72 render-diagrams pattern).

## F2. Queues — a uniform model: two buffer knobs + four metrics
Work is handed over through queues (`work/<project>/queues/<name>.csv` + rendered
`.md`). The four queues are **Intake → Ready → Deploy → Rework**. Every queue is
modelled IDENTICALLY — same two buffer knobs, same four metrics — so they compose
and compare; only the configured numbers differ.

**Buffer control = `min_items` + `wip_limit`** (both per queue, both in
`queues/policy.csv`, both owned and tuned by the retro, never hardcoded):
- `min_items` — the replenish/pull FLOOR: below it, signal upstream to refill so
  the queue never starves the stage it feeds. Targets **throughput**.
- `wip_limit` — the CAP: the queue never holds more than this, so work cannot age
  and WIP stays small (penny game). Targets **gross lead time**.
Defaults seed (retro tunes from evidence): intake 2/10, ready 2/4, deploy 0/1
(WIP = pipeline concurrency group, §11a), rework 0/2.

**Statistical metrics (uniform, computed by `dora.py flow` → `dora/flow.md`):**
- **queue length** — depth now;
- **throughput frequency** — dequeues per active-day;
- **dwell time** — enqueue→dequeue per item (the time to be taken off the queue);
  this is the queue's slice of gross lead time;
- **rework rate** — re-entries ÷ items (how many times items came BACK to this
  queue — a quality/flow signal).
**Every metric ties back to the two system numbers:** Σ dwell across queues is the
WAIT part of GLT; the throughput of the binding (lowest-throughput) queue is
system throughput; rework rate inflates both. The retro reads these to size
`min_items`/`wip_limit` per queue.

On EVERY insertion the flow-manager re-costs `vc_ratio` (= value ÷ cost) and
re-sorts (defects pre-empt, §F5). The ranking function is isolated so Cost of
Delay can replace it later with no structural change (CoD is out of scope for
v40). Target: gross lead time + throughput. [EXP-022]

## F3. The pull loop & replenishment (`/loop-run`)
The inner dev loop runs continuously: each cycle the flow-manager selects the
**maximal independent set** of ready use-cases (§F6) up to capacity `N` and the
orchestrator dispatches them as concurrent inner-loop instances —
cicd? → ui-structure? → engineer (TDD on trunk) → ui-validate? → deploy
(gate only if infra-bearing) → tester (validate in prod). Pass → done, bubble
up; fail → Rework. **Replenishment is a PROACTIVE, CONTINUOUS, parallel process
— it works AHEAD of the engineer, not at boundaries (§F9, v44).** Product is
never idle while engineers build: it runs concurrently and keeps the Ready
buffer **at or above `min_items` AT ALL TIMES** so the next broken-down work is
always waiting. Operationally:
- **Look ahead, don't wait for empty.** The trigger is `depth(Ready) <
  min_items` **OR projected-below-floor after the next pull** — replenish the
  moment the buffer would dip, not when it hits zero. The very FIRST build wave
  of a slice is dispatched together with a product look-ahead for the NEXT
  work, so decomposition and building overlap from the start.
- **Across chunk boundaries.** Product decomposes the next slice — and the next
  chunk's first slice — WHILE the current chunk is still building, so when the
  current Ready drains the next chunk's use-cases are already costed and
  enqueued. There is no decompose-gap at a chunk edge.
  Order: (a) more use-cases from the current slice; (b) next slice from the
  chunk (unattended — no slice gate); (c) advance to the next chunk; (d) only
  when the WHOLE requirement is decomposed-and-done does the loop report
  *starved + requirement complete* and ask the human for more work.
- **Below-floor is never "expected" or tolerated.** A `depth(Ready) < min_items`
  signal is a hard call to replenish NOW, in parallel — the orchestrator must
  NOT rationalise it away ("scaffold-constrained", "will refill after this UC")
  and let the engineer's next work go un-prepared (a logged principle failure,
  `principle-failures/2026-06-09-replenishment-boundary-reactive-not-proactive.md`).
Product estimates value+cost on every item; batch small (penny game): replenish
more often, less each time. Target: gross lead time (no engineer-waits-for-
decompose gap), throughput.

## F3a. Upstream pipelining — the WHOLE planning stage runs ahead of the build (v62)
Replenishment is not only product's job. While the engineer builds the pulled
use-case(s), the orchestrator keeps **every upstream role working the NEXT
independent item in parallel**, so by the time the engineer finishes, the next
item is fully planned — vision/slice AND architecture AND capabilities — and can
be pulled with zero wait. The engineer is the constraint; never let it idle
waiting for an upstream artifact that could have been prepared during the
previous build.
- **product** — the next slice + use-cases + acceptance (§F3), costed and enqueued.
- **solution-architect** — the next item's architecture delta + security review +
  policy-test notes, produced WHILE the current item builds, so the design a
  use-case needs is ready before it is pulled (not discovered at pull time).
- **cicd** — the next item's capabilities provisioned ahead of the build that needs
  them: feature flags, env/infra/pipeline prep, deploy-role grants (cicd already
  "runs BEFORE implementation loops"; this makes it run *concurrently with the
  prior* loop). A capability a near-future use-case requires is staged in
  advance, never a mid-build blocker.
- **ui-designer** — the next UI-bearing item's structure pass (IA, component
  decomposition, a11y conditions) prepared ahead the same way.
Bounds: only pipeline items that are **sequentially independent** of the in-flight
build (§F6 — no shared seam/edge; if dependent, it genuinely must wait); respect
each queue's `wip_limit`; look-ahead depth ≈ the Ready/Intake buffer (`min_items`),
not unboundedly far. The orchestrator dispatches these upstream agents
concurrently with the engineer in the same cycle (they write to disjoint
artifacts — slices/ , architecture/ , infra/ — so no commit collision, §14).
Target: gross lead time (eliminate engineer-waits-for-architecture / -capability /
-structure gaps), throughput. [EXP-075]

## F4. Time thieves — wait, attributed to its cause
`dora.py flow` writes `work/<project>/dora/flow.md`: per-queue length + wait,
per-item lead time (service vs wait split), and the time-thief table. A time
thief is wall-clock on item A's lead time spent waiting on something else; each
is attributed: queue wait (depth/batch), displacement (the higher-priority or
defect item inserted ahead), seam serialisation (the blocking UC), worker
contention (capacity `N`), deploy-queue wait (pipeline), gate wait (the gate),
session idle (§13). The retro reads the ranked thieves as its primary input
(this extends §5's wait taxonomy from per-slice to per-item with attribution).
Time-thieves also carry a **plumbing vs delivery** class (v59, EXP-067): a thief
that is plumbing (gate wait, bookkeeping, orchestrator coordination) feeds the
`dora.py cost-split` plumbing share §26 watches, distinct from a delivery thief
(seam serialisation, deploy-queue) that is the cost of the work itself.
Target: gross lead time. [EXP-028]

## F5. Two gates; defects pre-empt
**Blocking human gates are exactly two:** (1) requirement/defect **INTAKE** (JTBD
value framed before anything enters), and (2) **DEPLOY-to-prod for infra-bearing
change** (app-only diffs auto-approve per §9a). Each removed gate is replaced by
a named assurance, not dropped: vision → folded into intake; slice-accepted →
just-in-time slicing against the chunk plan + §10 selection, human leverage moved
to intake/deploy; arch+security → §9a security auto-accept + the §12a data-flow
gate-node discipline + synth-time contract tests, with infra-bearing deltas
surfacing at the deploy gate. The two-gate model is the baseline (validated
across SLC-001..004, v59); if evidence shows a removed gate was load-bearing,
reinstate it via §25a. **Defects re-enter
through intake**, are JTBD-framed/costed, and **pre-empt** (a defect on delivered
value is a failure in something of higher value than anything merely queued);
the displacement is logged as a time thief so the cost of interrupting is visible
(§5a ownership semantics unchanged). Target: gross lead time (gate wait) guarded
by CFR; MTTR (defect pre-emption). [EXP-025]

## F6. Parallel dispatch by independence (the maximal independent set)
Parallelism is the **default, not an option**. The flow-manager treats
`use-case-deps.mmd ∪ class-deps.mmd` as a DAG and each cycle dispatches the
highest-priority set of *ready* use-cases that are mutually independent — **no
edge/path between them AND disjoint claimed seams/paths** — up to capacity `N`,
isolated by use-case flags in code (§40 — never branches/worktrees/stash). Each
use-case declares the seams/paths it will own (engineer + architect, from the
route); the flow-manager holds the **claimed-path registry** of in-flight UCs.
`achieved` and `theoretical-max` concurrency are logged (`parallel_dispatch`) so
**parallelism efficiency** is visible. Target: build wall-clock = the slowest
dependency chain, not the sum of steps; gross lead time.

**A claimed path includes every SOURCE FILE a UC's route mutates (v54, EXP-051).**
The independence test has two halves and both bind: no behavioural edge in
`use-case-deps.mmd` AND disjoint claimed paths. A shared SOURCE FILE is a shared
claimed path — under §40 (trunk, no branches) two UCs editing one working-tree
file collide, so they are seam-serialised and NOT co-schedulable even when no
behavioural edge exists. `theoretical-max` is the achievable set under §40, so N
ready UCs all claiming one source file form a serial chain (M=1 for that group)
and that serial schedule is CORRECT — the flow-manager must NOT report the
shared-file seam as a parallelism time-thief (reporting a forbidden parallelism as
lost opportunity is the SLC-001/002/003 phantom-max failure). The genuine remedy
for wanting the parallelism is a STRUCTURAL refactor — split the file so each UC
owns a distinct file — pursued as a §F7 false-edge null-hypothesis lever, not by
inflating the max. [EXP-051]

## F7. Collisions teach the dependency tree (learn to structure dependencies)
A **collision** = concurrent work proving a declared independence false, detected
mechanically: a claimed-path violation (build/commit time, the registry is the
guard), a composition failure (a flag-ON-green UC goes red when another
integrates), or a §19 hidden hard edge at deploy. On a collision the flow-manager
emits a `collision` ledger row, **stops the pair**, hands the missing edge to
product/architect/engineer to ADD to the model (`classDef changed`, recorded in
`architecture/dependencies/edge-ledger.md`), re-serialises (§19, scheduling not
compensating logic), and bills the rework as a hidden-edge time thief. The system
attacks **both** error classes: **hidden edges** (false independence — collisions
per slice → 0) and **false edges** (false dependency — needless serialisation),
the latter found by an **edge null-hypothesis trial** (§25a applied to a
dependency edge: relax it for 4–5 opportunities; an attributable collision
reinstates, none retires it and reclaims parallelism; ≤1 trial running per seam).
Driving both toward zero IS the system learning to slice and structure work for
flow. Target: CFR (hidden edges), gross lead time (false edges). [EXP-027]

## F7a. Blocked items must say WHY — on block and on unblock (v72 — human-directed)
When an item moves to **Blocked** (a §F5 gate hold, a §F7 collision stop, or a
Rework re-entry), the cause is recorded as a one-line reason in
`work/<project>/items/blocks.csv` (`item,reason[,since]`) by whoever blocks it
(flow-manager for collisions/gates, orchestrator/tester for rework). When the
blocker clears, the row is **removed**. This is not bookkeeping for its own sake:
the human board mirrors it (`process/linear-mapping.md`) — a Blocked issue shows
a **🚫 Blocked: <why>** banner in its description and a one-time comment, and an
**✅ Unblocked** comment is posted when the row goes away — so a human reading the
board always knows *why* something is stuck and *when* it freed up, without
asking. A Blocked item with no recorded reason is itself a smell (the banner says
so). The reason is free text, not a metric (DORA stays in the ledger, §0). The
blocking event itself is still a ledger row (`collision`/gate/rework) for metrics;
`blocks.csv` carries only the human-readable WHY. [EXP-074]

## F8. Retro cadence (pull mode) — MECHANICALLY ENFORCED (v68)
Default: retro at **slice completion** (preserving §20's proven per-slice
economics — a retro is service time on the constraint, so per-use-case retros
would dominate overhead), PLUS an **event-triggered retro** whenever flow data
breaches a threshold (a prod defect, an MTTR pair, or a queue-wait spike above
target). Cadence is itself a tunable the system experiments on. The orchestrator
remains the **process owner** that runs retros (§26) and owns the experiments
registry; at every retro it tunes the per-queue buffers (§F2) and `N` (§F6) from
the flow evidence, each tune a scored experiment. Target: meta — bound retro
overhead without losing the learning signal. [EXP-029]

**The cadence is a GATE in the loop machinery, not orchestrator discretion (v68,
EXP-083).** "Run the retro automatically" was repeatedly violated by offering it
to the human instead (8 un-retro'd slice/chunk closes accrued after v67 — the
EXP-030 anti-pattern recurring), so enforcement is now mechanical, not a rule the
orchestrator may skip. **`dora.py retro-debt --project P`** counts retro-triggering
events (slice/chunk closes, defect resolves, deploy failures) since the last
`retro` ledger row and **exits non-zero (code 2 = RETRO DUE)**. `make retro-debt
PROJECT=P` is the allowlisted wrapper. The loop (`loop-run.md` step 7) MUST run it
before pulling the next work after any slice/chunk close or defect resolve; a
non-zero exit means the loop **may not advance** until `/retro` drains the debt,
and the retro may **never** be offered to the human as a choice (that is the §F9.4
over-ask the gate prevents). The retro stays TIGHT (§F9.4) so the gate does not
become the time thief.

**Right-sized cadence — routine batches, incidents fire immediately (v69,
EXP-085).** The v68 threshold=1 (retro after EVERY slice close) proved too
aggressive on its FIRST real firing (SLC-009, a validation-only close of pre-built
work): a per-slice-close cadence reintroduces the very retro-overhead/bloat churn
v68 fought, and treats a clean routine close (little to learn) the same as a real
incident (much to learn). The gate now **splits events by class**:
- **ROUTINE** = a SLICE/CHUNK close. These **batch** up to `--threshold`
  (default **3**) before a retro is due. A clean run of small closes does not pay
  per-slice retro overhead.
- **INCIDENT** = a prod defect resolve OR a deploy_failure. These are **never
  batched** — a single one forces RETRO DUE immediately (effective threshold 1),
  plus the existing event-triggers (MTTR pair, queue-wait spike above target). Real
  learning is never deferred.
This is the v68 gate **self-correcting on its first firing — the intended
behaviour, not a bypass**: enforcement stays mechanical (the loop still may not
advance past a due retro, the retro still may not be offered to the human), only
the routine cadence is right-sized and incidents are guarded to fire at once.
`--threshold` is per-project tunable for batchier projects.

## F9. Continuous operation & autonomous wake (v41 — human-directed)
The loop is a **continuously-running background process**, not a command the
human starts on demand. It runs while there is ANY work to do — any queue
non-empty OR anything replenishable against the chunk plan — and only EXITS when
**all queues are empty AND nothing is replenishable** (requirement complete).
Three rules make this autonomous:

1. **Two processes, both automatic, both parallel.** (a) the dev loop pulls and
   builds ready work; (b) replenishment breaks work down to lift any below-floor
   queue above its floor (§F3). They are **independent and run concurrently** —
   neither waits on the other. The orchestrator runs BOTH; it never makes the
   operator choose between them.
2. **Enqueue-to-empty wakes the loop.** When an item is enqueued onto a queue
   that was empty (e.g. intake adds the first ready item while the loop has
   drained/exited), the flow-manager emits a **`loop_wake`** ledger row and the
   orchestrator **(re)starts the loop** — without being asked. An enqueue is an
   event, not a prompt for a human decision.
3. **The orchestrator never asks the human a flow-mechanics question.** "Start
   the loop?", "replenish or pull?", "keep the queue above floor or build?" are
   NOT human decisions — they are autonomous flow and run automatically. The
   human is touched at **exactly** the §F5 two gates (intake, infra-deploy) and
   when the requirement is **complete** (starved + nothing replenishable → ask
   for more work). Presenting independent parallel flow processes as an exclusive
   human choice is a principle failure (see
   `principle-failures/2026-06-09-orchestrator-asked-human-to-choose-between-parallel-processes.md`).
4. **Keep trucking through boundaries.** Slice completion, the §F8 retro,
   and chunk advance are **autonomous boundaries, not human checkpoints**. The
   loop continues straight through tester-validation → slice-done → bubble →
   §F8 retro → next slice/chunk WITHOUT the orchestrator ending its turn to ask
   "continue or pause?". Stopping at a slice/chunk boundary to hand control back
   adds gross lead time and is a principle failure (see
   `principle-failures/2026-06-09-orchestrator-stopped-at-slice-boundary-to-ask.md`).
   The §F8 retro RUNS automatically and must be **tight** — a retro that becomes
   the time thief defeats its purpose. The default at every non-gate boundary is
   **continue**; the human can always interrupt. The only stops remain the §F5
   two gates and requirement-complete.
   **ENDING THE TURN *IS* the stop, even with a polite report.** Not asking
   "continue or pause?" is not enough: ending the turn with a status report +
   "I'll resume / refresh to confirm and I'll carry on" parks the loop just the
   same — the human must re-prompt ("go") to restart it, and every restart is
   idle gross lead time. **RULE: do not end the turn at a non-gate boundary.**
   After ANY unit completes — a UC done, a defect closed, the §F8 retro written,
   a chunk bubbled — IMMEDIATELY pull and dispatch the next ready work **in the
   same turn**, and keep chaining. A report is INLINE and terse; it never
   replaces the next dispatch. The turn ends ONLY at: a §F5 gate (intake /
   infra-deploy), requirement-complete (queue empty AND nothing replenishable),
   or a genuine blocker that needs a human answer. Verification/restart steps
   are mid-turn work, not a stopping point. "Refresh to confirm and I'll carry
   on" is banned — carry on, then the human confirms if they wish.

Target: gross lead time (removes avoidable human-decision idle) + deployment
frequency (the loop keeps flowing without re-invocation), guarded by CFR (the two
real gates are untouched).

## F10. Fleet — isolated per-project loops, one shared process spine (v72 — human-directed)
Multiple projects run CONCURRENTLY, each as its own isolated loop, feeding ONE
shared, project-agnostic process. Two layers, deliberately decoupled (design:
IMP-013):

1. **Per-project loop — isolated.** Each active project runs its own `/loop-run`
   in its OWN background runner/context (a per-project orchestrator agent or
   session), holding ONLY that project's `work/<project>/` — its ledger shard,
   queues, claimed-path registry, and Linear initiative. Loops are independent:
   different repos/domains, run in parallel, no shared mutable *work* state. One
   project's build/deploy churn never enters another's context (context is
   conserved). This is **isolation, not a context-inheriting fork** — a fork
   would drag project A's context into project B, the opposite of what we want.

2. **Shared spine — informed, not coupled.** `/process` (principles, rules, DORA
   baseline, learned failures) and the orchestrator role are SHARED and **MUST
   NOT reference any project** — the existing `/process`-vs-`/work` split. N
   `work/` spaces feed ONE `/process`.

3. **The integration seam (how project learning improves the whole without
   coupling it).** A project retro's lesson is **abstracted — de-projected —
   before it lands in `/process`**: the project retro records "in project X, Y
   happened" (stays in `work/<project>`); the process change states "when
   Y-shaped situation, do Z" as an experiment (`EXP-nnn`), rule, or
   principle-failure. So `/process` is **INFORMED BY every project yet
   INDEPENDENT OF any** — delete a project and the process still stands.
   Per-project retros tune that project's own queues off its ledger shard; a
   periodic **fleet retro** rolls the abstracted lessons up into `/process` +
   the shared DORA baseline. The main thread is a **fleet supervisor** (launch /
   monitor / route human decisions), not a per-UC worker; its cost is
   O(decisions), not O(UCs × projects). [EXP-075]
