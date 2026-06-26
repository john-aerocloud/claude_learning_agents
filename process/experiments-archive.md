# Experiment archive (terse index)

One line per experiment that reached a terminal state (`integrated` / `retired` /
`reworked→`) and was pruned from `experiments.md` (v45 §25a). The behaviour now
lives in the owning agent file; the full row is in git. Append-only, terse —
this is the index of what we've learned and folded in, not a working registry.

- EXP-001 — real-browser-not-node probe + browser-transport spec; 0 browser-only causes reaching prod — integrated 7db8d99 (engineer.md/tester.md)
- EXP-002 — local standability: build-phase browser tests against a stood-up system — integrated 7db8d99 (engineer.md, principles/02)
- EXP-003 — trunk-CD prereq-before-first-push corollary — reworked→EXP-005 (folded into the change-impact model)
- EXP-004 — failure semantics 5xx/4xx ownership + backoff taxonomy — integrated 7db8d99 (engineer/tester/product/solution-architect)
- EXP-005 — shared change-impact model (mermaid deps, read-before-build/test, @covers) — integrated 7db8d99 (engineer/tester/solution-architect/product)
- EXP-006 — use-case flags = two-phase rollout lifecycle (flags not branches) — integrated 7db8d99 (engineer.md/cicd.md)
- EXP-007 — walking-skeleton probe on new platform mechanisms — integrated 7db8d99 (engineer.md, make ws-skeleton)
- EXP-009 — budget-aware validation on rate-limited surfaces (serialise connection-consuming specs) — integrated at s007 retro (tester.md)
- EXP-010 — deployable-UC done = deployed + prod probe green; deploy order by concurrency group — integrated at s007 retro (engineer.md §11a)
- EXP-032 — edit files with Edit/Write, record ledger with dora.py record, never shell redirection — validated 2/2 (s001–s004 run + the v44/v45 retros: 0 file-edit prompts) — integrated v45 (process §15 + orchestrator.md, plain practice)
- EXP-012 — gate-4 go/no-go at route completion, before the deploy-bearing wave — validated 4/4 (s008/s005-h3/s009/s014, 0 ungated infra deploys) — integrated v48 (process §9a, plain practice)
- EXP-014 — canonical kebab node-id === @covers tag, no fuzzy-match — validated on arrival (IMP-007 caught real drift) — integrated v48 (process §12a.5)
- EXP-015 — multi-party modelling: state machine per party + sync-point table — validated 2/2 (s009, s014 chat) — integrated v48 (§12b + product/engineer/tester defs)
- EXP-017 — defect lifecycle intake→reproduce→prioritise→fix-as-spec→gap-closing retro — validated 3/3 — integrated v48 (/defect + §6, plain practice)
- EXP-020 — push→PULL flow control (continuous loop, costed queues, JIT replenish) — validated 2/2 — integrated v48 (§F2/§F3 are the durable home; citations stripped)
- EXP-030 — continuous background loop + parallel replenishment + enqueue-to-empty wake — validated 2/2 — integrated v48 (§F9; refined by EXP-031 rework)
- EXP-034 — proactive replenishment: product decomposes ahead in the same parallel batch as the build wave — validated 2/2 — integrated v48 (§F3 + orchestrator/flow-manager defs)
- EXP-039 — model tiering by judgment density + in-session per-call override bridge + availability re-tier — validated-on-opus (s014/s015/s018 CFR + SLC-002/003 mechanism) — integrated v57 (process §7a, plain assignment; fable scaffolding closed, model retired from access)
- EXP-046 — model-tier-change scoring quarantine (model-confounded experiments can't validate on a DORA move alone) — validated 1+/2 (v49 fable→opus window opened/held/closed cleanly at SLC-003) — integrated v57 (process §7a, plain practice)
- EXP-049 — no-git-push: agents commit LOCAL trunk only, pushing is human-gated — validated 3/3 (s001/SLC-002/SLC-003 OagEventSource, 0 push attempts) — integrated v57 (process §14, plain practice)
- EXP-016 — visual-structural correctness: assert layout geometry + no-reflow invariant on overlay surfaces — validated 2/2+ (board geo, s009 table, observatory GEO guards, DEFECT-006 no-reflow) — integrated v58 (ui-designer.md/tester.md, plain practice)
- EXP-026 — parallel dispatch by maximal independent set (DAG + claimed-path registry), §40 flags — validated 2/2 (s001 par_eff 1.00; s013/14/15 wave 0.86–0.89) — integrated v58 (process §F6 + flow-manager.md; mine-only-blob isolation folded into engineer.md)
- EXP-031 — keep-trucking: non-gate boundaries are autonomous; ending the turn IS the stop; dispatch next work in the same turn — validated 2/2 (s014 delivery run, 0 boundary stop-asks) — integrated v58 (process §F9.4 + orchestrator.md, plain practice)
- EXP-041 — atomic pull: queue-remove + items.csv in-flight + ledger rows keyed by work-item id in one act; sweeps reconcile not originate; coherence_warning detector — validated 2/2 (UC-S013-4, UC-S018-1; detector 2 true-positives) — integrated v58 (engineer.md/tester.md/flow-manager.md, plain practice)
- EXP-043 — repository split: each work/<project>/ its own git repo; project output inside, agent/process in parent; parent gitignores /work/*/ — validated 2/2 (s001 + mega-session, 0 cross-boundary leaks) — integrated v58 (process §14 + CLAUDE.md, plain practice)
- EXP-044 — CFR validity: separate deploy_failure (CFR numerator) from defect_intake (excluded, reported as arrival rate); classify retroactively by DEFECT- ref — validated 2/2 (cumulative 43%→20% measurement correction; CFR moved on real deploy break) — integrated v58 (process §3 + dora.py classifier, plain practice)
- EXP-045 — windowed DORA: last-12-deploys table beside the cumulative medians so improvement is visible inside a scoring horizon — validated 2/2 (window caught movement the history-dominated median hid, both directions) — integrated v58 (process §4 + dora.py cmd_compute, plain practice)
- EXP-052 — cheap idempotency-extension UC class: a UC extending an existing dedup-before-diff guard keyed on a stable key costs ≈ test-authoring only — validated 2/2 (UC-11 + UC-16 both zero production code) — integrated v58 (product.md cost-class, plain practice)
- EXP-023 — two-gate model: keep only requirement/defect INTAKE + infra-bearing DEPLOY; each removed gate (vision/slice/arch) replaced by a named assurance — validated 3/3 (SLC-004 infra-deploy gate caught DEFECT-OAG-001; the 3 removed gates 0 regression) — baselined v59 (process §F5, plain practice)
- EXP-055 — token-efficiency retro review: every retro estimates token consumption + dominant consumers and routes the single highest-leverage reduction, scored on DORA-value-per-token (never minimum tokens) — validated 2/2 (SLC-004 chose deploy pre-flight; mega-session chose build-time defect pins) — baselined v59 (process §26, plain practice)

- EXP-008 — changes-as-experiments lifecycle (scoring/retirement/null-hypothesis) — core process §25a/§26; registry maintained + acted on across every retro — integrated v60
- EXP-011 — validated-experiment INTEGRATION + prune-to-archive — core process §25a; multiple integration passes (7db8d99, v45, v48, v60) — integrated v60
- EXP-013 — `make impacted-tests` model-diff→impacted specs — tester planning -33% (12 vs 18min, s009) — integrated v60 (tester.md)
- EXP-018 — experiment applies-to declared + listed at work-selection — core process §25a/§10 — integrated v60
- EXP-021 — work-item model REQ/CHK/SLC/UC/DEF + per-item DORA from ledger — core process §F1 — integrated v60
- EXP-024 — dedicated flow-manager owns queues/costing/buffers/dispatch — core agent roster + STAGE F — integrated v60
- EXP-028 — time-thief attribution as primary retro input — core §F4/§26 (v60 retro used it: constraint=orchestrator) — integrated v60
- EXP-029 — retro cadence (slice-completion + event-triggered, tunable) — core process §F8 — integrated v60
- EXP-033 — validate against live data + figure-legibility/human-meaningfulness checklist — strong pattern (DEFECT-001/002/004/005/007/008) — integrated v60 (ui-designer.md/tester.md)
- EXP-035 — derived now-state = RECENCY-ONLY predicate (4-turn craft lesson: simplest predicate wins) — superseded by EXP-048 single-source for new projects — integrated v60 (engineer.md/product.md)
- EXP-037 — keep ledger/items.csv/queues coherent per-UC — superseded by EXP-048 for new projects; forward principle carried by EXP-047 — integrated v60
- EXP-038 — retro scriptifies the cycle's most-repeated MECHANICAL op (one allowlisted command, not N Read+Edit) — validated 2/2 (SLC-003) — integrated v60 (process §26 + dora.py)
- EXP-080 — verify CI/deploy/validation status at the SOURCE (gh run conclusion + job/step, deployed X-Service-Version, actual metric value); orchestrator verifies before closing a slice/gate; flow-manager never projects an in-flight item terminal — validated 2/2 (SLC-014 caught 3 spec-not-code false-fails; SLC-023 cited verified deploy sha + caught the ci-watch wrong-repo read) — integrated v67 (engineer.md/tester.md/orchestrator.md/flow-manager.md). Extended to the deploy environment by EXP-082.

> **v68 GRADUATE-TO-SKILL pass (rule lifecycle, process-framework skill).** The
> following PROVEN, STABLE, CROSS-AGENT rules graduated OUT of the active /process
> into skills (the durable methodology layer) + their owning agent files, and
> their EXP rows were pruned from experiments.md to keep /process lean:
- EXP-025 — defect-as-high-value-intake (defects re-enter via /intake, costed, pre-empt Ready) — validated 2/2 (DEFECT-001, DEFECT-OAG-025) — graduated v68 to plain practice (process §F5/intake.md/defect already core)
- EXP-062 — migration done-condition INCLUDES converting+proving the CI/CD pipeline green in-slice (never deferred) — validated 1/1 PROVEN GREEN (infra.yml SST run 27958502999) — graduated v68 to cicd.md plain practice (process §19a)
- EXP-064 — observability validated by a span/trace ARRIVING (read-back), not "collector started" — graduated v68 → delivery-principles "validate the fitness function" (tester.md mechanics). Founding DEFECT-OAG-002.
- EXP-065 — externally-published contract validated against a schema DERIVED FROM the frozen spec, not the implementation — graduated v68 → delivery-principles "oracle is ground truth". Founding DEFECT-OAG-003.
- EXP-066 — external-source semantic assumptions validated against the captured corpus before encoding (assumption register + corpus-adversarial test) — graduated v68 → delivery-principles "oracle is ground truth". Founding DEFECT-OAG-004.
- EXP-068 — a deployed processing component validated by it still DOING ITS PRIMARY JOB after deploy (core-function smoke), not "deployed + units pass" — graduated v68 → delivery-principles "gate asserts the outcome". Founding DEFECT-OAG-008 (24h projector outage).
- EXP-072 — consumer-facing READ surface ships a stated p95 latency budget + round-trip check (flag serial dependent-less queries / scan-instead-of-counter) — graduated v68 → delivery-principles "gate asserts the outcome". Founding DEFECT-OAG-010.
- EXP-073 — fixtures for an unowned data shape CAPTURED FROM THE REAL SOURCE, never hand-authored to match the code — graduated v68 → delivery-principles "oracle is ground truth" (engineer.md §2). Founding DEFECT-OAG-016.
- EXP-074 — a UI surface validated only when the RENDER is observed showing real content + key-field correctness; missing tooling is a blocker to wire — graduated v68 → delivery-principles "gate asserts the outcome" (tester.md). Founding DEFECT-OAG-016/018.
- EXP-081 — e2e/integration/contract specs assert the INVARIANT, not an incidental live-data condition (branch on data-state / derive from per-entity truth) — graduated v68 → delivery-principles "spec asserts the invariant" (tester.md/engineer.md). Founding SLC-014 batch (3 false-fails).
