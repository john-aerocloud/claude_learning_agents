---
process_version: 169
effective_from: 2026-08-29
supersedes: v168, v167, v166, v165, v164, v163, v162, v161, v160, v159, v158, v157, v156, v155, v154, v152, v151, v150, v149, v148, v147, v146, v145, v144, v143, v142, v141, v140, v139, v138, v137, v136, v135, v134, v133, v132, v131, v130, v129, v128, v127, v126, v125, v124, v123, v122, v121, v120, v119, v118, v117, v116, v115, v114, v113, v112, v111, v110, v109, v108, v107, v106, v105, v104, v103, v102, v101, v100, v99, v98, v97, v96, v95, v94, v93, v92, v91, v90, v89, v88, v87, v86, v85, v84, v83, v82, v81, v80, v76
status: active
---

<!-- v169 (RETRO, ROC 2026-08-29; INCIDENT arm, DEF-ROC-157 resolved. SHORT — the constraint is unchanged for an eleventh read and v167's reading still holds, so it is not re-derived. **THE FINDING IS A SHARPER SUB-SPECIES OF THIS PROJECT'S DOMINANT FAMILY, AND THREE INSTANCES WERE FOUND IN ONE FILE-SWEEP: A GUARD THAT SKIPS ON AN UNMEASURABLE INPUT ASSERTS NOTHING WHILE READING GREEN.**

`DEF-ROC-157` was dispatched to fix ONE host-dependent assertion — a focus-ring contrast measured against an unguarded transparent background. The engineer swept for the same shape and found something worse: `StatTiles` AC-112-6 and `BreakdownTable` AC-113-2/AC-114-2 had *correctly* noticed the transparency problem and handled it **by skipping the assertion**. Probed live, the activator, the tile AND the body all measure `rgba(0,0,0,0)` — so those three loops **asserted nothing, on any host, ever**. The tester then seeded a real ~1.10:1 violation into each and confirmed all four now red. **The originally-reported defect was the least harmful of the four**, because a host-dependent check at least fails somewhere; a skipping check never does.

WHY THIS IS NOT JUST §17i AGAIN, and why it earns its own clause: §17i asks *"can this come back negative?"*, and each of these three CAN — the assertion is real and would fire on an opaque background. **The defect is that the input never arrives**, so the negative branch is unreachable at runtime while the code reads as a complete check to anyone auditing it. The skip is also the RIGHT local instinct (asserting contrast against a transparent colour is meaningless), which is why it survived review three times. ROUTED as **§F11.5**: a guard that can decline to assert must **record that it declined**, and a declared assertion that never runs is a finding, not a pass. The cheap form is what the fix used — assert the PRECONDITION (`isFullyTransparent(against) === false`) before the property, so an unmeasurable input is a RED rather than a silent exit.

**SECOND, AND IT IS THE CYCLE'S BEST EVIDENCE THAT THE VERIFY-THE-PREMISE DISCIPLINE PAYS:** the orchestrator's own hypothesis was FALSIFIED. I named `DecisionLogPage` AC-121-5 as "the same shape" on the engineer's report; the engineer verified at source and it is not — it decodes real PNG screenshots and diffs pixels, and never reads `cs.backgroundColor` at all. The tester independently re-confirmed the falsification. **Had either taken the orchestrator's word, a working test would have been "fixed".** That is the third disproved mechanism this week and the first where the wrong claim was MINE; the instruction to verify at source is now carrying its own weight against the role that issues it.

CAPACITY, stated plainly because it is the honest headline of the day: **nine defects registered (`DEF-ROC-153`..`161`), about five closed.** Four are deferred to 2026-09-08 **on capacity, not on judgement**, and three of those four are one story — `DEF-ROC-158` (shared docker stack torn down on EXIT), `DEF-ROC-161` (six unit cases copy the working tree and assert over it; 5 failures, then 5 DIFFERENT failures, then 215/215 on an unchanged tree) and `DEF-ROC-160` (a control red across four commits into a workflow nobody reads). **Three tiers now red for reasons unrelated to the diff being gated.** That compounds: the rational response to a flaky gate is to re-run it, and that response is indistinguishable from ignoring a true finding. It is named here as the thing to attack next, ahead of new feature work.

DELIVERED: `DEF-ROC-157` (four assertions repaired, `paintedBackground` PROMOTED not copied — six copies collapsed to one), and with it **`AC-146.1` MET** — the geometry tier now runs inside `Web App / lint, test and build`, which IS in `deploy-test`'s `needs:` closure, with the second-host floor tightening 1 -> 0 on the ratchet script's own live stdout rather than by hand. REGISTRY: 8/8, no row added. CONSTRAINT: unchanged, eleventh read. -->

<!-- v168 (RETRO, ROC 2026-08-29; fired MECHANICALLY on the INCIDENT arm after DEF-ROC-150 resolved. SHORT by design — one incident, one finding, and the finding is worth the version. FOCUS QUESTION, default. ANSWER: the constraint is unchanged (`orchestrator`/`reported`, tenth read) and v167's reading still holds, so this retro does not re-derive it. **THE FINDING IS A NEW FAILURE MODE, AND IT IS THE THIRD INSTANCE OF ITS SHAPE TODAY: A DECISION RECORDED ON AN ITEM DIES WITH THE ITEM.**

`DEF-ROC-150` found a host-dependent assertion it could not fix within scope (`OverviewPage.drawer` contrasts the UA focus ring — a PLATFORM CONSTANT — against an UNGUARDED transparent row background that `contrast()` reads as black: **1.1036 against assumed-black, 19.03:1 against the composited white an operator actually sees**). It correctly REFUSED to force `AC-150.4` around it. The orchestrator verified the mechanism at source and re-scoped `AC-150.5`. The tester **independently agreed on its own measurements** and observed, sharply, that **macOS passing is not correctness but coincidental luck from a bluer ring**. Three roles, three independent confirmations, one recorded ruling — **and then the item closed and the re-scope was never applied.** Line 122 is unchanged on trunk. Filed as `DEF-ROC-157` only because the orchestrator re-read the source after the close.

WHY-CHAIN (4): (1) a verified defect survived the item that found it; (2) because the ruling lived in an `amended` EVENT NOTE on that item; (3) because an event log is an APPEND-ONLY HISTORY OF WHAT HAPPENED, not a carrier of WORK STILL OWED — when the item reaches `done` its notes move to `items/done/` and nothing reads them again; (4) ROOT CAUSE: **this system has exactly one durable carrier for outstanding work — a work item — and every other place we write things down is a record, not a queue.** `open-decisions.md` is the one deliberate exception, and it exists precisely because the same lesson was learned for owner decisions (§F9e: *"an escalation that lives only in a conversation is one the owner has to be present to receive"*). This is that sentence applied to an ITEM instead of a conversation.

**ROUTED as §F9g, plain practice, no experiment row** (§25a: a fix is not an experiment; ROC is at 8/8 and retiring a live row for a safety rule would game the cap): **before an item leaves an active state, any finding, re-scope or ruling recorded on it that is NOT discharged by the closing change must become its own registered item.** The test is mechanical and needs no judgement — *"is there a sentence on this item describing work that the commit I am about to close does not contain?"* If yes, it is an item. A note is not a queue. The three instances today all have this shape and are worth naming together, because the pattern is what generalises: a `lane:` correction I recorded in an event and never applied (caught by re-reading the frontmatter); a merge report that read green while duplicating a row twice (caught by re-reading the file out of HEAD); and this one (caught by re-reading the source). **In every case the record said the thing was done and only the STATE said otherwise** — which is the same instruction `CLAUDE.md` already gives for co-owned commits, generalised: after acting, verify the STATE, never the REPORT of the action.

ALSO THIS CYCLE: `DEF-ROC-150` delivered more than its item described — the tier was pinning no font AND measuring **Inter, the face the app actually ships, was absent from the stack entirely**, so it had been measuring a typeface the product never uses; the fix pins FILES not names, strips every generic (a trailing `sans-serif` is a live route back to the host), and handles a residual nobody predicted (FreeType hinting snapping advances, so the tier runs `--font-render-hinting=none`). Cross-host: ubuntu-latest **9 failures → 1**, macOS 297/297 same commit. The tester proved BOTH ratchet arms fire with a fabricated report and seeded two live `fontPinning` violations. `EXP-ROC-014`'s gate held throughout. REGISTRY: 8/8, unchanged, no row added. CONSTRAINT: unchanged, tenth read. -->

<!-- v167 (RETRO, ROC 2026-08-29; fired MECHANICALLY on the INCIDENT arm after DEF-ROC-109 and DEF-ROC-148 resolved. FOCUS QUESTION, default. **ANSWER: `orchestrator`/`reported` holds the constraint for a NINTH read at 33.90% — but for the first time the COUNT-INDEPENDENT measure MOVED, median/item 45,622s -> 42,202s within the session**, as the flow-manager's 24 backlog decisions landed. v165 diagnosed this correctly one retro ago (the share is carried by the STANDING AGED BACKLOG, not by arrival triage, so seven retros of arrival rules could not reach it) and the exploit it named — decide the aged inventory — is the first thing to move the number. Continue it: intake 24 -> 22 -> 23 with three new registrations, so arrivals are still outrunning decisions. CFR **8.6%** (from 8.8%), MTTR unchanged, deploy frequency 7.85/active-day.

**THE HEADLINE IS THAT A CHECK BUILT THIS MORNING PAID FOR ITSELF BEFORE THE DAY ENDED, AND WHAT IT FOUND FALSIFIES A BELIEF THIS PROCESS RECORDS AS SETTLED.** `make exit-gate-ran` (§F11.4 clause 1, shipped hours earlier for `DEF-ROC-153`) asks whether the exit gate produced a VERDICT for trunk head. Pointed at the run list it returned `DEF-ROC-156`: **of the 20 most recent trunk commits, 6 success, 2 failure, 5 CANCELLED and 7 with no run at all — 12 of 20 carry no verdict.** Cause: `concurrency.cancel-in-progress: false` protects a run that has STARTED; it does NOT stop GitHub cancelling one still QUEUED when a newer push arrives, which with six agents pushing is the normal case, not the edge. **And `cancelled` is not `failure`** — no red mark, nothing to notice. **v163 records this as solved** (*"So runs QUEUE"*): it fixed the in-progress half and the queued half was never tested. The other 7 are intermediate commits inside multi-commit pushes — ordinary GitHub behaviour, DECLARED rather than fixed, so nobody later reads per-commit coverage as a promise the mechanism cannot keep. WHY-CHAIN (4): (1) the gate's real trunk coverage is ~40%; (2) because a queued run is displaced and a cancelled run is not red; (3) because the fix for the racing problem addressed only the half that had been observed; (4) ROOT CAUSE, and it is the generalisable one: **we verify what our controls SAY and almost never that they SPOKE.** Both halves of that were found today, hours apart, by the only check that asks the second question.

**SECOND, AND IT IS AN OWNER RULING ALREADY BANKED AS v166: the analysis tool is UNPINNED.** The methodological point worth keeping is what it did to the check. Under a track-latest policy the natural check reports the current version and always passes — a control that cannot come back negative, §17i, worse than nothing. So `make action-current` was INVERTED: **a PIN is now the violation.** Generalisable: when a policy changes direction, re-derive what can FAIL under it, because a check inherited from the old policy usually cannot fail under the new one. Evidence the unpin is live and honest rather than theoretical: `v1.8.0` released mid-session and `@v1` resolved to a THIRD distinct unreleased commit in one day, which the check reported as SPLIT rather than hiding.

QUALITY, and it is the cycle's real result: **five items validated, every tester adversarial and none accepting a written claim.** DEF-ROC-149's tester induced SIX failures rather than watching a gate print PASS (discharging `EXP-ROC-014`'s §17c.2 proof-of-fire); DEF-ROC-152's independently reproduced the mutation and caught a stale figure in the engineer's own note; DEF-ROC-143's rebuilt BOTH prior escapes in an isolated fixture; DEF-ROC-109's tried to MAKE badge and filter diverge and seeded a parse failure in the new guard; DEF-ROC-148's raised a SECOND live ticket (ROC-35) and confirmed both in Jira itself rather than from the probe's own output — the probe-reporting-its-own-success circularity this project keeps finding. **Two engineers independently found the same defect from opposite directions with converging arithmetic** (`DEF-ROC-155`: vitest reports any file a test IMPORTS regardless of `coverage.include`, so writing a spec for a live probe DROPS the ratchet while leaving it untested keeps it clean — a detector that charges a penalty for the §F9f and §17c.2 compliance this process demands).

EXPLOIT: continue deciding aged inventory — it is the only operation that touches already-accrued dwell, and it moved the median. SUBORDINATE, and this one is a correction to MY OWN behaviour rather than a new rule: **triaging an item you are HOLDING inflates WIP without putting anyone to work.** I did it to `DEF-ROC-154`, took `wip` to 9 against a cap of 8, and the gate blocked. `DEF-ROC-155` and `DEF-ROC-156` were therefore registered WITH their triage decision recorded on the item but deliberately LEFT IN INTAKE — §F9b is satisfied by recording the decision, not by firing the transition. ELEVATE: NOT taken, ninth time; agent work-effort remains **0.2%** of GLT. REGISTRY: 8/8, **no new row** — DEF-ROC-155/156 are defects and §F11.4 is a safety fix, and §25a is explicit that a fix is not an experiment; retiring a live row to make space for one would be gaming the cap. `EXP-ROC-016` scored again: the §F13a Stop hook fired TWICE more this session and forced continuation both times, so the mechanism is real and not merely written down — but its metric is still hours old and the honest reading remains that one session is not a measurement. CONSTRAINT TO ATTACK NEXT: `orchestrator`/`reported`, unchanged in identity for a ninth read, now with its first measured movement and a named remedy that is working. -->

<!-- v166 (OWNER RULING, ROC 2026-08-29, within the hour of v165 and REVERSING two of its clauses). The owner, twice: *"really we should adopt as a matter of process the latest version"*, then explicitly *"the version pin on the code analysis tool needs to go - everytime it runs it should get the latest release"*. **SSF11.4 clauses 2 and 4 as written in v165 are SUPERSEDED.** Both lanes are now UNPINNED -- CI on `@v1`, the local image on `:latest` -- and the standing policy is to track upstream rather than to hold an immutable ref. **THE OBJECTION WAS RAISED, WITH THE MEASUREMENT, AND OVERRULED; RECORDING IT ONCE HERE SO IT IS NOT RE-LITIGATED AND NOT FORGOTTEN:** this exact ref took the gate DARK the same morning (`v1` moved onto an unreleased commit whose action.yml GitHub refuses to load; the job died in 19 SECONDS during `Set up job`, before a step ran, for three commits), and measured AFTER upstream fixed it, `v1` had ALREADY MOVED AGAIN to `1e581b4b` -- which is not the latest release either, so the CI ref tracks a moving target that is neither always a release nor always loadable. **WHAT MAKES THE RULING SAFE TO EXECUTE, and it is the reason this is a rebalance rather than a regression:** the failure is now DETECTED instead of silent. `make exit-gate-ran` asks whether the gate produced a VERDICT for trunk head and reports NO-VERDICT rather than reading silence as a pass -- it did not exist this morning, which is the only reason the outage needed a human reading a run list. Unpinning is affordable BECAUSE that check landed first. **`make action-current` is INVERTED to enforce the ruling rather than the old clause: a PIN is now the violation (exit 1).** That direction is deliberate -- the obvious check under a track-latest policy is one that prints the current version and always passes, which is a control that cannot come back negative and would be worse than nothing; the thing that CAN fail is drift back to a pin, so that is what it asserts. It also reports SPLIT loudly (advisory, never blocking, because with floating refs the lanes diverge through no act of ours and redding our lane on somebody else's push is the DEF-ROC-143 harm) -- and it fires today: CI's `@v1` resolves to an unreleased commit while the image's `:latest` is v1.7.1. **ONE HONEST GAP, not closed:** `uses:` cannot take an expression, so the CI lane is the MAJOR LINE, not literally the newest release tag; the image lane's `:latest` is. Closing it needs a resolve-then-checkout step, which puts a second repository INSIDE the workspace -- the `.trunk-mirror` trap this very workflow carries a scar from (DEF-ROC-042) -- so it is named here as an item rather than done inline. **Verified before the switch, on the real repo rather than from release notes:** v1.5.0 and v1.7.1 produce BYTE-IDENTICAL coupling/complexity/hotspot/generated CSVs (1056 commits, 1085 files, 15 couplings both), so nothing in the ratchet moved on the version change; the local lane runs green on `:latest` (DQG-VERDICT: PASS). **The v165 clause-3 requirement that both lanes name the SAME version survives in spirit and is now UNENFORCEABLE at config level** -- that is a real loss, stated plainly rather than papered over, and it is what SPLIT reports. -->

<!-- v165 (RETRO, ROC 2026-08-29; fired MECHANICALLY on the INCIDENT arm -- `make retro-debt` reported RETRO DUE [incident (immediate)] after three defect resolves (DEF-ROC-143, 149, 152) and BLOCKED the pull. FOCUS QUESTION, default. **ANSWER: `orchestrator`/`reported` is #1 for the EIGHTH consecutive read at 33.90% (median 45,622s, n=116, backfill 0.00%), `external` 29.42%, `queue` 23.73% -- but the number has CHANGED CHARACTER and the previous seven readings would now be the wrong diagnosis.** MEASURED THIS CYCLE: items created in the last two days have a median `reported` dwell of **3,737s (~1h)** against the all-time **45,622s** -- a 12x difference. SSF9b (register WITH the triage decision) is WORKING ON ARRIVALS; every item registered this session carried its decision in the same act. What now carries the 33.90% is the **STANDING AGED BACKLOG**, and it is visible item by item: the top ten `reported` dwells are 4-7 day old defects (DEF-ROC-087 at **680,083s = 7.9 days**, then 091, 092, 085, 096...). So for seven retros this constraint was read as *arrival triage is slow* and remedied at the moment of arrival; the arrival remedy has landed and the metric did not move, because **the inventory that holds the time was already in the queue when those rules were written.** A rule about arrivals cannot reach it. EXPLOIT, and it ran DURING this cycle rather than being routed for later: a flow-manager dispatched over ALL 24 intake items to return schedule / decline / defer-with-a-date for each, which is the only operation that touches already-accrued dwell. SUBORDINATE: SSF9d's admission-by-displacement holds unchanged. ELEVATE: NOT taken -- agent work-effort is **0.2% of GLT**, so capacity remains 99.8% idle and adding any is unjustifiable for an eighth time.

**THE CYCLE'S HEADLINE FINDING IS A NEW MEMBER OF THE OLDEST FAMILY, AND ITS MECHANISM HAS NEVER APPEARED HERE BEFORE.** `DEF-ROC-153`: the SSF11 engineering exit gate stopped running entirely. Not red -- **unloadable**. `AeroCloudSystems/CodeAnalysisTools`' floating `v1` tag was moved onto an unreleased commit whose `action.yml` puts input-only keys (`required:`, `default:`) inside the `outputs:` block; GitHub refuses to load such an action, so the job died in **19 seconds during `Set up job`, before a single step ran.** Measured across the tags: **0** invalid keys at v1.5.0 and earlier, **8** at v1.6.0, **14** at v1.7.0, **10** on the commit `v1` pointed at. Every prior instance of this project's most-registered family (OI-ROC-014, IMP-021, DEF-ROC-140, DEF-ROC-146, DEF-ROC-086) was **a control WE wrote that could not fail**. This one is **a control a THIRD PARTY switched off**, with no release, no PR into this repository, and no commit of ours -- the first run it reddened was an unrelated acceptance-heading edit to a work-item file, so it read as our breakage and was not. It was found by a human scanning a run list.

**AND THE FIRST FIX MADE A SECOND FAULT, which is the more generalisable half.** Pinning CI to the v1.5.0 action SHA left `quality/analysis-config.json` still naming the LOCAL lane's image by the mutable tag `:v1` -- which resolves to **v1.7.0**. So CI ran the v1.5.0 binary while every developer's `make exit-gate` ran v1.7.0: two lanes, two tool versions, which is exactly the drift that file's own header exists to prevent, **arriving through the fix for it.** That header's wording is the lesson, and it was written in good faith three days earlier: it claimed *"same tool, same version tag, same flags"*. **A TAG IS NOT A VERSION.**

WHY-CHAIN (4 levels) for the gate outage: (1) the exit gate produced no verdict for three pushes; (2) because the action could not be loaded; (3) because `@v1` is a MUTABLE ref that someone else repointed; (4) ROOT CAUSE: **this project verifies what its gates SAY and never that they SPOKE.** `loop-gate` carries twenty checks and not one asks whether the exit gate produced a verdict for trunk head. A gate that did not run is indistinguishable from a gate that passed -- which is DEF-ROC-086's skipped-not-failed shape, now reached by a second, entirely different road.

ROUTED as **SSF11.4** (three clauses, all plain practice -- NO experiment row, deliberately: SS25a's validity bar says a fix is not an experiment, ROC is at 8/8 rows, and retiring a live row to make space for a safety fix would be gaming the cap, exactly as v151 declined to do). QUALITY THIS CYCLE, and it is the best evidence the SSF11 gate is real: **three testers, three passes, all adversarial.** DEF-ROC-149's tester induced **six** distinct failures rather than watching the gate print PASS -- each limb, the delete-to-pass interlock, the ratchet-growth refusal and the target-figure refusal, every one quoted and reverted -- which DISCHARGES `EXP-ROC-014`'s outstanding SS17c.2 proof-of-fire obligation. DEF-ROC-143's tester rebuilt BOTH prior escapes in an isolated git fixture. DEF-ROC-152's tester independently reproduced the mutation (predecessors green, exactly 5 of 10 outside-in red) and caught that the engineer's "93 cases" is 73 today. Not one accepted a written claim. DELIVERED: DEF-ROC-143, DEF-ROC-149, DEF-ROC-152 (the test-refactor PILOT: 53 authored variation nodes, casesWithNoVariation 4023 -> 3968, 28 duplicates removed, coverage ROSE 89.03 -> 89.18), and DEF-ROC-153's two pins. OWNER DECISION: **OD-ROC-005 ruled (c) case-by-case**, overturning the (a) default four days early; the ruling's mitigation -- every node that cannot be expressed outside-in records its judgement AND reason ON the node -- is recorded so the set stays enumerable without a rule. REGISTRY: 8/8, no row added; `EXP-ROC-014` proof-of-fire discharged; `EXP-ROC-016` fired for real (the SSF13a Stop hook blocked this very turn at a non-gate boundary and forced the retro to run inline) but its metric is hours old and unscoreable -- `reported`+`queue` is **57.63%** against its 57.6% baseline, recorded as strike 1 with the honest note that one session is not a measurement. CONSTRAINT TO ATTACK NEXT: `orchestrator`/`reported`, 33.90% -- same name for an eighth read, but for the first time located in the STANDING BACKLOG rather than at the arrival gate, which is a different lever. -->

<!-- v164 (OWNER CORRECTION to the v163 retro, ROC 2026-08-29, within the hour). The owner: *"the slowdown really isnt the wi commands in orchestrator - the problem is the wait time for me to answer questions whilst you do not do things in the background"*. **CORRECT, AND v163's DIAGNOSIS WAS WRONG.** One number forbids it: agent work-effort is **0.2% of gross lead time**, so even with ZERO orchestrator state events, 99.8% of elapsed time is still wait -- a serialisation inside 0.2% cannot explain a 99.8% figure. SSF13 stands as a real but SECONDARY inefficiency and EXP-ROC-015's scope is corrected in place to say so. THE ACTUAL CONSTRAINT: the loop stops when the orchestrator stops talking, and that dead time is the human re-prompt gap recorded in the item log as `reported` + `queue` dwell (**57.6%** combined) -- which is why it READS as bookkeeping latency and is not. **SSF9.4 ALREADY FORBIDS THIS IN TERMS** -- *'ENDING THE TURN IS the stop, even with a polite report... do not end the turn at a non-gate boundary'* -- and was violated ~20 times in one session BY THE ROLE THAT OWNS IT, while that role wrote a retro naming a different cause. So this is not a missing rule, it is an unobeyed one: this project's most-registered failure family (a control that exists and is never consulted -- OI-ROC-014, IMP-021, DEF-ROC-140, DEF-ROC-146) arriving at the top of the process. ROUTED as **SSF13a**: mechanise SSF9.4 rather than restate it, per SS17c.5's prohibition on discharging this class with prose -- the loop SCHEDULES ITS OWN NEXT WAKE, so ending a turn does not end the loop, and the turn ends without a wake ONLY at SSF5 intake, requirement-complete, or a SS0b irreversible op. A blocked decision is NOT one of those, because SSF9e already converts it to a dated default. Scored on **EXP-ROC-016**, whose automatic kill is a wake that reports 'still waiting' -- the polite report SSF9.4 forbids, wearing a scheduler's clothes. Explicitly does NOT license acting without evidence, skipping a gate, or ceasing to report; the report becomes inline and terse ALONGSIDE the next dispatch. REGISTRY: **EXP-ROC-008 ADOPTED** -- CFR rose 7.4% -> 8.8% exactly as it predicted (with two build_faileds volunteered by the engineer that caused them), and control faults shifted to roughly **6 found deliberately against 2 by accident**, from a baseline where nine were found in one session and NOT ONE by anything looking for them. Qualified honestly in the archive: the two accidental finds were among the most consequential of the session, so SSF5e shifted the proportion without eliminating the class. SSF9f is its descendant and carries the mechanism forward. 8/8 at cap. -->

<!-- v163 (RETRO, ROC 2026-08-29; fired on the ROUTINE arm at 6/3 after a session that closed REQ-ROC-019 end to end. FOCUS QUESTION, default. ANSWER: **the constraint changed hands, and the orchestrator now holds it.** v159 asked how to reach 2.2x and answered 'raise occupancy from 1 of 8'. This session took it to **8 of 8** -- and **8x concurrency bought 1.43x completions** (83 -> 119 trailing-14d) on 1.40x agent work-effort. Badly sub-linear, and the gap IS the finding: capacity stopped being the constraint and the orchestrator became it. WHY-CHAIN (5): (1) orchestrator/reported is #1 at **33.90%**, median **58,718s**, n=114, SEVENTH consecutive read; (2) every item's first transition and every subsequent state event is fired by ONE ACTOR; (3) 8x occupancy moved completions 1.4x, so the specialists were not the limit; (4) that actor also writes every dispatch brief, commit message, correction and report, all serialised; (5) ROOT CAUSE, SELF-INFLICTED: **the orchestrator instructs every agent 'do NOT run any wi-* command'**, so every state event queues behind it BY EXPLICIT INSTRUCTION. That instruction was not arbitrary -- it was written against a MEASURED hazard (an engineer editing work-items.py froze every state change in the project for hours, 28 declines staged and unfireable) -- but it was a PROXY for a narrow hazard, applied to every dispatch, and the proxy became the constraint. EXPLOIT: **SSF13 -- a specialist advances its own item's state.** Legitimate now because OI-ROC-006 LANDED: 101 per-transition allowlists removed, firing rights derived from the item's declared owner, so a specialist recording its own work is the rights model working rather than a spoof. The blanket prohibition is RETIRED and may be issued only against a NAMED LIVE resource-class conflict the brief must state. AGENT= still never spoofed; TOKENS=/DURATION_MS= stay the orchestrator's on events it owns, and OI-ROC-008's residue is explicitly unchanged rather than papered over. SUBORDINATE: SSF9d/SSF9d.2 hold -- **arrival:completion fell 2.16 -> 1.60**, not yet under the 1.5 kill line but moving, and completions rose 43% in one session. ELEVATE: NOT capacity -- occupancy is already at cap; the elevate move is **IMP-034** (the writer must defer the WRITE, not the LOOP), because writer contention is the hazard the retired instruction was proxying for. DELIVERED: REQ-ROC-019 complete end to end (UC-112 the ViewIntent channel + dimension registry, UC-113 the registry proven on a STORED column with both parsers made registry-driven, UC-114 proven on a DERIVED read-boundary field), plus DEF-ROC-055 and DEF-ROC-144 (two permanent-data-loss defects), DEF-ROC-142, OI-ROC-006, OI-ROC-014, and **SSF11's engineering exit gate LIVE with the project's first-ever coupling and coverage baselines** (4027 test cases, **4023 attached to no variation node**). QUALITY: CFR **8.8%** (from 7.8% -- the RISE EXP-ROC-008 predicts as its good outcome, and two build_faileds were recorded this session that a less honest cycle would have swallowed); dev-validating **9.2%** still the highest stage and now the named kill-arm for EXP-ROC-015; building 0.8%, deploying 0.0%. RECONCILE LATENCY **0** (v157: 37.4h) -- EXP-ROC-012's adopted practice holding. **THREE REJECTIONS THIS SESSION AND ALL THREE WERE RIGHT**, which is the quality story: two on DEF-ROC-143 (a table row borrowing its neighbour's marker text, then an inserted line doing the same) and one engineer that REFUSED THE ORCHESTRATOR'S SUGGESTED FIX after measuring it -- 'had I taken it on trust, this would have been rejection three'. REGISTRY: EXP-ROC-015 opened, 8/8 at cap. CONSTRAINT TO ATTACK NEXT: unchanged in identity for a seventh read but for the first time with the ORCHESTRATOR'S OWN INSTRUCTION named as the mechanism rather than the allowlist beneath it. -->

<!-- v162 (ROC 2026-08-29; NOT a retro -- a measured finding from DEF-ROC-143's third round, routed immediately because it invalidates a habit every agent here has). **SSF12: in a shared tree, a cleanliness check is a SAMPLE, not evidence.** An engineer measured `git status --porcelain` reading EMPTY seconds before a merge failed on the very file it had just called clean. Up to eight agents share one working tree, so every `test -z "$(git status --porcelain)"` gate is true at the instant it runs and says NOTHING about the instant you act -- and the window between them is exactly where a concurrent save lands. The gates STAY (the index-emptiness gate refused a real sweep this session); what changes is that tree-cleanliness may never be REPORTED as evidence, and where the claim matters it is re-established AFTER the act -- the same discipline CLAUDE.md already requires for a co-owned append target. Prefer operations the window cannot invalidate: isolated-commit.js builds a PRIVATE index from HEAD and never consults the shared one, so its correctness does not depend on a sample at all. And WAIT rather than force -- the same engineer was blocked ~2 minutes by another agent's dirty file and POLLED until it was clean, rather than stashing (which steals untracked files, limit 4) or merging over (silent loss). **SSF12.1: a commit can be ORPHANED by a concurrent branch move.** That engineer's first commit 6db6d42 ended up on neither HEAD nor origin/main -- CLAUDE.md limit 3 arriving through a door nobody was watching, not a checkout the agent performed but one that happened AROUND it. No content lost, and the recovery is the copyable part: it re-ran EVERY gate against the moved HEAD, whose item store had itself changed, rather than assuming the earlier green still applied to a different base. So: after committing in a shared tree, assert reachability with `git merge-base --is-ancestor <sha> HEAD`, and re-validate before re-committing if it fails. A green obtained against a base that no longer exists is not a green. -->

<!-- v161 (OWNER-DIRECTED, ROC 2026-08-29; amends v160's SSF11.3, which was TOO WEAK, within the hour of writing it). The owner's amendment, verbatim: *"1. all tests should be outside in. 2. any tests that are not need to be routed back to a usecase and rewritten as outside in - and moreover we do not want duplicate tests which means we need to approach the collection of usecases as a graph of variations not as a list of unconnected tests"* and *"to reiterate all the usecases should connect back to a persona"*. **WHAT v160 GOT WRONG:** it wrote *"internal tests are not banned; they are subordinate"*, which grandfathers the state the ruling rejects and leaves ~3,900 inside-out tests in place indefinitely. SUPERSEDED. Four clauses, and they are ONE RULE SEEN FROM FOUR SIDES. (1) ALL tests are outside-in, through the use-case's own public surface; there is no permitted category of fast-internal-test-kept-alongside. (2) An inside-out test is MIGRATION DEBT, not grandfathered -- routed back to the use-case it is really about and rewritten from the outside, never deleted to move a number (that loses the requirement it encodes) and never left alone. Ratchets on the mechanism already proven here: the count of tests attached to no variation may only SHRINK. (3) **THE SUBSTANTIVE CLAUSE, and the one that makes the other three achievable: the use-cases are a GRAPH OF VARIATIONS, not a list.** A use-case is a happy path plus variations that COMPOSE, and the unit of coverage is a VARIATION NODE certified by EXACTLY ONE test. Then all three concerns become readable facts about one structure -- a test on no node is inside-out, two tests on one node is a DUPLICATE, a node with no test is a GAP, and the shape of the subgraph is what the use-case actually does. A flat list can answer NONE of them, which is precisely how ~3,900 tests accumulated against dozens of use-cases without anyone deciding it should. The graph is AUTHORED, never derived from the tests -- deriving it would make it agree with itself, which is SS17i's cannot-come-back-negative shape and this project's dominant failure family. (4) The graph is ROOTED IN PERSONAS: persona -> job -> use-case -> variation -> test, every link mandatory, so a test traces to a PERSON WHO WANTED SOMETHING. **MEASURED, and it locates the break precisely: all 116 of 116 ROC use-cases ALREADY carry both `personas:` and `job:` -- zero missing** -- against a real catalog (product/personas.md, docs/personas-and-jobs.md), P1/P2 dominant across eight personas. So the chain is INTACT from persona down to the use-case and broken only BELOW it: use-case -> variation (no graph exists) and variation -> test (the tests attach to nothing). Much narrower than it first appears, and it says where the work is -- do NOT redo the persona/job modelling, build the two hops underneath it. **This completes SS17d rather than replacing it:** SS17d gives every test an owner (`AC-<ID>.<n>`) but leaves the SET unstructured, so nothing notices two tests naming the same criterion or a criterion with three variations and one test. The node names WHICH VARIATION. Routed to SSF11.3 + engineer.md; DEF-ROC-149's AC-149.3 materially rescoped mid-build and its engineer corrected in flight. -->

<!-- v160 (OWNER-DIRECTED, ROC 2026-08-29; NOT a retro — retro-debt routine 2/3, no incident). Owner ruling, mandatory and quoted in full in SSF11: add the CodeAnalysisTools complexity/coupling tool INTO THE TEST STEP, constantly drive those numbers DOWN (ignoring items/), track coverage so it does not go wrong, and TEST FROM THE OUTSIDE -- use-cases, not functions -- all as EXIT CONDITIONS ON THE ENGINEERING STEP before the tester takes over. **THE FINDING THAT SHAPED THE FIX: the tool was ALREADY WIRED.** `code-analysis.yml` has been running on every push to main and weekly, already excluding `items/*`, already auto-detecting generated files -- and it uploads an artifact and GATES NOTHING, so nobody has ever read it. That is this project's most-registered family arriving again (OI-ROC-014 a declared control with no reader; IMP-021 a parser whose grammar is narrower than the declaration; DEF-ROC-140 a gate blind to every Playwright suite; DEF-ROC-146 a whole test tier no CI job runs). So the work is not integration, it is ACCOUNTABILITY: the same tool, moved into the gating path, with a may-only-shrink baseline. ROUTED: **SSF11** (three limbs) + the same three limbs written into `.claude/agents/engineer.md` as the step-3 exit gate, because a rule the engineer does not hold in its own file is one the orchestrator has to remember. **SSF11.2 REQUIRED AN EXPLICIT RECONCILIATION WITH A PRIOR OWNER RULING, and it is recorded rather than silently overwritten:** v127 states *"I do not care AT ALL about code coverage. The ONLY thing tests should be validating is the requirements."* The two are compatible and the distinction is the whole of it -- coverage as a TARGET stays forbidden (writing a test to raise a number is the theatre SS17d rejects and EXP-124 scores as FAILED), while coverage as a REGRESSION DETECTOR is now required, because a FALL means a use-case lost its test or code shipped with none, which is a statement about requirements and not about a percentage. The gate asks 'did it get worse', never 'is it high enough', and no target figure may be introduced. **SSF11.3 SHARPENS SS17d rather than replacing it:** SS17d requires every test to name its AC; this says WHERE the test must stand to make that claim honestly. The cost of getting it wrong is already in the record -- v127's founding case built its precondition by deleting the very leaf whose presence breaks the heal, and **2,171 tests were green while nine real cancellations sat unhealed in production**. An outside-in test could not have been written that way. Internal tests are subordinate, not banned. SCORED ON **EXP-ROC-014**, whose negative arms include the two ways this gate would rot: widening the ignore list or raising the baseline to pass (an automatic kill, the OI-ROC-006 anti-pattern), and introducing a coverage target figure. Proof-of-fire required per SS17c.2 -- each limb observed going RED once, quoted. **REGISTRY: EXP-ROC-009 KILLED at strike 2 on its own stated terms** -- v157 wrote 'if the reported median does not fall at v158 the row DIES with no further argument', and it rose 46,703s -> 73,588s. Killed without argument, because forbidding the argument in advance is the point. One measurement artifact recorded so the next retro does not misread it: this cycle took 28 DECLINES, and deciding an aged item moves its whole accrued dwell into the completed-item median -- so doing exactly the throughput work the owner asked for mechanically raises that number in the short run. Not a reprieve for the row, and not evidence the work was wrong; it is why SSF9d.2 is scored on the count-independent arrival:completion ratio instead. ROC back to 8/8 active rows. CONSTRAINT: orchestrator/reported 33.89%, STABLE. -->

<!-- v159 (retro, ROC 2026-08-29; fired ON REQUEST by the owner mid-loop, NOT on debt — `make retro-debt` reported ok. FOCUS QUESTION, owner-set: ***"if you need the process to go 2.2x faster, what can you do to get there?"*** ANSWER — **NOTHING NEEDS TO GO FASTER. 2.2x is available inside limits this project has ALREADY DECLARED, and the only thing standing in the way is that the loop keeps stopping.** The arithmetic, from §B/§F: **87.01%** of gross lead time is WAITING states (`reported` 33.78, `blocked` 27.28, `registered` 10.68, `open` 7.26, `ready` 5.59, `awaiting_observation` 2.23, `scheduled` 0.19) against **13.00%** in working states — and measured agent work-effort is **0.20%** of elapsed (116,736s of 76,529,128s). Two independent routes to 2.2x, neither requiring anyone or anything to be quicker: the **concurrency route** takes `wip` occupancy from **1 of 8 to 2.2 of 8 — 28% of a cap that is already 8**, i.e. no ELEVATE, no model-tier change, no new agent; the **lead-time route** needs 55% of elapsed time removed, which is only **63% of the waiting** that already exists. Five consecutive retros correctly declined to ELEVATE on the 0.2% figure; this one states the corollary they stopped short of — *if capacity is 99.8% idle, throughput is bounded by STOPPING, and every stop is addressable.* **THE OWNER NAMED THE DOMINANT STOP, and it is the orchestrator, not any agent:** *"you have work you can be doing but you keep stopping to ask me questions instead of blocking items, recording the decision and giving me an async way to handle those blocks"* and *"you can hardly work for an hour without my help."* WHY-CHAIN (4 levels): (1) `blocked` 27.28% @ median 8.8d and `orchestrator`/`reported` 33.78% @ median 37h are the top two GLT owners; (2) both are the same event — the loop reaches a judgement and HALTS; (3) it halts because an escalation was delivered as a QUESTION IN A TRANSCRIPT, which requires the owner to be present to receive it; (4) ROOT CAUSE: **the process had no representation for a decision that is owed but not yet made.** A question has exactly two states, asked and answered, and no default — so the only legal behaviour while unanswered was to wait. Founding case `DEF-ROC-035`: escalated 2026-08-25 with three clean options, **unanswered four days**, item parked 11.9d. EXPLOIT: **§F9e — an owner decision is a BLOCKED ITEM WITH A DEFAULT, never a question.** Block with a checkable predicate, record the options and a RECOMMENDED DEFAULT with reasoning, publish to `work/<project>/open-decisions.md` with a DECIDE-BY date, keep working — and **when the date passes unanswered the DEFAULT IS TAKEN**, because a default that merely waits politely is the same stall with an extra file. Safe because the default must be the REVERSIBLE option, costing at most the work done before it is overturned. Four decisions that were sitting in this session's transcript were converted and shipped as `OD-ROC-001..004`, each defaulting to descope/decline on an unbounded external wait. SUBORDINATE: **§F9d + §F9d.2** (v158, same day) cap the ARRIVAL — measured 179 in / 83 out over 14 days = **2.16:1**, with the source event being sixteen requirements accepted in one sitting on 2026-08-18 and `/slice-next` correctly cascading them on 08-27. ELEVATE: **NOT capacity — the SERIALISATION POINT.** Measured in this very cycle and it is the new finding: one engineer's edit to `work-items.py`, the sole writer every `wi-append` shells out to, **froze every item state change in the project for the entire cycle** — 28 declines and ~6 amendments staged and unfireable for hours. §F2b resource-class exclusivity is correct as a safety rule and is ALSO a hard cap of 1 on concurrency for anything needing a state change. Routed as an improvement slice, not a rule: the writer needs a queued/deferred append so a lock defers a WRITE instead of stalling the LOOP. **DELIVERED THIS CYCLE:** `OI-ROC-006` firing-rights (allowlists removed, in flight at close); the `UC-ROC-112/113/114` reclassification (a three-way "collision" proved to be a mis-modelled `deps:` edge, and `UC-ROC-112` as specified shipped a **broken count** — a 24h tile routing to an all-time list, 42 records over 9.2 days, caught before a line was written); `OI-ROC-009`'s age restored; three wrong `lane:` values corrected; the ROC host allowlisted. **THE QUALITY RESULT OF THE CYCLE IS A REFUSAL:** an engineer sent to enable a maintenance-window env var in aas-test **declined and was right** — a written security control forbids it (*"no deployed environment can be made quiet by an environment variable"*), delta 019 §C1.4 had already ruled the live absence is *parity, not a gap*, and the setting would have armed a permanent nightly 02:00-04:00 suppression window on the **alert-RAISING** path. Its own report is the finding: *"nothing would have stopped me"* — typecheck green, seam pin green (it walks only `src/**` and `local/**`), drift SSOT updated — because **the control's stated policy test is an unticked checkbox that was never implemented.** Guard now being built. Both the orchestrator AND the flow-manager triage had asserted the change was safe and self-serviceable; the source said otherwise. RECONCILE LATENCY: **0.4h across 3 commits**, down from **37.4h** (v157), 23.3h (v156), 20.6h (v155) — the three-retro rise is BROKEN, by committing continuously rather than at the close. Scores `EXP-ROC-012` positive. REGISTRY: `EXP-ROC-013` opened for §F9e; 7 active ROC rows, under the per-project cap of 8. CONSTRAINT TO ATTACK NEXT: **`wip` occupancy itself.** For six reads the constraint was named as an owner (`orchestrator`/`reported`); that identification is not wrong but it is one level too shallow, because the owner is only ever the thing that stopped. The measurable target is occupancy 1 -> 2.2 of 8. -->

<!-- v158 (OWNER-DIRECTED, ROC 2026-08-29; NOT a retro — `make retro-debt` reported ok (routine 0/3, incidents 0). Raised by the owner mid-loop: *"the lead time on everything is going up and up"* and *"the art is finishing things."* MEASURED IMMEDIATELY, and it reframes six retros of work: over the trailing 14 days ROC registered **179** items and finished **83** — arrival:completion **2.16:1**, net **+96**; July net +49, August net +99; two batch-generation days carry most of it (2026-08-18 **+38**, 2026-08-27 **+26**). **`orchestrator`/`reported` has been the named constraint for six consecutive reads while every remedy aimed at it SUCCEEDED ON ITS OWN TERMS** — §F9b honoured 9 of 9, v157 re-decided 17 findings onto a real staggered schedule — because all three remedies (§F9b, §F9b.1, §F9c) went at the QUALITY OF THE DECISION and **not one went at the NUMBER OF ARRIVALS**. A decision is not a finish: a decided item sits in the queue accruing dwell exactly as an undecided one does. **THE ERROR CORRECTED, and it is a misreading of our own rule:** v126 made intake-over-cap advisory for the **PULL** and was right (the remedy for a deep backlog is to deliver faster, so blocking delivery inverts the constraint); v156 then wrote *"Intake gains NO cap from this rule. Little's Law governs WIP, not backlog depth (v126)"*, carrying an argument about the DRAIN across to the FEED. They are opposite interventions, and Little's Law does not merely permit capping arrival, it PRESCRIBES it — L = λW, and with λ at 2.16× the departure rate W rises without bound whatever is done downstream. **ROUTED: §F9d — admission by displacement.** At or over the intake `wip_limit`, a new finding is admitted only by declining an existing intake item, attaching itself as evidence to one, or being declined at birth; below the cap, arrival is unrestricted. The §F8a objection is answered head-on rather than finessed: an item that sits fifteen days and is never pulled IS ALREADY A DECLINE — one nobody wrote down, that cost fifteen days of lead time to not-decide, and that misreports itself as planned work in every view. §F8a forbids closing a finding AS IF FIXED or to flatter a metric; it does not forbid declining one with its reason recorded, which is the honest position when the oldest intake item is 14.7d old against a whole-project finish rate near 6/day. Three evasions are priced in advance (no self-displacement, a re-defer is not a displacement, no batch exemption — N findings at the cap need N displacements). **SCORED ON EFFECT, per v157's own generalisable lesson:** the quantity is the trailing-14-day arrival:completion ratio, target ≤1.0, baseline 2.16:1 — NOT "did every registration carry a displacement", which is the compliance reading whose perfect score coexisted with a rising metric. Dies at strike 2 if the ratio does not fall below 1.5. **§F9d.1 — THE OTHER HALF, and possibly the larger one: a cycle that runs at WIP occupancy 1 of 8.** v157 recorded occupancy **1 of 8 all cycle** with that one item inactive for 23h of it, ran **as a single session with ZERO subagent dispatches**, and §F puts agent work-effort at **0.2% of GLT** (everyone doing the work is 11.98% combined). The system is not slow, it is IDLE — which is exactly why five retros correctly declined to ELEVATE. So the loop's obligation is to FILL WIP, not to pull one item and report: a pull of K < `wip_limit` is a FINDING about the dependency model, not an outcome; look ACROSS TYPES before concluding the set is full (a three-way collision inside one React file caps the use-case set at 1 and says nothing about whether a defect can run alongside); resource-class exclusivity (§F2b) stays but must be NAMED AND RARE, not the accidental default. The two limbs are scored together and can fail independently — arrivals falling while completions do not is a smaller queue and no delivery, which is not what was asked for. **NOT MECHANISED YET, and that is the known failure mode of this exact section** (v157: *"v156's two remedies were PROSE and §F9a's implementing item was never built"*): `loop-gate` lives in `work-items.py`, which an engineer holds exclusively this cycle under §F2b for `OI-ROC-006`. The mechanisation is owed as a registered item the moment that lock clears, and this note is the standing evidence if it is not. CONSTRAINT TO ATTACK NEXT: unchanged in identity — `orchestrator`/`reported`, 33.78%, median 37h/item, n=105 — but for the first time attacked at the arrival rate rather than at the decision quality. -->

<!-- v157 (retro, ROC 2026-08-28; fired MECHANICALLY on INCIDENT debt — `make retro-debt` reported **RETRO DUE [incident (immediate)]**, routine 7/3 and 2 incidents, and BLOCKED the pull.) FOCUS QUESTION, default: *"what was the largest contributor to gross lead time, and what strategies can reduce it while protecting DORA?"* ANSWER — **`orchestrator`/`reported` is now the #1 owner at 31.32% (median 13.0h/item, n=105, backfill 0.00%), overtaking `external` at 30.95%; it is the SIXTH consecutive read of the same constraint, and this retro's whole finding is WHY the previous five retros' fixes did not move it.** `queue` 23.65%, engineer 7.81%, tester 4.17%, cicd 2.10% — everyone doing the work is **11.98%** combined. GLT/item: median 36,430s, p85 300,642s, n=104. **THE HEADLINE, and it is one layer down from v156's:** v156 routed §F9b (*a finding is registered WITH its triage decision, in the same act*) at this exact constraint. **§F9b was honoured 9 of 9** — every defect registered since the v156 close carried a decision in the SAME COMMIT that created its file, verified with `git log -S defer_until` rather than from item text, which carries no timestamp for a frontmatter scalar. **And `reported` still rose, 29.78% -> 31.32%, median 31,485s -> 46,703s.** The cause: **six of the nine decisions were the identical `defer_until: 2026-08-28`, written in one batch, expiring inside 13 hours.** So this is NOT the familiar "documented obligations are skipped". It is the finding that **a mechanised rule can also fail, when the mechanism checks COMPLIANCE instead of EFFECT** — a control satisfiable without achieving its purpose, this project's most-registered failure family, appearing INSIDE the fix for that family. EXP-ROC-009's own condition (c) had foreseen reflexive FAR-dated defers and pointed the 30d total-age ceiling at them; what arrived was the mirror, reflexive NEAR-dated defers, which a 30d ceiling on a one-day-old item can never reach. The guard was aimed at the wrong end of the range. WHY-CHAIN (5 levels): (1) `orchestrator`/`reported` is #1 at 31.32%; (2) leaving `reported` needs `triaged`, orchestrator-only (v156's chain, unchanged — `DEF-ROC-128` still unbuilt); (3) v156's two remedies were PROSE, and §F9a's implementing item was never built; (4) §F9b WAS obeyed, but the cheapest legal decision is a defer with no minimum horizon, so the decision collapsed to "ask me tomorrow"; (5) ROOT CAUSE: **every producer in this system is gated except the one that writes the gates.** Item transitions are edge-checked, tests must name their criterion, parks must carry a probe, deploys must show their `needs` closure — and the retro's own outputs (a fold-back, an improvement slice, a rule) are checked by nothing, so they are the only outputs that can quietly not happen. MEASURED THREE WAYS IN ONE CYCLE: **(a)** `instance/ROC` is **12 commits / 37.4h** ahead of `main` with the integration tree CLEAN throughout — every fold-back would have exited 0 on one command — and reconcile latency rose 20.6h (v155) -> 23.3h (v156) -> 37.4h, each of those retros recording step 8a as done; **(b)** 33 improvement slices, **8 with no `**Status:**` line at all**, several QUEUED since 2026-06-06, and `IMP-033` (opened by the v150 retro four days ago) has `park_remedy` in **ZERO lines of machinery and ZERO items** while `EXP-ROC-004` sat at strike 1 of 3 **being scored against it** — which would have archived the hypothesis as "no measurable effect" when the truth is "never built", a FALSE negative that is worse than no row; **(c)** §F9b above. EXPLOIT: **`loop-gate` check 17 `undecided-arrival`** (§F9b at the CYCLE clock, where check 4's is 7 days) **+ `_defer_is_decision`, a MINIMUM DEFER HORIZON** — a defer under `DEFAULT_MAX_BACKLOG_AGE_DAYS` in the future is not a decision, because that is the window the gate already grants for free, so it decides nothing. Measured from `now`, NOT from queue entry: the first version measured from entry and therefore did nothing about an aged item snoozed daily, which is the 7d-to-30d window between check 4 and the total-age ceiling. Folded into `EXP-ROC-009` rather than opened as a new row — same hypothesis, now with teeth — with the commitment that if the `reported` median does not fall at v158 the row DIES at strike 2 with no further argument. SUBORDINATE: **checks 18 `reconcile-latency` and 19 `retro-output-unbuilt`**, registered as `EXP-ROC-012`. Check 18 blocks only when the integration tree is CLEAN (fold-back would exit 0 — one command, always available) and stays ADVISORY when it is dirty, because blocking on a remedy the loop cannot reach is the `DEF-ROC-083` unsatisfiable-gate failure. Check 19 blocks on an open slice cited by an active row THIS project owns, is ADVISORY for another project's rows (§25a v143/v145 gives a retro no standing over those, only the right to report and add a strike), and ADVISORY for the rest of the aging queue. Ownership is read from the row's ORIGIN CELL, not the whole row — two earlier attempts were wrong in instructive ways, recorded in the code: asking the FILESYSTEM which projects exist fails because a per-project worktree contains exactly one, and searching the WHOLE ROW fails because one OagEventSource row mentions ROC in its prose and a mention is not ownership. ELEVATE: **NOT taken.** Everyone doing the work is 11.98% of GLT and `wip` occupancy was **1 of 8** all cycle (and that one item, `DEF-ROC-123`, had no recorded activity for 23h of it) — adding capacity to a system that is 99% idle buys nothing. **DELIVERED:** `DEF-ROC-140` — **the test-requirement gate was blind to EVERY PLAYWRIGHT SUITE.** `test.describe(...)` matched no branch of its call regex (the lookbehind rejects `describe` after a `.`, and `test` cannot absorb `.describe`), so 16 suites in 11 files were invisible and their cases inherited no suite title. limb1 1145 -> 1138; three of the seven mis-counted cases landed yesterday and BLOCKED the loop as a ratchet REGRESSION that had not happened, while the remedy the gate printed ("delete it, or register the criterion") would have damaged a correct test. The other four had been frozen in the 2026-08-24 baseline since the first measurement, so the committed floor of 1142 was unreachable by construction. Found by asking §F5e's second question of the parser — *what do you actually measure* — which is `EXP-ROC-008`'s mechanism working. **DECIDED, not delivered, and the capacity signal is deliberate:** 17 findings whose recorded "decisions" decided nothing were re-decided onto a REAL staggered schedule, two per slot from 2026-09-05, ordered by value/cost — not a batch re-stagger, which is the `aged-backlog-defer-ceiling` pathology. `DEF-ROC-055` (value 5, an uncaught poison loop that loses events for ever) takes the EARLIEST legal slot rather than a pull, and that is the honest capacity statement of this cycle: ROC has 54 items in intake and delivered machinery this cycle. QUALITY: CFR **7.8%** all-time (up from 7.4% — the RISE `EXP-ROC-008` predicts as its good outcome, failures becoming recordable); `dev-validating` **9.4% (11/117)**, still the highest in the system; `building` and `deploying` **0.0%**; rework 4.9% (13/267). REGISTRY: 6 ROC rows -> `EXP-ROC-004` **PAUSED at 0/3 (never built, clock stopped, resume condition recorded)**, strikes recorded on 006/007/008/009/010, `EXP-ROC-012` opened. TOKEN REVIEW (§24): §E reports 1.7% plumbing / 98.3% delivery. `EXP-ROC-010` (`make item-brief`) is **UNSCORED with no sample** — this cycle ran as a single session with ZERO subagent dispatches, so median-tokens-per-dispatch has no denominator; recorded as strike 1 rather than skipped, because a row that is never scored lives for ever. No new token change routed: the measurable cut from v156 has not yet had a chance to be measured, and routing a second one would make neither attributable. RECONCILE LATENCY: **37.4h with 12 commits batched** at retro open, up from 23.3h (v156) and 20.6h (v155) — THIRD consecutive rise, now mechanised as check 18 and scored on `EXP-ROC-012`. Fold-back run at close. CONSTRAINT TO ATTACK NEXT: `orchestrator`/`reported`, **31.32%, median 13.0h/item, n=105** — unchanged in identity for six reads, but for the first time with a mechanism on its cheapest evasion. -->

<!-- v156 (retro, ROC 2026-08-27; fired MECHANICALLY on ROUTINE debt — `make retro-debt` reported **RETRO DUE [routine 7>=3]** and BLOCKED the pull. That is itself the headline: routine debt was structurally UNREACHABLE at the start of this cycle and reached 7/3 the moment the marker was split. Fold-forward ran first per STEP 0, exit 0; v155 merged clean.) FOCUS QUESTION, default: *"what was the largest contributor to gross lead time, and what strategies can reduce it while protecting DORA?"* ANSWER — **the constraint is unchanged in RANK for a fifth consecutive read, but the count-independent figure reframes what to do about it: agent work-effort is 0.17% of gross lead time.** §F reports **116,319s** of measured agent effort against **66,759,943s** elapsed. The system is not slow because anything is working slowly; it is slow because almost nothing is being worked on at any moment. GLT per item: median **38,749s**, p85 **323,126s**, n=101. By owner: `external` **31.73%** (median/item **620,515s = 7.2d**, n=17), `orchestrator` **29.78%** (median **31,485s = 8.7h**, n=98), `queue` **23.85%** (median 24,838s, n=103), engineer 8.10%, tester 4.36%, cicd 2.18%. By state: `reported` **29.78%** and `blocked` **29.60%** (median **1,215,508s = 14.1d**, n=14), backfill 0.00% on both — clean, and count-independent per §17f limb 6. **WHY THE TOP OWNER IS NOT THE TARGET, stated so the change-set is not judged against the wrong number:** `external` is 14 items parked on platform Ask A (RBAC grant) and Ask D (Easy Auth). The owner has CLOSED the ask list at two items, so nothing ROC does opens it; it is decision debt, not flow debt. The correct response to it was exercised THIS cycle and is worth recording as the pattern: discovery established that `REQ-ROC-020` (make the Global Fallback configurable) needs a rule-config WRITE path that does not exist on the deployed host, the owner chose **HOLD** rather than build, and product created no chunk/slice/UC — with the unblock condition recorded as a CHECKABLE predicate (`DEF-ROC-009` leaving `blocked`) rather than a memory. That reduces future exposure to the constraint without pretending to reduce the constraint. **SO THE EXPLOITABLE CONSTRAINT IS `orchestrator`/`reported` AT 29.78%, TWO POINTS BEHIND, AND IT IS ENTIRELY SELF-INFLICTED.** WHY-CHAIN (5 levels): (1) `orchestrator` is the #2 GLT owner and **every second of it is the `reported` state** — 98 items, median 8.7h each; (2) items dwell in `reported` because leaving it requires the `triaged` event, whose ONLY legal agent is `orchestrator`; (3) an orchestrator-only transition takes a median 8.7h because the orchestrator is a single serialised actor that also runs the pull loop, fires pipeline `deployed` events, dispatches every agent and reports to the human — triage competes with all of it and therefore happens in batches, whenever the orchestrator next looks; (4) triage is orchestrator-only because of the per-transition AGENT ALLOWLIST, under which the **flow-manager — the role that OWNS scheduling — is structurally forbidden from scheduling a defect** (`type: defect` has no `ready` state at all, and `triaged` excludes flow-manager); (5) ROOT CAUSE: **the allowlist makes the orchestrator a mandatory serialisation point for the first transition of all 130 defects.** MEASURED THIS CYCLE, twice, independently: the flow-manager dispatched to clear `aged-backlog-undecided` on six intake defects attempted `made_ready` on two and was REFUSED, so all six of its decisions became dated `defer_until` entries rather than the schedules two of them warranted on merit; and an engineer that reproduced `DEF-ROC-063` and found the premise FALSE had **no legal event of any kind** to record it — from `reproducing` its only forward event is `confirmed`, which would have been a lie. It declined, wrote its verdict to a file and handed it back. **THE GRAPH'S ONLY AFFORDANCE FOR AN HONEST NEGATIVE WAS A FALSE ASSERTION.** Registered as `DEF-ROC-128` with **ten** recorded instances across five roles; instance 10 is the mirror image — an engineer that sharpened `DEF-ROC-071`'s stated mechanism while building adjacent code could not append it, and the finding survives only because an orchestrator relayed it by hand. Instance 9 shows the graph COMPELLING a false record; instance 10 shows it SILENTLY DISCARDING a true one. **RECURRENCE, and this is why a principle-failure entry is opened rather than only an item:** `UC-ROC-093`'s own 2026-08-14 event log already called this *"the seventh recorded instance of the per-transition allowlist blocking legitimate work across four different roles in one day"* and said to note the incoherence explicitly. It was noted, three times, and never fixed — thirteen days and three instances later it is the measured #2 GLT owner. A root cause recorded and left is a system failure to smooth it (§5b). EXPLOIT: **§F9a — a role that PERFORMS work may always record its OUTCOME, including a negative one.** No role's only legal forward move may be a statement it believes false. Routed to `process-current.md` + `DEF-ROC-128` as the implementing item; explicitly NOT closable by adding one more agent to one more allowlist, which would be the fourth such extension. SUBORDINATE: **§F9b — a finding must be registered WITH its triage decision, in the same act.** The orchestrator registered **seven** findings this cycle (`DEF-ROC-125` through `DEF-ROC-131`, `OI-ROC-012`) and triaged **one**, piling six items onto the very queue it then named as the constraint. Each finding is real and §F8a rightly forbids closing one to shrink a number — but registering a finding and not deciding it converts discovery into inventory, and the discovering role always holds the context to decide. So intake gains no cap (Little's Law governs WIP, not backlog, v126) and instead the ARRIVAL carries its own decision. ELEVATE: **NOT taken, and the number that settles it is 0.17%.** Agent work-effort is 116,319s against 66,759,943s elapsed; raising `N` or moving an agent to a stronger tier buys nothing when capacity is idle 99.83% of the time. **DELIVERED:** `REQ-ROC-002` **complete** by aggregate fold (`UC-ROC-093` -> `SLC-ROC-025` -> `CHK-ROC-004`); `UC-ROC-107` (an operator opens a publish window and posts an event entirely from the Simulator screen — 22-assertion operator-only walk plus a negative test per blast-radius bound, including an out-of-band kill switch refusing in BOTH directions); `UC-ROC-093`; `UC-ROC-106` at the third attempt; `DEF-ROC-118`, `DEF-ROC-120`, `DEF-ROC-121` resolved; `DEF-ROC-063` **not_reproduced** with its cause pinned to `DEF-ROC-057`, whose fix landed **22 minutes** after the human's spreadsheet was saved; `UC-ROC-105` parked `awaiting_observation` — four criteria pass and the CENTRAL one (never mislabel a window-extended hold as "soak window") is unreachable on `aas-test` because `SEEDED_MAINTENANCE_WINDOWS` ships `enabled:false`, established by three live probes including one inside the seeded window's own 02:00-04:00 slot, with a committed predicate rather than a forced override. **A GREEN THAT WAS REFUSED IS THE QUALITY RESULT OF THE CYCLE.** QUALITY: `dev-validating` **9.6% (11/114)** is the highest failure rate in the system and two of this cycle's three rejections were DOC ROT on one document; `validating` 5.7% (5/88); `building` and `deploying` **0.0%**; rework 5.2% (13/252). CFR 8.16% all-time. **SEVEN FINDINGS REGISTERED AND SIX SHARE ONE SHAPE — a control reading healthy while the thing it guards is actively failing:** `DEF-ROC-125` `loop-gate` reported "3 containers, clean" at **load average 56.11** (22 `yes` processes, ~1300% CPU, from a peer session's load experiment — NOT killed, the peer was notified and stopped it); `DEF-ROC-126` `board-sweep` printed "nothing outstanding" while **190** items were stale, because its resume file is overwritten scope-blind by every run — **reproduced a second time within the hour**, discarding a 37-id NON-RETRYABLE failure list; `DEF-ROC-127` the co-owned guard cannot tell a REWRITE from a REVERT, so it fires on the loop's own step 6 and routes the documenter to `--no-coowned-merge`, the flag that reverts co-owned lines — verified 20 of 25 lines legitimately superseded with all substance intact; `DEF-ROC-128` above; `DEF-ROC-129` **`DEF-ROC-120`'s own class one layer down** — it made `build_failed` recordable from `deploying`, but `BUILD_FAIL_RECOVERY_EVENTS` omits `deployed` and from `deploying` that is the ONLY reachable resolve, so the first real firing (a genuine 27-minute recovery) reads `n=0`; `DEF-ROC-130` the retro cadence itself. **THE OWNER RULING THAT REDIRECTED THE CYCLE, and it reversed a recommendation of mine:** *"we should not deploy things that are red — they should get fixed"* and *"fix the loops to fix things."* I had recommended moving the rot gate's item-store arm OUT of the deploy-gating tier (`OI-ROC-012` option b) and the owner overruled it — correctly: moving a check out of the deploy gate does not make the underlying condition true, it only stops anyone being stopped by it. The arm STAYS and a true red still blocks; only the FALSE reds are in scope (the LIVE arm keys freshness on a pinned build sha, so it reds after ANY deploy — verified on `f950220f`, which changed a workflow file and one test, touched no screen, and left all five captures byte-identical by content hash, yet clearing it costs a real publish that raised real ticket `ROC-31`). Re-keying on CONTENT makes the check accurate, which is the opposite of bypassing. **THE SECOND HALF BECAME `DEF-ROC-131` AND IS THE MOST IMPORTANT MACHINERY OF THE CYCLE: `loop-gate` had 13+ checks and NOT ONE asked whether trunk was red.** Trunk was red for most of this cycle — four sequential genuine reds — and because `Deploy` has `needs: [test-function-app, test-web-app]` every one SKIPPED the deploy; `UC-ROC-105` and `UC-ROC-106` sat built-green, committed, pushed and UNDEPLOYABLE, therefore un-validatable, while `loop-gate` reported OK on every run and the orchestrator learned of it from an engineer's passing remark. Now check 16, and it reads the **DEPLOY job's own conclusion and its `needs` graph, never the run conclusion** — so `DEF-ROC-068`'s permanent audit red (deepmerge-ts via flowbite-react via the design system; re-verified against `registry.npmjs.org` this cycle — flowbite-react at latest `0.12.17` pins deepmerge-ts EXACTLY `7.1.5`, so the wait is unbounded and an `npm overrides` is the only route round it) does NOT fire it, which the successful deploy alongside that red proves. TOKEN REVIEW (§24): **21.75M** tokens, `engineer` **74.7%** (16.24M), `tester` 18.6%, `cicd` 5.4%, `orchestrator` 1.3%; coverage 16.0% so the split is directional. **§E came back 1.27% plumbing against 0.0% for three consecutive retros** — v150's rule working, because the previous 0.0% was 0.0% BY CONSTRUCTION. Highest-leverage reduction IDENTIFIED AND ROUTED: **`make item-brief` exists, is committed, and is referenced in ZERO agent files and ZERO commands.** A targeted-read tool sat idle all cycle while five dispatches read whole item files (one read of five items cost 68.5KB in a single call). That is the same shape as the six findings above — a built control that does nothing — and it is the rare token cut that cannot hurt DORA, because it replaces whole-file reads with the SAME facts. Long dispatch briefs were considered as the alternative cut and DECLINED per §26: they demonstrably bought quality this cycle (a tester screened a load-window green on shape rather than blanket-discarding it; another refused a false green and parked the item), and shortening them risks the 9.6% `dev-validating` rate. RECONCILE LATENCY: **23.3h with 5 commits batched** at retro open (oldest `f92b741`, 2026-08-26T18:17:31Z), up from v155's 20.6h and therefore TRENDING THE WRONG WAY across two consecutive retros — named here so the next retro scores the trend. Fold-back run at close. REGISTRY: 5 ROC rows -> `EXP-ROC-001` **ADOPTED** on real movement (see archive) -> 4, +2 new = **6, under the per-project cap of 8**. CONSTRAINT TO ATTACK NEXT: `orchestrator`/`reported` **29.78%, median 8.7h/item, n=98** — the exploitable one, whose root cause is now named and whose implementing item is `DEF-ROC-128`. `external` remains the top share and remains owner decision debt, not flow debt. -->

<!-- v155 (retro, OagEventSource 2026-08-27; fired MECHANICALLY on incident debt — `make retro-debt` reported RETRO DUE [incident (immediate)] on the `DEFECT-OAG-142` resolve and BLOCKED the pull. Fold-forward ran first per STEP 0; main held nothing this instance lacked.) FOCUS QUESTION, default: *"what was the largest contributor to gross lead time, and what strategies can reduce it while protecting DORA?"* ANSWER — **the constraint is unchanged in rank but its ROOT CAUSE was measured for the first time, and it is that the gate guarding it can be satisfied without moving any work.** `queue` **68.66%** of measured GLT, median **567,165s (6.6d) per item**, n=222; state `open` **61.65%**, median **675,874s (7.8d)**, n=149, backfill 0.00% — clean, and count-independent as §17f limb 6 requires. WHY-CHAIN (4 levels): (1) `open` dominates because items sit in intake unpulled; (2) they are unpulled because WIP is saturated by `DEFECT-*` work — **6 of 7 slots at measurement** — and Ready is replenished from whatever is cheapest to DECIDE, not from a reserved class; (3) that persists because the only mechanism acting on aged intake is `loop-gate`'s `aged-backlog-undecided` check, and **a dated defer satisfies it without moving the item**; (4) ROOT CAUSE: **the gate measures DECISION, not MOVEMENT**, so its cheapest compliant action is re-dating — and re-dating is what happened. **THE MEASUREMENT THAT MADE THIS ACTIONABLE:** the same 36-item batch had been mechanically re-staggered **TWICE in 9 days** (08-18, 08-19), items 22-25 days old re-dated three weeks out, **not one reaching `done` in between**, with the gate reporting satisfied the whole time because every individual defer was legal and in date. That is §17i's control-satisfiable-without-achieving-its-purpose family arriving in the flow gate itself — the eighth registered instance and the first inside the flow machinery. EXPLOIT (waste at the constraint): **§F8a.2 + `--max-defer-total-days` (default 30)** — past a total-age ceiling an in-date defer stops exempting the item and the answers are SCHEDULE / DECLINE / ESCALATE; re-dating is not one of them. Keyed on TOTAL AGE rather than a defer COUNT **because the count is stored nowhere** (frontmatter holds one value, overwritten each re-date) while age is already computed and is exactly what serial re-dating hides — a rule needing a number nobody stores is a rule that cannot fire. 4 new tests, and the non-vacuity is a DIFFERENTIAL on one fixture (25d old, deferred 3 weeks out: ceiling 20d fires, ceiling 90d does not), plus two limbs pinning that it does NOT double-report an item with no defer or an EXPIRED one. `make test-wi` 610 -> 614. Deliberately did NOT tune the ceiling to fire on today's corpus (oldest 25d, ceiling 30d): making a check fire by lowering its threshold is the dishonest direction, so it is proven by test and will bite the genuinely-serial cases within days. SUBORDINATE: **§F2d — a starved CLASS needs a standing allocation, not better intentions.** When replenishing Ready, if intake holds any class that produced no `done` last cycle, at least one pick must come from it. EVIDENCE FROM THE CYCLE THAT FOUND IT: steering replenishment to the `OI-*` class closed **both** picks inside the same session (`OI-GH-WORKFLOW-CAPTURE-REFRESH-OWED`, `OI-WI-VALIDATE-IGNORES-DERIVED-STATE-LEGALITY`) — **2-for-2 in one cycle against 0-for-36 over 9 days**. ELEVATE: NOT taken; agent work-effort is **0.1% of GLT** (§F, 285,302s of effort against 245,638,692s elapsed), so capacity is manifestly not the binding constraint and raising `N` would buy nothing. **§E CAME BACK NON-ZERO FOR THE FIRST TIME: plumbing 14.8% / delivery 85.2%** at 9.2% coverage, against **0.0% for three consecutive retros**. That is v150's rule (replenishment/flow events carry `TOKENS=`) working exactly as written — the previous 0.0% was 0.0% BY CONSTRUCTION because only delivery-classified stage events carried tokens. §F populated too (duration coverage 6.9%). Both sections stop being decorative. TOKEN REVIEW (§24): ~2.4M subagent tokens across 12 dispatches, dominated by `engineer` (24.5M cumulative, 173,687s work-effort, median 2,044s/dispatch). Highest-leverage reduction identified and DECLINED: capping dispatch context would have prevented today's most valuable outputs, each of which came from an agent reading MORE than its brief — three items had their recorded mechanism falsified by a dispatch that went and checked (`OI-SANDBOX` three facts superseded, `OI-PARTS-CHECK` fixed 6.6d earlier, `DEFECT-OAG-140`'s fix doing less than half what the item claimed). Per §26 that is a token INCREASE buying a real DORA gain and is accepted. RECONCILE LATENCY: **20.6h with 10 commits batched** at retro open — above zero and therefore drifting toward the §0a Rule 4 ban; fold-back run at close, and it is named here so the next retro scores the trend rather than rediscovering it. DELIVERED: `DEFECT-OAG-142` **validated** (root cause: `coownedStaleAgainst` asked whether a commit's lines were absent from MY copy and never whether HEAD still had them — **absence of content HEAD does not have is AGREEMENT, not staleness** — selecting a base 23 commits behind BOTH sides; four corruptions in one session, one of which duplicated two events in an item log and MANUFACTURED AN ILLEGAL TRANSITION that stopped the loop; the report could not see it because `addedBack` is a set difference so a duplicated line is not novel). `OI-A-WEDGED-CI` closed (CI wedge gone: 7m10s named failure against 2h20m). `OI-PARTS-CHECK-MARKER` closed (premise stale — fixed 6.6d earlier, never given its event; the real gap was acceptance pinned at the gate's INPUT, never the gate). `OI-GH-WORKFLOW-CAPTURE-REFRESH-OWED` closed. `OI-WI-VALIDATE-IGNORES-DERIVED-STATE-LEGALITY` closed with **I8**. The owner's `bos.*`/`daa.*` grant applied and audited passing on **both** hubs. **A PRE-PUSH CATCH WORTH THE WHOLE CYCLE:** a correct new ECS-adoption gate was wired into `infra-sandbox`, the TOPOLOGICAL ROOT of the deploy chain, with no `continue-on-error` and a precondition that had not shipped — pushing it would have skipped EVERY downstream deploy including prod. delta-079 had ruled the interlock in ONE direction only. Registered as `OI-A-BLOCKING-STEP-AT-A-NEEDS-ROOT-HAS-CHAIN-WIDE-BLAST-RADIUS-AND-NOTHING-MODELS-IT`, and the tester CONFIRMED the gap independently: every test reading `infra.yml` reasons about steps in ISOLATION. Two generalisations kept: **a gate that asserts a REMEDY must ship WITH the remedy**, and **a blocking step's blast radius is the transitive closure of the jobs that `needs:` its job.** ORCHESTRATOR FAILURE, unsoftened: I swept another agent's staged file into `cfb42a18` via `add`+`commit` **having printed the evidence it was there in the same `&&` chain** — a check nothing branches on is decoration. Not repaired (four agents were committing; `reset --soft` could have discarded one) and recorded as a principle failure. **Then the better finding: `CLAUDE.md` limit 2's instruction was itself WRONG** — `make commit-isolated` already commits an untracked file, by construction (private index seeded from HEAD, shared index never read). The rule told agents to open a window the machinery already closes. Both halves measured within the hour: the new gate REFUSED correctly on the next new file, and `commit-isolated` committed it with nothing swept. **The repair was documentation of an existing capability, not new code** — the cheaper and more common repair, missed for exactly as long as the rule read the way it did. REGISTRY: 8 active (AT cap) -> **5** by three adoptions, all on real movement, then +2 new rows = **7, under cap**. CONSTRAINT TO ATTACK NEXT: `queue` **68.66%**, median **6.6d/item** — and for the first time the change-set attacks its measured root cause (a gate satisfiable without movement) rather than its symptom. -->
<!-- v151 (OWNER INSTRUCTION, OagEventSource 2026-08-25 — NOT a retro; no DORA recompute, no experiment row, no retro-debt drain. The owner stated that **production is now live with customers** and asked for a process update covering (a) running the tester in development and then again in production and (b) a rollback strategy, on the standing requirement that we do not break prod.) HEADLINE — **the two-stage tester was ALREADY the rule and is restated; the actual gap is ROLLBACK, and this week produced the evidence that it is a real one.** §F5a/§11b already require `dev_validated` then an automatic `promoted` then a prod `validated`, and the state graph enforces the ORDER — `UC-ML5` and `UC-NCI1` both went through it correctly this week. So F5c.1 restates rather than invents, and names the thing that actually makes the second dispatch happen: `loop-gate`'s stalled-validation check, which is the only reason two items sat 47h in `prod-validating` and then moved. **WHAT WAS MISSING IS ROLLBACK AS A MECHANISM.** 'Reversibly rollable' existed only as the fourth bullet of §F5a's infra auto-approve list, with nothing computing it, and the word appears six times in the whole process as principle and never as procedure. **§F5b said feature-flagging is the escalation 'until evidenced' — THE EVIDENCE ARRIVED**: `DEFECT-OAG-140`, false `OagFlightDiverted` events delivered to BOTH live prod consumers (verified at source — 352 publish results, `failedEntryCount 0`, both fan-out lambdas enabled, DLQs at depth 0), **7 of 13 false, 53.8%**, undetected for five days. **AND THE NATURAL ROLLBACK WAS UNAVAILABLE**, which is the part that makes this a process change rather than a defect: `DIVERSION_MAPPER_ENABLED` is a bare `true` with `stageKeyed: 'none'`, so disarming prod also disarms dev and sandbox — i.e. the rollback would have destroyed the reproduction needed to fix the fault being rolled back. MEASURED: of five `outwardEmitting: true` arms only **two** carry a per-stage table. FOUR RULES ROUTED, all automated preconditions or automated signals — **§F5a's rejection of a human promotion gate is UNCHANGED and explicitly restated**, because the fix for 'prod has customers' is not a human clicking approve: (F5c.2) an outward-emitting arm MUST be stage-keyed with a lane term before the change that arms it may deploy — promoting `delta-078`'s architecture ruling into process, checkable from the registry the arms already declare themselves in; (F5c.3) every prod-affecting change names a ROLLBACK CLASS — **A** arm flip (seconds, no redeploy), **B** revert+redeploy (one pipeline), **C** irreversible — and **class C is the one that matters, because a published event cannot be unpublished**: AdixOut and FIDS received those diversions and no revert reaches them, so an outward-emitting change is class C for what it has already sent and class A only for what it has not, which is precisely why F5c.2 is a PRECONDITION; (F5c.4) an UNREHEARSED rollback is an unfired guard — this project's signature failure is a control that reads healthy while doing nothing and it has now been found in a gate, a census, a byte search, a vacuity check and an arm, so a rollback path nobody has executed is the same shape and must be rehearsed in dev and recorded on the item; (F5c.5) declare the DETECTION signal, because a rollback nobody triggers is not a rollback — `DEFECT-OAG-140` was found by a census five days late and nothing alarmed, and where no signal exists the item must SAY so, since an undetected class-C change is a risk the owner is entitled to see before it ships rather than after. **NO EXPERIMENT ROW, deliberately and stated in the section itself** — §25a's validity bar says a fix is not an experiment, and neither is mandatory safety practice adopted because the operating context changed: there is no hypothesis here we would abandon if the metric stayed flat, because we would not resume shipping un-rollable outward changes to live customers on the strength of a chart. It is routed as plain practice against **recovery/MTTR** primarily and CFR secondarily. (It also keeps OagEventSource at 8/8 honestly rather than retiring a live row to make room, which would have been gaming the cap.) NOT DONE HERE and left to the owner, because both are decisions rather than engineering: the mechanism-C corroboration ruling on `DEFECT-OAG-140` (how many messages before we believe a diversion — latency against truth, a consumer-contract call, pinned executably in `AC-140.5`), and whether to convert `DIVERSION_MAPPER_ENABLED` to a stage-keyed table with identical values as a separate reviewable commit. No arm was touched. **AUTHORED AS v150 AND RENUMBERED TO v151 AT COMMIT TIME - recording it because it is a KNOWN RECURRING TRAP and the record should show it caught rather than avoided:** ROC published its own v150 retro while this was being written, so `main` already held v150 by the time the commit ran. This is the v141/v144 renumbering trap, and it was caught by the commit failing rather than by a check - the fold-forward at the START of this turn reported `already up to date` and was correct AT THAT MOMENT, which is exactly the window the trap lives in. The section header, the `process_version`, the heading and the `supersedes` list were all moved together, and this record was reordered ABOVE ROC's so the file stays newest-first. -->
<!-- v150 (retro, ROC 2026-08-24; fired MECHANICALLY on incident debt — `retro-debt` reported RETRO DUE [incident (immediate)] for `DEF-ROC-064` resolved 14:10:30Z plus two routine closes (`CHK-ROC-007`, `SLC-ROC-026`) since v148's drain at 06:51:15Z, and `loop-gate` BLOCKED the pull on THREE preconditions. Fold-forward ran FIRST per the STEP-0 precondition and pulled `main` v148→**v149**, which mattered immediately: v149 had just landed §5b.2, and this retro is the first to be BOUND by it.) **UPTIME FIRST, because §5b.2 now requires it before any movement may be quoted: of the 7.53 h since v148's drain the loop shows event activity in roughly 1.2 h — two dead gaps of 141.0 min and 237.3 min (06:59:01Z→09:20:00Z, 09:20:00Z→13:17:19Z), i.e. ~6.3 h with no event at all. So NO constraint movement is claimed this cycle in either direction.** For the record the numbers barely moved (`external` 35.67%→**35.40%**, `blocked` 33.76%→**33.41%**), and under §5b.2 that is reported as UNATTRIBUTABLE, not as 'held'. v149's principle-failure was written against exactly the temptation to read those two lines as a result. FOCUS QUESTION (default): *what was the largest contributor to gross lead time, and what strategies can reduce it while protecting DORA?* ANSWER — **the constraint is `external` for the fifth consecutive retro (35.40% of GLT, median 7.19 d/item, n=15, 0.00% backfill; state `blocked` 33.41% at a median 20.95 d/item), and this cycle established that part of it is not external at all: it is our own backlog wearing `external`'s name.** `DEF-ROC-035` (parked 7.2 d on `make probe-dash0-wired`) and `DEF-ROC-056` (4.9 d on `make probe-appinsights-wired`) both wait on deployed app settings that are absent because nobody has wired a telemetry sink — and the item that wires one, `DEF-ROC-041`, says in its own Definition *"Ownership: ours … Not blocked externally … buildable via the normal dev-first CICD pipeline"*. It had sat undecided in `reported` for **7.2 days, longer than the parks it would end.** I read the two probes' SOURCE rather than the items' prose to establish this (§17ab), which is the only reason it surfaced. **THE AGGRAVATING HALF, and it is mine: the aging gate was used to push the constraint's own remedy further away, and it read as compliance.** Check 4 (§12d.1, EXP-131) blocked the pull on 8 items aged 7.1–7.2 d with no recorded decision; I cleared it with six dated defers — and one of the six deferred `DEF-ROC-041` to 2026-08-26. The retro's own IDENTIFY step caught it ~20 min later and the defer was withdrawn; **nothing mechanical would have.** EXP-143's probes (adopted v148) are not at fault — they answer *"is this still blocked?"* correctly and for ever. Nothing asked *"is the thing that would end this ours, and is it scheduled?"* WHY-CHAIN (4 levels): `external` tops GLT → because 13 items sit parked at a median 20.95 d → because a park's exit needs an actor and ROC owns neither the Service Bus namespace nor the platform grants → **but for at least 2 of the 15 the actor IS us**, and the only control on that is §12d.3's advisory sentence *"if the wait is unbounded, arm it, force the trigger, or judge it statistically"* → which has printed on a `loop-gate` line every cycle for 7.2 days with no effect, because it is PROSE (§17c Layer 2: *a remedy written as prose reproduces the defect it was written for*). EXPLOIT, done in-cycle and needing no machinery: `DEF-ROC-041`'s defer WITHDRAWN; it is the first pull. SUBORDINATE: `intake` 28 deep against `wip_limit` 10 — ADVISORY by design (Little's Law governs WIP, not backlog) and NOT satisfied; median in-queue age 6.2 d, oldest `DEF-ROC-036` at 9.9 d. NOT ELEVATED: `N` unchanged, no model-tier move. NEW LIMB **§12d.2** — a park DECLARES the item that would end it (`REMEDY=` → `park_remedy:`, either an `<ITEM-ID>` or the explicit claim `none-inside-project`); `append` refuses without it (fail closed, copying §17c.2 verbatim); **`loop-gate` BLOCKS when that item is aging in a BACKLOG-kind queue with no in-date `defer_until`**; and the `external` share is REPORTED split inside/outside-project and **never netted off**. Built by **`IMP-033`** (9 ACs), scored as **`EXP-ROC-004`** against gross lead time. Its migration AC binds the **9 LEAF parks**, not the 15 in `waiting` — measured with the new `make item-brief`, six of those are AGGREGATES that read `blocked` only via the fold, and demanding a declaration about a state nobody appended would make the limb unfireable and read as clean. **§5b.1 partition, and it cuts the OPPOSITE way to OagEventSource's — which is why the rule says measure it rather than assume it:** of ROC's 27 intake-state items only **7 (25.9%) are decided-and-parked**, 0 due, **20 (74.1%) genuinely undecided**. OAG measured 65.4% parked at v146. For ROC *deliver faster* remains the honest reading of intake; for OAG it was not. §5b.1 ALSO caught me: I had just created 6 of those 7 defers, so the parked share is partly this retro's own artifact and is reported as such, not netted off. SECOND FINDING, off-constraint and justified as INSTRUMENT INTEGRITY on the EXP-128/v145 basis — **the tool built at v145 to stop one project invalidating another's registry record performs exactly that transfer, silently, in the flattering direction.** `process-lint`'s `parseRegistry` captures `routed` as the ENTIRE REST OF THE ROW (not the routed cell its own comment and violation text name), `projectOf` returns the FIRST `KNOWN_PROJECTS` match with `ROC` first, and **`\bROC\b` matches INSIDE `DEF-ROC-041`** (a hyphen is a word boundary — verified with `node -e`). So appending the cross-project EVIDENCE that v143/v145 explicitly permit as *"reporting, never retirement"* moved two rows out of their owner's cap: **`OagEventSource: 8/8, ROC: 4/8` became `OagEventSource: 6/8, ROC: 7/8`** with nothing adopted, killed or retired. **NOT FIXED INLINE, deliberately, and this is the standing part:** attributing from the real routed cell leaves all four legacy rows naming no project (a C4 violation), and attributing them CORRECTLY — all four trace to OagEventSource retros: `EXP-127`←v131, `EXP-129`←v133, `EXP-131`←v135, `EXP-134`←v138 — puts that project at **9 against a cap of 8**, an over-cap violation only an OagEventSource retro has standing to clear. Either way a ROC-only change hands another project an unclearable blocking `loop-gate` failure: the v143 trap (*no single actor had standing to satisfy it*) reappearing inside the enforcement tool. Registered as **`DEF-ROC-092`** (value 4, lane `parent-repo`) with the 5-part joint fix shape, and **process-lint's per-project counts are advisory-grade for legacy rows until it lands.** THIRD: ui-designer gains checklist rule 5 — **UNKNOWN is a THIRD state, never folded into the negative.** `DEF-ROC-091`: the Relink tab asserts *"Currently self-managed (owns its own rules)"* whenever `currentParent` is falsy, so `undefined` (the probe that would establish it FAILED) renders identically to `null` — the screen states a config fact it does not have. §17i on a screen, and the project's **twelfth** registered absence-vs-ignorance instance; routed to the narrowest owner as plain practice, no registry row (a base rate of twelve is not a hypothesis). REGISTRY — ROC 7/8 after the new row, under cap, zero unattributed. SCORED: **`EXP-ROC-001` STRIKE 2, halves pointing opposite ways and reported separately** — POSITIVE, `DEF-ROC-091` was caught by RENDERING the deployed screen and reading the sentence (invisible to any element-level assertion: every element conforms and the SENTENCE is false); NEGATIVE, `DEF-ROC-064` (*"all buttons are greyed out"*) was HUMAN-reported, which is precisely the *"passed the gate and is still bad"* class this row claims will fall to zero, and it took three fix commits. Strike 3 next ROC retro is adopt-or-KILL. **`EXP-ROC-002` STRIKE 2, NO INSTANCE OBSERVED — second consecutive unmoved scoring, so the next ROC retro KILLS it** unless `OI-ROC-006` is built first; stated plainly rather than dressed up. **`EXP-ROC-003` STRIKE 1, POSITIVE on the discrimination it was built for**: check 15 returned the THIRD outcome — deployed `7d66968b` vs trunk `71a07590`, 1 commit behind, deployed 0.4 h old, **no deploy-TRIGGER path touched ⇒ EXPECTED drift, explicitly NOT a dark deploy** (a naive commits-behind counter would have cried stale). Not adopted: it has not yet caught a real `DEF-ROC-086`-class dark deploy. **`EXP-131` — evidence + strike, REPORTING not retirement (shared row, no standing):** strongly positive, the gate forced **8 real re-decisions in minutes** on inventory aging invisibly; and it named its own ceiling, since one of those decisions parked the constraint's remedy, which §12d.2 now closes. **`EXP-129` — evidence + strike, a NEGATIVE INSTANCE whose violator was the orchestrator running this retro:** my `product` brief prescribed the DESIGN (*"`EVENT=created AGENT=product` then `EVENT=made_ready`"*) and both halves are wrong against `state-graphs.json` — a use-case's genesis event is `registered`, and **`made_ready` is flow-manager-only.** The dispatch found it empirically via a correctly-REJECTED `wi-append`, registered `CHK-ROC-012`/`SLC-ROC-027`/`UC-ROC-099`/`UC-ROC-100` complete with acceptance, reported the contract mismatch instead of working around it — and the floor still needed a SECOND `flow-manager` dispatch. The machinery was right, the agent was right, the BRIEF was wrong. TOKENS (§24/§26) — **the answer is not a reduction, it is that the split cannot come back non-zero.** §E reads plumbing **0.0%** / delivery 100.0% at 16.9% coverage of 1062 events, and three retros have now called that a coverage problem. It is a CONSTRUCTION problem: `TOKENS=` was specified only on `built_green`/`deployed`/`validated`, all classified DELIVERY. Measured proof from this cycle — the `product` replenishment (**179,231 tokens / 549,039 ms**) and the `flow-manager` promotion (**76,532 tokens / 312,395 ms**) are 255,763 tokens and 14.4 min of pure flow mechanics with **no event to record them on.** Routed to `.claude/commands/loop-run.md` as plain practice (a fix is not an experiment, so no row): the replenishment/flow events carry `TOKENS=`/`DURATION_MS=`, and the ORCHESTRATOR attaches them, because a dispatched agent generally cannot observe its own `subagent_tokens` — both agents this cycle said so rather than inventing a number, which is the behaviour wanted. Actual reduction shipped: **`make item-brief PROJECT=<p> [IDS=… | QUEUE=…]`** — one line per item (id, state, value, cost, `defer_until`, title). Deciding the 8 aged items meant exactly those five fields, and getting them cost a 45 KB whole-file dump followed by a hand-rolled `awk` for the same fields; two of this retro's three largest reads were that, and a parameterised target replaces a repeated hand-assembly (§36). It then paid for itself immediately by producing AC-033.9's aggregate-vs-leaf split. DORA: deploy frequency 7.09 all-time / 6.40 trailing-30d; lead time median 962 s / p85 50,603 s; CFR **7.8%** (8.0% at v148); MTTR median 22,857 s. §F remains the standing indictment — agent work-effort is **0.2%** of gross lead time. NOT ESTABLISHED and stated rather than dropped: the §17d test-requirement gate is still NOT CONFIGURED for ROC (`DEF-ROC-045`, which this retro scheduled rather than deferred) and `aged-backlog-unreadable` reported one item whose age could not be computed. Verified before close: `make process-lint` clean, `make doc-lint` clean, `make wi-validate` clean (I1–I4, I6, I7), `wi-project` regenerated (264 items / 187 done), `make item-brief` exercised on all three arms including NOT-FOUND and the usage refusal. Principle-failure: `2026-08-24-a-park-whose-remedy-we-own-is-booked-as-external.md` — logged as a RECURRENCE (third instance of *the system books its own latency to an owner outside itself*: v126's wait wearing the tester's name, v144's `DEF-ROC-004` blocked 28.8 d after its blockers had gone, and now this), and the fourth instance in four days of the wider class §5b.1 and §5b.2 were each written for. -->
<!-- v149 (retro, OagEventSource 2026-08-24; fired MECHANICALLY on incident debt — `loop-gate` reported RETRO DUE [incident (immediate)] for `DEFECT-OAG-137` resolved 2026-08-21T16:37:09Z and BLOCKED the pull. Fold-forward ran FIRST per the STEP-0 precondition and brought v148 in from ROC, so this is v149 and not v148 — no renumbering trap. Reconcile latency **ZERO**: `instance/OagEventSource` was already an ancestor of `main`.) HEADLINE — **the constraint's headline number is confounded by whether anyone was RUNNING the loop, and two consecutive retros have now reasoned from it in opposite directions without noticing.** `queue` is top GLT owner at **66.82%**, and the count-independent median §5b.1 tells you to read went **119,684 s at the v147 close → 303,881 s now, n unchanged at 218 — +154%**. But **the loop was STOPPED for 60.9 h (2.54 d) at the owner's request across that interval, and that downtime alone is 72% of the current median.** `loop-gate` measured the same interval from the other side and agrees: two items 47.0 h in `prod-validating`, one 2.7 d idle in `reproducing`, five `scheduled` open-items 2.6 d idle. So the +154% is **NOT a process regression** — and, symmetrically and more uncomfortably, **v147's celebrated −51% (246,033 → 161,635 → 119,684, called *"the first sustained move in this constraint"*) is exposed to the identical artifact in the opposite direction.** Gross lead time is WALL-CLOCK; `/loop-run` is specified as a CONTINUOUS process (§F9); so calendar time and system latency are the same quantity ONLY while the loop runs, and **nothing records whether it did**. This is the same failure class as §5b.1 (`EXP-OAG-002`) — a control that reads confidently while measuring something other than what it names — arriving a SECOND time in the measurement layer, which is why it is a sibling limb and not a new section. ROUTED: **§5b.2** (four rules — state uptime before quoting any movement; attribute loop-stopped dwell separately and never net it off; never score a prior change across an interval with material downtime without saying so; if uptime is unknown say UNKNOWN, not zero) and **`IMP-031` AC-031.6–AC-031.10**, folded into the SAME slice as the decided/parked partition because they are one job: make the fold's denominator mean what it says. **`EXP-OAG-005`** opened against gross-lead-time INTEGRITY, with the anti-gaming trap named up front — this rule could be used to EXCUSE a real regression as downtime, so AC-031.7 pins that the split CONSERVES total dwell (attribution moves, total does not). Deliberately symmetric: it forbids claiming a win as much as reporting a regression. **SCORED — `EXP-127` KILLED at 2/2, its declared horizon, and the hypothesis PROMOTED rather than discarded.** It could never move its metric because **nothing enforces a resource class** — the `EXP-143` shape from v144 (*unscoreable BY CONSTRUCTION because nothing refuses*) reaching its horizon. But it was **CONFIRMED this cycle, not merely un-refuted**: I dispatched FOUR agents in one turn with no class declared and nothing refused, and splitting the deaths by the row's own exclusion rule (*watchdog stalls, NOT API errors*) gives 4 machine-sleep (out of scope), 3 stopped by me (not deaths), and **2 `no progress for 600s (stream watchdog did not recover)` — the measured class — at four-way concurrency** on a machine also carrying four foreign ROC containers. Applying v145's own `EXP-140` ruling to myself (*a stated fix with strikes is a backlog item that was invisible to the backlog*): promoted to **`OI-OAG-RESOURCE-CLASS-CAPS-ARE-PROSE-AND-NOTHING-REFUSES-A-DISPATCH`** (18/3), whose enforcement point is the limb that was missing — an undeclared class must **fail closed**, as `make dispatch-check ISOLATION=worktree` already does for the lane question. Second independent witness on record: 13 leaked containers once drove load to 19.85 and made a two-file run take **301 s instead of 877 ms (340×)**. Archived with outcome. **`EXP-OAG-004` took a strike from ROC v148 in another project** — its pre-declared falsifier (*a fourth CI-divergence class*) fired as `DEF-ROC-086`, a TOOLING class; noted, not re-scored here. **FLOW-MANAGER WORK, off-constraint but justified as a real finding re-measured rather than re-opined:** `OI-OAG-SCHEDULE-STREAM-IDENTITY` RE-VALUED **14 → 30**. Its own numbers had moved and nobody had re-read them since 2026-08-01 — single-event schedule streams **609,986 → 747,381 (+22.5% in 20 d)**, orphan removals **37,261 → 46,639 (+25.2%)** — and the singleton property was re-derived as a MEASUREMENT from the committed prod census rather than quoted: schedule-facet events (700,742 + 46,639) equal schedule-facet-born streams (747,381) **EXACTLY, difference ZERO**, so the mean is **1.0000** and no schedule stream ever receives a second event. Mechanism is in the code's own words at `normaliser-core.ts:1010` — `scheduleInstanceKey` IS the content hash `oagFingerprint` — and it reaches BOTH sides of the bridge (`:1205`, `:1285`, `:1517`), so a content revision mints a new stream on the planning side AND a new `flight-{k}`. The trade-off is real and must be stated in any fix: content-hash keying is what makes an exact REDELIVERY idempotent, at the price of identity ACROSS revisions, and the planning facet is nothing but revisions. **A dependency edge onto `DEFECT-OAG-126` (value 42) was CONSIDERED AND DELIBERATELY NOT ADDED** — a hard dep would park the highest-value item in the register behind an UNPROVEN causal theory, and `blocked` is already the top-median park state; the hypothesis is recorded on both items as evidence, with the cheap discriminator named (take a flight whose schedule was revised and ask whether its planning facet and its operational stream share a key). **ALSO CORRECTED — TWO of my own claims from this cycle, both recorded on the items rather than quietly dropped:** (1) I reported the CI wedge as *the whole pool wedging, so it cannot be one file*, reasoning that a second worker would have kept printing — **wrong**: CI has 2 vCPU and vitest's non-watch default is `maxWorkers = max(cpus-1,1)` = **ONE worker**, so a single blocked file wedges everything with no partial output, and the file was then identified by a size-ranked **perfect prefix cut** over 422 specs; (2) I characterised *91.7% of streams have no genesis event* as a potential defect — **it is the schedule facet by design**, as `declared-population-units.ts` states verbatim (*"NOT the schedule facet"*), and `birthPhases` names the 747,381 explicitly; the real residue is **864 streams born MID-LIFECYCLE** (703 `born-TakenOff`), up from 632 at the 2026-08-04 census. **A FOURTH LOCAL/CI DIVERGENCE beyond v147's three, and it changes how a local green is read:** `ci.yml` sets `DYNAMODB_ENDPOINT` and stands up a real DynamoDB Local, and `vitest.config.ts` includes `tests/**/*.test.ts` excluding only `tests/integration/**` — so plain `vitest run` in CI runs `tests/adapter/**` **in the same pool as the unit tier**, while a local run with the endpoint unset has those 15 files fail closed in milliseconds. **`make test-app` alone is therefore not the CI suite.** SUBORDINATE: `ready` is 5 against `wip_limit` 4 and BLOCKING, and for an **open-item** `scheduled` IS the in-flight state mapping to the `ready` queue — so this was never five idle items waiting; all five were active and the only drain is a `closed`. `intake` 131 against cap 10 stays ADVISORY (Little's Law governs WIP, not backlog depth), and the §5b.1 hand-partition reproduced v146's number EXACTLY: **131 intake, 86 decided-and-parked with a future date, 45 ACTIONABLE**, with 3 due-dates expired (`DEFECT-OAG-083`/`085`/`086`). NOT elevated: `N` unchanged, no model-tier move. TOKENS: the dominant cost this cycle was four concurrent dispatches lost to a machine sleep — roughly 0.5M subagent tokens across agents that produced no appended event — which is the same finding as the promoted resource-class item rather than a separate one, and the highest-leverage reduction is therefore fail-closed class declaration, not narrower reads. Principle-failure: `2026-08-24-a-constraint-movement-quoted-without-loop-uptime.md`. Verified before close: `make process-lint` clean, `make doc-lint` clean, `make wi-validate` clean. -->
<!-- v148 (retro, ROC 2026-08-24; fired MECHANICALLY on incident debt — `loop-gate` reported RETRO DUE [incident] for five items resolved since 2026-08-21T14:55:55Z and BLOCKED the pull. Fold-forward ran FIRST per the STEP-0 precondition and pulled main from v146 to v147, which turned out to matter: v147 had registered EXP-OAG-004 with a falsifier this cycle then fired.) FOCUS QUESTION, default: *"what was the largest contributor to gross lead time, and what strategies can reduce it while protecting DORA?"* ANSWER — **the largest contributor this cycle was a wait the metrics could not see at all, and the metric that should have screamed reported health throughout.** ROC's ONLY environment went **three pushes with no deploy** and nothing said so, while deployment frequency read **6.57/active-day**. Mechanism: a CI test job failed; `deploy-test` declares `needs:` on it; so the deploy was **SKIPPED — not failed**, and a skipped job renders as a neutral dash contributing nothing to the run's conclusion. The run read "a test broke" when the consequence was "the environment is N commits stale". **ROOT-CAUSE WHY-CHAIN: (1) why was it invisible? nothing compares the deployed artifact to trunk. (2) why not? deployment frequency is a fold over ITEM EVENTS — an item entering `deploying` — i.e. an INTENTION an agent recorded, and a push that never deploys emits no event at all. (3) why is it an intention? because v82 made every metric `fold(events)` over items, which is right for WORK STATE and wrong for a DEPLOY: a deploy is a fact about the WORLD. (4) why did nobody notice? `/api/health` has served `buildSha` all along and nothing in the loop ever read it — the observation was available and unused.** So the one DORA metric whose subject is the outside world was computed from statements about our own intentions: this project's signature absence-vs-ignorance class (eleven registered instances) arriving in the measurement layer. FIXED with `loop-gate` check 15 + `.claude/tools/deploy-staleness.js` (9 tests) — asks the deployed host what it runs, reports commits-behind, the deployed commit's age, and whether any of those commits touches a deploy-TRIGGER path (the actionable subset; raw commits-behind would cry stale over a README); three outcomes never two, and ADVISORY by design because refusing to pull cannot un-stale an environment. Registered EXP-ROC-003 against **deployment frequency**. SECOND FINDING, and it is EXP-OAG-004's own pre-declared falsifier firing three days later in a different project: that row said *"if it is a fourth class neither topology nor contention nor environment, the model was incomplete."* `DEF-ROC-086` is that fourth class and it is a **TOOLING** class — the local tier did not give a different answer, it **ran no such check at all** (`npm test` is vitest, vitest transforms with esbuild, esbuild strips types WITHOUT checking them, so a committed `tsc` error was green locally for ever). §17b gains divergence 4 and its rules; the model is EXTENDED not killed, and `IMP-032`'s CI-faithful checkout would NOT have caught it, so a green there must not be read as covering this. THIRD: §17ab, **an item's recorded MECHANISM is a hypothesis** — four instances in five days where a confident recorded claim was false or had rotted (`DEF-ROC-008`, `UC-ROC-023` at 27.3d, and then `DEF-ROC-053`/`DEF-ROC-081` whose mechanisms were disproved by one grep each, both already pulled for BUILD with their prescribed fixes ready). Probes (EXP-143) re-check a PARK; nothing re-checks a DIAGNOSIS, and a wrong diagnosis is the dearer error — it ships a plausible fix that changes nothing and closes the item over the live defect. Aggravating detail kept in the principle-failure: the orchestrator appended a `confirmed` event asserting a mechanism it had taken from the item's own prose, so the process manufactured a MORE confident record of an unchecked claim, under the role whose job is verification. CONSTRAINT: `external` 40.41%→**35.67%** and `blocked` 39.11%→**33.76%** — the first sustained move in this constraint, causally attributable to EXP-143's probes (two false parks cleared on their first run, one of them blocked 27.3 days), which is **ADOPTED** this retro. Lead-time median 1,002s all-time / 2,525s trailing-30d; CFR 8.0%; MTTR median 22,857s. Section F is the standing indictment: agent work-effort is **0.2% of gross lead time** — 99.8% is wait. TOKENS: 100% delivery / 0% plumbing at 17.3% coverage, too sparse to act on; this cycle's spend went overwhelmingly to READING SOURCE to disprove two recorded mechanisms, which was worth it (it prevented two wrong builds) and is the cheapest possible form of that work — one grep of the named file — now encoded as §17ab. A rule the retro METHOD itself got wrong, corrected in `.claude/commands/retro.md`: it said "HARD CAP of 8 active rows" with no scope, so this retro read the GLOBAL count (11), concluded the cap was unmeetable, and began drafting a structural repair for a rule v143 had already repaired. ROC's per-project count was 3. Reconcile latency: fold-forward v146→v147 at open, fold-back run at close. -->
<!-- v147 (retro, OagEventSource 2026-08-21; OWNER FOCUS QUESTION, verbatim: *"why are we finding test failures on a cicd pipeline and not locally"*). ANSWER — **because the local run and the CI run differ in THREE MEASURED ways, nothing measures the divergence, and the damage is not the lost round-trip: it is that the CHEAP signal has become the one we distrust.** (1) TOPOLOGY, permanent and structural: CI checks out the PROJECT REPO ALONE while a dev worktree has it NESTED INSIDE THE PARENT, so anything reading above the project root is green locally and CANNOT work in CI — measured when a spec read `.claude/skills/work-items/scripts/work-items.py` at module scope, went green locally, and in CI the file failed to COLLECT (`1 failed | 403 passed`); a sweep of all 522 specs then found EXACTLY ONE such reach, the one CI had caught. That follows from v50 meeting the worktree model and will not go away. (2) CONCURRENCY, and it cuts BOTH ways: local is up to five agents on 14 cores each with its own DDB container, CI is a dedicated 2-core runner — so `AC-AV.11` (which asserts a forced race DID interleave) fails locally under contention and passes in isolation, hit by FIVE dispatches in one day, while THREE dispatches independently reported that whole-suite reds are UNTRUSTWORTHY ON FIRST READ because source-scanning gates read files another agent was mid-write on. **That is the damaging half — agents have learned to discount a local red, which is exactly the reflex that lets a real regression through, and the trusted signal is the slow expensive one: a wedged gate held two items non-terminal for over two hours today.** (3) ENVIRONMENT: 45s locally, 98s at `--maxWorkers=2` (a hosted runner's core count), against TWO consecutive CI runs that stalled dead after the same spec with 18 and 86 MINUTES OF TOTAL SILENCE — ~2x is not 50x, so it is not the suite outgrowing the runner. THE FIX COMPOSES TWO MECHANISMS THIS REPO ALREADY HAS AND NEITHER WAS POINTED AT THE SUITE: `bundle-at-sha.sh` already builds in a DISPOSABLE WORKTREE AT A COMMITTED SHA (killing shared-tree contention, and its own header documents why that is not the DEFECT-OAG-072 nested-clone shape), and `check-probes-standalone` already builds a REAL LIFTED-OUT TREE (which IS the CI topology). §17b states the verdict-environment rules; `IMP-032` builds the composition. A CORRECTION I OWE ON THIS QUESTION: I diagnosed the CI stall as a wedge, RETRACTED it after reading a log that showed the suite completing files normally "right up to the cancel", then re-established it as a genuine hang. The retraction was wrong for a precise reason worth keeping — **I read log lines that were ADJACENT IN THE FILE and inferred they were ADJACENT IN TIME**, with the timestamps sitting in the same lines: the last test output and the cancel were 18 and 86 minutes apart. And the property that made it possible is that GitHub returns BlobNotFound for an in-progress job's logs, so THE ONLY WAY TO OBSERVE A RUN IS TO END IT — which forces an operator to choose between evidence and the run, and I chose destructively twice. CONSTRAINT: `queue` unchanged at 64.74% but its count-independent median FELL 246,033s -> 161,635s -> 119,684s across the day (-51%) while n rose 194 -> 218, and `open` fell 707,864s -> 491,430s (-31%). More items, much less wait each — the first sustained move in this constraint. `reported` remains second at 11.25% / median 24.1h and is orchestrator-owned (EXP-OAG-003, scored next retro). Reconcile latency 5 commits / 2.71h, drained at close. -->
<!-- v146 (retro, OagEventSource 2026-08-21; fired MECHANICALLY on incident debt — `retro-debt` reported RETRO DUE [incident] for `DEFECT-OAG-138` resolved 13:41:59Z and BLOCKED the pull, 5.8h after v145's mark). HEADLINE — **for weeks the retro has named a constraint it could not move, because two thirds of that constraint's denominator was already DECIDED.** `queue` was top GLT owner at 64.63%, dominated by `open` at 56.20% (median 7.05d, n=139, 0% backfill), and the prescribed remedy was always *deliver faster*. MEASURED this cycle over the 130 intake-state items: **85 (65.4%) carry a `defer_until` IN THE FUTURE** — decided, parked, waiting on a date and not on capacity; 3 are genuinely due; 42 carry no defer at all. Actionable intake was **45, not 130**. AND THE SYSTEM ALREADY KNEW: `defer_until` appears 9 times in `work-items.py` and EVERY ONE is inside a `loop-gate` limb — the gate blocks on *age without a decision* and an expired defer re-blocks by design (it fired this morning on five items and forced five real re-decisions). The metrics fold does not know the field exists. **Two mechanisms read the same frontmatter, one honours it and one is blind, and the blind one is the one that names the constraint the retro spends its budget on.** That is this project's signature defect class — a control that reads confidently while measuring something other than what it names — arriving in the measurement layer rather than the code. §5b.1 makes the partition a rule at IDENTIFY, with three anti-gaming guards written in (the parked share is REPORTED not netted off; expiry pressure already exists and stays; parked growth without matching throughput is itself the finding, and kills the change rather than tuning it). `IMP-031` builds it into the fold. SECOND CHANGE, routed to the narrowest owner rather than here: `reported` is 11.22% of GLT at a median **24.1h** across 84 items, zero backfill — second only to pure queue wait, and it is ORCHESTRATOR-owned, i.e. mine. It is not think-time; a defect sits there because nobody fired `triaged`. Routed to `.claude/agents/orchestrator.md` as triage-in-the-same-turn-you-register, with the honest exception preserved (no reproduction ⇒ `reported` IS the correct state, and triaging it would be the phantom-fix failure `/defect` exists to prevent). Demonstrated the same day: `DEFECT-OAG-138` went `reported → triaged → confirmed → fixed` in ONE turn because the finding dispatch had already reproduced it and landed the fix. CONSTRAINT MOVED IN THE RIGHT DIRECTION FOR THE FIRST TIME, on the count-independent measure that matters: `queue` median/item **246,033s → 161,635s (-34%)** and `open` **707,864s → 608,869s (-14%)** while n rose 194→211 — more items, less wait each. CFR 8.7%→8.6%, lead-time median 9,782s→9,361s, MTTR 78,347s→77,954s; deploy frequency flat at 7.67. Reconcile latency: 6 commits unmerged, oldest 4.14h, drained at close. -->
<!-- v145 (GAP-CLOSING retro, ROC 2026-08-20; fired MECHANICALLY on incident debt — `loop-gate` reported RETRO DUE [incident] for `DEF-ROC-076` resolved 13:18:49Z, 12 minutes after v144's mark at 13:06:05Z, and BLOCKED the pull. Fold-forward ran FIRST per the STEP-0 precondition: `main` was already an ancestor of `instance/ROC`, exit 0, so reconcile latency for this cycle is ZERO and no renumbering trap this time — v144 hit that trap and this is the first ROC retro since to run the check in the right order.) HEADLINE — **the system is per-project in its DATA and global in its REGISTRIES, and every place those two meet, one project silently invalidates another's record. Two instances were found within four hours of each other on 2026-08-20, and they are the same defect.** (1) `DEF-ROC-077`: `acceptance-audit` reads a GLOBAL declared-exception registry and scores it against a PER-PROJECT sweep, so five OagEventSource rows looked stale from ROC's tree and the tool printed **"delete the row"** — obeying its own remedy would have DESTROYED another project's legitimate declarations, and it BLOCKED ROC's `loop-gate` while doing so. (2) The **`EXP-142` collision**: `process/experiments.md` mints ids from one monotonic counter read per-instance from whatever a worktree happens to hold — a read-modify-write race with a stale read — and on 2026-08-18 two different experiments were both minted `EXP-142` (main's test-requirement-gate ratchet at v142, ROC's screen-viewport hypothesis the same day). v144 found it and correctly refused to relabel either half: neither instance has standing to rewrite the other's records. **v143 had already scoped the CAP per-project and left the ID SPACE global — the fix was applied to the budget and not to the namespace**, which is why the second half surfaced two versions later. FIXED STRUCTURALLY, not procedurally: experiment ids are now **`EXP-<PROJ>-<nnn>`** and the bare-numeric space is FROZEN, matching work items, which have been project-namespaced all along (`DEF-ROC-077`, `DEFECT-OAG-091`) — collision becomes impossible by construction rather than detected afterwards by a human reading two files. **SECOND FINDING, and it is the one that cost real delivery: `experiments.md` was carrying TWO GENRES in one id space** — capped falsifiable hypotheses, and long-form findings awaiting a decision. Six ROC-authored `##` sections had NO registry row, so the WIP cap never governed them and no retro ever scored them (that invisibility is exactly why "8 active, AT cap" was untrue for two consecutive retros). Worse than the accounting: `## EXP-140` had accreted to **TEN measured instances across SIX roles** — documenter on docs-only work, cicd on an infra-owned defect, tester on verification-only, engineer on an ORDINARY use-case, solution-architect on an architecture-only fix, and `ui-designer`, which appears on NO edge of the defect graph at all, unable to record that it reproduced a UI defect — with its replacement mechanism ALREADY STATED ("derive firing rights from the item's declared owner; let the graph constrain transition SHAPE only") and, because it was a section and not a row, no owner, no acceptance, no item, and nothing ever built. Ten strikes and a stated fix is not a finding any more; it is a backlog item that was invisible to the backlog. It is now `EXP-ROC-002` with a real row and item **`OI-ROC-006`**. NOTE THE ATTRIBUTION HARM specifically: an agent that spoofs `AGENT=` to escape a missing edge corrupts the `by_owner` table this retro uses to NAME the constraint. ROUTED: (a) **process §25a**, two new limbs (per-project ids + frozen numeric space; a finding is an item, never a section) — cross-agent, hence the bump; (b) **`.claude/tools/process-lint.js` + 9 self-tests + `make process-lint`, made a PREREQUISITE of `make doc-lint`** so the retro's own step-7 gate enforces it with no new prose: C1 the `# Current Process — vNN` heading matches the highest retro record, C2 every `## EXP-` section has a row and no id is defined twice, C3 the bare-numeric space is frozen, C4 per-project rows at or under cap-8 and no unattributed row. **PROOF-OF-FIRE, not asserted: first run against the real repo returned 16 violations, every one real** — a v142 heading on a v144 file (the same drift v138 found at 19 versions stale, so this is a RECURRENCE and the reason it is now mechanised), a duplicate `## EXP-140` section, six row-less sections and six frozen-space breaches; after the surgery it returns exactly one, the version heading, which this record clears. Non-vacuity is pinned by two tests (an in-section summary table must NOT satisfy the row requirement — that shape is live in the file and would have made C2 pass for free; and the parser must find the rows in the REAL `experiments.md`, not just fixtures). C4 discharges the enforcement v143 routed to "a committed tool" and nobody built; what it still does NOT do is score rows or block a row past its horizon at `0/N` — that needs the item event stream, belongs in `loop-gate`, and stays owed in §25a. REGISTRY, now honest and under cap for the first time in four retros: **OagEventSource 6/8, ROC 5/8**, zero unattributed (`EXP-142`'s routed cell named no project, which put it outside every cap). Retired with dispositions to `experiments-archive.md`: `EXP-137` ADOPTED (atomic pathspec commits, live in `CLAUDE.md` with its four known limits — a fix that should never have held an id), `EXP-138` and `EXP-141` DEFERRED to dated `open-items.md` entries (a missing `prod-deploying` blocked-exit edge, and "dep satisfied" being undefined — both off the constraint, and ROC has no prod environment to strand an item in), `EXP-136`/`139`/`140` PROMOTED into `EXP-ROC-002`, and ROC's colliding `## EXP-142` KEPT and renamed **`EXP-ROC-001`** with a real row (main's `EXP-142` untouched — the namespacing removes the standing problem rather than adjudicating it). SCORED: **EXP-143 STRIKE 1, and unscoreable BY CONSTRUCTION because the mechanism is NOT YET ENFORCED.** v144's limb 6 shipped saying `EVENT=blocked` "requires `PROBE=`" while nothing refuses; ROC caught that itself about four hours later, labelled it NOT YET ENFORCED and registered `OI-ROC-005` (`912c5dc`) — §17c.5 working exactly as written, but it means the row cannot have moved anything. CONSTRAINT — **UNCHANGED IN IDENTITY FOR FOUR RETROS AND GETTING WORSE PER ITEM, which is the number that matters:** by state `blocked` **41.10%** of GLT at a median **21.7 DAYS** per item across 10 items, **0.00% backfill** (so §17f permits naming it); by owner `external` **42.08%** at a median 20.1d, `queue` 28.15%, engineer 10.45%. The count-independent median has RISEN 19.3d → 21.7d since v144 while the share fell 46.3% → 41.1% — i.e. the share moved only because more work arrived, and the honest reading of the count-independent number is that parked items are parked LONGER than they were. EXPLOIT is therefore not a new rule: it is `OI-ROC-005`, and specifically its **AC-005.6 migration of the 12 items currently in `blocked`** — a probe binding only future parks leaves the whole measured 41% exactly where it is, and v144's own founding evidence was `DEF-ROC-004` sitting blocked for 28.8 days after both its blockers had already gone. It is the resumed loop's FIRST pull. SUBORDINATE: `intake` is 25 deep against a `wip_limit` of 10 — ADVISORY by design (Little's Law governs WIP, not backlog depth) and it is NOT satisfied; median in-queue age 2.3d. NOT elevated: `N` unchanged, no model-tier move, and no change routed away from the constraint except the two registry limbs, which are justified as INSTRUMENT integrity (the same basis as EXP-128) and as a cross-project DATA-DESTRUCTION safety fix. ALSO STANDING, and re-checked rather than assumed: `DEF-ROC-035` and `DEF-ROC-056` are parked `awaiting_observation` on `probe-dash0-wired` / `probe-appinsights-wired`, both NOT YET OBSERVED at 4.8h and 24.8h — and v144 established WHY: the deployed Function App has no telemetry sink of ANY kind, so neither probe can ever come back positive until somebody wires one. That is an UNBOUNDED wait dressed as a park, §12d.3's named failure, and it is recorded as such rather than left to re-report itself every cycle. TWO GATES ARE NOT ESTABLISHED FOR ROC and this retro did not fix either: the §17d test-requirement gate has no `.claude/config/test-requirement-gate/ROC.json` (so no test in this project is known to declare the acceptance criterion it validates), and `container-reap` was UNRUNNABLE because the Docker daemon is down (ROC's containers are declared but nothing could be checked — not the same as clean). Both are stated in the report, not silently dropped. TOKENS: this cycle's `stats.md` §E still shows plumbing **0.0%** on **19.2% coverage** of 936 events, so the plumbing/delivery split remains uncomputable — coverage, not the split, is the metric to fix, and the highest-leverage reduction found this cycle is `process-lint` itself, which replaces the hand-audit of a 1,526-line registry that every retro has been re-reading in full. Principle-failure: `2026-08-20-global-registry-per-project-reality.md`. Verified before close: `make process-lint` clean, `make doc-lint` clean, `node --test` 9/9 on the new tool. **AND THE SWEEP CAUGHT ME:** `make test-tools` named `process-lint.js` under AC-DEFECT-OAG-076.5 for `process.exit(main(...))`, which truncates stdout past the 64 KiB pipe buffer — fixed to `process.exitCode`, and the same sweep named a PRE-EXISTING offender, `stack-claim.js`, fixed with it. `make test-tools` now 182/190; the 8 remaining are `make-refs-tracked.test.js` cases bound to the absent `work/OagEventSource` corpus, RED in every project worktree — the same corpus-unavailable class the `1eafaa3` fast-follow fixed in `linear-project.test.py` ONE COMMIT EARLIER and did not sweep, so it is registered in `open-items.md` as the §17g sweep obligation rather than tolerated as noise. `make wi-validate` clean (I1–I4), `wi-project` regenerated (243 items / 164 done). -->
<!-- v144 (GAP-CLOSING retro, ROC 2026-08-20 — fired by `/defect` on DEF-ROC-073/074/075/076; scoped to ONE question, what let this defect through.) HEADLINE — **the process already had the right rule, already mechanised and enforced, and had applied it to only ONE of the two park states the machinery itself enumerates.** Human reported "we write events to a bus, something fails with no feedback, no tickets in Jira". DIAGNOSED END-TO-END AND REPRODUCED LIVE, and the headline finding is that **the pipeline was never broken** — it raises a real PPSM Alert in ~2s (`ROC-14`, `ROC-15`, both verified in Jira then closed via *Alert Self Resolved*). The events were DISCARDED IN SILENCE at the first hop: `bhx.cu-device-data-topic` has exactly ONE subscription, SQL-filtered `RocTestMarker = 'true'`, so a message lacking that application property matches nothing and Service Bus drops it — **with a SUCCESS ACK to the publisher and no dead-letter** (a non-match is not a filter *exception*, so `deadLetteringOnFilterEvaluationExceptions: true` is irrelevant). Proof: `IncomingMessages 3 / OutgoingMessages 2` in the 10:36Z bucket across three controlled sends of the SAME real captured payload — marker absent = gone with no record anywhere; marker present + node matching no site pattern = `not-handled`, no ticket; marker present + real node `UYD1C020` = ticket. The operator's own 08:58 and 10:20 sends carry the identical signature. THE LATENT CAUSE, with an artifact not an inference: `replay-injector` — the ONLY publisher that sets the marker (`mapRow.ts:117`) — is structurally unable to run because `ALLOWED_NAMESPACES` is **`[]`**, every entry commented out. So injection gets hand-rolled, and the hand-rolled sender exists on disk as the UNTRACKED `src/app/local/probe-real-bus-send.ts`, whose line 41 is `applicationProperties: { source: "roc-send-probe" }` — **no marker** — and which prints `SEND_RESULT=AUTHORIZED` / "Azure ACCEPTED the send" before telling the operator to watch `/api/decisions` for a record that never arrives. **A deny-by-default boundary left closed for a month did not prevent the unsafe action; it GUARANTEED it**, because the need did not go away — the operator still had to send, and routed around the tool, losing its safety properties with it. RULED OUT so nobody chases it: the probe also sends a flat PascalCase PPSM-CSV body rather than the MassTransit envelope; I suspected a second independent gate and a `DEF-ROC-003` regression and **tested it** — `normalise()` accepts both shapes (`ROC-15`), so the marker is the SOLE cause and the fix is correspondingly cheap. WHY NO GATE CAUGHT IT — and this is the transferable part: the tester could not have caught it, because the send path did not exist (IP firewall + no role), and the system CORRECTLY recorded that as external blockage in `DEF-ROC-004`. **Then nothing ever re-checked the blocker.** `DEF-ROC-004` sat `blocked` for **28.8 days after both of its blockers had already gone** — its `roc-test` subscription was created 2026-07-22, *the same day the defect was raised*, and the namespace IP firewall now allowlists our egress `88.97.177.220`. I falsified the blockage in about five minutes by TRYING. Meanwhile `external` is **46.3% of this project's gross lead time at a median 19.3 days/item** — the largest single cost — and its one detector is a human deciding to re-ask. **THE SHARPEST EVIDENCE, and it is why this is a limb and not advice:** the machinery already defines `_PARKED_STATES = {"blocked", "awaiting_observation"}` and already REFUSES `not_yet_observed` without `OBSERVE=make:<target>`, on the explicit stated grounds that *"a park whose reason is only a `note:` can never come back negative and therefore never ends"* (§17c Layer 2). That reasoning is not specific to observation. `blocked` was simply left exempt. Worse, §17c limb 3 ALREADY required that a rotting environmental premise be re-checked by "a registered item" — `DEF-ROC-004` **was** that item, and limb 3's remedy was PROSE, so Layer 2's own sentence (*"a remedy written as prose reproduces the defect it was written for"*) came true against the rule that wrote it. NEW LIMB **§17c.6**: `EVENT=blocked` requires `PROBE=make:<target>` printing `BLOCKER: standing` (advisory) or `BLOCKER: cleared` (`loop-gate` BLOCKS — an `unblocked` dispatch is actionable), anything else = BROKEN and blocks, copying §17c.2's proven treatment verbatim. Cross-agent (flow-manager + orchestrator + tester), hence the bump. **EXP-143** opened against **gross lead time**. REGISTRY INTEGRITY PROBLEM FOUND AND RECORDED RATHER THAN PERPETUATED: the table holds **8 OAG rows** and ROC's own **EXP-136..142 have NO table rows at all** — they exist only as `##` sections, so the "8 active, AT cap" reading is an artifact of ROC's rows being invisible to the registry it is supposed to be capped by. EXP-143 is given a real row; the per-instance allowance v141 flagged as owed is still owed and is now blocking honest accounting. ALSO UNBLOCKED THIS CYCLE (measured, not assumed): `DEF-ROC-004` → `fixing` after 28.8 days, which also unblocks `UC-ROC-023` live acceptance; and `DEF-ROC-035`'s parked premise SETTLED DIRECTLY — the deployed Function App has **no telemetry sink of ANY kind** (no App Insights, no OTEL, no Dash0 app setting), so it is not merely an unwired Dash0 export, and that is why all three silent-loss gates are invisible by construction.  **THIS RETRO HIT THE v141 TRAP IT WAS NOT LOOKING FOR, and the record must say so:** I authored this as **v142** against a base where ROC was v141 — and `main` was already **v143**, so the bump collided with a version that already existed. Caught at fold-back (which aborted with `main` untouched, as designed), fold-forward run, renumbered to **v144**. `EXP-143` was verified free against `main` (its high-water was EXP-142) BEFORE keeping it. **A SECOND, PRE-EXISTING COLLISION SURFACED and is deliberately NOT papered over:** `main` has authoritatively allocated **EXP-142** to a `test-requirement-gate` shrink-only-ratchet row, while ROC carries a local `## EXP-142` section ("a screen is evaluated as a SCREEN") that was never given a table row. Same id, two different experiments. ROC's EXP-140/141/142 sections were all minted against the stale high-water v141 recorded, so this is that same failure surfacing a second time — the renumbering is NOT done here because it rewrites other retros' records and this retro has no standing to relabel them silently; it is escalated as the next retro's first item, alongside the per-instance experiment allowance that is now owed twice over. Principle-failure: `2026-08-20-blocked-is-the-one-park-state-nothing-re-checks.md`. -->
<!-- v143 (retro, OagEventSource 2026-08-19; fired MECHANICALLY on incident debt — `loop-gate` reported RETRO DUE [incident (immediate)] on the `DEFECT-OAG-047` resolve and BLOCKED the pull.) **HEADLINE — FOUR INDEPENDENT CONTROLS WERE FOUND SILENTLY PASSING IN ONE SESSION, and the pattern is now a numbered rule (new §17i): a control that cannot report is not a control, and silence is never a pass.** (1) `worktree-guard` read as NOT ESTABLISHED — its `--json` payload crossed the 64 KiB pipe buffer and `process.exit()` does not wait for a pipe to drain, so the JSON ended mid-string at byte 65536; **nothing had regressed, the repo's history simply grew past the buffer**, which is how this class arrives late and in code nobody touched. That is the check standing between a finished agent's commits and `DEFECT-OAG-072`'s fate. Fixed with a CONTROL that watches the bug happen (the identical fixture through the pre-fix tail is cut to exactly 65536 bytes and `JSON.parse` throws) and a passing arm that FAILS rather than passing vacuously if the payload ever stops crossing the buffer. Guard then reported: 5 worktrees, **none holds unrecoverable work** — nothing was lost. (2) The **dev** smoke gate in `infra.yml` passes on EVERY run: dev is `authType: AWS_IAM`, the step's curl is unsigned, so it gets **403** with no version header, and **absent is treated as "advisory"**; the only `exit 1` needs the header PRESENT and MISMATCHED, which dev's auth makes unreachable. Its other branch prints *"Smoke gate SKIPPED (advisory on first deploy; fails on subsequent ones)"* — **that parenthetical is false, there is no `exit 1` on that path at all.** `UC-C4` was closed on this gate, so its closure is UNEVIDENCED rather than known-wrong. Registered `DEFECT-OAG-131` at ratio 20, the highest in intake, because `infra.yml` reaches prod ONLY if dev acceptance passes — **dev is the gate prod passes through.** (3) `ddb-local-down` had no `DISPATCH` handling: it tore down the DEFAULT container and **exited 0** while printing `lease released` for a container the caller never created, so **every dispatch that followed the documented teardown leaked its container** — the mechanism behind thirteen leaked containers driving load to 19.85 and a two-file run taking **301 s instead of 877 ms** (340x, four agents killed, reds that were green in isolation). **This was the PROCEDURE leaking, not agent carelessness** — every brief in this system says to tear down with that target. Fixed and proven differentially (`DEFECT-OAG-132`). (4) The acceptance parser scored an unreadable section as **0**, indistinguishable from an item with none authored — fixed with seven verdicts and wired into `loop-gate` as a blocking check, which **failed loudly on its first real run** and named all nine of `OI-NON-VACUITY-WITNESS-SWEEP`'s criteria (a level-1 heading, population **1 of 474** — measured before choosing, so the item was normalised rather than the parser widened). **TWO OF THE FOUR HAD THE LESSON ALREADY WRITTEN DOWN IN THIS REPO AND UNSWEPT**, which is why §17i mandates a mechanical sweep committed as a test: `test-requirement-gate.js` carried the comment *"NEVER `process.exit()` after writing to a pipe"* while FOUR sibling tools carried the bug, and the carrier census's own comment warned about a wrong field path three lines above a deeper instance of it. **A comment in one file is not a sweep (§17g).** **THE ARM SHIPPED AND THE OBSERVATION LANDED — `OagFlightDiverted` fired for the first time in this system's history**, 0 of 5,300,655 → two real emissions post-arm (arm 15:25:19Z; Sun Country SY8170 RSW→PBI diverted DJT at 15:39:13Z, Flexjet SRQ→MDW diverted TYQ at 15:48:18Z), each ONE event despite 8-10 later updates (idempotent-on-the-fact, live), 3-party routing key persisting through the real terminal `OagFlightLanded`, both consumer rules invoked with `failedEntryCount 0` and **all five prod DLQs at zero**. `UC-GSA2` + `DEFECT-OAG-047` **validated**; `DEFECT-OAG-046` `fixed` by an INDEPENDENT engineer, because the orchestrator performed the arming (three engineer dispatches died on 529s) and **deliberately refused to spoof an engineer event** — that verifier opened all six batch/replay lanes by name and confirmed none can mint historical diversions. **THE LIMITATION KEPT RATHER THAN GLOSSED:** `delta-054 §4`'s fail-closed airports fan-out ban is still in force, so the rules deliver unconditionally and never read `metadata.airports` — today proves the correct 3-party set REACHES both buses, NOT that the fan-out gate was ever the barrier. One of the ban's three grounds is discharged; registered for the architect rather than acted on. **CONSTRAINT: STABLE in rank and now interpretable — `queue` 63.97% of GLT, state `open` 54.92%, median 11.2 d/item, n=95, 0.00% backfill.** WHY-CHAIN (≥3): `open` dominates → because 101 items sit in intake against a ready cap of 4, so arrival outpaces SCHEDULING not building → because every dispatch runs a §17g sweep and each sweep registers findings (today alone: three defects and three open items) → **so the system's own quality discipline is the dominant source of intake arrivals** → and it is not self-limiting because registration costs seconds while scheduling is capped, so **finding capacity vastly exceeds fixing capacity BY CONSTRUCTION.** EXPLOIT: waste at the constraint is duplicate registration — **proven, I registered `OI-DISPATCH-CONCURRENCY-SATURATES-THE-MACHINE` when `OI-DISPATCH-HAS-NO-LOAD-PRECONDITION` had covered it for eight days**, and it surfaced only because a concurrent agent hit a WRITE RACE on the same subject; cancelled as a duplicate with every piece of new evidence folded into the original (a double count removed, not a finding closed — §F8a). SUBORDINATE: 35 items were deferred to September on the premise *"wip 7/8, one slot, claimed"* — **`DEFECT-OAG-127` proved that premise FALSE (WIP was idle/abandoned, not full)**, so 33 were re-staggered forward at ≤3/day. ELEVATE — and this is the finding that matters: the lever is more concurrency, but **load hit 18.93 with four dispatches and ZERO leaked containers**, versus 19.85 in the thirteen-container incident. **Saturation is now reachable by concurrency alone, so closing the leak does not lower the load, and the elevate lever is blocked by the HOST, not the model.** Two false test results were observed the same day (an adapter non-vacuity guard red under load, green 2/2 in isolation; four phantom timeouts from two concurrent suites). **The dangerous direction is the GREEN one, because nobody re-runs a pass** — so this is a measurement-VALIDITY problem, not a performance complaint, and `wip_limit` currently conflates shared-tree collision risk with machine saturation under one number. **REGISTRY: the three-retro breach RESOLVED STRUCTURALLY rather than excused a third time.** v141 excused it (ROC lacked standing over OAG's rows), v142 escalated it to the owner and the escalation was still open. The cap was measured GLOBALLY while scoring authority is PER-INSTANCE, so **no single actor had standing to satisfy it** — the mirror image of a gate that cannot fail. §25a's cap is now **per-project**, which makes it obeyable and therefore enforceable without loosening the number. **EXP-133 KILLED on its OWN stated negative criterion** — it said kill if a contention failure occurs with `ddb-local-mine` available, *"then the container was not the mechanism and EXP-127's load-average reading was right after all"*; that fired exactly. Mechanism KEPT as plain practice (per-agent containers address collisions, not saturation) with a symmetric teardown; archived with outcome. **AND THE RULE THAT HAS NEVER FIRED: eight of nine rows sat unscored at `0/3`**, so 3-strikes has never once killed anything — prose depending on a human performing a step fails exactly like a gate that cannot fail, so the enforcement is routed to a committed tool wired into `loop-gate`, as the acceptance audit was today. **`DEFECT-OAG-125` closed `not_reproduced` — and BOTH halves of the reported gap were the orchestrator's own measurement errors**, corrected in place: reading a `body.delta` filter as an event count under-reported a complete 11-event stream **13x** (a delta carries a field only when it changes, so the filter can only ever match genesis), and "daily rotation" was wrong — BBQ flies every 3-4 days. Push lane proved by **BIJECTION**: every REST statusKey maps to exactly one prod stream and back, zero unmatched either side. **`not_reproduced` is not `wontfix`** — there was no gap, rather than a gap declined. `DEFECT-OAG-133` registered from a sweep claim that was then MEASURED and corrected in both directions: the carrier census is CORRECT on its default subject (`CAT#flight`: 79 carrier-bearing events are exactly the 79 genesis events, a 1:1 match) but reports **100% `noCarrierNode` on `CAT#schedule` where coverage is 500/500** — the subject is a parameter and the reader is a constant. -->
<!-- v142 (OUTAGE-RESUME retro, OagEventSource 2026-08-18; fired MECHANICALLY on incident debt — `loop-gate` check 4 reported 5 incidents since the last mark and BLOCKED the pull. Fold-forward ran FIRST per EXP-113: 9 process versions merged, exit 0, no conflict — the v141 lesson obeyed.) **CONTEXT: a 3-day system outage killed the driving session, and the most useful finding is what the outage REVEALED rather than what it broke.** Nothing was corrupted; the per-item substrate did its job. What was lost was DISPATCHES — three fixes sat `validating` for 3.0/3.1/3.2 days with the work already DONE and only a dispatch missing. **TWO DOCUMENTED FACTS WERE FALSE ON RESUME, and both would have misdirected the whole session if believed:** `RESUME.md` opened with 🔴 TRUNK IS RED (`DEFECT-OAG-114`) — it was fixed on trunk at `dea4c089` five days earlier; and it warned the full observation gate takes **2h37m** — measured **69 seconds**. **A handover note is a claim with a timestamp, not a state**, and the correct move was to re-derive both from the tree rather than act on the prose (§17c Layer 2 applied to our own documentation). **HEADLINE — a ratchet that only a human can tighten is not a ratchet, it is a high-water mark that drifts (new §17d.5).** The test-requirement gate was RED at limb1 **1811 vs floor 1749** / limb2 **25 vs 15**, and MY FIRST TWO DIAGNOSES WERE BOTH WRONG: (1) *the fold-forward widened the gate's scope* — refuted, the pre-merge run reported the identical 1811/25; (2) *the 9 unpushed commits did it* — refuted by set-diff, a scratch `git archive` of the project repo at `origin/main` measures **exactly 1811/25**, so the unpushed work contributes **ZERO**. Established by exporting the tree at the ratchet commit's own project-repo HEAD (`6673abb0`) and re-running with `--repo-root`: it measures **exactly 1749/15**, i.e. **the hand-lowered floor was HONEST to the integer**. The whole delta arrived in two `DEFECT-OAG-110` commits landing **80 and 106 minutes LATER the same morning** (`9363b9aa` 11:50, `97732692` 12:16): +24/+24/+11/+5 limb-1 across four keyless-identity test files and **all +10 limb-2 in one of them**. Registered as `DEFECT-OAG-122` (value 25/cost 5), NOT fixed by relabelling — EXP-124 records mass-tagging as a FAILED experiment. **THE LIMB-2 TEN MATTER MORE THAN THE 64, and the reason is specific:** they are `delete neither['statusKey']`, `delete stripped['scheduleInstanceKey']`, `{...record, flightType:…}` on REAL captures — and `DEFECT-OAG-110` is *about records that arrive with no `scheduleInstanceKey`*. Its guard MANUFACTURES the very condition it claims to prove, which is §17d.2 exactly, committed inside the defect whose population it was written to characterise. The tester validating 110 was told this and validated against **live production data instead of that suite** — the right call, and it passed on 539 keyless streams / 10,288 events in dev and 539 / 10,293 in prod, verdict `ok`, 0 late-keyed movements, all 6 DLQs empty. **THE EXPIRED SOFTENING IS THE ROOT CAUSE, AND IT IS SELF-INFLICTED.** `OI-GATE-SOFTENINGS-WITH-EXPIRY` was opened at v128 under §17e.2 with owner engineer+product, **expiry 2026-08-17**, and acceptance defined as *limb 1 BLOCKING*. That date passed. Over its two-week life the count went 1795 → 1749 → **1811** — it ended **HIGHER than it started** while the floor recorded a win, and the item's own text forbids a reflexive extension (*'the honest report is the residual count with its owner — not a further extension'*). WHY-CHAIN (≥3): the floor drifted above the tree → because the ratchet only shrinks when somebody REMEMBERS to shrink it, and nobody re-baselines on a good day → so the floor's only observer is the next gate run → and the session that would have run it was killed by the outage, making a 90-minute window into a 3-day blind spot. **FIXED, NOT DESCRIBED (§17e's own standard):** the gate now AUTO-TIGHTENS — every PASSING run whose count is strictly below the floor rewrites the floor DOWN, mechanically, and says so; raising stays manual and reviewed; a FAILING run tightens nothing. **NON-VACUITY PROVEN IN BOTH DIRECTIONS BEFORE COMMITTING** (5 self-tests driving the REAL CLI via `child_process`, because stubbing the writer would be the exec-boundary fault this gate exists to catch): fires below-floor, silent at-floor, tightens nothing on red, never raises, suppressible, `--json` stays a pure read. `make test-tools` **170/170**. Registered EXP-142 against CFR, with its own kill condition named up front — **if agents start habitually passing `--no-auto-tighten` to dodge a config commit, that is §17e.2 softening by the back door and the row DIES.** **OWNER INSTRUCTION, and it becomes new §0d:** *'they need to understand how to use the work items, personas and all the documentation we have to continue the work that is here and continue the ways of working in order to not mess up what we are doing.'* THE GAP, stated precisely: each `work/<project>/` is deliberately its own repo so it can be lifted out and stand alone (v50) — but the METHOD lives in the PARENT repo, so a lifted-out project arrives as hundreds of work items and a persona catalogue **with no manual for either**, and its next maintainer's most likely first act is to hand-edit a `derived:` block. **The artefacts shipped; the ways of working did not.** Every project repo now carries a four-file handover pack owned by the documenter (`HANDOVER.md`, `docs/ways-of-working.md`, `docs/work-items-guide.md`, `docs/personas-and-jobs.md`), templated in `work/_TEMPLATE/`, which must NAME the tooling that is absent and state that a half-maintained event log is worse than an honestly abandoned one. **Deliberately routed as plain practice with NO registry row** — 'the documenter produces a handover pack' is a did-we-do-the-work measurement that cannot come back negative, which §25a/EXP-063 disqualifies. **CONSTRAINT: unchanged in RANK, uninterpretable in MAGNITUDE.** `queue` **64.02%** of GLT (v141 68%), state `open` **54.41%** with 0.00% backfill. But `open`'s count-independent median/item reads 5.9d (v138) → 6.9d (v140) → **10.7d** — and a 3-day outage sits inside the window, which very nearly accounts for the whole move. **So no dwell-metric row was scored this cycle, in either direction**, because scoring a movement off a contaminated measurement is the §17f failure committed inside the registry built to prevent it. EXP-131's MECHANISM is nonetheless confirmed firing and obeyed (the gate blocked on `aged-backlog-undecided`; 22 aged items got dated decisions; an EXPIRED defer then re-blocked immediately, which is the design working). **§F IS THE MOST IMPORTANT NUMBER IN THIS RETRO:** agent work-effort is **0.1% of gross lead time**. Duration coverage is only 5.5%, so grossing up ~18x still lands near **2.3%** — the conclusion survives the correction and must be stated with the bound: **this system is WAIT-dominated, not effort-dominated, by two orders of magnitude.** Optimising agent speed is close to worthless; only removing WAIT moves anything. **AND THE INSTRUMENT ITSELF IS BROKEN, which is why that number has a bound at all.** Measured across all 2,044 events: **7.7% carry `tokens`, 5.3% carry `duration_ms`**; `deployed` carries tokens on **1 of 196**. Cause is now understood and is STRUCTURAL, not laziness: `loop-run` step 4 requires the stage `wi-append` to carry `TOKENS=`/`DURATION_MS=`, but **the agent firing the event cannot see its own consumption** — only the dispatcher can, and only AFTER the event has been appended. All four dispatches this cycle independently reported exactly that, unprompted (real figures, from the dispatch layer: 146,500/747s; 158,017/660s; 125,333/590s; 107,056/503s). So §E's plumbing/delivery split and §F's cycle-time complement are both computed on ~1 event in 13, and v141 already flagged §E as structurally false at ROC for the same reason. **This is the same shape as §17h's counter that cannot go red: a metric whose broken state is indistinguishable from its healthy one.** NOT fixed in this retro and deliberately not prosed away — the fix belongs in the dispatch layer (the orchestrator appends the stage event, or a follow-up `amended` carries the figures), and it is registered rather than asserted. **REGISTRY: over cap at 12 of 8 for the SECOND CONSECUTIVE RETRO, and ESCALATED rather than re-excused.** v141 breached it because ROC lacked standing to judge OAG's rows; this retro is the exact mirror (I can judge EXP-128..135, not ROC's EXP-136/139/140), so repeating that reasoning would make the breach permanent by construction. Needs an OWNER decision — a per-instance allowance, or one named cross-instance scoring owner with standing over any row. **DELIVERED THIS CYCLE:** `DEFECT-OAG-110` **resolved** (validated against live prod across three real accounts, read-only); `DEFECT-OAG-118` **resolved** — and its tester met §17e's standard properly by driving the check RED four separate ways (an untagged spec, a bypass attempt via explicit CLI path, a scratch proof of the untouched runtime guard, and stripping a `@lane-surface` tag to watch the coverage gate go 2/8 red) then reverting byte-for-byte; `DEFECT-OAG-117` **REJECTED, correctly and valuably** — the source fix is sound (15/15 tests, byte-identical regeneration of the licensed asset) but the committed bundle mirror was never rebuilt and **dev is provably running pre-fix code** (`buildSha=6bb3f5e1` live in `/ecs/oag-ingest-consumer`, task started before the fix existed), so `AC-117.4` fails on the built bytes — the release-friction constraint (`OI-SRC-APP-WORK-IS-SERIALISED-TO-ONE`) materialising exactly as predicted. Also fixed: a tracked vitest cache in the parent repo (`7e4d4df`) that was the ENTIRE dirty state of the worktree and can silently DEFER both fold-forward and fold-back — a §17g sweep off it found 10 tracked-but-ignored `resource.enc` on an APPLY path, registered not fixed blind, plus one confirmed NON-finding recorded so nobody re-flags it. -->
<!-- v141 (retro, ROC 2026-08-14; fired by REQ-ROC-006 close + DEF-ROC-029 resolve). **FOCUS OVERRIDDEN BY STEP 1's OWN RULE: reconcile latency IS the constraint, so it IS the focus.** Measured, not estimated: oldest un-folded-back `instance/ROC` commit **2026-07-30 = 15 DAYS**; **19** commits owed to main; **67** commits owed from main; ROC working on **v118 while main was v140** — 22 versions stale. §0a Rule 4 ("reconcile continuously, never batch") was violated continuously and silently in BOTH directions. THE COMPOUNDING COST, which is the real finding: being behind is survivable, **authoring process changes while behind is not.** ROC minted experiment IDs from a stale high-water mark and allocated **EXP-119..124 — all six already OagEventSource's on main, adopted/retired at OAG v125.** VERIFIED before acting (main's archive read directly), then renumbered to **EXP-136..141**. We got lucky twice: main had NOT fixed the transition-allowlist problem and did NOT carry the atomic-pathspec rule, so ROC's work was genuinely novel rather than re-derived — luck, not a property of the design. WHY-CHAIN (>=3): fold-back never ran since 2026-07-30 -> it is specified only as the RETRO's close step and retro markers exist for v119/v120, so it was either DEFERRED (dirty integration tree) and never chased or skipped, and **either way silently** -> nobody noticed for 15 days because **reconcile latency's ONLY observer is step 1 of the retro itself**, and a metric readable only after the ceremony cannot alarm during the loop -> it compounded rather than staying flat because nothing forces fold-FORWARD on resume either, so both directions drifted and the ID space silently overlapped. **THIS IS A REPEAT**: OagEventSource hit the identical failure at main v96 and its recorded lesson was *"fold-forward FIRST on resume before bumping versions"* — prose, no gate, so ROC reproduced it exactly including the bump-against-stale-base. Principle-failure logged (recurring root cause, mandatory): `2026-08-14-reconcile-latency-15-days-and-colliding-experiment-ids.md`. **FOUR FINDINGS IN ONE DAY, ONE SHAPE — a stated invariant with nothing asserting it**: this reconcile lesson (prose, no gate); `uc006`'s "run on a FRESH stack" precondition (docstring, unenforced -> DEF-ROC-027); delta 002 §4's `node+device` partition key (asserted in FOUR artefacts, implemented in NONE -> DEF-ROC-026, verdict RETIRE the key because the code was right); `EventHubsLogConsumer` catching `ReceiverDisconnectedError` and never surfacing it (-> DEF-ROC-031, silent partition theft that reads as a flake). DORA THIS CYCLE: deploy freq **7.47/active-day** (30d 7.23); lead time median **716s** (30d 1237s), p85 5628s; CFR **9.0%**; MTTR median **7972s**. GLT DECOMPOSITION — the system is **WAIT-dominated, not effort-dominated**: `external` **46.65%** + `queue` **33.59%** = **80.2%**, against engineer 8.06%, tester 6.55%, cicd 4.69%, orchestrator 0.46%. TOC LOOP WALKED: IDENTIFY = `external` is the largest single share but is NOT actionable inside the system (four platform asks — a storage-table grant, Easy Auth, a BUILD_SHA wipe, and a Service Bus **Send** role without which NOTHING can feed the deployed pipeline at all); so the actionable constraint is the self-inflicted reconcile latency. EXPLOIT = remove the waste in the constraint: 0% failure at `building` and `deploying` means there is no rework to wring out there; the waste is **integration batching**, removed by folding forward+back THIS cycle (done: instance/ROC synced v118->v140, no conflicts). SUBORDINATE = the registry's **hard cap of 8 active is a GLOBAL budget allocated PER-INSTANCE**, so main arrived AT 8 and ROC cannot add rows without breaching it — and ROC has neither evidence nor standing to adopt-or-kill OagEventSource's rows to make room. **CAP DELIBERATELY AND VISIBLY BREACHED rather than resolved by killing rows I cannot fairly judge**, recorded in the registry banner; it needs a per-instance allowance or a named cross-instance scoring owner. ELEVATE = not reached. ALSO MEASURED AND BROKEN: the plumbing/delivery token split reports **plumbing 0.0%** of 15.7M tokens — structurally false (orchestrator and flow-manager work IS plumbing), caused by only **22.4% event token coverage**; a metric whose null result is indistinguishable from its healthy result, i.e. the same shape as §17h's counter that cannot go red. `policy.csv` has **no `wip` cap row at all**, so WIP limits are observed and not enforceable — noted, not fixed. FOUR STATE-DRIFT instances (work in flight the system believed had not started) and **SEVEN transition-allowlist blocks across FOUR roles in one day**, including the **orchestrator unable to fire `made_ready`** while permitted to fire `pulled` — it may take FROM Ready but not PUT INTO it. EXP-140 records the verdict that the MECHANISM is wrong (derive firing rights from the item's declared owner; let the graph constrain transition SHAPE only) and deliberately does NOT patch an eighth allowlist. DELIVERED: REQ-ROC-006 CLOSED (all 6 statuses classify end-to-end; 3 of 6 rest on ASSUMED wire text, labelled honestly in three user-visible places and NOT closed); DEF-ROC-029 RESOLVED — **ROC silently raised NO ticket for a genuine fault** whenever a hold expired and the device recovered before the sweep tick, reachable with in-order delivery, which is an independent second cause of the human's standing "ROC is not writing to Jira" alongside Ask F; DEF-ROC-022 RESOLVED after two weeks and six agents (broker dedup silently discarding republished rows while every send reported success); DEF-ROC-013/021/023/024/025 resolved; 10 Dependabot PRs drained with `make audit` now the ONLY gate in this project shown to fail correctly on two independent occasions. -->

<!-- v140 (GAP-CLOSING retro, OagEventSource 2026-08-13 — fired by /defect on DEFECT-OAG-107/110, NOT by the §F8 arm: `make parts-check` drained the incident debt from DEFECT-OAG-111 with the constraint provably STABLE (`queue` 63.0% / state `open` 51.25%), so full-retro overhead was correctly not paid and this retro is scoped to ONE question — what let this defect through. EXP-132 working as designed.) HEADLINE — **a PROBE's scope note became a permanent PRODUCT exclusion, and a counter pre-declared it healthy.** Unscheduled and GA flights had NEVER reached consumers: **29.8%/31.2% of SRQ's real traffic**, 7.2%/7.9% TPA, 5.1%/5.8% RSW, across 57 ICAO-only carriers **plus 21 IATA-holding ones** (AA, DL, UA, WN, BA, and freight FX/5X) — so not a charter niche but extra sections, ferry and freighter legs on majors. Nobody decided it; asked directly, the owner ruled in one sentence that they must come through. The SKIP was defensible (a record with no `scheduleInstanceKey` cannot form a stream — that key IS our stream identity); **the defect was what we CALLED it.** Four sites named the population a *"benign GA/Unscheduled degenerate sample"* sourced to *"probe §E — out of scope"*. *Benign* is a HEALTH VERDICT, so the counter counts up forever and NOTHING CAN GO RED — the instrument that would have found this was built, wired, and pre-declared as good news. WHY NO GATE CAUGHT IT: which population of the source we admit is a CONTRACT decision, the identical class as `AC-110.3` (stream identity) which this same defect correctly routes to the solution-architect and FORBIDS an engineer to author — **we had the rule for the KEY and never for the POPULATION**, though both decide what a consumer receives. The tester could not have caught it: validation exercises what ARRIVES; nothing compares what we admitted against what the source HOLDS. **THE SHARPEST EVIDENCE, and it is why the remedy is a GATE not a rule:** `DEFECT-OAG-055` went to THIS counter in THIS file and wrote *"a diversion recovery hiding inside a counter that reads '8 GA records skipped' is the silent-suppression family this project has been bitten by repeatedly"* — it NAMED the family, then split irregular-ops out of the benign count and STOPPED, leaving the verdict standing over the rest of the bucket. The label survived the one review that recognised it as dangerous. That is §17g's generalisation-sweep miss, and **§17g postdates 055** — a pre-§17g instance surfacing after the remedy existed, so telling agents to generalise harder is the remedy already proven insufficient. NEW RULE §17h, two limbs: (1) an exclusion of a population from the domain is a CONTRACT decision (solution-architect) and must carry a machine-checkable authority ref — **an exclusion with no authority is a FINDING, not a sample**; (2) a counter may not pre-judge its population healthy — `benign`/`degenerate`/`expected`/`out of scope` as a STANDING description is banned; state the population and its MEASURED SIZE and leave something able to go red. Mechanised in `test-requirement-gate`'s proven tag-or-justify + shrink-only ratchet shape. **NOT SHIPPED IN THIS RETRO, and registered instead of prosed** per §17f.7 — an engineer held `src/app` exclusively fixing a red trunk (`DEFECT-OAG-114`) and the bundle mirror builds from the SHARED working tree (`OI-SRC-APP-WORK-IS-SERIALISED-TO-ONE`), so a second writer would collide: `OI-EXCLUSION-WITHOUT-AUTHORITY-READS-AS-HEALTHY` (owners solution-architect + engineer, value 22/cost 3, 5 acceptance criteria incl. NON-VACUITY and an explicit *relabelling all 7 sites is FAILURE not success* clause against EXP-124 coverage theatre). Nine prose-only remedies would have been the record; this is deliberately not the ninth. **THE CORRECTION THAT MUST NOT BE LOST:** *one defect not two* is TRUE about ICAO-versus-keyless (`CodeType` governs what you may FILTER by, not what is VISIBLE; carrier identity is consulted NOWHERE on the excluding path; witnessed on 176 real records where KEYED⇒events and KEYLESS⇒none with both off-diagonal cells empty) and **FALSE about the two LANES**: on REST, OAG sends and WE drop (ours); on the EVENT HUB push lane — the PRIMARY lane and the only one with deployed compute — **OAG has never sent one** (57,206 prod genesis events, `generalAviation` TRUE on ZERO; the live alert config carries NO `unscheduledFlights` and NO `gaFlights` key, so both sit at OAG's default and the default EXCLUDES — the identical shape to `codeshare:false`). **A perfect identity fix delivers nothing on the primary lane until the flags are flipped, and the flags deliver nothing without it.** REGISTRY: **EXP-135** opened cap-neutral against **change failure rate**, with its honest risk stated up front — it MANUFACTURES `open` findings and `open` IS the constraint (51.25% of GLT, median **6.9 d/item**, n=81, 0.00% backfill, worsening from 50.46% at v138), pulling directly against EXP-131; that tension is checked FIRST at every scoring and the row is KILLED not re-tuned if it loses. **EXP-123 ADOPTED and archived** — its `loop-gate` mechanism BLOCKED this very pull with 4 violations and named the remedy for each, and all four were cleared by acting on the remedy rather than softening the gate; archived with the honest caveat that its GLT falsification condition was never met and is explicitly NOT adopted with the mechanism. Registry stays **8 active, AT cap**. DELIVERED THIS CYCLE: `DEFECT-OAG-107` **resolved** (fail-closed proven LIVE in both directions, and the tester reproduced the original blind spot before showing it closed) and `DEFECT-OAG-104` **resolved** (the tester REINTRODUCED the pre-fix defect, watched the committed pin go RED, and reverted byte-for-byte — a PASS made into evidence, §17e). Also fixed: `process_version` frontmatter read **138** while the heading read **v139** — the stale-heading failure v138 recorded as fixed, recurred INVERTED. Principle-failure: `2026-08-13-a-probes-scope-note-became-a-permanent-product-exclusion-labelled-benign.md`. -->
<!-- v138 (retro, OagEventSource 2026-08-10; fired MECHANICALLY on incident debt — 20 incident-class resolves since 2026-08-08 tripped `loop-gate` check 4, which BLOCKED the pull; fold-forward ran FIRST per EXP-113 and `main` was already an ancestor, so no reconcile was needed). CONSTRAINT HAS SHIFTED, and this is the first retro in several where it is not an artifact: state `open` is **50.46% of GLT** (32,759,555 s measured, median **508,685 s = 5.9 DAYS** per item, n=68) with **0.00% backfill** — i.e. fully MEASURED, not interpolation, so §17f permits naming it. Prior retros named `registered`/`queue` and correctly discounted it as a multi-session artifact; `queue` is still 65.66% by owner but carries 22.31% backfill, while `open` does not. `open` is the OI-* findings backlog: the system MANUFACTURES findings and retires none — exactly what EXP-131 was opened for, and it FIRED this cycle (5 items aged >7d with no decision) and was acted on correctly (UC-DP2..DP5 SCHEDULED after checking their dep UC-DP1 was already done — they were never blocked, only undecided — and OI-DATA-APPLY-HAS-NO-ENGINEER-EVENT given a dated `defer_until: 2026-08-24` with its reason, NOT closed). DORA: deploy freq 7.90/active-day (5.29 trailing-30d), lead time median 8,196 s / p85 237,072 s, CFR 8.4%, MTTR median 64,415 s. Worst stage remains cicd `deploying` at 6.3% (13/206). CENTREPIECE = **§17g, the fault dimension, which was wholly unowned**. Founding: an external review produced 7 findings; independent verification against live prod confirmed 6 and rated 2 of its recommended fixes HARMFUL (TRIM_HORIZON on the bus Pipe would re-broadcast ~60k events unattended to a live passenger departures board — 2.4x a replay that previously required owner sign-off, phasing, a journal and a tripwire; and re-pointing the diversion mapper would have silently broken the REST seed lane that legitimately depends on `body.diversion` after DEFECT-OAG-055). **5 of the 7 were fault-path defects** (partial write, resource replacement, marker-TTL expiry, poison record, wedged consumer) — every §17 contract to date governs the SUCCESS path, and the tester is adversarial only about input edges, so nobody ever injured the system and asserted the recovery. Two reproduced on demand once sought (DEFECT-OAG-080 3/3, incl. an OCC variant the reviewer MISSED that loses a projection inside one call with no error surfacing; DEFECT-OAG-082 against real DynamoDB Local) — cheap to find, simply never looked for. §17g therefore adds (1) fault-set acceptance owned by solution-architect, fail-closed as `needs-acceptance`, with a 5-item floor drawn from the founding class, and (2) a MANDATORY generalisation-sweep LEDGER owned by engineer when a fault-class defect is fixed — founding failure DEFECT-OAG-069, which fixed this exact shape in the feed-projector lane, recorded NO sweep event, and left the identical shape in `normaliser-core` for an outsider to find as DEFECT-OAG-080. **Deliberately routed UPSTREAM, not as a pre-tester red-team gate**: §F5a forbids a compensating promotion gate and EXP-123 records that misdiagnosis being made TWICE, so the adversary's output is ACCEPTANCE CASES, not a verdict. 7 items registered from the review (DEFECT-OAG-080..085 + OI-OAG-PUSH-EVENTPOSITION-NOT-REDERIVED); findings 1 and 2 correctly got NO item (a documented architect hold, and an existing OI). `OI-OAG-SCHEDULE-STREAM-IDENTITY` gained `deps: [DEFECT-OAG-080]` because fixing the schedule key UNMASKS 080 for ~1600 observations/day with no arming gate and no detector — a safety ordering edge, not a preference. TWO OWN-PROCESS FAILURES RECORDED, both mine: (a) 7 verification agents dispatched CONCURRENTLY and ALL 7 were killed by the stall watchdog — a live re-confirmation of EXP-127/§F2b (resource-class scheduling), which I did not apply; resuming in batches of 3 worked and every agent's banked work survived; (b) I admitted 4 items to `ready` when the cap allowed 2, taking ready 2→6 against `wip_limit` 4 — corrected by finishing, not by un-admitting. REGISTRY WAS OVER ITS OWN HARD CAP: 10 active against cap-8, i.e. the cap is not enforced anywhere — retired EXP-113 (freshness precondition; now mechanised as loop-run STEP 0 + `make project-update`, exercised clean this cycle), EXP-126 (declared-unit gate; visibly in force — today's `stats.md` carries the backfill-share column and the "do not name a constraint from a high-backfill state" instruction that this retro OBEYED) and EXP-130 (verified-blocker shelf life; obeyed this cycle — I re-checked the Dash0 notification channel myself and found the runbook's "placeholder" claim STALE, and re-checked the prod table names rather than trusting the Makefile default), all three ADOPTED and archived with outcomes: 10→7, then EXP-134 opened → 8, AT cap. Also fixed: the `# Current Process — v118` heading had been stale for 19 versions while the frontmatter read 137. Next constraint to watch: `open` — if §17g and EXP-131 do not move it, the finding-manufacture rate is the lever, not the decision latency. -->
<!-- v137 (OWNER-RAISED retro, OagEventSource 2026-08-07). FOCUS QUESTION, owner's words: *"we should consider using dynamodb container per engineer"*. ANSWER: yes — but the exposure is NOT the one the question implies, and finding that out changed the fix. **Test DATA was already safe.** The adapter suite namespaces its tables per run (`OagFeed-EventStore-PortContract-<runid>-N`; MEASURED 27 tables across 3 run ids on the live container), so two concurrent engineers could never corrupt each other's rows. **THE CONTAINER ITSELF was the exposure, in two ways.** (1) `container_name` was HARDCODED in docker-compose.yml, so `OAG_DDB_PORT` moved the port while the name stayed fixed — a container per engineer was therefore IMPOSSIBLE, and a second `docker compose up -d` RECREATES the one container on the new port, yanking the endpoint out from under an in-flight suite whose tests then fail with a connection error **indistinguishable from a code failure**. That is the worst kind of phantom: it points an engineer at its own correct code. (2) `ddb-local-assert-ours` could only ask *is this container OAG's* — never *is it MINE* — so it green-lit engineer B onto engineer A's database. Corroborating context: two engineers were building concurrently and BOTH had independently discovered they must hand-override `OAG_DDB_PORT=8010`, because a sibling project holds 8000. A workaround two agents find separately is a missing mechanism. FIX (§F2c, new): container identity is DERIVED, never hardcoded — `OAG_DDB_NAME` (defaulting to the LEGACY name so every existing invocation is byte-identical), a per-name compose project so two stacks are separate objects to compose, `assert-ours` comparing the publisher against `$(OAG_DDB_NAME)`, and `make ddb-local-mine DISPATCH=<id>` deriving BOTH port and name from one dispatch id. Derived rather than hand-picked for exactly the reason a threshold is: a hand-picked port looks fine and collides silently. VERIFIED AT LANDING, not asserted: `ddb-local-mine DISPATCH=retro-probe` brought up its own container on derived port 8603 ALONGSIDE the live shared container on 8010 and a sibling project's on 8000 — three coexisting — without disturbing two engineers mid-suite; NON-VACUITY proven in both directions, and the failing case is precisely the one the OLD guard PASSED. CONSTRAINT: UNCHANGED for a fourth retro — `queue` 59.82% / `open` 42.36% (median 329,907s = 3.8d/item, n=57, 0% backfill). This change is NOT aimed at it and is justified under §5b as a **defect-preventing safety fix that is also an exploit move**: a phantom failure reading as a code failure generates a re-dispatch and can generate a FALSE finding, and false findings inflate the very `open` backlog that IS the constraint. EXP-131's aged-inventory gate is one retro old and has not yet had time to move `open`; `open`'s n rose 54 → 57 purely because this session registered three real new findings. Registered as EXP-133, cap-neutral (EXP-125 ADOPTED and archived — a red gate is a defect, fired three times this session unprompted and uncited: DEFECT-OAG-072's false red registered rather than softened, the FIDS timeout BOUNDED rather than its timeout raised, and the component-map alias gap registered). EXP-127 scored 1/2 POSITIVE with an honest correction: a watchdog stall occurred at load 7.57 against that row's own 14.68-during-failures baseline, so load average was never the mechanism — the CONTAINER was, which is what EXP-133 now tests. -->

<!-- v136 (OWNER RULING, OagEventSource 2026-08-07, minutes after v135). HEADLINE — **two standing rules genuinely contradicted, and the contradiction was costing the whole session.** §F8 says an INCIDENT (defect resolve) is NEVER batched, so it trips a full retro immediately. `/loop-run` step 5a says a STABLE constraint should not pay full-retro overhead. MEASURED COLLISION: the v135 retro closed at **13:17:51Z**; DEFECT-OAG-060's resolve re-armed the gate at **13:23:43Z** — **six minutes later, on an unchanged constraint**. With a backlog of ~15 defects the owner had just asked to clear, that rule pair spends the session running retros that re-derive the same answer. Escalated to the owner rather than resolved silently, because the alternative was to soften a gate on my own authority — the §17e / EXP-125 failure this project has already recorded (*"a gate that cries wolf needs to be FIXED"*, and a control softened once becomes a rhetorical device). OWNER RULING 2026-08-07: run the cheap parts-check per resolve and escalate to a FULL retro only when the constraint SHIFTS. **THE FIX IS MACHINERY, NOT PERMISSION (§F8b, new): `make parts-check PROJECT=<p>`.** It reads the constraint from the DERIVED `views/stats.json`, compares it to the constraint recorded at the last close, and drains the INCIDENT arm of retro debt **only when it is provably unchanged**. Everything else ESCALATES, exit 2: constraint SHIFTED (names the move, and does NOT touch the marker — an escalation may never drain debt); constraint UNREADABLE (*an instrument that cannot be read is not evidence of stability*); NO PRIOR RECORD (stability cannot be established from nothing); ROUTINE debt at threshold (parts-check drains the incident arm only — a slice-close backlog is a different signal and keeps its batched full retro). **WHY THIS IS NOT A SOFTENING, and the distinction is the whole point:** the cheap path is gated on a machine-checked fact, and THE MACHINERY DECIDES, NOT THE ORCHESTRATOR — so the expensive path stays mandatory in precisely the case a retro exists for, namely that where time goes has changed. `retro-mark` now also records the constraint, so the two paths cannot drift. The constraint reader inherits §17f.6/EXP-128: **an owner or state whose backfill share exceeds 50% is never named the constraint**, or parts-check could "confirm" a phantom. 221 unit tests green (+6 new, 5 of which assert REFUSAL rather than success); NON-VACUITY PROVEN by disabling the stability control — the shifted-constraint test fails with a witness. Registered as EXP-132, cap-neutral (EXP-121 ADOPTED and archived — its `inScope`-required-by-type mechanism is compile-time enforced and its pattern was independently re-derived this session by REQ-OAG-DELIVERY-INTEGRITY's J31, the two-live-writer lane). Verified live: escalated correctly with no prior record, then drained DEFECT-OAG-060 once the marker carried v135's own measured constraint. -->

<!-- v135 (INCIDENT retro, OagEventSource 2026-08-07 — DEFECT-OAG-070's resolve; §F8 never batches an incident and the gate named the retro, which is the mechanism working). HEADLINE — **the constraint has not moved for THREE consecutive retros, and the reason is that the system generates findings and retires nothing.** Measured now: state `open` is **42.18% of measured GLT** (median **326,331s = 3.8d/item**, n=54, **backfill 0.00%** — clean), against 42.09% at v134 and 39.73% at v132. By owner, `queue` is **59.69%** (median 240,945s = 2.8d, n=115). Intake holds **65 items, median age 2.2d, oldest 8.0d**, while defect arrivals are **36 in trailing-30d against 38 all-time** — i.e. essentially ALL discovery is recent, and the discovery rate structurally exceeds the retirement rate. WHY-CHAIN: (1) `open` dominates because 54 findings dwell a median 3.8d unpulled; (2) they dwell because every gate, census, probe and agent-read MANUFACTURES an OI row, while the loop pulls only from `ready` and nothing ever promotes or retires an OI; (3) there is no forcing function because the loop-gate's intake check is deliberately ADVISORY (v126, correctly — blocking on DEPTH inverts the constraint), but the advisory has NO CONSUMER: it prints depth and age every cycle and nothing is obliged to answer it; (4) retiring a finding needs an explicit decline/defer decision and there was no cheap mechanised path for one, so every OI is implicitly "someone will do this" and the queue only grows. ROOT CAUSE: **a rich finding-GENERATION mechanism with no finding-RETIREMENT mechanism.** This is the THIRD recurrence of EXP-123's founding pattern — *documented obligations are skipped, mechanised ones are honoured* — so it opens a principle-failure as a chronic constraint the system has failed to smooth, per retro step 1a. THE FIX (§F8a.1, new): `make loop-gate` gains a BLOCKING check on **age-without-a-decision** — a BACKLOG item older than `--max-backlog-age-days` (default 7) with no in-date `defer_until:` blocks the pull. **This deliberately REFINES the standing §F8a rule** *"a gate blocks only on harm that stopping relieves; stale inventory does not become safer by halting the loop"* — which remains true of DEPTH and of mere staleness, and is why check 3 stays advisory. The refinement: this gate is cleared by a DECISION, not by delivery. Writing `defer_until: 2026-09-01` costs one line and seconds, so the loop is never held hostage to throughput; what is blocked is only the act of pulling MORE work while undated inventory ages invisibly. THE ASYMMETRY IS LOAD-BEARING AND DELIBERATE: the cheapest path to green is a dated defer, NEVER a close — a gate whose cheapest remedy were "close it" would manufacture pressure to close real findings, which §F8a bans outright, so the remedy text says so explicitly. A defer EXPIRES and re-blocks (the EXP-130 stale-blocker lesson applied to inventory); an UNPARSEABLE date fails CLOSED and does not count as a decision, so a typo can never silence the gate. Verified on the real project: it names **4 items of 65** (OI-CHUNKS-STALE-REF 8.0d, OI-CFG-ENDPOINT-DERIVE 7.9d, OI-FIDS-INTEGRATION-TIMEOUT 7.8d, OI-E2E-TYPECHECK-GAP 7.1d) — the aged tail, not the backlog. 215 unit tests green (+6 new), and NON-VACUITY PROVEN by disabling the control: 3 of the 6 fail with one witness each. Registered as EXP-131, cap-neutral (EXP-113 ADOPTED and archived — 3rd POSITIVE, already integrated as loop-run STEP 0, and it scored POSITIVE again this session: `make project-update` exit 0 and the loop began on the current process). ToC: this is the EXPLOIT move (remove waste at the constraint — undated inventory corrupts both the age median and the depth signal). SUBORDINATE is named but NOT built (an OI should carry a schedule-or-defer AT CREATION, capping the generator); ELEVATE (raise N) is explicitly NOT taken while exploit and subordinate are untried. -->

<!-- v133 (OWNER-DIRECTED retro, OagEventSource 2026-08-07). HEADLINE - **the orchestrator was specifying designs for code it had not read, and was overturned FIVE TIMES OUT OF FIVE in one session.** The owner named it before I did: *"you are flip flopping on solutions which tells me that the problem has gotten too complex for you. we need to stop, analyse, break it down and calculate a response."* I checked it against the record and it is exact. THE FIVE: a feature-flag spec that would have made DEFECT-OAG-063 PERMANENTLY UNCLOSABLE (AC-063.4's prod limb was false-by-design under the flag's own default, caught by the architect); a `deliberatelyNotEmitted` exception-set refused by the engineer for a typed TOTAL projection whose completeness limb is the COMPILER - *"a set of exceptions is still opt-in"*; a `git rm --cached` diagnosis disproved by an index mtime (it was DEFECT-OAG-058's pathspec trap) AFTER the brief had caused a full re-investigation; registering our own unvalidated regression as a NEW defect, overruled with *"recording your own unvalidated regression as a new defect launders the rework"*; and calling a 4.84-day dwell modal when it was a 640x OUTLIER (read off a table that was 45pct interpolation). One reviewer catch is the system working; five is designing above your knowledge of the code. MECHANISM, and it is the whole of the fix: **a brief that names the solution IS an engineering decision** - the role boundary breached in the one place it is invisible, because the orchestrator is not reading the code and the agent is. The agent then either builds a wrong design or spends its budget overturning us; both are rework and both land on `queue`, the standing constraint. ROUTED to orchestrator.md as a new binding section - state the PROBLEM, the CONSTRAINT and the ACCEPTANCE and stop; label a hypothesis as one and make it the FIRST thing to falsify; name what you did NOT verify so it is not inherited as evidence; and when an agent overturns you, record it plainly and move on [EXP-129]. THE OWNER ALSO READ THE CODE, and the measurements (madge / ts-prune / tsc --showConfig - NOT grep, on their instruction) confirm the mechanism in ONE FUNCTION: tsconfig is FULLY STRICT yet `foldAggregate` accumulates into `let merged: Record<string, unknown>` and ends `} as unknown as FlightAggregate` - a DOUBLE assertion defeating the compiler at exactly the domain core, so **the type is a claim about the OUTPUT, not a constraint on the CONSTRUCTION.** Three monotone facts (cancellationEmitted/cancelled/withdrawn) live OUTSIDE `merged` as hand-maintained accumulators because deepMerge is not monotone. **Every fact the type cannot express becomes an accumulator plus a test plus a config entry plus a gate** - `withdrawn` was the third and adding it cost DEFECT-OAG-063 + DEFECT-OAG-067 + three tester rejections + a CONFIG FILE that now tracks which fields the fold derives. The code's own docstring records the identical cost earlier (`scheduledTimeUtc` written into the untyped Record, never declared as watched, so nothing diffed it and a post-genesis re-time was silently dropped - DEFECT-OAG-042's still-open half). MEASURED: 210 modules / 43 ORPHANS / 2 cycles both `adapters -> service` / only 15 dead exports (so the sprawl is LIVE code) / src 40,316 lines against tests 62,867 across 276 files / the core fold path alone 17,714 against the owner's ~5k estimate. Registered REQ-OAG-COHESION (value 34) and **FROZE new defect work**, one exception: DEFECT-OAG-063, in flight and fixing a LIVE prod-path defect. The open defects PARTITION and that is the point - STRUCTURAL ones (063, 042's open half, the 062 units family, the stuck-predicate class) become ACCEPTANCE CRITERIA of the new structure rather than being fixed twice in code the refactor deletes; INDEPENDENT ones (065 telemetry label, 066 position residue, 058 pathspec) stand on their own merits. TWO OWNER CORRECTIONS I had got wrong and relayed mid-flight: `ports/` is not about file CONTENT (madge shows all 25 with zero deps) - **a ports FOLDER is itself the mistake**, because the interface an aggregate needs belongs WITH the aggregate and the adapter should depend INWARD to obtain it; and the adapter rule is positive and enforceable - **an adapter RECEIVES its collaborators as constructor arguments** and constructs only the resource it adapts, with the logger as the worked example BECAUSE WE WANT TO ASSERT IT LOGS CORRECTLY (a testability argument, and directly load-bearing: today's ECS log bridge dropped a signal field through a fixed field list). DELIVERED DESPITE ALL THAT: DEFECT-OAG-061 and DEFECT-OAG-062 both RESOLVED (OAG-225/OAG-226); UC-OB1 parked in `awaiting_observation` on a predicate that DISTINGUISHES CANNOT-TELL FROM NOT-YET (no session -> no sentinel, exit 3, gate reads BROKEN); and DEFECT-OAG-063's corrected predicate produced the session's best measurement - 755 -> base 651 is **-104 streams while the store GREW**, which is not definitional and not the fix but the population AGEING as missing arrivals finally land: **those 104 were LATE, NOT LOST - AC-061.3's thesis observed directly rather than argued from a curve.** delta-061 R3.2's entire cure measures 651-649 = **2 streams = 0.31pct of base**, and `removedBy.withdrawn = 0` because no OagFlightWithdrawn has ever been appended in prod. REGISTRY: EXP-124 ADOPTED (the ratchet moved the only way its own ruling allows - 1795 -> 1773 by work that NAMED its criteria, never by mass-tagging, and it is enforced by machinery not prose) to open the slot for EXP-129; 8 of cap 8. ENVIRONMENT: GitHub Actions starved runners all session (`steps=0`, `runner=""`) so nothing could deploy; NO deploy_failed fired, because booking an external outage to CFR is the wrong-subject error §17f exists to stop. I also killed two of my own agents by dispatching them into the same resource class concurrently - the exact §F2b violation I had described an hour earlier - and the one that committed incrementally kept all its work while the one that batched lost everything. CONSTRAINT UNCHANGED: `queue`, and the refactor is the first change aimed at WHY work arrives faster than it leaves. -->
<!-- v132 (INCIDENT retro, OagEventSource 2026-08-06 — DEFECT-OAG-061's resolve; §F8 never batches an incident, and the gate refused the pull and named the retro, which is the mechanism working). HEADLINE — **the constraint instrument was 44.98% interpolation presented as measurement, and three retros aimed the change budget where the interpolation pointed.** Not a rounding problem. 138 of 282 flow items are migration backfill: their event timestamps were synthesised by spreading a span evenly across their transitions, so every state segment came out identical TO THE SECOND. `UC-14` walks five consecutive segments of exactly **304,800.0s**; `UC-16` carries **byte-identical timestamps to UC-14**. Real work does not do that. And backfill is NOT evenly distributed — it lands only on the states migrated items walked — so pooling it inflated precisely the delivery stages while leaving the queue states untouched: `deploying` read **12.30%** against a measured **6.00%** (73.15% backfill), `building` **10.12%** against **2.03%** (88.96%), `ready` **10.54%** against **2.79%** (85.42%), `dev-validating` **13.96%** against **9.02%** (64.45%); `open`, `blocked`, `reported` and `fixing` are 0% backfill and were always clean. THE INVERSION: on measured data EVERY WORKING OWNER IS FAST — **cicd median 655s per item, engineer 2,053s, tester 3,723s** — and essentially all elapsed time is inventory standing still: **`queue` 57.80%, median 166,319s (1.9d) per item**, of which state `open` ALONE is **39.73% of all measured GLT** (51 never-pulled findings at a median age of 3.07d, oldest 7.1d). So the five-retro story that `queue` is the constraint (37.02 → 39.36 → 41.78 → 47.18 → 49.73 → **57.80** measured) was RIGHT ALL ALONG, and each retro then spent its budget mechanising a delivery stage the instrument had inflated. **THE ROOT CAUSE IS §17c.3 NEVER APPLIED TO THE RETRO'S OWN OUTPUT.** v128 diagnosed the share/count confound *exactly* — it wrote that the share metric "cannot distinguish 'work waits longer' from 'there is more work'" — and routed the fix as PROSE in a version comment with no owner, no item and no test: *"stats.md must report median per-item dwell in registered/ready alongside the share."* It never landed, and it was the very number that would have exposed the backfill. That is the **seventh** prose-only remedy on record. The **eighth** is the subordinate move for this same constraint — *decline-or-schedule aged intake* — routed by v130, re-routed by v131, both times recorded "still unstarted". A retro that writes its remedy into its own changelog and moves on has not routed anything. FIXED AS CODE IN THE SAME RETRO, which is now the rule (new §17f limbs 6–7): `_is_interpolated` flags an item when ≥3 non-zero state segments agree to within max(1s, 0.05%) and its dwell is EXCLUDED from every measured figure and reported in its own `backfill_s` column with the per-state share beside it; every `by_state`/`by_owner` row now carries `median_per_item_s` + `n_items` (v128's owed fix, implemented not re-routed); and the `loop-gate` BACKLOG advisory now reports median in-queue AGE and names the oldest item, so a depth nobody can act on becomes an age somebody can (it stays ADVISORY — blocking on backlog depth inverts the constraint, v126 was right). **4 new tests, 209 green.** §17f limb 6: a constraint may not be named from a figure without stating its interpolation share AND its count-independent per-item median. §17f limb 7: a retro that routes a change to a measurement, a gate or the flow machinery either ships the commit in that retro or registers it as an item with an owner and an acceptance condition. THE SUBORDINATE MOVE WAS EXECUTED, NOT ROUTED A THIRD TIME: the product agent was dispatched to give every aged intake item an explicit disposition — schedule / defer-with-a-date / decline / merge near-duplicates — briefed that success is a DECISION PER ITEM and never a smaller count, because closing real findings to shrink a number is the coverage-theatre EXP-124's founding ruling rejects. EXPLOIT: the constraint's dominant waste was that the constraint was INVISIBLE; that is now removed. ELEVATE: not taken — capacity is plainly not the problem at a 655s cicd median. A CORRECTION I OWE MY OWN EARLIER READING THIS CYCLE: I first read `deploying` as a flat distribution and called UC-OB1's 4.84-day dwell merely 5% of the state — that read was itself an artifact of the backfill I had not yet found. Against a measured cicd median of 655s, UC-OB1 is a **640× outlier**, and it sat in `deploying` for 4.84 days awaiting a deploy that was NEVER OWED: its ref `2d5a655` touches Makefile + docs + scripts and ZERO declared trigger paths, its own definition reads "NOT deployed infra", and its `built_green` note ended "NOT PUSHED" while the commit had been an ancestor of `origin/main` the whole time — the exact stale-prose failure §F8a warns of. Corrected by firing `deployed` from the empty-trigger-path derivation. The gate never flagged it because its stalled-validation check covers only validation states; filed as `OI-LOOP-GATE-BLIND-TO-A-DEPLOY-THAT-IS-NOT-OWED` and DEFERRED rather than built, because cicd is the SMALLEST measured contributor (6.06%) and this retro's budget belongs to the constraint — it joins `OI-DERIVED-PUSH-DEPLOY-STATUS` and `OI-PROD-DEPLOYING-NO-BLOCKED-EDGE`, all three one root shape (the gate reasons over item state and cannot see the world that state refers to) and probably one fix. DELIVERED: **DEFECT-OAG-061 resolved** — all seven AC pass, and the tester's METHOD is worth adopting: it refused to validate against a working tree dirty with another agent's in-flight work and instead built a disposable `git worktree` at exactly `919147a`, ran the full suite there (254 files / 2734 tests green) and cross-checked every source assertion against the committed blob via `git show <ref>:<path>` — two independent confirmations per claim. It also correctly attributed the one live-tree failure to DEFECT-OAG-063's uncommitted work rather than counting it against its own item, and handed it over. REGISTRY: **EXP-118 ADOPTED** (POSITIVE ×2 at the OFS v115 retro; folded into `ui-designer.md` §3b as plain practice with its `(v114, DEF-004)` scaffolding stripped) to open the slot for **EXP-128**; still 8 of cap 8. Principle-failure `2026-08-06-retro-constraint-named-from-interpolated-dwell.md`. CONSTRAINT TO ATTACK NEXT: `queue` **57.80%**, median **1.9d/item** — and from now on it is scoreable, because the median column is count-independent. -->
<!-- v131 (OWNER-REQUESTED retro, OagEventSource 2026-08-06). HEADLINE — **schedule by RESOURCE CLASS, not only by logical dependency** (new §F2b), and the owner named it exactly: *"dynamodb scans do not sound like things that should be connected with linting committing and pushing."* They are not connected LOGICALLY - a 6M-item store scan and an eslint run share no file no item no deps edge - and they serialise anyway because they compete for one machine. MEASURED: eslint src tests is **8 SECONDS idle and 19 SECONDS under concurrent load** (2.4x on load alone, nothing else changed); load average 14.68 during the failures against 8.19 once quiet. THE FLOW LAYER HAS ONE AXIS WHERE IT NEEDS TWO: wip_limit caps by QUEUE (a logical stage) and deps edges express LOGICAL ordering, so **nothing models the machine as a finite resource** and two activities that cannot logically conflict are dispatched freely parallel while physically contending. SELF-CONCEALING, which is why it survived every control added this week: contention slows a command, the liveness watchdog kills at 600s of SILENCE, a slow command and a hung one are indistinguishable to it, the kill reads as an infrastructure flake, and the diagnosis lands on the wrong layer. I DID EXACTLY THAT AND WORSE - two agents died at the identical step ("verify the combined trunk state is green"), I registered DEFECT-OAG-064 blaming per-commit gate cost, and I **never timed the command**. When measured it was 8 seconds. So the premise was false, the item is corrected on its own record, and my claim that the gate cadence killed a dozen agents is UNPROVEN. That is the §17f failure I added to this process one day earlier, committed by me, inside an item whose own acceptance demanded before-and-after wall-clock - the third time this session I asserted a mechanism from plausibility rather than measurement (after the body.changes[] hypothesis and after telling six agents to use a `git commit -- pathspec` form that does NOT do what I claimed: it commits from the WORKING TREE and swept 33 lines of another agent's in-flight work; the race-free form is a private GIT_INDEX_FILE plus commit-tree). WHY-CHAIN, five levels: queue is 49.73% of GLT because items sit unworked -> because work in flight keeps dying and restarting (12+ deaths, one item resumed FIVE times with nothing durable until the instruction changed) -> because the watchdog kills at 600s of silence and heavy commands emit nothing -> because heavy work runs concurrently across 4-5 agents on one machine -> **because nothing models the machine as a finite resource.** EXPLOIT (the move this retro routes): the constraint's dominant waste is NOT slow agents, it is agents being KILLED AND RESTARTED - dispatch-layer rework - so §F2b caps concurrency per RESOURCE CLASS (full-store-scan / full-test-suite / type-aware-lint / external-api / light) independent of queue membership, and forbids a silent long command (emit progress or background with a waiter). SUBORDINATE: unchanged from v130 - decline-or-schedule aged intake, still unstarted. ELEVATE: not taken; capacity is not the problem. CONSTRAINT `queue` **49.73%** and rising for a FIFTH retro (37.02 -> 39.36 -> 41.78 -> 47.18 -> 49.73); CFR 9.0% (was 8.6%); lead-time median 8425s trailing. WHAT HELD: the incremental-commit rule is now load-bearing and must not be relaxed - twelve deaths and every agent that committed as it went kept its work (the heal-forward landed 2 prod corrections plus full evidence; the 062 engineer survived three deaths across two dispatches with all five commits intact) while the ONE agent that batched lost everything FOUR times. ALSO DELIVERED THIS CYCLE: DEFECT-OAG-053 resolved (OCC key contract in prod, guard observed firing five ways, 98/98 position anomalies confirmed by three independent drained scans); DEFECT-OAG-054 resolved (prod deploys unblocked); UC-XE1, UC-ML3 and UC-BPC1 done; DEFECT-OAG-060 R3 closed by DECLARE-and-accept after the engineer refused to append an OagFlightOffBlock that would have regressed a completed flight's state in our fold AND in FIDS's mirror - and the architect's rejection of the monotone-fold option is the sharpest call of the cycle: **a fold rule binds only the folds WE ship and cannot bind a consumer fold we do not own**, so making our fold safe is not making the append safe. DEFECT-OAG-063 ruled (OagFlightWithdrawn was ALREADY ruled as delta-055 N4 and never built, so the closed set stays at 8; a withdrawal is NOT silence because OAG sent state:"DELETED" explicitly, and the mechanical test that keeps this coherent with the owner's no-new-events ruling is that the event must carry provenance to the inbound message that asserts it - S7 can carry none). MEASURED FOR THE OWNER: RSW takes **2386 physical flights/month** (5164 streams, factor 2.164, median 78/day) - my first answer of 5135 was a STREAM count read as a FLIGHT count, which the owner caught, and which became §17f and DEFECT-OAG-062. Registry: EXP-113 ADOPTED (fold-forward freshness is standard practice and ran clean today), opening the slot for EXP-127. Still 8 of cap 8. RECONCILE LATENCY 0. -->
<!-- v130 (INCIDENT-triggered retro, OagEventSource 2026-08-05 — retro-debt = 4, routine 3/3 PLUS an incident: DEFECT-OAG-054's prod-defect resolve, which §F8 never batches. The loop's own gate refused the pull and named the retro; that is the mechanism working.) HEADLINE — **a number without its unit and its subject is not a measurement** (new §17f), and the ruling came from the OWNER in three words: *"the RSW numbers are double counted."* They were right and the number was MINE. §17d bound tests, §17e bound gates, and NEITHER bound a COUNT — the most-cited and least-governed artefact here. Fourteen numbers were reported, believed and acted on this session without stating what they counted; FOUR were the orchestrator's own. UNIT: "5,135 RSW arrivals/month" counted STREAMS not flights, and codeshares split one aircraft across up to EIGHT streams — the correction factor (2.08 mean, histogram to 8, 16 unclusterable) was ALREADY MEASURED AND COMMITTED in UC-BPC1's codeshareCollapse, and the stream-vs-flight distinction had been PROVEN in the same session by the ground-truthed reproduction. UC-NCI1's 37, DEFECT-OAG-051's 85, the 98 damaged streams and my "~250 lost arrivals" carry the identical error. SUBJECT: "43,744/43,744 one OagFlightCreated per stream" was cited for WEEKS as evidence the OCC race was not firing — true, and about the WRONG AXIS; 98 prod streams were damaged on the change path above position 0 the whole time. A correct invariant mistaken for a broader one is more dangerous than a broken one because nothing about it looks wrong. REACHED-SUBJECT: "adapter tier green against real DynamoDB Local" — :8000 collided with AdixOut's container, NO report recorded the port, so good runs cannot be told from compromised ones after the fact (DEFECT-OAG-059). NULL: "two matching 98/98 scans prove the fix is holding" (mine) — at 1 incident per ~26,800 events that agreement was 93% likely IF THE FIX DID NOTHING. TEN CONTROLS FOUND THAT EXISTED, WERE BELIEVED, AND DID NOT FIRE, which is the same disease one layer down: render-diagrams skipped in 8 of 8 runs while I reported it as blocking (mine, and I had written §17e against exactly this three days earlier); aerobus-route-liveness wired into NO workflow while delta-056 claimed it "would have flagged the defect within 15 minutes"; the board acceptance parser matching `## Acceptance criteria` when every item writes `## Acceptance`, so a 10-AC defect projected as ZERO and a 13-AC use-case was pushed to the board labelled needs-acceptance WHILE BEING SET DONE; the WIP cap declared for `deploy` while the derived queue is `wip`; 14 logging.retention declarations the Landing Zone Accelerator overwrites 32 SECONDS after every deploy, org-wide; impacted-tests scraping mermaid label prose (a, an, the, each) as graph nodes; make prod-validate-oag reporting "42 passed" while the prod Function URL returns 403 to its unsigned fetch and the specs soft-skip; a key-separation check that would have reported "separation confirmed" while ONE key sat in BOTH secrets; the prefix-violation detector firing FOUR times on AA2706 at ingest, logged data-4xx, events appended anyway, unalarmed; and provenance.deliveryMode a hardcoded 'replay' across 2.73M events which nearly produced a wrong root cause. THE COUNTER-EXAMPLE IS THE PATTERN: the census's `complete: false` guard REFUSED to report a partial 0/0 as the store — three times under pressure, twice for an engineer and once for me — because it was built to state its own subject. CONSTRAINT — `queue` **47.18%** and RISING for a fourth consecutive retro: 37.02 → 39.36 → 41.78 → 47.18. WHY-CHAIN, four levels: items sit in intake unworked (64 deep) → registration throughput vastly exceeds delivery throughput (7 items registered today, ZERO closed) → investigation is GENERATIVE, one ground-truthed reproduction alone produced 6 items plus 5 corrections to existing ones → and it is not self-correcting because NOTHING EVER DECLINES: `wontfix`/`declined` exist in the graph and are essentially unused, so intake is append-only in practice. EXPLOIT (the move this retro routes): the constraint's waste is inventory that will never be pulled. loop-gate already says the remedy is "deliver faster; decline or defer what will never be pulled — never close real findings to shrink the number" and we have done only the first half. Each retro must now DECLINE or SCHEDULE-WITH-A-DATE every intake item past an age threshold; an item nobody will ever pull is decision-debt wearing a backlog's clothes, and it taxes every constraint reading. SUBORDINATE: a finding registered as a new item is pulled this cycle or deferred WITH A DATE (the OI-GATE-SOFTENINGS-WITH-EXPIRY shape). ELEVATE: already spent today on the owner's own ruling — WIP caps exist to constrain NON-bottleneck stages, so the `wip` row was made REAL (policy.csv declared `deploy` while the derived queue is `wip`, so the engineering cap was enforced NOWHERE) at 8, and `rework` 2 → 4 because rework IS engineering work and both slots were held by unattended items. DELIVERED: DEFECT-OAG-054 resolved and PROD DEPLOYS UNBLOCKED (SST deploy [prod] success on three consecutive runs vs failure/skipped at the causing commit); UC-XE1 done; UC-ML3 done against a REAL landed observation after 20.7h parked in awaiting_observation — the state the machinery added exactly so a shipped-but-unproven capability could not read `done`; DEFECT-OAG-053's OCC key contract fixed and deployed to prod with the guard OBSERVED FIRING five ways; OI-RECOVERY-LITERAL closed with the ledger entry correctly NOT promoted (the read path does NOT reach the field — 2 of 2 Recovery records are keyless and emit nothing, so promoting would have asserted a push-root path from REST-nested evidence); UC-BPC1's rework complete with genesisMultiplicity = 0 over 47,014 streams, an ORDER-INVARIANT proof closing my own tie-order concern by measurement rather than argument. THE REFUSALS HELD, and they are the session's best output: the heal-forward engineer healed 2 of 8 leaves and REFUSED the other 6 rather than append an OagFlightOffBlock that would overwrite a completed flight's folded state in our fold AND in FIDS's mirror — delta-059's "a filled gap is strictly worse than the gap" applied to a MILESTONE — then declined to fire `fixed` on a 2-of-8 result and asked for `blocked`; and it CORRECTED MY INSTRUCTION, refusing to remove the healed streams from the arm baseline because absent-from-baseline reads as FRESH CORRUPTION under delta-059 §5.2, which would have turned the must-not-grow gate red by construction. ENVIRONMENT: EIGHT agent deaths (529s, API timeouts, a DNS outage resolving dynamodb.eu-west-2.amazonaws.com). The work that SURVIVED is the work that committed incrementally — the heal-forward landed 2 prod corrections plus full evidence, while the registration agent lost everything four times by batching, and I completed that registration BY HAND. Routed to every agent file's commit discipline, not left as per-dispatch advice. Also confirmed: on a shared trunk `git add` takes a pathspec but `git commit` DOES NOT — it commits the whole shared index, and my commit b477f08 published 102 files including NINE source files from two other agents mid-task, applying their untested code to dev-shared under a commit message about a board parser (DEFECT-OAG-058; four instances today; every commit since uses `git commit -- <pathspec>`). REGISTRY: EXP-123 ADOPTED and pruned (its metric finally moved the right way — loop-gate check 5 surfaced UC-ML3's landed observation as actionable and the retro-debt gate refused this very session's pull), opening the slot for EXP-126 (§17f's declared-unit gate). Still 8 of cap 8. AdixOut's EXP-119 remains queued in open-items for THEIR retro — retiring another instance's scored row is not this retro's call. RECONCILE LATENCY 0. -->
<!-- v129 (RECONCILE, AdixOut 2026-08-05 — fold-forward instance/AdixOut v122 onto main v128, then reapply). AdixOut's process work from this session — numbered v121/v122 on instance — is RENUMBERED v129 because main independently used v121–v128 (OagEventSource retros) while it was in flight: the exact version-collision the "fold-forward FIRST, then bump" lesson warns of. All three folds are NOVEL (main covered none); the substantive agent edits auto-merged clean, only the version/registry files conflicted (resolved: take main's registry base, reapply mine). FOLDS: (1) cicd.md — a FIRST-EVER deploy into a FRESH account must grant the FIRST-USE auto-provisioned resources dev masks (audit deploy role AND runtime exec roles for the SST `sst-asset` ECR repo + a scoped `iam:CreateServiceLinkedRole` per SLR-provisioning service, all stages for parity); founding principle-failure `2026-07-30-adixout-first-prod-deploy-fresh-account-bootstrap-gaps.md` + IMP-026 (executable preflight) — AdixOut's first-ever prod deploy failed TWICE on exactly these (ECR CreateRepository, EventBridge API-destinations SLR). (2) cicd.md — the full local pre-push gate (lint+typecheck+`make test-all`+audit) applies to EVERY push including probe/tooling/one-line-fix commits (a probe's eslint unused-var bounced CI twice). (3) defect.md — reproduce-to-confirm REQUIRES a live reproduction of the CURRENT symptom, NOT a trusted/relayed report + a plausible root-cause diff (assert-real-state applies to the DIAGNOSIS, before the fix); founding principle-failure `2026-07-30-adixout-def010-diagnosed-from-stale-report-without-live-assert.md` (DEF-AIDX-010: an external "100% NO_PERMISSIONS" report + a structural policy diff were taken as confirmation and a prod IAM change shipped, when a 30-second live check showed delivery already working since bus go-live). DEFERRED (cap-8): the EXP-119 fresh-account-bootstrap-parity SCORED registry row — main's registry was at the hard cap of 8 (all OagEventSource's), and retiring another instance's scored row is not a merge-time call; the behaviour is live as cicd.md practice, the row is queued in open-items for the next AdixOut retro. Also queued in open-items: the traceability AC→use-case-acceptance propagation tightening, and the `/requirement` aggregate-registration skill drift. No global-section rule changed beyond the two agent-file folds; no experiment row added (cap-8); constraint unchanged. -->

<!-- v128 (HUMAN-REQUESTED retro, OagEventSource 2026-08-03. The ruling, verbatim: *"a gate that cries wolf gets ignored ... no, a gate that cries wolf needs to be FIXED."*) HEADLINE — **a red gate is a defect with an owner, not context** (new §17e). The first half of that sentence had become this repo's standing excuse: the orchestrator used "a noisy gate gets ignored" **SIX times in one session**, every time to justify SOFTENING a gate instead of repairing one — report-only for the test-requirement gate, "an architect follow-up" for a stale threshold, and `make render-diagrams` as a cautionary anecdote. The anecdote was the worst of it: **red for ~20 days over three `.mmd` files, running in NO workflow at all, and quoted inside `security-audit.yml`'s own header comment as the reason THAT workflow needed a `schedule:` trigger.** A defect had been converted into a rhetorical device. Worse still, **v125 had ALREADY routed the correct rule** — "every committed gate is green on trunk or DELETED" — naming this exact target; it stayed red three more days. That is the **SIXTH prose-only remedy** in recent history (after `make wire-provenance`, the unread corpus markers, `awaiting_observation`, "push on green" aimed at a misdiagnosis, and the never-generalised heal comment). And the entire repair was **four semicolons and one pair of quotes**: `;` is a mermaid statement separator, so a `;` inside `Note over X:` or a message label silently truncates the statement and the parser then fails on the NEXT line — which is precisely why the reported line numbers never pointed at the real defect and nobody looked twice in twenty days. FIXED, NOT DESCRIBED: `render-diagrams` is **31/31 green** (was 28 pass / 3 fail) and now runs **BLOCKING** in `ci.yml`, with **`architecture/**` added to the path trigger** so a diagram broken in isolation can no longer skip CI. NEW GLOBAL RULE §17e, five limbs: (1) a red gate is a DEFECT WITH AN OWNER, fixed or deleted, and "known red" is not a state; (2) **softening is not a remedy** — report-only, ratchet, raised threshold, exclusion or skip is a decision to STOP MEASURING and is permitted ONLY with an owner, a date, and a registered item whose acceptance is the gate BLOCKING again; (3) a threshold that fires on legitimate volume is **BROKEN not noisy** and is re-baselined from the measured population before shipping; (4) **wired-but-non-blocking is not wired** (mentioning it in a comment is the §17c.3 comment-is-not-a-control failure); (5) **never cite a red gate as evidence in an argument** — if you know enough to cite it you know enough to fix or open it, and citing it teaches every reader that red is normal. SELF-BINDING APPLIED (§17c.5): the two softenings I created today were registered with owners and hard expiry dates rather than left open-ended — `OI-GATE-SOFTENINGS-WITH-EXPIRY`: the test-requirement ratchet (1,795 untagged of 2,749; owner engineer+product; expires **2026-08-17**; acceptance is limb 1 BLOCKING, and reaching zero by mass-tagging counts as FAILED under EXP-124), and delta-051 §11 metric 3's stale `>2/day` threshold which would fire on ~1,050 legitimate lines/day after delta-052 re-measured the population at 40,955 across three causes (owner solution-architect; expires **2026-08-10**; UC-ML2's new `prefixViolationClass` already splits `sequence` ~51/day from `schedule-key-defect` ~1,000/day so honest per-class thresholds are settable). CONSTRAINT — **`queue` 41.78%**, and it is RISING across three retros: **37.02% → 39.36% → 41.78%**. EXP-123 (mechanised loop preconditions) existed to reduce exactly this and its metric moved the WRONG WAY at its first scoring opportunity: scored **NEGATIVE (1/3)**. The confound is real and stated rather than used as an excuse: `queue` share counts `registered`+`ready` dwell, and intake went 10 → 33 this session as the census, the test gate and the HF042 dry-run surfaced genuine findings — so registering more work inflates the share mechanically. But that ALSO means the metric is confounded by item COUNT and cannot distinguish "work waits longer" from "there is more work", which makes it the wrong measurement for the constraint it is supposed to track. Routed: `stats.md` must report **median per-item dwell in `registered`/`ready`** alongside the share, so EXP-123's next scoring is against a count-independent number. METERING FOUND UNRELIABLE, twice in one hour: engineers self-reported `tokens` at **118,000 vs an actual 318,349** (UC-ML3) and **195,000 vs 405,598** (UC-ML2) — 2.7x and 2.1x under, with no `duration_ms` at all. §E/§F are therefore not merely low-coverage; the entries that EXIST are understated by half or more, and three retro constraint analyses were read off them. `loop-run` step 4 already prescribes the cure (the append carries the DISPATCH LAYER's `subagent_tokens`, a figure only the orchestrator holds) — an engineer self-reporting is the defect. Both times the engineer advanced the state before the orchestrator could append the real figures, making the correct edge illegal: the v124 dispatch-and-state-event-are-ONE-act hazard, twice. WIP DISCIPLINE CORRECTED BY THE OWNER, and it is mine: I recommended "displace the in-flight builds" as the RECOMMENDED option on a priority question, then started a third concurrent stream. **High priority means head of the queue for the NEXT pull; it does not interrupt work already in progress** — interruption leaves partially-done inventory and lengthens gross lead time for everything INCLUDING the interrupting item. The guard that should have stopped me DOES NOT FIRE: `queues/policy.csv` declares the cap as `deploy` while the derived queue is `wip`, so no row matches and it is unenforced — observed live at `wip` depth 4 against a modelled cap of 1 with `loop-gate` reporting "OK, the loop may pull" (`OI-WIP-CAP-UNENFORCED-NAME-MISMATCH`, value 20 / cost 1; the flow-manager flagged this exact `deploy`≡`wip` ambiguity on 2026-08-01 and it was recorded, not fixed). FOUR MORE SILENCE-AS-SUCCESS CONTROLS found this cycle, all registered: the board projector rendered `Backlog` for ANY unmapped state (fixed — `cancelled` missing since v5, `awaiting_observation` since v9, and the aggregate tables were a `.copy()` of the use-case table which defeated the inverse sweep); `wi-validate` never checked `derived.state` legality against the type graph (five items passed clean carrying aggregate-only `planned`/`queue: null`, and "wi-validate clean — I1–I4 + I6 all hold" has been quoted all session as assurance it does not provide); the board acceptance parser matches `## Acceptance criteria` while every item writes `### Acceptance`, so `needs-acceptance` sits on 100% of items and can discriminate nothing; and `@covers fids-format`/`fids-fold` match no node id in any `.mmd`, so `impacted-tests` silently under-reports FIDS. DELIVERED: UC-XC5 **done** (AdixOut confirmed the replay; the tester built a better argument for accepting scope-level confirmation than the orchestrator had, and pulled the authoritative CloudWatch `NumberOfMessagesSent` = **0 across the whole 3-day window** on both consumer DLQs so the claim does not rest on their word); UC-ML2 and UC-ML3 built green, deployed and out for validation, each with proof-of-fire on REAL streams only — ML2 reproducing the 444-shape and 36-shape end-to-end through the real `ingest()` and its per-append signal matching the whole-stream oracle exactly across all 862 harvested streams, ML3 true on all 9 captured born-cancelled streams via BOTH the REST recovery lane and the live change path with monotonicity observed RED differentially. §17d FIRED ON ITS OWN AUTHORS TWICE: ML3's first cut pushed limb-2 15 → 18 on its own capture-override patterns and was restructured back to 15; and `AC-ML2.x` did not exist at all because the acceptance was prose, so the engineer had to author the criteria it would then be judged against (flagged for the tester to verify nothing was narrowed). A NEW CUSTOMER DEFECT, framed and human-gated HIGH: two stuck RSW arrivals (AA1144 CTG→RSW landed FLL, WN814 IND→RSW landed STL). **OAG DOES send the diversion** — REST carries `diversionAirport`, `irregularOperationType: Diversion`, `diversionType: Unplanned` on both — and **we never received the update at all**: an ABSENT message, not a mis-shaped one. My instance-key hypothesis was FALSIFIED (`scheduleInstanceKey` is identical to our streamId on both). The wire-shape bug is real but DEMOTED (REST carries a flat `diversionAirport` under a `statusDetails[]` array; our code expects `body.diversion.airport`) — moot here since nothing arrived to mis-map. **Population: 210 stale-non-terminal streams** of 4,992 in-window in the gated scope, a lower bound. Leading untested hypothesis: our own DEFECT-OAG-043 scope gate on `{TPA,RSW,SRQ}` — both flights diverted to airports OUTSIDE that set, so if `inScope` reads the CURRENT arrival airport then a flight diverting AWAY from a gated airport goes out-of-scope at the exact moment of the diversion and we discard the message reporting it, which would also explain `OagFlightDiverted` = 0 of 5,300,655. Salvaged before that investigation was stopped for WIP discipline: **16 streams ingested-then-dropped in 3 days, 313 dropped messages.** AMEND DEFECT-OAG-046, do not duplicate. RECONCILE LATENCY 0. Registry 7 → **8, AT cap** (EXP-125 opened); next retro must retire one to open one. -->
<!-- v127 (HUMAN-REQUESTED retro, OagEventSource 2026-08-02; NOT a defect retro — retro-debt was `ok`. Two human rulings, both adopted verbatim.) HEADLINE — **a test validates a requirement, or it is not a test** (new §17d). The ruling: *"A test was written to match the code. I do not care AT ALL about code coverage. The ONLY thing tests should be validating is the requirements. If we are making up tests for coverage that do not map onto requirements then either (a) we are wasting time, or (b) we have identified a new acceptance criteria and we need to retro as to why it wasn't discovered earlier."* THREE independent instances in ONE session, which is what makes it a rule and not an incident: (1) **the founding case** — `uc-hf041-cancellation-recovery.test.ts` built its "pre-fix" prior by re-ingesting a REAL capture **with `statusDetails[].state` DELETED**, precisely the leaf whose presence breaks the heal, with three siblings hand-setting `{state:'Cancelled'}` and asserting suppression; **2,171 tests green while nine real cancellations sat unhealed in prod** on the passenger-facing feed — the test did not merely miss the bug, it encoded the bug's own assumption as its fixture; (2) the `awaiting_observation` probe test stubbed `subprocess.run` and so "only proved the mapping agreed with itself" — against a real `make` EVERY probe read BROKEN, because `make` does not propagate a recipe's exit status and the three-way exit-code contract it asserted is not expressible through `make` at all; (3) the provenance ledger's `read` dispositions were DECLARED and, tested differentially against `normalise()`, **8 were false**. This is §17c Layer 1 with the SUITE as the blind spot: §17c bound capabilities to observation but never bound tests to requirements, leaving the one place that certifies everything else as the last place where authoring the world was permitted. §17d has four limbs: every test declares its `AC-<ID>.<n>` and an untagged test is a BINARY choice (waste ⇒ delete, or undiscovered acceptance criterion ⇒ register AND open a discovery retro — "it improves coverage" is not an answer); **a precondition may not be AUTHORED** (a prior built by mutating a real capture must instead be folded from events or harvested); never stub the seam under test; and a green suite is evidence about the TESTS until §17c.1's observation pointer exists. Made executable as **EXP-124** (two-limb gate, scheduled lane), falsifiable against the easy way out: **satisfying the baseline by mass-tagging counts as FAILED**, because that reproduces the coverage theatre the ruling rejects. SECOND RULING, adopted as **§12d-bis**: *"a basic definition of done should include merging code into main and deleting the branch."* The v89 multi-audience DoD and §17c.1 all describe the CAPABILITY; none asks where the CODE ended up. Found: **three feature branches on the remote, unmerged, 10–13 days old, with NO pull request at all** (`feat/onboard-ids-pullbridge-consumer-surface-c` 2 commits, `fix/private-api-redeploy-on-policy-change` 1, `fix/surface-c-per-flight-route-event-shape` 2) — no PR means no board item, no queue entry, no gate: **invisible inventory, strictly worse than an open PR**. And four Dependabot security PRs sat open **TEN DAYS** while their advisories were live, so the exposure was never a proposal gap but an enforcement gap. DoD now requires the change on `main`, any branch deleted after merge, no owned PR left open, and an unruled inbound PR treated as AGEING INVENTORY belonging in a queue not a tab — with the hard caveat that an unmerged orphan is REGISTERED and adjudicated, **never swept**, since deleting a finished engineer's work already cost a day at v124. PR hygiene actioned this cycle: 24 open → **2**; 18 were self-inflicted by a `dependabot.yml` group misconfiguration (`update-types: [minor, patch]` does NOT restrict a group — majors fall OUTSIDE it and each opens its own PR, producing the flood that teaches a team to ignore Dependabot) and 4 were superseded by the override fix; **0 open high-severity alerts** verified against the API. SECURITY: 14 alerts (not the 11 filed — it GREW while untriaged) = 4 unique advisories over 3 packages, all fixed by narrow same-major transitive `overrides`; **reachability 0 of 14 from shipped code, established from ARTIFACTS not from npm scope** because the two disagree (`flowbite-react` declares a build tool as a production dependency), via the admin sourcemap's 10 bundled packages, all 12 committed lambda bundles, and byte-identical rebuilds. New `security-audit.yml` whose **daily `schedule:` is the load-bearing part** — every other workflow here is path-triggered and a third-party advisory arrives with TIME, so a path-only audit would have repeated the `make render-diagrams` failure exactly; proof-of-fire in CI run 30717088605 (overrides reverted ⇒ exit 2 ⇒ `AUDIT FAILED`). ALSO LANDED: **state-graph v8→v9**, `awaiting_observation` now REAL (v125 listed it as completed and it had never been added — the THIRD v125 prose-only remedy after `make wire-provenance` and the unread corpus markers), non-terminal, predicate REQUIRED via `OBSERVE=` (a `note:` can never come back negative), re-checked every cycle by `loop-gate` check 5, held out of `done` by the machinery rather than by hand, and an awaiting child holds its parent aggregate out of `done`; machinery suite 148→200. **delta-052** re-ruled delta-051 after the census falsified §1: the store's violations decompose EXACTLY with no residual — **40,955 = C1 1,813 genesis (UC-ML1's) + C2 1,881 change-path + C3 37,261 schedule-identity** — so UC-ML1 owns 4.4%, its success measure is replaced by a four-way partition where only M1 may gate and **M3 must be UNCHANGED (a move either way is an arm failure)**, and the coherence prohibition now extends FORWARD: nobody may report the event log coherent. Schedule identity UPHELD as a defect: **`scheduleInstanceKey` IS `oagFingerprint`** — we key the stream on the very value used to detect a new version, so 609,986 observations produced 609,986 keys with zero collisions and **the planning facet has no history**. Confirmation tiers added: `store-confirmed` may NEVER promote to `wire-confirmed`, and since `isRemovalState` upper-cases, 37,261 firings prove only that SOME case-variant arrived — **a normalised comparison can never confirm itself from its own output**. `changes[]` ruled an ORACLE never a control input, and the architect CORRECTED the orchestrator: it explains neither the 644 collateral writes nor the 9 missing cancellations, both being REST-seeded paths carrying no `changes[]` at all. ORCHESTRATOR FAILURE, unsoftened (principle-failures/2026-08-02-the-test-authored-the-world.md): I asserted that `changes[]` hypothesis TWICE and briefed an engineer on it, reasoning from "we ignore data OAG sends us" to "that explains the symptom" without checking whether the field is present on the failing path; it cost nothing only by luck, the engineer already having the cause from the records. UC-HF041 ROOT CAUSE (two composing defects, both real): the suppression guard compared the FOLDED AGGREGATE's coarse `state` against cancelled and read a match as "already emitted" — but the nine were BORN CANCELLED, so genesis seeded `state` while emitting no `OagFlightCancelled`, making "the aggregate reads Cancelled" and "the cancellation was published" disagree PERMANENTLY on such a stream (and every consumer reads the event, not the leaf); compounded by the `messageId` fast path having frozen the partial result, so fixing the guard alone heals nothing. Blocks the LIVE change path too, not just the heal. REGISTRY: 6 → **7** of cap-8 (EXP-124 opened; no retirement needed for the first time in four retros). RECONCILE LATENCY = **0**. CONSTRAINT unchanged from v126 (`queue` + `dev-validating` ≈ 58% of GLT) and EXP-123 remains unscored at 0/3 — this retro deliberately spent its change budget OFF the constraint under §5b's safety-fix exemption, both rulings being defect-preventing, and says so rather than pretending otherwise. -->
<!-- v126 (§F8 retro-debt INCIDENT gate, OagEventSource 2026-08-01 — 3 incidents: DEFECT-OAG-044/045/048 resolved. The gate FIRED at exit 2 and forced this retro; that fact is the retro's whole finding.) HEADLINE — **an obligation with no mechanism is not an obligation** (new §F8a). In ONE cycle, four loop preconditions came due and exactly one was honoured: `make retro-debt` (exit code 2) forced this retro, while every judgement-shaped sibling was skipped — DEFECT-OAG-045 dwelt **127,636s (35.5h)** and DEFECT-OAG-048 **98,224s** in `validating`, both already pushed AND deployed, awaiting only a tester dispatch nobody made; Ready sat at 1 against `min_items` 3; intake sat OVER its `wip_limit` of 10 — a cap enforced NOWHERE in the machinery (and the orchestrator quoted 14 from a `views/queues.md` that was 8 minutes stale while the gate, folding live item events, read 22 then 23: a derived VIEW is a snapshot and quoting one as current is the same error as quoting an event note). The obligations did not differ in importance or difficulty — only in whether a command returned non-zero. SECOND CONSECUTIVE RETRO ON THIS CONSTRAINT, and the previous remedy is now FALSIFIED: v124 diagnosed orchestrator over-gating (holding pushes) and prescribed "push on green"; the prescription was FOLLOWED — all three fix commits (`5095849`, `78bfd55`, `265bea2`) are ancestors of `origin/main`, pushed same-day — and the dwell happened anyway, because the missing act was the **dispatch AFTER** the push. The metrics record the non-movement: `dev-validating` 22.17%→21.15%, `tester` 22.60%→22.28%, `queue` 36.78%→**37.02% (WORSE)**. CONSTRAINT unchanged and now correctly attributed: `queue` 37.02% + `dev-validating` 21.15% ≈ 58% of GLT; the tester's 22.28% share is a WAIT wearing the tester's name, caused upstream by the orchestrator. EXPLOIT/SUBORDINATE = mechanise the preconditions in §F8's proven shape → **`make loop-gate PROJECT=P`** (exit 0 may pull / exit 2 blocked, reporting EVERY violation with ids + remedy): stalled-validation (an item dwelling past `--stale-hours` whose latest `fixed`/`built_green`/`deployed` carries a `ref:` — work done, dispatch missing), Ready-below-floor, queue-over-cap, retro-debt-due (delegated, not reimplemented). Registered **EXP-123**, deliberately falsifiable: if the two dominant GLT shares do not fall over 3 cycles then mechanisation is NOT the lever and the pattern must be abandoned rather than prescribed a third time. NEW HARD RULE, §F8a: **push/deploy state is DERIVED (`ref:` + `git merge-base --is-ancestor` in the project repo), NEVER read from event-note PROSE** — a note reading "NOT pushed — push is the prod apply" was ~35h stale while its commit had been on `origin/main` throughout, and reasoning from it produced a confident, precisely-quantified, WRONG constraint diagnosis; this is v125 §17c Layer 2 (the load-bearing claim living in prose where it cannot be false) recurring against the process's OWN metrics. Also §F8a: a hold on a push needs a NAMED precondition on the HELD ITEM and is **SCOPED to the declared trigger paths** — `infra.yml` explicitly EXCLUDES `src/fids-app/**` (manual `make deploy-fids` gate, DEFECT-OAG-028), so for the 35.5h item the push was never the apply and there was nothing to sequence; check `git diff --name-only origin/main..HEAD`, never the habit. ORCHESTRATOR FAILURES, unsoftened (principle-failures/2026-08-01-loop-obligations-as-judgement-are-skipped.md): (1) diagnosed the constraint from a stale note instead of from git — THIRD consecutive day asserting a governing fact without establishing it; (2) reported UC-HF041 verified on the strength of the ONE flight the human named — the tester, correctly declining to trust my numbers, ran the full window: `cancelledAtSource=645 recovered=362 **missing=9** noStream=274 duplicates=0`, exit 2, reproducible twice, 9 codeshare siblings of one physical RSW→JFK flight (2026-07-05) still uncancelled, in scope and in retention ⇒ item REJECTED back to `reworking`. Both are the same shape: a claim that felt established because nothing had contradicted it. REGISTRY (§25a, cap-8): **EXP-101 ADOPTED** — the metric had been moving for 26 days while the row sat unscored at `0/2`: the dev→prod path fired 11× (`prod-deploying`/`prod-validating` n=11) with `dev-validating` failure rate **1.1% (2/175)** against `prod-validating` **0.0% (0/11)** — 2 contained dev catches, 0 prod escapes, exactly the CFR claim; folded into tester.md/cicd.md as plain practice. **EXP-107 KILLED** — 20 days unscored at `0/3` and its target metric is the system's WORST: `deploying`/cicd **6.7% failure rate (13/195)**, `deploying` 18.16% of GLT; 13 deploy failures reached the deploy stage and the pre-push catch was never demonstrated once — deliberately NOT re-registered (that would be the prose-remedy failure §17c exists to prevent); the 6.7% goes to an improvement slice as WORK. **EXP-112 KILLED** — falsified by direct observation this cycle: a push to `origin/main` returned "GitHub found 11 vulnerabilities on the default branch (11 high)" while `OI-DEPENDABOT-HIGH-SEV` sits open in intake; advisories live, pushes happened, nothing caught — a measurement that has already come back NEGATIVE may not stay `active`. Registry 8 (AT cap) → 5 → **6**, with headroom for the first time in three retros. CORRECTION LOGGED: I claimed `experiments-archive.md` was EMPTY and called it a process failure — it is 138KB with 118 entries including EXP-106 and EXP-115 properly archived; my grep matched a table format the file does not use. Checked before writing the false finding into the record. VALIDATED THIS CYCLE with real negative cases proven (§17c proof-of-fire): DEFECT-OAG-044 (the deployed prod publisher observed REFUSING a live synthetic invoke — `aerobus.publish.synthetic-refused`, nothing published, plus an offline bundle-byte pin so the DEFECT-OAG-043 stale-artifact class cannot recur), DEFECT-OAG-045 (live CloudFront, `make probe-fids-hosted` clean, a NEW live env-selector spec authored because the existing ones checked the artifact locally or one option only — never the full contract against deployed bytes), DEFECT-OAG-048 (live dev origin: AdministratorAccess → 403 where it was masked 200, garbage creds → 403 fail-closed, ReadOnly → 200 + cookie + no leak; `CustomErrorResponses.Quantity=0` read off the deployed distribution). NOT ESTABLISHED and recorded as such: the `oagMaintainer` accepted-role case is UNOBSERVABLE — the current SSO user is not in `aws-oag-team` (pre-existing entitlement gap, not a regression). RECONCILE LATENCY = **0** (`main..instance/OagEventSource` empty) — integration is NOT the constraint; §0a Rule 4 healthy. FLOW: registered SLC-049..052 from delta-051 plus 6 use-cases (UC-ML1..5, UC-BPC1); UC-ML1 pulled and building INERT behind `GENESIS_PHASE_EVENTS_ENABLED=false`; UC-ML5 registered `blocked` (arm gated on UC-XC5 + UC-HF042 + consumer acks) and NOT padded into Ready; UC-HF042 re-attributed `deploying`→`blocked` so an external third-party wait stops being booked as our deploy latency. Product flagged that SLC-049's `job: J22` (secondary, diversion-liveness) does not fit content that matches CORE `J0` almost verbatim — routed to the HUMAN at the requirement gate (V5a), not silently re-tiered. §E/§F metering still barely instrumented (token coverage 3.0%, duration coverage 0.5% of 1253 events; plumbing share reads 0.0% which is meaningless at that coverage) — the sections remain decorative and any claim made off them is unsafe. SAME-CYCLE ADDENDUM (engineer, dispatched by the orchestrator): the gate's FIRST REAL RUN exposed a MODELLING ERROR in the specification, not in the implementation — check 3 blocked on ANY queue over its `wip_limit`, which is wrong for `intake`. **Little's Law governs WIP, not backlog depth.** A legitimate differential-sweep session produced ~15 verified-real sub-cost-4 findings; the flow-manager correctly refused to close any of them, and the loop halted at exit 2 for having done good discovery work — the block INVERTS the constraint (the remedy for a deep backlog is to deliver faster, which is exactly the pull it prevents) and pressures agents to close real findings to shrink a number. Check 3 now has TWO SEVERITIES: BLOCKING for a WIP-stage queue (`ready`/`wip`/`rework`/any future in-flight stage), ADVISORY-only for a BACKLOG queue (`intake`) — reported prominently with depth, overage and remedy, exit code untouched, advisory-only runs exit 0 and SAY so. The classification is DECLARED as a `kind` param row in `queues/policy.csv` (long format, so no column and no existing reader changed), falling back to one named map with an UNDECLARED queue defaulting to `wip` (fail-closed). Generalisation now in §F8a: **a gate blocks only on harm that stopping relieves.** Proof-of-fire per §17c: backlog-alone -> exit 0 with the advisory printed (real state, intake 20 vs 10), a seeded WIP-stage queue over cap -> exit 2, both together -> exit 2 with the advisory alongside; machinery suite 133 -> 148 green. Also state-graph **v7 -> v8**: `open-item` never got v7's `amended` self-edge (v7 said 'both flow graphs'; there are THREE), so the flow-manager could not record a legitimate scope-narrowing on OI-CHUNKS-STALE-REF and correctly refused to work around the graph — `open`/`scheduled` self-edges added, the invariant now pinned generically across every flow type, and CONTRACT.md (which already ASSERTED it) made true. -->
<!-- v125 (HUMAN-REQUESTED retro on the TEST PROCESS itself, OagEventSource 2026-07-31; NOT a defect retro — retro-debt was already `ok`. The human's brief, verbatim and unsoftened: "we need to do a retro on the test process for this project as this is a disastrous fail that is a larger pattern. We have shipped a thing, we have thousands of events and we have not used real events to demonstrate that things work.") HEADLINE — **nothing is established until it has been observed in a state that could have come back negative** (new §17c). FIVE capabilities read `done`/`validated` while never once working on real data: `OagFlightCancelled` 0 of 10,519,584 events; `departure.scheduledTimeUtc` 78% null, source path never read though ALL 109 real captures carry it; `irregularOperationType='Recovery'` 0 captures (so `recovery` has always been `false`); `OagFlightDiverted` 0 of 5,300,655; and `deriveAirports()` deriving `metadata.airports` from departure+arrival ONLY, so a diversion airport can never enter the routing key every consumer fan-out rule filters on. All five passed an 1,804-case green suite. NONE was found by a test — the first four by ad-hoc prod queries the orchestrator ran ONLY because a human challenged a reported flights-per-day figure ~3x reality, the fifth by reading code. TWO LAYERS. **Layer 1: we only ever ran ONE direction** — every test is `code → expectation` over inputs WE authored, an EXISTENCE proof, while every failure is a UNIVERSAL property over inputs reality authors and outputs we declare. Three inverse questions were never asked: **D1** code→data liveness (has reality ever produced this output?), **D2** data→code coverage (does our code read what reality sends?), **D3** gate→artifact identity (did the passing gate read the shipped bytes?). Crucially this is NOT a data-access problem — we hold ~10.5M prod events and 109 real captures, and `times.scheduled` was in every one; reality was already in the repo, UNEXAMINED. The human's candidate root cause ("every gate validates our representation of reality, none validates reality itself") is Layer 1 and is ADOPTED, with that one correction. **Layer 2, which explains the recurrence: the load-bearing claim lives in PROSE, where it cannot be false.** A handler docstring claiming a literal was "corpus-confirmed" (it was not); a provenance ledger whose docstring says it "sweeps the whole REAL capture corpus" while recursively walking every `.json` including hand-authored `synthetic/`, derived fixtures, vendor doc samples and a config dump; a prod smoke whose safety comment claimed "no real consumer is fanned out to" — false AND ROTTED, two runs reached an external consumer's live prod DLQ; a scope declaration citing a **1,160,377-row prod scan that exists ONLY as a docstring with no committed script**, so the load-bearing measurement is unreproducible; a delta saying "re-verify when a real diversion is first captured", never actioned. And the proof of the layer: **§17b's own remedy from v123 is prose — `make wire-provenance` DOES NOT EXIST**, the corpus's `_capture`/`_provenance` markers sit on 115 files NO GATE READS, the stricter directory filter that fixes the sweep already exists in the sibling 042 ledger and was never back-ported, and `diversionType` carries no declaration at all. A remedy written as prose reproduces the defect it was written for — so §17c binds THIS document too (a retro may not discharge a finding of this class with prose; each fix is executable now or a registered item whose acceptance IS the gate firing). NEW GLOBAL RULE **§17c** with five limbs: observation-gated done; **a gate is not a gate until observed going RED (proof-of-fire — a seeded violation, demonstrated once)**; a control asserted in a comment is not a control and an environmental premise ROTS; a number needs a committed re-runnable query behind it; and the self-binding clause. **§12d amended — the FOURTH recurrence of the CORE-job false-done gate, and it locates the flaw in the MOMENT not the mechanism**: the gate runs at slice CLOSE, when the capability has had no opportunity to occur, so it is structurally blind — the check must run on a CADENCE over real data. DoD gains obligation 3 (observation pointer to a real record the system did not author) and the state graph gains **`awaiting_observation`** — non-terminal, machine-checkable liveness predicate, re-checked every cycle like `blocked`. That is the honest state the five items should have held: shipped, green, UNPROVEN. Recorded as `done`, they made CFR and rework read clean while nothing worked. The v89 multi-audience DoD did not help and could not: all four audiences document INTENT; observation is the missing fifth. REPLACEMENT STRATEGY = **IMP-028** (the human specified it: "for each event and the sequence of events find the example in the data that would generate this and create tests from actual data"): Phase 0 corpus provenance made unfakeable (only real+resolvable-id captures may confirm; synthetic physically separated); Phase 1 `make conformance-census` over the REAL store, types enumerated FROM `canonical-event-types.ts` (all 19), emitting a committed DIFFABLE snapshot — cheapest-catch-all is Phase 0 + D1 + D2, which catches instances 1-4 on its first run with no thresholds to invent; Phase 2 a real exemplar per TYPE and per SEQUENCE (6 branch-complete real streams — the two worst instances were INTERACTION failures a per-field test cannot see); Phase 3 rare events by expected-rate x exposure with `not-yet-observed` as a first-class declared outcome; Phase 4 refresh-or-fail so the oracle cannot decay back into a fixture. Ordered by PASSENGER-VISIBLE CONSEQUENCE (Cancelled as template -> ScheduledTimeSet -> Diverted+3-airport key -> OOOI -> Recovery -> BagBelt/Gate -> schedule facet). Instance 5 is deliberately NOT in IMP-028's scope: `deriveAirports` is a SPECIFICATION failure — nobody ever stated the invariant, and no oracle invents a requirement — routed to solution-architect.md (a routing key is derived from the SET OF PARTIES that must receive the record, and every new BRANCH re-opens the key) + discovery/product. Its blast radius is accurately ARMED-BUT-UNEXPLODED: no consumer registry entry sets `airports:` today, so every deployed rule filters on `category` only; the first airport-scoped consumer detonates it. ROUTED: tester.md (observation pointer on `validated`; an INJECTED input is a diagnostic never a validation — DEFECT-OAG-044; sequences not just fields; statistical rare-branch verdict; `not-yet-observed` does not reach `done`; an unrunnable tier is a RED tier), engineer.md (the D2 inverse sweep; build the test FROM the real record; **dry-run a writing lane against real data BEFORE claiming what it will do** — UC-HF041's 28-day real-REST dry-run falsified the item's own premise in ONE pass: 1,005 events not the 361 predicted, 644 (64%) unforecast collateral field-diffs, 274 historical flights would have been MINTED into prod as if new, and a retention-based residual FABRICATED from an un-measured horizon; reasoning and a green suite found none of it), cicd.md (the census as a SCHEDULED lane — a never-firing capability is invisible to a push-triggered gate by construction; plus every committed gate is green on trunk or DELETED: `make render-diagrams` red ~20 days over 3 committed `.mmd` files because it runs in NO workflow, `make test-fids-integration` times out in its own 300s `beforeAll` walking a ~107k-event feed to head), solution-architect.md (routing-key party set). CONFIRMED WORSE THAN REPORTED: `infra.yml` is the ONLY deploy lane, has no dependency on `ci.yml` AND never runs the full unit suite (2-3 named specs only) — so prod can deploy with the unit suite and the bundle-diff gate both red. REGISTRY (§25a, cap-8): **EXP-106 RETIRED as SUPERSEDED** — its intent is exactly this class but its close-time mechanism cannot fire (4th recurrence, 1/3 in 3 projects), and its CFR metric is inherited; that frees the slot for **EXP-122** (observed-or-not-established: observation-gated `validated` + proof-of-fire on every gate — one hypothesis, two limbs, both counters to Layer 2). **EXP-120 EXTENDED not duplicated** (D2 inverse sweep, statistical liveness, and the gate must READ the provenance marker) and held at 1/3 with an explicit ADHERENCE GAP recorded: its next scoring must verify the target EXISTS, not that it was intended. Registry 8 -> 7 -> **8, AT cap**. ORCHESTRATOR CONTRIBUTION, unsoftened: I ran the queries that found instances 1, 2, 4 and 5 only AFTER a human challenged a number I had reported. Nothing in the process prompted them, and the process is what I own. -->
<!-- v124 (GAP-CLOSING retro, OagEventSource 2026-07-31; §F8 retro-debt INCIDENT gate — 1 incident, DEFECT-OAG-043 resolved 13:05:20Z. Version established from the file first (v123, correct this time); tree was on v123 with a clean bump. PROPORTIONATE by design: one incident, registry AT the hard cap-8, so NO new global § was added and everything routed to the narrowest owner as agent-file practice; the only registry move is a justified cap-NEUTRAL swap.) HEADLINE — the engineer's own error-class statement, adopted verbatim as the spine: **a control declared as an OPTIONAL dep on a shared primitive is a control that some lane will omit — and a back-compat-permissive fallback makes the omission SILENT AND GREEN.** Prod ran TWO live ingest lanes into ONE event store and only the ECS one was scope-gated: the scheduled `oag-ingest` Lambda (rule `oag-ingest-1min`, **ENABLED**, consumergroup-3) had no `CONNECTION_CONFIG_TABLE_NAME` and `IngestHandlerDeps` had **no `inScope` field at all**, while the shared `consume-and-ingest` primitive documented an absent predicate as "no filtering (pre-OB6 behaviour preserved)". 27,537 events / 2,144 streams appended since 2026-07-27, ~25,100 outside the then-declared scope, **all republished** to FIDS and AdixOut (the event store IS the transactional outbox — no downstream scope gate). The un-gated lane wrote precisely what the gated lane refused. UC-OB6 wired the gate into one composition; nothing forced the other to declare a decision, and TDD cannot write a test for a required field nobody knew was required. Also: "documented as the ECS-rollback asset" while its trigger was live — the deployed trigger state is the fact. ROUTED: **engineer.md** as **EXP-121** — control REQUIRED on the deps type (compiler catches an omitted control at composition), fail-safe CLOSED (absent config enforces the code constant, never "no filtering"), a committed **lane-coverage completeness gate** that fails the build on an UNDECLARED lane (each lane declares control + trigger; no continuously-triggered lane unfiltered; an inert lane ASSERTS why), a standby/rollback asset is LIVE until proven inert, and single-source control derivation (EXP-047). Adoption cost ~0: both mechanisms were built in the founding fix. THREE further gaps, each to its narrowest owner and NONE made an experiment: (1) **a red gate ran alongside a successful prod deploy of the code it rejected** → **cicd.md** (a fix, not a hypothesis) — push `5095849` went correctly RED on the app-CI *Bundle diff gate* for a stale `infra/assets/ingest-handler/handler.mjs`, but `infra.yml` declares no dependency on that lane so its job ran on to `SST deploy [prod]` and SUCCEEDED, shipping source-correct/artifact-stale/**deployed-code-wrong**; the gate worked, the pipeline TOPOLOGY did not. Rule: a deploy job must be UNREACHABLE while any integrity gate on the same sha is red; audit the deploy×gate matrix; a gate reading a SHIPPED ARTIFACT must never sit in a lane the deploy ignores; "green" must name which gates ran and which artifact each read. (2) **4th instance of the never-fired-capability class** (`OagFlightDiverted` = 0 of 5,300,655 prod events) → **solution-architect.md** as an EXTENSION of **EXP-120**, deliberately not a 9th row: delta 029 (2026-06-26) had ALREADY recorded the doubt about the coded diversion wire shape and said "re-verify when a real diversion is first captured" — never actioned, because prose in a delta has no mechanism to become work. New limb: an `unverified` mark or "re-verify when…" note must in the SAME act either become an executable provenance entry that goes RED the day the wire sends the value, OR be registered as an item whose acceptance IS the verification with a machine-checkable liveness predicate — never both-neither; slice gates sweep the deltas they build on. (3) **agents finished work they could not RECORD, 3× in two days** → **orchestrator.md**, and it is the orchestrator's failure: every ENTRY transition is orchestrator/flow-manager-owned, so an agent briefed onto an un-advanced item is asked to do unrecordable work (DEFECT-OAG-044's fix on trunk while the item said `reproducing`; UC-XC5 + the scope-declaration engineers; the prod-scope engineer with DEFECT-OAG-043 in `validating` where the defect graph has NO engineer edge, who correctly REFUSED to fabricate one — the v123 anti-impersonation rule working). Fixed by sequencing, NOT new edges (v7 edge regression tests still owed under IMP-027): **the dispatch and the state event are ONE act**; work found past an item's owning stage is routed by the orchestrator (`amended` or a new item); "no legal edge" is a reported process defect. Also orchestrator.md: **DEFECT-OAG-045 — an isolation worktree's auto-clean DESTROYED a finished engineer's commits** (~3h/218k tokens, unrecoverable; the project repo is a gitignored nested clone invisible to the changed-check; the near-repeat survived only on a scratchpad `git bundle`) whose ROOT CAUSE was the briefing "DO NOT PUSH" — meant as GitHub, but that clone's `origin` is the local shared repo and pushing there was the ONLY escape ⇒ name the remote in every push instruction, every brief carries a durable-ref requirement QUOTED in the return, and v80 isolation means an explicit `git worktree add` on the PROJECT repo, never the Agent tool's auto-cleaned `isolation: "worktree"`. RECORDED SO NEITHER ERASES THE OTHER: the isolation trial MEASURED WELL on its stated benefit (2 concurrent engineers, zero cross-contamination, both suites green at start, zero feature-code conflicts, ~9–15s setup via APFS copy-on-write, only append-only operational-file conflicts) vs FOUR contamination incidents in the shared tree the same day — the benefit is real, the storage model was unsafe. CONSTRAINT — the top time thief is a WAIT wearing the tester's name: by state `dev-validating` 22.17% / `registered` 20.29% / `deploying` 18.60%; by owner `queue` 36.78% / **tester 22.60%** / engineer 19.58% / cicd 18.60%. DEFECT-OAG-043 measured it cleanly: **63,518s booked to `tester`** of 68,720s GLT against **~2,400s of real tester effort** — ~96% was the item sitting in `validating` awaiting a human-sequenced push + CI cascade, whose proximate cause was ORCHESTRATOR OVER-GATING. Exploit = push on green per change; a hold needs a NAMED precondition on the HELD ITEM (3 of 4 holds this cycle failed that test). Subordinate = honour the §E/§F metering rules (coverage still 2.6% tokens / 0.2% durations of 1,220 events — DEFECT-OAG-043's own `validated` carried `tokens: 0` and no `duration_ms`). Elevate = IMP-027, still owed. ORCHESTRATOR FAILURES logged unsoftened (principle-failures/2026-07-31-orchestrator-overgated-then-pushed-a-meaningless-green.md): asserted a pipeline verdict never read (mis-reported the bundle-diff gate as not catching the staleness — having checked only the infra run; yesterday's governing-fact class VERBATIM on consecutive days = a pattern); pushed 20 batched commits on a green that was true and MEANINGLESS because no gate in that lane read the shipped artifact; over-gated (human corrected: push on green, don't accumulate); and the DO-NOT-PUSH briefing that cost a finished engineer's work. SCORES: **EXP-120 POSITIVE 1/3** (its output-liveness invariant found the 4th never-fired instance; its only-real-captures-confirm limb produced the 043 fix's real prod-capture pin) and extended; **EXP-115 ADOPTED + archived** (5 positive opportunities across 3 projects, standing practice in tester.md, boundary recorded) to free the cap slot for EXP-121 — registry 8 → 7 → **8, AT cap**; next retro must again retire one to open one. NO new global § — deliberately, this is one incident and the owners are all specific. CLOSE-STEP RESCUE (a SECOND live instance of the 045 class): fold-back was DEFERRED by an untracked `.claude/worktrees/` in the integration tree, which turned out to hold a REGISTERED isolation worktree with commit `e13d70d` unmerged into main or any instance branch — an engineer-authored principle-failure asking THIS retro to choose between two amendments, which reached it only by accident. Content preserved by hand, worktree retired, `.claude/worktrees/` gitignored (untracked already, so nothing is deleted anywhere — unlike yesterday's settings.local.json untracking). DECISION: **option 2** — the same-commit `.mmd` rule binds EVERY commit as the CHEAP MARKER (node/edge + `:::changed`, two-line diff), with the `edge-ledger` narrative allowed to land on the item's completing commit; exempting sub-steps would protect the mechanical signal only at boundaries, which is exactly the false-clean `impacted-tests` window DEFECT-OAG-044 documents (a new domain gate on the PRODUCTION publish path invisible at 2 intermediate shas) -> engineer.md. Open-items worktree fix (3) (the isolation bootstrap must not hold the only copy of anything) is the real fix and remains OWED. Verified: `wi-validate` clean (I1–I4), `wi-project` regenerated (257 items / 235 done). -->

<!-- v123 (GAP-CLOSING retro, OagEventSource 2026-07-30; §F8 retro-debt INCIDENT gate — DEFECT-OAG-041 + DEFECT-OAG-042 resolves + SLC-045/046 closes. On main v120, tree already byte-identical to main, so a clean bump; the session brief's "current v117" was stale — v117 was OAG's own contribution and main folded forward through v118/v119/v120 since). HEADLINE — the two defects are ONE failure mode, not two lessons: **we compared against a hand-typed guess at an external wire value, and being wrong produced SILENCE rather than an error.** DEFECT-041: OAG sends `Canceled`, the handler tested `=== 'Cancelled'` ⇒ **0 `OagFlightCancelled` in 5,308,984 dev + 5,210,600 prod events** — the type had NEVER fired; its docstring claimed the value was "corpus-confirmed"; the only 4 occurrences of the UK spelling in the entire repo were OUR OWN TEST EXPECTATIONS, so it passed a 1,525-test suite forever while never working on real data. DEFECT-042: `times.scheduled` was never read on the FlightStatus path at all ⇒ 78% of flights with no departure time, whole airlines invisible on departures boards. Two more of the class known+unexploded (`irregularOperationType='Recovery'`, `diversionType`, both in ZERO captures). WHY NO GATE CAUGHT IT: every gate consulted OUR DECLARATION of the wire contract, never the wire — TDD red→green proves the code agrees with the guess; the tester's live journey validation asks "does the journey work?", never "did every type we can emit actually emit?" (0 occurrences ≡ a quiet day); the architect reviews the seam's shape, not the vocabulary crossing it. Sharpest finding: the RULE ALREADY EXISTED (EXP-078 "verify external-interface facts at the authoritative SOURCE") but as PROSE it is unfalsifiable — so the fix is NOT another prose rule but making the claim EXECUTABLE. ONE experiment: **EXP-120** (engineer.md + tester.md + solution-architect.md + cicd.md) — generalise the two provenance ledgers the engineer built during the fixes into a standing gate: literal provenance asserted both directions, canonical-leaf source-path coverage (present in a real capture AND actually populates the leaf through the real read path — this limb would have failed 042 on day one), and OUTPUT LIVENESS over real traffic; closing the seed's three holes (fail on a MISSING declaration, only provably-real captures may confirm, committed corpus-refresh + live-probe targets). Target CFR + MTTR, 3 external-contract slices/defects, applies-to = any project consuming/emitting data across a wire it does not own. NEW GLOBAL RULES: **§17b** (a claim about a wire you do not own is executable, never prose) and **§11b.5/6/7** — the state-graph goes **v6 → v7** with (5) a VALIDATE-ONLY route (`ready --pulled_for_validation--> validating --validated--> done`) because verification-only UCs were forcing agents to SPOOF `built_green` as AGENT=engineer and `deployed` as AGENT=cicd (UC-XC4, citing UC-XC2/XC3 as precedent — the prohibition was dead letter because obeying it made the item uncloseable; the damage is phantom engineer/cicd GLT + never-failable stage exits), (6) an `amended` SELF-EDGE on every non-terminal flow state so an architecture gate that FALSIFIES an in-flight premise is recordable, and (7) `unblocked` symmetric with `blocked`. Also §14: no push-on-green clearance extends to infra-bearing paths where THE PUSH IS THE APPLY. CONSTRAINT — the honest answer is that ATTRIBUTION IS BROKEN in both directions, so `queue 36.5%` cannot be trusted: UC-OB1 spent ~256k s in `deploying` (booked to **cicd**) actually awaiting a human-supplied secret, while UC-OA2's 193,448s `blocked` span was 91.5% our own failure to re-check a permission set created 4.5h in (that ONE span = 24% of all recorded blocked time, laundered as `external`, which is why `external` reads a flattering 1.80%). Fix the measurement before exploiting: **IMP-027** (unblock predicate on the `blocked` event + a cycle sweep that auto-appends `unblocked`) + flow-manager.md re-checks every blocked item every cycle. POSITIVE, recorded deliberately: the per-slice architecture gate is the **highest-yield step in the loop** — it falsified UC-XE1's premise before a line was written (the item would have torn down a live consumer feed carrying 51–61k events/day) and caught a pending diff that would have destroyed a DLQ holding 8,287 messages; it works because it probes the RUNNING SYSTEM instead of the repo's beliefs about it (protected in solution-architect.md). ORCHESTRATOR FAILURES logged unsoftened (principle-failures/2026-07-30-orchestrator-asserted-authorised-and-pushed-without-establishing-the-governing-fact): reported a flights-per-day figure ~3x reality with an unestablished denominator (the forced investigation found DEFECT-OAG-043 — prod holds 116 airports, 34% out of scope); AUTHORISED a policy-forbidden cross-account publish path on engineering grounds without establishing permission (a G2 breach, caught only by the human, with a forbidden default left armed in a make target); told an engineer "push on green" on infra-bearing paths, nearly applying a held prod cutover; and dispatched 2 concurrent code-committers into ONE tree, causing 2 shared-file sweep collisions — non-adherence to the standing v80 worktree rule, now a CHECKED dispatch precondition. Scores: EXP-113 POSITIVE 2/3 (session ran on main's current process vs the v117 retro's 114-commit drift); **EXP-115 honest BOUNDARY, NOT counted positive** (it was in force and passing while two transformations had never worked — it validates the journey, not whether every output actually occurs); EXP-107 near-miss reinforced; EXP-101 no opportunity (the DEFECT graph has no dev/prod split — logged to open-items). Registry 7 → **8 active, AT cap** — next retro must retire one to open one. Verified: 107-test machinery suite green against the real v7 graph, `wi-validate` clean, `wi-project` regenerates; v7 edge regression tests queued in IMP-027 (the orchestrator does not write machinery test code). -->

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
# Current Process — v169

<!-- v139 (owner instruction, OagEventSource 2026-08-13, NO retro — a direct standing
instruction from the human owner, folded immediately rather than queued): every update to
the human is written FOR AN ADHD READER. The owner asked for it in terms, having read the
same content twice and found the compressed version "far more readable". New §0c states
the shape (lead with the action; one idea per line; bold the decision points and the
numbers; numbers in a table; cut the reasoning chain to its conclusion; say "don't know"
plainly) AND the hard limit that makes it safe: it is a change of FORM, NEVER of CONTENT.
Brevity may never drop a caveat, a bound, a correction, a risk or an unverified status —
those get SHORTER and BLUNTER, not omitted, because a stale premise relayed briefly is
still a stale premise (§17c, DEFECT-OAG-100). Cross-agent, so a version bump: it binds the
orchestrator and any agent whose output reaches the human. Target: human decision latency,
which is a gross-lead-time input under §5's wait-time taxonomy since the human gate is a
wait state. -->

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
- **STAGE 0** — Principles & metrics (§0a–§5a), incl. **§0c** reporting to the human (ADHD-readable) and **§0e** re-read your authorisations before escalating a block
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
(the board/doc-lag lapse). **The backstop is `make board-sweep`, never a loop over
`board-project` (DEFECT-OAG-099):** the loop form writes every item whether or not it needs
writing, so the rate limit lands on whatever is last — measured, 269 already-correct items
rewritten and 5 DONE items left showing Blocked, and later two TERMINAL items lagging SEVEN
DAYS against this very invariant. The sweep skips matches, spends the budget on terminal and
blocked lag FIRST, and on exhaustion NAMES the ids that did not land (exit 3 + a resume file).
An unnamed shortfall is how a "best effort, the next sweep reconciles" API failure becomes a
week of a false board — **quote the ids or it did not get logged.** Likewise user-facing docs (README / GitBook, via `documenter`)
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

## 0c. Reporting to the human — write for an ADHD reader [v139, owner instruction 2026-08-13]

**Every update to the human is written for an ADHD reader.** The owner asked for this
directly, having found it "far more readable", so it is a standing rule and not a
per-message style choice. It binds the **orchestrator** (which does nearly all
human-facing reporting) and any agent whose output reaches the human.

**The shape:**
- **Lead with the action.** What must the human DO, or NOT do, and by when. If there is
  a deadline or a "don't do X yet", it is the first line — never buried under context.
- **Short lines. One idea per line.** Bullets and small tables over paragraphs.
- **Bold the decision points and the numbers that matter.** A skimmer must be able to
  read only the bold and still act correctly.
- **Numbers in a table**, not in prose.
- **Cut the reasoning chain to its conclusion.** Keep the *fact*, drop the derivation
  unless the human needs it to decide. Detail belongs in the item file, which is where
  the audit trail lives anyway — the human does not have to carry it.
- **Say "don't know" plainly** rather than hedging over three clauses.

**What this rule does NOT license — it is a change of FORM, never of CONTENT:**
- **Never drop a caveat, a bound, or a correction to make a report shorter.** A stale
  premise relayed briefly is still a stale premise (§17c, `DEFECT-OAG-100`). An absence
  still carries its bound; a "not yet live" still leads.
- **Never soften a refusal, a risk, or a self-correction.** These get SHORTER and
  BLUNTER, not omitted. "I got this wrong" is one line, at the top.
- **Never hide that something is unverified.** One line: what is proven, what is not.

Rationale worth keeping: a long report is not a more honest report. Most of the length
in a bad update is the author reasoning in public. The item file is the durable record;
the human update is an interface to a decision. Target: human decision latency (a
gross-lead-time input — the human gate is a wait state under §5), and fewer
misreadings of the kind §17c catalogues.

## 0d. A PROJECT REPO CARRIES ITS OWN OPERATING MANUAL [v142, owner instruction 2026-08-18]

Owner instruction, verbatim: *"they need to understand how to use the work items, personas and
all the documentation we have to continue the work that is here and continue the ways of working
in order to not mess up what we are doing."*

**The gap this closes.** Each `work/<project>/` is deliberately its own git repo (§v50) so a
project can be lifted out and live standalone. But the METHOD lives in the parent agent-system
repo — the work-item machinery, the state graph, the gates, the persona/JTBD apparatus, this
file. So a lifted-out project arrives as hundreds of work items and a persona catalogue **with
no manual for either**, and the most likely first act of its next maintainer is to hand-edit a
`derived:` block or hand-write a status field that does not exist. **The artefacts shipped; the
ways of working did not.**

*Therefore, binding on every project:*
1. **Every project repo carries a four-file handover pack**, owned by the **documenter**:
   `HANDOVER.md` at the repo root (what to read, in what order, and what must not be broken),
   `docs/ways-of-working.md` (the flow, and which rules are HARD GATES versus defaults),
   `docs/work-items-guide.md` (authored vs DERIVED, `state = fold(events)`, the append path, and
   the real pitfalls), and `docs/personas-and-jobs.md` (how personas and jobs are USED, not a
   restatement of them).
2. **Templates live in `work/_TEMPLATE/`** and a new project starts with them. They carry
   placeholders that MUST be made true of the actual repo — a pack still describing the template
   is worse than none, because it reads as authoritative.
3. **It states its own limits.** `HANDOVER.md` must name the tooling that is NOT in the repo and
   what to ask for, and must say plainly that **a half-maintained event log is worse than an
   honestly abandoned one** — because everything downstream keeps reading as authoritative.
4. **Every pitfall listed is one that actually happened.** The pack's value is that its warnings
   are scars, not speculation.
5. **It is refreshed when the METHOD changes**, not when the product does. A product change is
   the README's business (§documenter standing duty); a new gate or a changed state graph is the
   pack's.
6. **Link, never duplicate.** Where a project has a `DOCS-LAYOUT.md`, that owns *where a document
   belongs*; the pack owns *how the work works*.

Target: **lead time** (a new maintainer or a fresh agent reaches first correct contribution
without re-deriving the method) and **CFR** (state corruption by a newcomer hand-editing derived
state is prevented rather than repaired). This is routed as **plain practice in the documenter
agent, with NO experiment row** — "the documenter produces a handover pack" is a
did-we-do-the-work measurement that cannot come back negative, which §25a/EXP-063 explicitly
disqualifies as an experiment.

## 0e. ON A BLOCK, RE-READ YOUR AUTHORISATIONS BEFORE YOU ESCALATE [v145, retro 2026-08-21]

**An escalation that names no checked authorisation is not an escalation — it is a stall.**

Before any agent hands a block to the human, it MUST re-read its own standing instructions and
**state in the escalation which authorisation it checked and why that authorisation does not cover
the blocked action.** No named check ⇒ the escalation is invalid and the agent keeps working.

**MEASURED COST OF NOT DOING THIS (2026-08-21, OagEventSource).** The `loop-gate` blocked because an
expired SSO token made an `awaiting_observation` predicate unrunnable. The orchestrator ran
`aws sso login --no-browser`, it waited on a device code nobody was there to type, and the
orchestrator **stopped and escalated** — while a standing instruction in its own context read *"AWS
SSO re-login authorized — run `aws sso login` myself when the token expires; don't ask the user."*

| | |
|---|---|
| loop blocked | **40,542 s = 11.26 h** |
| Ready depth throughout | **4** (WIP 1) |
| added directly to the constraint | **162,168 item-seconds** of pure `queue` dwell |
| actual fix, once attempted | **< 2 min** — the plain browser flow, 6 profiles, gate BLOCKED → OK with **no code change** |

The constraint is `queue` at **64.43%** of gross lead time. This stall fed the constraint directly and
every second of it was avoidable.

**THE FAILURE MODE, NAMED SO IT IS RECOGNISABLE.** A real observation (`--no-browser` hangs) → a
mechanism inferred from it (SSO cannot be done unattended) → **the inference recorded as though it
were the observation.** It was written into an item as fact, where the next agent would have read it
and escalated too. This is §17c's boundary-between-measured-and-inferred rule applied to an agent's
own capabilities rather than to product data.

**THREE INSTANCES IN ONE SESSION, which is why this is a rule and not a note:**
1. escalated an action it was explicitly authorised to take;
2. closed the same turn with *"Want me to pull that set and keep the loop running?"* — while a
   standing instruction says the loop is autonomous and flow-mechanics questions are never put to
   the human;
3. passed `make loop-gate ARGS=--no-observe` — an unsupported variable (`NO_OBSERVE=1`) — from a
   Makefile recipe it had **already read earlier in the same session**, so the gate silently ran in
   the wrong mode.

**THE ROOT CAUSE IS THAT NOTHING PROMPTS THE RE-READ.** The instruction was in context and simply not
consulted, because escalating is cheaper *in the moment* than re-reading — and the cost is paid
later, invisibly, in overnight queue dwell that no gate measures. This section is that prompt.

**WHAT THIS DOES NOT LICENSE.** It does not soften any gate. An unevaluable predicate MUST still
block the pull (state-graph v9, §17c.2) — the precedent is `DEF-ROC-004` sitting `blocked` **28.8
days** after both its blockers had gone. The remedy is for the agent to CLEAR the block, never for
the gate to stop reporting it. Nor does it license acting outside an authorisation: if the re-read
shows the action is genuinely not authorised, escalate — and now the escalation can say so.

**THREE THINGS AN AGENT MUST TRY BEFORE ESCALATING A BLOCK:**
1. **Re-read the standing authorisations** (its own instructions, `CLAUDE.md`, its agent file) and
   name the relevant one.
2. **Re-read the mechanism** it is invoking — the actual recipe, flag or target, not its memory of
   it. Variable and flag names are checked at the source, never recalled.
3. **Try the plain form before concluding a class is impossible.** One flag failing is evidence about
   that flag. Generalising from it to the mechanism is the inference error above.


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

### 5b.1 BEFORE you name the constraint, check the denominator is WAITING and not DECIDED [v146, retro 2026-08-21]

**A constraint named from a denominator you cannot move sends every subsequent step at the
wrong target — and step 5's "the constraint has NOT shifted" then reads as a failed change
instead of a mis-named constraint.**

Measured 2026-08-21 on OagEventSource. `queue` was the top GLT owner at **64.63%**, dominated
by `open` at **56.20%** (median 7.05 d, n=139, 0% backfill) — and every retro for weeks had
prescribed the same remedy from it: *deliver faster*. Of the 130 items in an intake state:

| | count | share |
|---|---|---|
| `defer_until` **in the future** — decided, parked | **85** | **65.4%** |
| `defer_until` past/today — genuinely due | 3 | 2.3% |
| **no** `defer_until` — genuinely undecided | 42 | 32.3% |

So **two thirds of the constraint's denominator was already decided** and waiting on a *date*,
not on capacity. Actionable intake was **45, not 130**.

**The gate and the metric disagreed, and the GATE was right.** `defer_until` appears 9 times in
`work-items.py` and every one is inside a `loop-gate` limb: the gate blocks on *age without a
decision* (count-independent) and an **expired** defer re-blocks by design. The metrics fold does
not know the field exists.

**RULE — at IDENTIFY, before recording the constraint:**
1. **Partition the top owner's dwell into DECIDED-and-parked vs UNDECIDED-and-waiting** (a dated
   defer in the future is decided). Name the constraint from the **undecided** share.
2. **Report the parked share anyway**, with its age and next expiry. It is never netted off and
   never hidden — parking is a decision on the record, not a disappearance, and an expired defer
   already re-blocks the pull.
3. **If parked inventory GROWS while completed items do not, that is the finding** — deferral has
   become the way work stops being counted. Attack that, not throughput.
4. This is a rule about **honest denominators, not about smaller numbers.** Re-classifying to
   make a metric look better is the failure it exists to prevent; the partition must make the
   constraint *actionable*, and if it does not change which owner is top, say so and move on.

Owed: `IMP-031` builds the partition into the fold. Until it lands, do this by hand at each
retro — the frontmatter is right there.

### 5b.2 A MOVEMENT in the constraint is not a finding until you state the loop's UPTIME for the interval [v149, retro 2026-08-24]

**Gross lead time is WALL-CLOCK. `/loop-run` is specified as a CONTINUOUS background process
(§F9). Calendar time and system latency are therefore the same quantity only WHILE THE LOOP IS
RUNNING — and nothing records whether it was.** So the constraint's headline number is
bidirectionally sensitive to loop uptime, and two consecutive retros have now reasoned from it in
opposite directions without noticing.

Measured 2026-08-24 on OagEventSource. `queue` median/item, the count-independent figure §5b.1
tells you to read:

| close | queue median/item | what the retro concluded |
|---|---|---|
| v146 | 246,033 s | constraint unmoved |
| v146 (late) | 161,635 s | — |
| **v147** | **119,684 s** | *"−51%, the first sustained move in this constraint"* |
| **v149 (now)** | **303,881 s** | **+154%**, n unchanged at 218 |

**The loop was STOPPED for 60.9 h (2.54 d) at the owner's request between those two closes. That
downtime alone is 72% of the current median.** `loop-gate` measured the same interval from the
other side: two items 47.0 h in `prod-validating`, one 2.7 d idle in `reproducing`, five
`scheduled` open-items 2.6 d idle — all of it correctly recorded as dwell, none of it latency the
system could have avoided.

So the +154% is **not** a process regression, and v147's −51% was **not** necessarily a process
win: both are partly a measurement of how many hours somebody happened to be running the loop.
This is the same failure class as §5b.1 — *a control that reads confidently while measuring
something other than what it names* — arriving a second time in the measurement layer.

**RULE — at IDENTIFY, alongside §5b.1's partition:**
1. **State the loop's uptime for the interval since the last retro close** before quoting any
   movement in the constraint. A movement quoted without it is not a finding.
2. **Attribute dwell that accrued while the loop was stopped separately.** It is real elapsed
   time and is never deleted — but it is *calendar*, not latency, and no exploit/subordinate/
   elevate move can reduce it.
3. **Never score a prior change's anticipated-vs-observed effect (step 5) across an interval with
   material downtime** without saying so. A change scored across a stop is scored against noise —
   and "the constraint did not shift" then reads as a failed change instead of an unmeasured one.
4. **If uptime is unknown, say UNKNOWN.** The honest reading of an unmeasured interval is that
   the movement is unattributable — not that it is zero, and not that it is real.

This cuts both ways deliberately: it forbids claiming a win as much as it forbids reporting a
regression. Symmetry is the point — the confound has no preferred direction.

Owed: fold loop-uptime into `IMP-031` alongside the decided/waiting partition — both are the same
job (make the fold's denominator mean what it says). `EXP-OAG-005` scores it.

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
5. **Verification-only UCs take the VALIDATE-ONLY route — never spoof another role's
   event [v123, state-graph v7].** A UC whose entire scope is asserting behaviour that is
   ALREADY built and deployed goes `ready --pulled_for_validation(orchestrator|flow-manager)-->
   validating --validated(tester)--> done` (`rejected` → `reworking` as usual). Before v7 the
   only route to `done` ran through `building` + `deploying`, so UC-XC4 was closed by the
   tester appending `built_green` AS `AGENT=engineer` and `deployed` AS `AGENT=cicd` as
   declared no-ops — and it cited UC-XC2/XC3 as precedent, i.e. the no-spoofing prohibition
   had become **dead letter because obeying it made the item uncloseable**. The damage is
   measurement: phantom engineer/cicd gross-lead-time nobody spent, plus fake
   never-failable `building`/`deploying` exits in quality-by-stage. Rule: use the route; if
   the route you need does not exist, SAY SO rather than impersonating another agent.
6. **Record a definition correction as an EVENT, not a prose edit [v123, state-graph v7].**
   Every non-terminal flow state has an `amended` self-edge (agents: solution-architect,
   product, flow-manager, orchestrator) for a correction to an already-pulled item —
   above all when an architecture gate NARROWS or **FALSIFIES** its premise. On 2026-07-30
   the gate falsified UC-XE1's premise (the item would have had the engineer tear down a
   LIVE consumer feed carrying 51–61k events/day) and that — the highest-value event in the
   loop — was invisible to `fold(events)` because the only way to record it was editing the
   Definition prose. The self-edge is time-preserving, so it never distorts GLT.
7. **`unblocked` is symmetric with `blocked` [v123]** — both carry
   `[flow-manager, orchestrator]`: whoever holds the evidence that the external condition
   cleared records it. And per flow-manager.md every in-flight `blocked` item is
   **re-evaluated every cycle** against a machine-checkable unblock predicate where one is
   expressible. An `external` block is a decaying hypothesis, not a fact: UC-OA2 sat blocked
   two days on a permission set created 4.5h after the block, and that single un-noticed
   span was 24% of all recorded blocked time — laundered as `external` wait when it was our
   own latency (IMP-027).

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

**v125 — the FOURTH recurrence, and it says the mechanism was aimed at the wrong MOMENT.**
Five OAG capabilities read `done`/`validated` while never once working on real data (§17c).
That is precisely this gate's target class, and this gate could not fire — because it runs
**at slice close**, when the capability has not yet had any opportunity to occur. The
discriminating evidence (a real event of that type in the store) does not exist until days
of real traffic later, so a close-time check against a success measure is structurally
blind to it. **The check must run on a CADENCE over real data, not once at the boundary.**
So the definition of done gains a third obligation and the state graph gains a state:
3. **Observation-gated done [§17c.1].** For any item whose deliverable is an event type, a
   canonical field, a routing decision or any other output crossing a boundary, `validated`
   requires an **observation pointer to a real record the system did not author** (§17a).
   Where the capability has not been observed — including because its trigger is genuinely
   rare — the item does **NOT** become `done`: it enters **`awaiting_observation`**, a
   non-terminal state carrying a machine-checkable liveness predicate, re-checked every cycle
   exactly as `blocked` is, and exiting via `validated` when the observation lands (or
   `rejected` when the observation falsifies the capability). Rare branches are judged
   statistically — for a declared base rate `p` (with a sourced denominator) and exposure `N`,
   zero observations is RED when `P(0 | p, N) < α` — never by a binary someone invents at
   validation time.
This is the honest state the five items should have occupied: shipped, green, and unproven.
Recording them as `done` is what made CFR and rework read clean while nothing worked, so
this is a change to the ARTIFACT that could not detect the failure, as required. Note the
multi-audience DoD (test + runbook + marketing + delivery-tree, v89) did not help either,
and could not: **all four audiences document INTENT** — the runbook describes error pathways
we imagined, marketing the capability we believe we shipped, the delivery tree the item we
closed. None of the four is an observation. Observation is the missing fifth audience.

**LANDED 2026-08-01 (state-graph v9) — the hand-hold is gone.** `awaiting_observation` was the
THIRD v125 remedy that existed only as prose (with `make wire-provenance`, which did not
exist, and the corpus provenance markers no gate read): v125's changelog listed it as a
COMPLETED change and it had never been added, while this section carried an interim
"held out of `done` by hand" instruction. It now EXISTS and its mechanism has been observed
firing (§17c.2). Concretely:
- **`awaiting_observation`** on the `use-case` and `defect` graphs, non-terminal, owner
  `external`, queue `waiting`. Entered by the **tester** with
  `make wi-append … EVENT=not_yet_observed AGENT=tester OBSERVE=make:<target>` from any
  validation state (`dev-validating`/`prod-validating`/`validating`); exits `validated` →
  `done`/`resolved` or `rejected` → `reworking`/`fixing`. NOT on `open-item` (no deployable
  capability, no observation surface).
- **The predicate is REQUIRED, not optional**: `append` REFUSES the transition without
  `OBSERVE=`, because a reason in `note:` can never come back negative (§17c Layer 2). It is a
  committed re-runnable target in `work/<project>/Makefile` that exits 0 and prints
  `OBSERVATION: observed` / `OBSERVATION: not-yet`; anything else is a BROKEN predicate.
- **Re-checked every cycle** by `make loop-gate` **check 5**: observed ⇒ BLOCKS (a tester
  dispatch is now actionable), not-yet ⇒ ADVISORY (real, outstanding, never "satisfied"),
  broken/absent ⇒ BLOCKS. `wi-validate` **I6** catches a hand-edited predicate-less park.
- **It can never fold into `done`**: an `awaiting_observation` child holds its parent
  aggregate out of `done` (the parent reads `awaiting_observation`).
The tester therefore no longer reports `not-yet-observed` in prose and no item is held out of
`done` by hand — it is a state, with a predicate, on a cadence. Contract:
`process/machinery/CONTRACT.md`; the still-owed IMP-011 CORE-job invariant keeps the number
**I5**, which is reserved and NOT reused. [EXP-122]

## 12d-bis. Definition of Done includes the CODE'S DISPOSITION [v127]
Human ruling: *"a basic definition of done should include merging code into main and deleting
the branch."* Adopted. The v89 multi-audience DoD (test + runbook + marketing + delivery-tree)
and §17c.1's observation pointer all describe the *capability*; none of them asks where the
**code** ended up. So work could be complete, validated, and still be sitting somewhere.

Found on OagEventSource 2026-08-02: **three feature branches on the remote, unmerged, 10–13
days old, with NO pull request at all** — `feat/onboard-ids-pullbridge-consumer-surface-c` (2
commits), `fix/private-api-redeploy-on-policy-change` (1), `fix/surface-c-per-flight-route-event-shape`
(2). No PR means no board item, no queue entry, no gate: **invisible inventory**, strictly
worse than an open PR, which is at least visible somewhere. Separately, four Dependabot
security PRs sat open **ten days** while the advisories they fixed were live — the exposure
was never a proposal gap, it was an enforcement gap.

*Therefore:* an item is not `done` while code that implements it is unmerged. Concretely —
**(1)** the change is on `main` (this is a trunk-based system: engineers push to `main`, so
normally there is no branch at all, and a long-lived branch is itself the smell); **(2)** any
branch created for it is **deleted after merge**; **(3)** no PR it owns is left open; **(4)**
an inbound PR nobody has ruled on (a bot's dependency bump) is **inventory that ages** and
belongs in a queue, not in a tab.
**Never delete an unmerged branch to satisfy this** — it destroys work, which cost a finished
engineer's day at v124. An unmerged orphan is REGISTERED and its content adjudicated (merge,
or explicitly abandon with a reason), never swept.
Mechanised, not documented: `make loop-gate` reports orphaned remote branches and open-PR age
as advisories (§F8a — a gate blocks only on harm that stopping relieves; stale inventory does
not become safer by halting the loop). Target: gross lead time (work stops completing
invisibly) + CFR (a ten-day-old unapplied security fix is an exposure, and was).

## F2c. A contended local container is per-DISPATCH, and its identity is DERIVED [v137, EXP-133]
§F2b says schedule by RESOURCE CLASS. This is the first named resource. A shared local
container (DynamoDB Local, Azurite, any emulator) is **mutable shared state with a single
name**, and a hardcoded `container_name` makes per-engineer isolation impossible however
many ports you offer:

- A second `docker compose up -d` with a different port **recreates the one container** on
  the new port and yanks the endpoint from an in-flight suite. Its tests fail with a
  connection error **indistinguishable from a code failure** — a phantom that points an
  engineer at its own correct code.
- An ownership guard that checks only *is this container ours* cannot answer *is it mine*,
  so it green-lights one engineer onto another's database.

*Therefore:* derive container identity, never hardcode it. Name and compose project are
derived from one dispatch id together with the port, so they cannot diverge; the ownership
guard compares against the derived name; and the legacy default is preserved so existing
invocations are byte-identical. `make ddb-local-mine DISPATCH=<id>` is the entry point.

**Derived, not hand-picked** — a hand-picked port is the same class of decision as a
hand-picked threshold: it looks fine and collides silently. Two dispatches with different
ids cannot collide, and a re-dispatch idempotently reuses its own container.

**The signal that this mechanism was missing:** two engineers independently discovered the
same `OAG_DDB_PORT` workaround in one session. **A workaround that two agents find
separately is a missing mechanism, not a tip** — write it down as machinery or it will be
rediscovered indefinitely.

Note what was NOT the problem: test DATA was already isolated by per-run table namespacing.
Check where the sharing actually bites before isolating the thing that merely looks shared.

Target: CFR (a phantom connection failure is a false defect signal) + lead time (removed
re-dispatches). **Watch for the inverse failure** — if engineers keep hand-overriding the
port because the helper is more friction than the workaround, revert rather than re-prescribe.

## F8b. The cheap parts-check, and when it is NOT allowed [v136, EXP-132]
§F8 never batches an incident; step 5a says a stable constraint should not pay
full-retro overhead. Those contradicted, measurably: v135 closed at 13:17:51Z and a
defect resolve re-armed the gate at 13:23:43Z on an unchanged constraint. Owner ruling
(2026-08-07): parts-check per resolve, full retro on a SHIFT.

*Therefore:* `make parts-check PROJECT=<p>` drains the **INCIDENT** arm of retro debt
**iff the constraint is provably unchanged**. It escalates (exit 2, full `/retro` due)
in every other case:

| case | why it escalates |
|---|---|
| constraint **SHIFTED** | real learning; a retro must walk exploit/subordinate/elevate. The marker is left UNTOUCHED — an escalation may never drain debt |
| constraint **UNREADABLE** | an instrument that cannot be read is not evidence of stability |
| **no prior record** | stability cannot be established from nothing |
| **routine debt ≥ threshold** | parts-check drains the incident arm only; a slice-close backlog is a separate signal |

**This is not a softening of §F8, and the difference is the point.** The cheap path is
gated on a machine-checked fact and **the machinery decides, not the orchestrator** — so
the expensive path remains mandatory in exactly the case a retro exists for: where time
goes has changed. Compare §17e — a control the orchestrator may waive at its own
discretion has already stopped being a control. `retro-mark` records the constraint too,
so the two paths cannot drift apart.

The constraint reader inherits §17f.6: **an owner or state whose backfill share exceeds
50% is never named the constraint**, or parts-check could confirm a phantom one.

Target: lead time for changes (defect throughput stops being consumed by retro
overhead). Anticipated: more defects resolved per session at unchanged CFR. **Watch for
the inverse failure** — if a constraint shift is ever missed, or CFR/MTTR worsen because
real learning went uncaptured, this reverts.

## 12d.1 Aged inventory blocks on the DECISION, never on the depth [v135, EXP-131]
`open` has been the top contributor to gross lead time for **three consecutive retros**
(39.73% → 42.09% → **42.18%**, median **3.8d/item**, n=54, **0% backfill**). The cause is
structural: every gate, census, probe and agent-read MANUFACTURES a finding, the loop pulls
only from `ready`, and nothing promotes or retires an open item. Discovery outruns retirement
by construction — 36 of 38 all-time defect arrivals are inside the trailing 30 days.

*Therefore:* `make loop-gate` BLOCKS when a **BACKLOG-kind** queue holds an item older than
`--max-backlog-age-days` (default 7) that carries **no in-date decision**. The decision is a
plain frontmatter scalar, `defer_until: YYYY-MM-DD` — no event, no state-graph edge, because a
defer is a scheduling decision, not a transition, and modelling it as an event would wrongly
imply the item had moved.

**This REFINES §F8a; it does not overturn it.** "A gate blocks only on harm that stopping
relieves" stays true of DEPTH and of mere staleness — which is exactly why check 3 (queue
over cap) remains ADVISORY, and why blocking on backlog depth is still banned as inverting the
constraint. The distinction that earns the block: **this gate is cleared by a DECISION, not by
delivery.** One line, seconds, always available — so the loop is never held hostage to
throughput. What is withheld is only the right to pull MORE work while undated inventory ages
invisibly.

Three properties are load-bearing; changing any one turns the gate into the harm it prevents:
1. **The cheapest path to green is a dated defer, NEVER a close.** A gate whose easiest remedy
   were "close it" would manufacture pressure to close real findings — banned by §F8a. The
   remedy text must keep saying so.
2. **A defer EXPIRES and re-blocks.** The EXP-130 stale-blocker lesson applied to inventory: a
   decision has a shelf life, and "defer" must not become "bury". Do not extend reflexively —
   re-decide.
3. **An unparseable date FAILS CLOSED** and does not count as a decision, so a typo can never
   silence the gate.

Target: lead time for changes (median) + the `open` GLT share. Anticipated: undated items are
either scheduled or explicitly dated, `open`'s median/item falls, median lead time falls,
deployment frequency is unaffected. **Watch for the inverse failure** — if CFR rises or real
findings start being closed rather than deferred, the gate is producing the pressure it exists
to prevent and must be reverted, not re-tuned. The 7d default is a guess, like `--stale-hours`
before it, and is the first knob to tune from the measured age distribution.

## 12d.2 A park declares the item that would END it — and if we own that item, it is not an external wait [v150, EXP-ROC-004]

`external` has been ROC's top gross-lead-time owner for **five consecutive retros** (35.40% this
cycle, median 7.19 d/item, n=15, 0.00% backfill). EXP-143's probes — adopted v148 — re-check every
park each cycle and they work: two false parks cleared on their first run, one blocked 27.3 days.
But a probe answers only *"is this still blocked?"*, and for two of ROC's parks the answer is
**yes, correctly, and for ever**: `DEF-ROC-035` (7.2 d) and `DEF-ROC-056` (4.9 d) wait on telemetry
app-settings that are absent because nobody has wired a sink — and the item that wires one,
`DEF-ROC-041`, states in its own Definition *"Ownership: ours … Not blocked externally"*. It had sat
in `reported`, undecided, for **7.2 days**: longer than the parks it would end.

Worse, the aging gate was used against itself. Check 4 (§12d.1, EXP-131) blocked this cycle on eight
undated aged items and forced six real re-decisions — **and one of the six deferred `DEF-ROC-041`.**
The gate demands *a* decision and cannot distinguish a sound defer from one that parks the remedy for
the project's own named constraint. §12d.3 already advises *"if the wait is unbounded, arm it, force
the trigger, or judge it statistically"* — and that advice has printed on a `loop-gate` line every
cycle for 7.2 days without effect, which is §17c Layer 2 exactly: *a remedy written as prose
reproduces the defect it was written for.*

*Therefore:* an event entering a `_PARKED_STATES` state (`blocked`, `awaiting_observation`) requires
**`REMEDY=<value>`**, persisted as the frontmatter scalar `park_remedy:`, with two legal forms and no
third — an **`<ITEM-ID>`** whose delivery would end the park, or the explicit claim
**`none-inside-project`**. `append` REFUSES the transition without it or with an id that does not
resolve (fail closed, copying §17c.2 verbatim); `validate` catches a hand-edit; and **`loop-gate`
BLOCKS when a parked item's `park_remedy:` names an item aging in a BACKLOG-kind queue with no
in-date `defer_until`** — because that is not an external wait, it is our own queue wearing
`external`'s name. A park chain (`park_remedy:` naming another parked item) is ADVISORY, never
blocking: chains are legitimate and blocking on them re-inverts the constraint.

**Three guards, and they are the load-bearing part.** (1) The reported `external` share is SPLIT into
*remedy-inside-project* and *remedy-outside-project* and the split is **never netted off** — total
dwell is conserved, attribution moves, same rule as `IMP-031` AC-031.7. (2) The limb binds the
**existing** 15 parked items by migration, not just future ones; a rule that binds only new parks
leaves the entire measured 35.40% precisely where it is (v144's `DEF-ROC-004`, blocked 28.8 d after
both its blockers had gone, is what that mistake looks like). (3) `none-inside-project` is one
keystroke cheaper than thinking, so it is a CLAIM the next retro re-reads, and the moment it becomes
the common value this rule has become the ceremony it replaced.

Built by **`IMP-033`**; scored as **`EXP-ROC-004`** against gross lead time. Principle-failure:
`2026-08-24-a-park-whose-remedy-we-own-is-booked-as-external.md`.


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
  **And no standing "push on green" clearance extends to these paths [v123].** For an
  infra-bearing path CI auto-applies, so **the push IS the apply** — it is a deploy decision,
  not a code decision. The orchestrator's blanket push-on-green authorisation (a trunk-based
  rule about ordinary code) must NOT be issued for such a change, and an agent must not accept
  it as overriding this gate: telling an engineer to push a HELD infra cutover on 2026-07-30
  nearly applied it to prod. Rationale:
  `principle-failures/2026-07-30-orchestrator-asserted-authorised-and-pushed-without-establishing-the-governing-fact`.
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
- **Parallel-committer isolation = worktree — FOR THE PARENT-REPO LANE ONLY.** When 2+
  agents COMMIT concurrently on one repo, a file boundary is not enough — `git add` over a
  shared index sweeps a co-worker's staged files into your commit. Dispatch such committers
  in git WORKTREE isolation (`git worktree add`, private index). The ONE §14 exception to
  the no-worktree default, orthogonal to §40 flag-isolation; single-committer cycles keep
  the plain trunk tree. [EXP-097]
- **TWO LANES, and a parent-repo worktree contains only ONE of them (DEFECT-OAG-076).**
  Because the parent gitignores each project's own nested repo, `work/<project>/**` is
  **never checked out in a parent-repo worktree**. So worktree isolation applies to the
  **parent-repo** lane (`.claude/`, `process/`, `Makefile`, `CLAUDE.md` — committing in the
  worktree is correct and safe) and **never** to the **project-repo** lane (edit at the real
  shared path; commit via `make commit-isolated`). Dispatched onto a project-repo item with
  worktree isolation, an agent finds nothing to edit and no legal way to commit; the only
  move left is to clone the project repo inside its worktree and commit there, and the
  auto-clean then takes those objects with it. That is not hypothetical: `DEFECT-OAG-072`
  was delivered complete and destroyed exactly this way (`git cat-file -t fb080d9` →
  `fatal: Not a valid object name`), while the correct tool — `isolated-commit.js`, which
  solves the very hazard worktree isolation was reached for — had landed three hours
  earlier. Mechanised, because the prose form of this rule (v124) was already written and
  was broken under load: every item declares `lane:` in its authored frontmatter;
  **`make dispatch-check ID=<item> ISOLATION=worktree`** must pass before such a dispatch
  (undeclared fails CLOSED); and **no cleanup path deletes a directory without
  `make worktree-guard`**, which refuses when a nested repo holds commits that exist in no
  surviving repo — replacing the "is the worktree *unchanged*?" test, which was false
  precisely because the change lived where it could not look. Never remove an agent worktree
  by hand: `make worktree-reap DIR=--all [RESCUE_TO=<dir>]`.
- **The within-tree commit form is `make commit-isolated`, and BOTH earlier remedies are
  broken (DEFECT-OAG-058, six instances).** `git add -- <mine>` followed by `git commit`
  commits the WHOLE SHARED INDEX — `git add` takes a pathspec, **`git commit` does not** —
  which published 102 files including nine belonging to two other agents mid-task and, on a
  trunk where the push IS the apply, applied their untested code (b477f08). The remedy
  prescribed six times in response, a pathspec passed to `git commit`, commits from the
  **WORKING TREE**, so it sweeps whatever a concurrent agent has SAVED under those paths
  mid-edit (33 lines, observed live) — it narrows the path set without isolating the
  CONTENT. The race-free form takes content from an index nobody else can write:
  `make commit-isolated REPO=<repo> MSG="…" PATHS="<yours>"`
  (`.claude/tools/isolated-commit.js`) — private `GIT_INDEX_FILE` seeded from HEAD, only
  the declared paths added, a declared-subset assertion, `commit-tree`, a compare-and-swap
  ref update so a concurrent commit is retried rather than lost, and a resync of the shared
  index for YOUR paths only (a stale shared-index entry silently REVERTS your file at the
  next whole-index commit). Its self-tests are differential — each asserts the pre-fix form
  publishing the foreign file — and are wired into `make test-tools`. This is a MECHANISM,
  not advice: discipline failed six times and the sixth failure was the advice itself.
- **Never `git stash` a shared tree** — stash-all hides OTHER agents' uncommitted work.
  Commit with `make commit-isolated`; `git pull --rebase --autostash` for just your own
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

**17b. A claim about a wire you do not own is an EXECUTABLE assertion, never prose
[v123, EXP-120].** For data crossing a boundary the repo does not define (third-party feed,
partner API, another team's bus/event contract), every literal compared and every field path
read is an EXTERNAL fact, and **being wrong about one is SILENT** — a branch that never runs,
a field never read. Nothing that consults only in-repo artifacts can see it, because the
discriminating fact lives outside the repo: on 2026-07-30 a handler tested `=== 'Cancelled'`
while OAG sends `Canceled`, so its event type fired **0 times in 5,308,984 events** while a
1,525-test suite stayed green (the only occurrences of the wrong spelling in the whole repo
were **our own test expectations**), and separately a canonical leaf's source path was never
read at all (78% of records missing the field). Note the belief was ALREADY in the process
(EXP-078 "verify external-interface facts at the authoritative source") — as prose it is
unfalsifiable, since a docstring claiming verification is indistinguishable from a real one.
So, cross-agent: **solution-architect** names the seam's wire-contract source of truth (a real
captured payload set or a live probe — never a vendor doc, a peer service's model, or a
docstring) and hands over the vocabulary marked confirmed/unverified; **engineer** turns that
into a provenance ledger asserted BOTH directions (confirmed ⇒ present in a real capture AND
actually populates the leaf through the real read path; unverified ⇒ still absent) that also
fails on a MISSING declaration; **tester** asserts output LIVENESS over real traffic (a
zero-occurrence type/branch is red until explained, not silence); **cicd** runs it in the
push gate and owns the committed corpus-refresh + live-probe targets, because an offline
corpus can only ever contain what we already captured. An unmapped inbound value RAISES
(deduped, structured, raw value preserved) — never a silent no-op. Target: CFR, MTTR.

**17c. NOTHING IS ESTABLISHED UNTIL IT HAS BEEN OBSERVED IN A STATE THAT COULD HAVE COME
BACK NEGATIVE [v125, EXP-122].** This is the root cause of a class that has now produced
FIVE capabilities reading `done`/`validated` while never once working on real data, and it
is the reason §17b — written one day earlier against the same class — did not help.

*The evidence.* `OagFlightCancelled`: 0 of 10,519,584 events. `departure.scheduledTimeUtc`:
78% null, its source path never read though **all 109 real captures carry it**.
`irregularOperationType='Recovery'`: 0 captures, so `recovery` has always been `false`.
`OagFlightDiverted`: 0 of 5,300,655. `deriveAirports()`: derives `metadata.airports` from
departure+arrival ONLY, so a diversion airport can never enter the routing key every
consumer fan-out rule filters on. All five passed a 1,804-case green suite. **None was
found by a test; the first four were found by ad-hoc prod queries run only because a human
challenged a reported number, and the fifth by reading code.**

*Two layers, and the second explains the recurrence.*
- **Layer 1 — we only ever ran ONE direction.** Every test is `code → expectation` over
  inputs WE authored, which is an EXISTENCE proof ("there is an example where this works").
  Every failure above is a UNIVERSAL property over inputs reality authors and outputs we
  declare. Three questions were therefore never asked, each an inverse of a test we do run:
  **D1 code→data liveness** (for every output we can emit, has reality ever produced it?),
  **D2 data→code coverage** (for every field reality sends, does our code read it and
  populate a leaf?), **D3 gate→artifact identity** (did the gate that passed read the bytes
  we shipped?). Note what this is NOT: it is not a lack of real data. We hold ~10.5M real
  prod events and 109 real captures, and `times.scheduled` was in every one of them. Reality
  was already in the repo, unexamined. The missing thing was an invariant quantified OVER it.
- **Layer 2 — the load-bearing claim lives in prose, where it cannot be false.** Every
  instance of this class is a claim asserted in a docstring or comment rather than in code:
  a handler docstring claiming a literal was "corpus-confirmed" (it was not); a provenance
  ledger whose docstring says it "sweeps the whole **real** capture corpus" while it
  recursively walks every `.json` including hand-authored `synthetic/`, derived fixtures,
  vendor doc samples and a config dump; a prod smoke whose safety comment claimed "no real
  consumer is fanned out to" (false, and it had ROTTED — two runs reached an external
  consumer's live prod DLQ); a scope declaration citing a **1,160,377-row prod scan that
  exists only as a docstring, with no committed script** — the load-bearing measurement is
  unreproducible; an architecture delta saying "re-verify when a real diversion is first
  captured", never actioned. **And the proof of the layer: §17b's own remedy is prose. `make
  wire-provenance` DOES NOT EXIST**, the corpus's `_capture`/`_provenance` markers sit on 115
  files that **no gate reads**, the stricter directory filter needed to fix the sweep already
  exists in its sibling ledger and was never back-ported, and `diversionType` carries no
  declaration at all. A remedy written as prose reproduces the defect it was written for.

*Therefore, cross-agent and binding:*
1. **A capability is not `done` until it has been OBSERVED working on data the system did not
   author.** `validated` requires an observation pointer — a real record id (stream + event)
   or a provenance-stamped capture — produced by real input (§17a). An input we injected is a
   diagnostic, never a validation. If it has not been observed, the honest state is
   `awaiting_observation`, NOT `done` (§12d).
2. **A gate is not a gate until it has been observed going RED.** Every new gate/control
   ships with a **proof-of-fire**: a deliberately seeded violation, demonstrated once, that
   makes it fail, recorded on the item. This is the cheapest available check and it would
   have caught all of: a `make` target that does not exist, a gate red on trunk for ~20 days
   because it runs in no workflow, and a gate that runs in a lane no deploy depends on.
3. **A control asserted in a comment is not a control**, and an environmental premise
   ("no real consumer exists yet") ROTS — it must be a code guard with an owner, or a
   registered item that re-checks it when the environment changes.
4. **A number is not established without a committed, re-runnable query behind it.** A
   load-bearing measurement quoted in prose is an assumption wearing a figure's clothes
   (this is the v123 governing-fact rule, applied to our own artifacts).
5. **This rule binds THIS document.** A retro may not discharge a finding of this class with
   prose alone: each fix is either executable now, or a registered item with an owner and an
   acceptance that is the gate firing. Prose here is a plan, never a control.
6. **BOTH park states carry a machine-checkable predicate, not just one [v144, EXP-143,
   ROC DEF-ROC-073/004].** The machinery itself enumerates exactly two parks —
   `_PARKED_STATES = {"blocked", "awaiting_observation"}` — and only the second was ever
   required to prove it could end. `append` REFUSES `not_yet_observed` without
   `OBSERVE=make:<target>` on the stated grounds that *"a park whose reason is only a `note:`
   can never come back negative and therefore never ends"* (Layer 2). **That reasoning is
   not specific to observation, and `blocked` was left exempt from it** — so `blocked` takes
   a prose note and nothing else, while holding **46.3% of ROC's gross lead time at a median
   19.3 days per item**, the largest single cost in that project. Therefore: **`EVENT=blocked`
   requires `PROBE=make:<target>`**, a committed re-runnable target that prints
   `BLOCKER: standing` (ran, honestly still blocked — advisory) or `BLOCKER: cleared`
   (the blocker is gone — `loop-gate` BLOCKS, an `unblocked` dispatch is now actionable), with
   anything else — missing target, crash, both sentinels, non-zero exit, timeout — treated as
   a BROKEN predicate that blocks, exactly as §17c.2 already treats an unrunnable observation
   probe. **Note this limb is limb 3 MECHANISED, and why it had to be:** limb 3 already said an
   environmental premise ROTS and needs "a registered item that re-checks it when the
   environment changes". `DEF-ROC-004` **was** that registered item — and nothing re-checked
   it, so it sat `blocked` for **28.8 days after both of its blockers had already gone**
   (its subscription was created the same day it was raised). Limb 3's remedy was prose, and
   Layer 2's own sentence — *"a remedy written as prose reproduces the defect it was written
   for"* — came true against the rule that wrote it. The generalising claim: **an
   externally-blocked item is not blocked, it is UNVERIFIED-blocked, until something that can
   fail says so.** A blocker is a claim about the world, and the world changes without telling us.
   **STATUS — ENFORCED since v145 (`OI-ROC-005` landed 2026-08-20).** `wi-append` REFUSES
   `EVENT=blocked` without `PROBE=`, refuses a malformed spec before writing, `loop-gate` re-runs
   every blocked item's probe on every invocation (`blocked-park`: `cleared` blocks, `standing` is
   advisory, anything else blocks as BROKEN), and `wi-validate` **I7** catches a hand-edited park —
   the same four-way treatment §17c.2 already gave observation, sharing one runner so the two park
   states cannot drift apart again. It was PROSE for four hours and labelled as such; the label is
   what made it get built. **NON-VACUITY, measured not asserted:** the seven parked ROC items were
   migrated in the same change and TWO were falsified on the probes' first cycle — `DEF-ROC-008`
   (the deployed host reports `jiraEgress.configured=keyvault`; real tickets `ROC-14`/`ROC-15` had
   already been raised through it) and `UC-ROC-023` (blocked 27.3 days on two preconditions that
   were both already satisfied) — while five reported `standing` against real queries. Same probe
   family, both answers, so the mechanism is not a constant. **Two traps found while building it,
   both worth carrying:** (1) the first `DEF-ROC-008` probe counted `az keyvault list` and read 0,
   which measures whether OUR identity may LIST vaults, not whether the vault exists — an
   unanswerable query read as a true negative, i.e. DEF-ROC-046's mistake inside the probe written
   to prevent it. **Ask the deployed app about itself, not our own RBAC.** (2) Attaching a probe to
   an old park is an `amended` self-loop, which opened a new dwell segment and made a 34-day park
   report **0.0h** — the migration that exposes the cost would have ERASED it. Adjacent same-state
   segments are now merged for every park-age reading.
Target: CFR (a never-fired capability, an unread real field, or a dead gate is caught by a
lane instead of surviving millions of events into `done`) + MTTR, and for limb 6 specifically
**gross lead time** — the `external` owner share and median time-in-`blocked`.

**17d. A TEST VALIDATES A REQUIREMENT, OR IT IS NOT A TEST [v127]**

Human ruling, verbatim and binding: *"A test was written to match the code. I do not care AT
ALL about code coverage. The ONLY thing tests should be validating is the requirements. If we
are making up tests for coverage that do not map onto requirements then either (a) we are
wasting time, or (b) we have identified a new acceptance criteria and we need to retro as to
why it wasn't discovered earlier."*

This is §17c Layer 1 turned on the test suite itself. §17c said a claim must be observable in
a state that could come back negative. A test whose INPUT we authored cannot come back
negative about reality — it can only confirm the code. **Three independent instances in one
session** (2026-08-01), which is why this is a rule and not an incident:
- `uc-hf041-cancellation-recovery.test.ts` built its "pre-fix" prior by re-ingesting a REAL
  capture **with `statusDetails[].state` deleted** — exactly the leaf whose presence breaks
  the heal — and three sibling tests hand-set `{state:'Cancelled'}` and asserted suppression.
  2,171 tests green; **nine real cancellations sat unhealed in prod** on the passenger-facing
  feed, including the flight a customer reported.
- The `awaiting_observation` probe test stubbed `subprocess.run`, so it "only proved the
  mapping agreed with itself"; against a real `make` every probe read BROKEN.
- The provenance ledger's `read` dispositions were DECLARED; tested differentially against
  `normalise()`, **8 of them were false**.

*Therefore, cross-agent and binding:*
1. **Every test declares the acceptance criterion it validates** (`AC-<ID>.<n>`). Coverage is
   not a goal and is never a justification. A test that maps to no AC is one of exactly two
   things, and the author must say which: **(a) waste — delete it**, or **(b) an acceptance
   criterion nobody wrote down**, which is registered as a real AC *and* opens a discovery
   retro asking why it was missed. There is no third option, and "it improves coverage" is
   not an answer.
2. **A precondition may not be authored.** A test that builds its prior by MUTATING a real
   capture — deleting a field, spreading an override, hand-setting a folded value — has
   authored the world and cannot validate a requirement about reality. The prior is **folded
   from events** or **harvested**. Mutating a real capture so it agrees with the code is the
   most direct form of the failure this rule exists to stop.
3. **A dependency stubbed at the seam under test proves only self-agreement.** Stub across a
   boundary you are not asserting about; never across the one you are.
4. **A green suite is evidence about the tests, not about the system**, until §17c.1's
   observation pointer exists. The three instances above were all green.
5. **A RATCHET THAT ONLY A HUMAN CAN TIGHTEN IS NOT A RATCHET — it is a high-water mark
   that drifts [v142].** The floor may only shrink, but nothing shrank it except somebody
   remembering to. Measured failure: the limb-1 floor was hand-lowered `1755 → 1749` at the
   moment a gain was noticed, and **106 minutes later two commits on the same morning took the
   true count to 1811**. Nobody saw it for **three days**, because the drift's only observer is
   the next gate run — and an outage removed the session that would have made it. Net effect
   over the softening's whole two-week life: the count ended **higher than it started** (1795 →
   1811) while the floor recorded a win. *Therefore:* **every PASSING gate run whose observed
   count is strictly below the committed floor lowers the floor itself, mechanically, and says
   so.** It can only ever lower; raising stays manual and reviewed. A failing run tightens
   nothing. Corollary for anyone tempted to re-baseline by hand: **lower the floor AFTER the
   session's last commit, never at the moment you notice the gain** — that gap is the whole
   window in which the floor and the tree diverge silently.
Target: CFR (a defect of this class is caught by the gate rather than by a customer) +
MTTR. Mechanism: the AC-traceability + authored-precondition gate [EXP-124]; the shrink-only
auto-tighten [EXP-142].

**17e. A GATE THAT CRIES WOLF IS FIXED, NOT TOLERATED [v128]**

Human ruling, verbatim and binding: *"a gate that cries wolf gets ignored … no, a gate that
cries wolf needs to be FIXED."*

The first half of that had become a standing excuse in this repo. The orchestrator used
"a noisy gate gets ignored" **six times in one session** — every time to justify SOFTENING a
gate rather than repairing one: shipping the test-requirement gate report-only, deferring a
stale threshold to "an architect follow-up", and citing `make render-diagrams` as a cautionary
anecdote. Meanwhile:

- **`make render-diagrams` was RED for ~20 days** over three `.mmd` files, ran in **no
  workflow**, and was quoted inside `security-audit.yml`'s own header as the reason THAT
  workflow needed a `schedule:` trigger. A defect had become a rhetorical device.
- **v125 already routed the correct rule** — "every committed gate is green on trunk or
  DELETED" — naming this exact target. It stayed red for three more days. **Sixth prose-only
  remedy** (after `make wire-provenance`, the unread corpus markers, `awaiting_observation`,
  "push on green", and the never-generalised heal comment).
- **The entire fix was four semicolons and one pair of quotes.** `;` is a mermaid statement
  separator, so a `;` inside `Note over X:` or a message label silently truncates the statement
  and the parser then fails on the NEXT line — which is why the reported line numbers never
  pointed at the real defect and nobody looked twice.

*Therefore, cross-agent and binding:*
1. **A red gate is a DEFECT WITH AN OWNER, never context.** It is fixed or deleted. There is no
   third state, and "known red" is not a state.
2. **Softening is not a remedy.** Report-only, a ratchet, a raised threshold, an added
   exclusion, a skip — each is a decision to STOP MEASURING, and is permitted only with an
   owner, a date, and a registered item **whose acceptance is the gate BLOCKING again**. An
   open-ended softening is a deletion that still costs CI time.
3. **A threshold that fires on legitimate volume is BROKEN, not noisy** — re-baseline it before
   shipping, from the measured population. Shipping a gate you already expect to be red is
   shipping a gate you have decided to ignore.
4. **Wired-but-non-blocking is not wired.** A gate must run in a workflow that EXECUTES and
   whose failure STOPS the thing it guards (§F8a: it blocks on harm that stopping relieves).
   Mentioning it in a comment is the §17c.3 "control asserted in a comment" failure.
5. **Never cite a red gate as evidence in an argument.** If you know enough about it to use it
   as a cautionary example, you know enough to fix it or open it. Citing it converts a defect
   into decoration and teaches every reader that red is normal.
Target: CFR (a defect the gate was built to catch is caught, because the gate is green and
blocking) + lead time (a permanently-red gate is re-diagnosed by every agent that meets it).
Mechanism: `render-diagrams` is now green (31/31) and wired BLOCKING into `ci.yml` with
`architecture/**` in the path trigger [EXP-125].

**THE MECHANISM, committed 2026-08-02 — this rule is now executable and no longer prose.**
`make test-requirement-gate PROJECT=<p>` (`.claude/tools/test-requirement-gate.js`,
zero-dependency, no creds, no network; self-tests under `make test-tools`). Per-project
config, committed allowlist and ratchet baseline live in
`.claude/config/test-requirement-gate/<PROJECT>.json`. It is **`loop-gate` check 6**, so it
runs before EVERY pull — a gate in no workflow is not a gate, which is the whole reason
`make render-diagrams` sat red on trunk for 20 days.
- **Limb 1** flags a test case with no `AC-<ID>.<n>` in its title, its suite, or its own
  comments. A file-level `@covers AC-x` deliberately does NOT satisfy it (that is a claim
  about the module, not about this case) and is reported as a separate number.
- **Limb 2** flags five static shapes: `delete` on a corpus-derived value; an override
  spread over one; an assignment into one; an object literal setting a FOLD-DERIVED field
  cast to an aggregate; and a stubbed process-exec boundary. Occurrences inside an
  `expect(...)`/matcher argument are excluded — normalising an OBSERVED value is the
  opposite act to authoring a PRECONDITION.
- **Verdict rides a stdout sentinel** (`TRG-VERDICT: PASS|FAIL|NOT-CONFIGURED`), because
  `make` cannot express a three-way exit — a recipe exiting 3 makes `make` print `Error 3`
  and exit 2. That is instance 2's own lesson, applied to the gate built from it.
- **It ships in RATCHET mode with a committed baseline that may only shrink.** The
  OagEventSource first measurement (2026-08-02, honest and un-mass-tagged) is **1,801
  untagged of 2,728 cases (66%), of which 606 carry only a file-level `@covers`**, and
  **22 authored preconditions across 9 files**, with a **1-entry** allowlist. A count ABOVE
  baseline BLOCKS the pull; the standing debt is ADVISORY and reported every cycle so it
  cannot quietly become normal. `--write-baseline` REFUSES to raise the number. Per
  EXP-124, clearing the baseline by mass-tagging counts as FAILED.
- **Two limits, stated rather than left silent.** A folded field hand-set through a local
  builder (`prior({ state: 'Cancelled' })`) is not caught — the same rule would flag the
  CORRECTED test verbatim, so recall was traded for precision. And instance 3's shape (a
  ledger disposition declared, not proven) is not statically decidable; it is closed by the
  differential census, which is this discipline in a different mechanism.

**17f. A NUMBER WITHOUT ITS UNIT AND ITS SUBJECT IS NOT A MEASUREMENT [v130]**

The owner's report was three words: *"the RSW numbers are double counted."* They were right, and
the number was mine. §17d governs tests; §17e governs gates. **Neither governs a COUNT** — and a
count in a report, a population in a census, a figure in an item note are the most-cited
artefacts in this system and were the least governed. So both rules were satisfied while the
evidence base rotted. Fourteen numbers were reported, believed and acted on in one session
without stating what they counted; **four were the orchestrator's own.**

- **Unit unstated.** "5,135 RSW arrivals/month" counted **streams**, not flights — codeshares
  split one aircraft across up to **8** streams (`UC-BPC1`'s `codeshareCollapse`: 2.08 mean,
  histogram to 8, 16 unclusterable). The factor was **already measured and committed in our own
  view**, and the stream-vs-flight distinction had been PROVEN in the same session. `UC-NCI1`'s
  37 stuck, `DEFECT-OAG-051`'s 85, the 98 damaged streams and "~250 lost arrivals" carry the
  same error.
- **Subject unstated.** "43,744/43,744 — one `OagFlightCreated` per stream" was cited for weeks
  as evidence the OCC race was not firing. It was **true, and about the wrong axis**: 98 streams
  were damaged on the change path above position 0 the whole time. A correct invariant mistaken
  for a broader one is more dangerous than a broken one, because nothing about it looks wrong.
- **Reached-subject unstated.** "Adapter tier green against real DynamoDB Local" — `:8000`
  collided with another project's container, **no report recorded the port**, so good runs are
  indistinguishable from compromised ones after the fact (`DEFECT-OAG-059`).
- **Null unstated.** "Two matching 98/98 scans prove the fix is holding" — at 1 incident per
  ~26,800 events, agreement across ~6,700 new items was **93% likely if the fix did nothing.**

*Therefore, cross-agent and binding:*
1. **A population declares its unit** at the point of report — `streams` vs `physicalFlights`,
   `messages` vs `events`, `items` vs `flights`. A bare count is the defect. Where a
   de-duplication is applied, **name the clustering rule** and state the unclusterable residue
   separately; never divide by a mean factor when the distribution has a tail.
2. **An invariant declares the axis it measures** and does not stand in for axes it does not.
   "Green" is evidence about the axis, not about the system.
3. **An "against real X" claim names the X it actually reached** — the endpoint, the table, the
   account, the sha. Reachability is not identity.
4. **A sample-based claim states what it would have read under the null.** If the answer is
   "about the same", it is not evidence yet — say `INSUFFICIENT-OBSERVATION` and give the
   observation still owed.
5. **The pattern to copy is the census's `complete: false` guard** — it refused to report a
   partial `0/0` as the store, three times under pressure, because it was built to state its own
   subject. It was the one control that behaved correctly all session.
6. **INTERPOLATION IS NOT MEASUREMENT, AND THE RULE BINDS OUR OWN INSTRUMENT [v132].** A
   figure derived by *filling in* rather than *observing* is segregated from measured data and
   never pooled with it. Applied to the thing that chooses where every retro spends its budget:
   **138 of 282 flow items** carried backfill dwell — timestamps synthesised by spreading a span
   evenly across an item's transitions, so every state segment came out identical to the second
   (`UC-14`: five consecutive segments of exactly **304,800.0s**; `UC-16` byte-identical to it).
   That was **44.98%** of the reported gross lead time. It is not spread evenly — it lands only
   on the states migrated items walked — so pooling it inflated exactly the delivery stages:
   `deploying` read **12.30%** against a measured **6.00%**, `building` **10.12%** against
   **2.03%**, `ready` **10.54%** against **2.79%**. **Three consecutive retros therefore named a
   delivery stage as the constraint and aimed their change budget at it**, while on measured data
   every working owner is fast (cicd median **655s**/item, engineer **2,053s**, tester **3,723s**)
   and the constraint is inventory (`queue` **57.80%**, median **1.9d**/item). *Therefore:* **a
   constraint may not be named from a figure without stating that figure's interpolation share
   AND its count-independent per-item median.** A share alone cannot distinguish "work waits
   longer" from "there is more work" — the confound that made `EXP-123` unscoreable.
7. **A METRIC FIX A RETRO ROUTES MUST LAND AS CODE IN THAT SAME RETRO [v132].** §17c.3 says a
   comment is not a control; that rule had never been applied to **the retro's own output**. v128
   diagnosed the share/count confound exactly and routed the remedy — *"`stats.md` must report
   median per-item dwell in `registered`/`ready` alongside the share"* — as prose in a version
   comment, with no owner, no item and no test. **It never landed**, and it was the number that
   would have exposed limb 6. That is the **seventh** prose-only remedy on record here; the
   subordinate move for this same constraint (*decline-or-schedule aged intake*) was routed by
   **both v130 and v131** and recorded "still unstarted" — the eighth. *Therefore:* a retro that
   routes a change to a measurement, a gate or the flow machinery either **ships the commit in
   that retro** or registers it as an item with an owner and an acceptance condition. A version
   comment describing an intended mechanism is not a routed change; it is a note about one.
Target: CFR (a wrong-unit population mis-sizes a defect and the fix is scoped to the wrong
blast radius) + lead time (every downstream reader re-derives a number whose referent is
unstated; and limbs 6–7 aim the change budget at the real constraint). Mechanism:
`DEFECT-OAG-062` carries the executable limb for limbs 1–5 — a reported population without a
declared unit FAILS — and §17c binds it: the acceptance is the check firing on an undeclared
count, not this rule being written down [EXP-126]. Limbs 6–7 shipped as code in the retro that
wrote them: `_is_interpolated` + `_compute_glt`'s `backfill_s`/`median_per_item_s` columns and
the `loop-gate` backlog **age** advisory, 4 new tests, 209 green [EXP-128].

**17g. A BOUNDARY'S FAULT SET IS ACCEPTANCE, AND A FAULT-CLASS FIX OWES A SWEEP LEDGER [v138]**

Every contract in §17 so far governs what the system does when things *work*: 17b that a
wire claim is executable, 17c that a capability was observed, 17d that a test validates a
requirement, 17e that a gate can fire, 17f that a number has a unit. **None of them asks
what happens when a write fails halfway, a resource is replaced, a marker expires, a
record is poisoned, or a consumer wedges.** §12 acceptance does not require a fault case;
the tester is adversarial about input edges and ordering on the SUCCESS path (§20). So the
whole fault dimension has been unowned, and it is where the defects actually are.

**Founding evidence, 2026-08-10 (OagEventSource).** An external reviewer produced seven
findings. Verification against live prod confirmed six as real and rated two of their
recommended fixes as HARMFUL. **Five of the seven were fault-path defects** — partial
write between two partitions (`DEFECT-OAG-080`), resource replacement losing in-flight
records (`DEFECT-OAG-083`), dedup-marker TTL expiry duplicating permanent data
(`DEFECT-OAG-082`), poison record (folded into 083), consumer partition wedge with no
self-heal (`DEFECT-OAG-085`). Every one of them passes the happy path, and every one was
found by someone OUTSIDE our process. Two were reproduced on demand once looked for
(080 3/3 including a variant the reviewer missed; 082 against real DynamoDB Local) — so
they were cheap to find and simply never sought.

*Therefore, two obligations:*

1. **Fault-set acceptance (owner: solution-architect, at the §12 acceptance gate).** Any
   new or changed boundary that **persists, publishes, projects or checkpoints** declares
   its FAULT SET as acceptance cases, each becoming a failing pinned test at build time.
   The floor, from the founding class — extend per boundary, never shrink:
   (a) failure BETWEEN two writes that are not one transaction — and specifically whether
   the first write establishes the idempotency key for the second, which makes the
   redelivery a silent no-op; (b) replacement/recreation of the resource, and what happens
   to records in the swap window; (c) expiry of any marker/TTL/lease the correctness
   argument leans on, where the thing it guards is permanent; (d) a poison record, and
   whether the blast radius is the record or the batch; (e) a wedged/frozen consumer, and
   whether anything recovers it without a human. An **undeclared** fault set is a
   `needs-acceptance` gap and the item is NOT Ready (same shape as §12a) — fail closed,
   because the whole finding is that nobody asks unprompted.
2. **A fault-class fix owes a GENERALISATION SWEEP with a LEDGER (owner: engineer).** When
   a defect of one of these classes is fixed, enumerate every other site where the same
   SHAPE could exist and declare each one *fixed* or *not-applicable-because*. **The ledger
   is the deliverable; a sweep with no ledger does not satisfy this.** Founding failure:
   `DEFECT-OAG-069` fixed "the marker is written before the projection so a retry skips a
   missing item" in the feed-projector lane, recorded **no sweep event**, and the identical
   shape sat undetected in `normaliser-core` until an outsider read it — becoming
   `DEFECT-OAG-080`. One fix, one lane, same bug twice.

**Route it UPSTREAM, never as a gate before the tester.** The tempting remedy — a red-team
review between build and validation — is forbidden by §F5a ("never add a promotion gate to
compensate"; the failure is upstream, fix it there) and would add exactly the queue wait
that is the standing constraint. EXP-123 records this misdiagnosis being made twice. **The
adversary's output is acceptance cases, not a verdict**, so it flows through TDD and blocks
nothing. [EXP-134]

**17h. AN EXCLUSION NEEDS AN AUTHORITY, AND A COUNTER MAY NOT PRE-JUDGE ITS POPULATION
HEALTHY [v140]**

Founding: unscheduled and GA flights had **never** reached consumers — **29.8%/31.2% of
SRQ's real traffic**, 7.2%/7.9% at TPA, 5.1%/5.8% at RSW, across 57 ICAO-only carriers
**plus 21 IATA-holding ones** (AA, DL, UA, WN, BA, FX, 5X). Nobody had decided that; when
finally asked, the owner ruled in one sentence that they must come through
(`DEFECT-OAG-107`/`110`).

The skip itself was defensible — a record with no `scheduleInstanceKey` cannot form a
stream, because that key **is** the stream identity. **The defect was what we called it.**
Four source sites named the excluded population a *"benign GA/Unscheduled degenerate
sample"*, sourced to *"probe §E — out of scope"*. Two moves, both the failure: a **probe's**
scope note (*I am not looking at these right now*) was frozen into production as a
**product** decision about what customers receive; and *"benign"* is a **health verdict**,
so the counter counts up forever and **nothing can ever go red** — the instrument that would
have found this was built, wired, and pre-declared as reporting good news.

1. **An exclusion of a population from the domain is a CONTRACT decision (owner:
   solution-architect).** A counted skip, an early return or a `continue` on a **population
   predicate** carries a machine-checkable reference to the item or ruling that authorised
   it. **An exclusion with no authority is a FINDING, not a sample.** This is the same class
   as stream identity — which §12/`AC-110.3` already forbids an engineer to author — and the
   gap was simply that we had the rule for the **key** and never for the **population**,
   though both decide what a consumer receives.
2. **A counter may not pre-judge its own population healthy (owner: engineer).**
   `benign` / `degenerate` / `expected` / `out of scope` as the **standing description** of a
   counted population is banned. State the population and its **measured size**, and leave
   something able to go red.

**Why a GATE and not another rule.** `DEFECT-OAG-055` went to *this* counter in *this* file
and wrote, in its own source comment, that *"a diversion recovery hiding inside a counter
that reads '8 GA records skipped' is the silent-suppression family this project has been
bitten by repeatedly"* — it **named the family**, then split irregular-ops out of the benign
count and stopped, leaving the *"benign"* verdict standing over the rest of the bucket. The
label survived the one review that recognised it as dangerous. That is §17g's
generalisation-sweep miss, and **§17g postdates 055** — so this is a pre-§17g instance
surfacing after the remedy existed, and telling agents to generalise harder is exactly the
remedy already proven insufficient. Mechanise it in the shape `test-requirement-gate`
already proves works here: tag-or-justify, with a ratchet that may only shrink.

**Honest tension, to be checked FIRST at every scoring:** this manufactures `open` findings,
and `open` is the standing constraint (**51.25%** of GLT, median **6.9 d/item**, n=81, 0%
backfill). It pulls against **EXP-131**, which exists to cap undated inventory. If it
converts exclusions into findings faster than they are ruled, **kill it — do not re-tune
it.** Binds engineer, solution-architect and tester. [EXP-135]

**17i. A CONTROL THAT CANNOT REPORT IS NOT A CONTROL — SILENCE IS NEVER A PASS (v143).**

Every gate, probe, guard, teardown and counter must be able to say *"I could not look."* A
control whose failure to observe renders as success is not a weak control, it is an
**absent one wearing the costume of a present one** — and it is worse than nothing, because
its standing green suppresses the search.

**FOUR INDEPENDENT INSTANCES IN ONE SESSION (2026-08-19) — this is a class, not a slip:**

| control | how it fell silent | how long it "passed" |
|---|---|---|
| `worktree-guard` | `--json` payload crossed the 64 KiB pipe buffer; `process.exit()` does not wait for a pipe to drain, so the JSON ended mid-string | until the repo's history grew past the buffer — arrives late and silently |
| dev smoke gate (`infra.yml`) | dev is `AWS_IAM`, the curl is unsigned → 403 → version header absent → **absent treated as "advisory"** | every run since it landed; `UC-C4` was closed on it |
| `ddb-local-down` | no `DISPATCH` handling → tore down the DEFAULT container → **exit 0** while the dispatch's container kept running | every dispatch since v137/EXP-133 |
| acceptance parser | an unreadable acceptance section scored **0**, indistinguishable from an item with none authored | unknown; found only when the audit was built |

Three shared properties make this diagnosable rather than a coincidence:
1. **Each exits 0.** There is nothing to read, no warning, no non-zero status.
2. **Each was correct when written.** Truncation needed a big repo; the smoke gate needed
   `AWS_IAM`; the teardown needed a per-dispatch container. **The world moved, and the
   control did not notice** — so this class arrives on a delay, in code nobody changed.
3. **In two cases the lesson was ALREADY WRITTEN DOWN in the same repo and not swept.**
   `test-requirement-gate.js` carried the comment *"NEVER `process.exit()` after writing to a
   pipe"* while four sibling tools carried the bug; the census file's own comment warned about
   a wrong field path three lines above a deeper instance of it. **A comment in one file is
   not a sweep (§17g).**

**THE RULES:**
- **Distinguish the three outcomes, always: PASS / FAIL / COULD-NOT-LOOK.** A control that
  collapses the third into the first is a defect the moment it is written, not when it bites.
  The in-repo model is `probe-oag-alerts-observed`: it exits non-zero and prints a **NAMED
  REASON from that run** rather than issuing a verdict it has not earned.
- **A could-not-look must BLOCK, not warn** where the control is a gate. §17c.2 already says
  an unrunnable liveness predicate is not a predicate; this generalises it to every control.
- **When you fix one instance, SWEEP THE CLASS mechanically and commit the sweep as a test**
  — not as a comment, not as a resolution to be careful. The `process.exit(main(…))` sweep is
  the worked example: one assertion, no tool can reintroduce the shape.
- **THE MIRROR IMAGE IS EQUALLY BANNED: a rule no single actor has standing to SATISFY.**
  A control that cannot fail and a rule that cannot be obeyed decay by the same mechanism —
  both become folklore while appearing enforced. The experiment-registry cap breached three
  consecutive retros because it was measured globally while scoring authority is per-instance;
  the repair was to scope the rule to the unit that can satisfy it (§25a, v143), NOT to
  re-excuse the breach. **When a rule is breached repeatedly by different actors, suspect the
  rule's addressee before the actors' discipline.**
- **A rule with no mechanical observer is not in force.** Measured 2026-08-19: eight of nine
  registry rows sat unscored at `0/3`, so the 3-strikes kill rule had **never once fired**.
  Prose that depends on a human remembering to perform a step has the same failure mode as a
  gate that cannot fail — route it to a committed tool and wire it into `loop-gate` (§25).

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

## 17ab. AN ITEM'S RECORDED MECHANISM IS A HYPOTHESIS — re-measure it before you build its fix [v148, ROC retro 2026-08-24]

**A work item's stated cause is evidence of what someone concluded, not evidence of what is true.**
Four measured instances in five days, all in one project, all where a confident recorded claim had
rotted or was wrong from the start:

| item | the recorded claim | what was true |
|---|---|---|
| `DEF-ROC-008` | blocked: no real Jira in the cloud test env | the deployed host reported `jiraEgress.configured=keyvault`; tickets had been raised through it |
| `UC-ROC-023` | blocked on two preconditions | both already satisfied — it had sat **27.3 days** |
| `DEF-ROC-053` | the tier races itself: a running `local:read-api` attaches a consumer to the same consumer group | `local/read-api.ts` contains **zero** consumer references. The contender does not exist, so its prescribed fix would have isolated the tier from nothing |
| `DEF-ROC-081` | a self-resolve loses its Jira key | every resolve site stamps it; the outcome that lacks it is the one written when a clear closes **nothing** |

The first two were caught because `blocked` gained a re-run probe (`EXP-143`, §17c limb 6) — the
share of gross lead time in `external` fell 40.4% → 35.7% and `blocked` 39.1% → 33.8% in one cycle.
**The second two were not caught by anything**, because a probe re-checks a *park*, and nothing
re-checks a *diagnosis*. A diagnosis is the more expensive one to get wrong: a park that is stale
costs waiting, whereas a mechanism that is wrong costs a **plausible fix that ships and changes
nothing**, leaving the real defect in place behind an item that now reads as resolved. That is how
`DEF-ROC-022` consumed two weeks across six agents.

**RULES:**

- **Before implementing the fix an item PRESCRIBES, verify its mechanism against the source or the
  running system.** One targeted grep of the file the item names usually settles it. This is cheap;
  the alternative is not.
- **Never confirm a mechanism from the item's own prose.** In the `DEF-ROC-053` instance the
  orchestrator wrote a `confirmed` event asserting the mechanism was "structural and readable in
  configuration" — from the write-up, not the code. **Ask the code or the host, never the
  write-up.** This is the `DEF-ROC-008` trap in a new costume: that item's first probe counted
  `az keyvault list` and so measured *our* RBAC rather than asking the deployed app about itself.
- **When a mechanism is disproved, correct the item's TITLE, not only its body.** The title is what
  `views/queues.md` renders and what the board projection publishes, so a false title travels
  further than a false body and reaches readers who never open the file. Retitle via an `amended`
  event that quotes the old wording; never silently.
- **Separate what survives from what does not, explicitly.** A disproved diagnosis rarely
  invalidates the OBSERVATIONS. `DEF-ROC-053` kept value 5 on its measured evidence while losing its
  mechanism and its prescribed fix; conflating the two would have thrown away a real defect.
- **An acceptance condition written to catch a failure that does not occur is VOID, not passed.**
  Record it as void with the disproof. `DEF-ROC-081`'s AC-081.1 was already green before any change
  and could not go red first; marking it "passed" would have claimed a test that never tested.

Target: **lead time for changes** (eliminating rework spent building fixes for absent mechanisms),
secondary **change failure rate** (a fix for a mechanism that is not there is a change that fails
while looking done).

## 17b. A LOCAL GREEN IS NOT A CI GREEN — name which environment a verdict came from [v147, retro 2026-08-21]

**A green run does not say where it was green, and here the two environments differ in three
measured ways.** The cost of pretending otherwise is not a lost round-trip: it is that the cheap,
fast signal becomes the one we distrust, and the trusted one is the slow expensive one.

**The three divergences, all measured 2026-08-21:**

1. **TOPOLOGY, permanent and by construction.** CI checks out the **project repo alone**; a dev
   worktree has that repo **nested inside the parent**. So anything reading above the project root
   is green locally and **cannot** work in CI. Measured: a spec read
   `.claude/skills/work-items/scripts/work-items.py` at module scope; locally green, in CI the file
   failed to **collect** (`1 failed | 403 passed`). A sweep of all **522** specs found exactly
   **one** such reach — the one CI had caught. This follows from v50 (a project is its own repo)
   meeting the worktree model, and will not go away.
2. **CONCURRENCY, and it cuts BOTH ways.** Local: up to five agents on 14 cores, each with its own
   DDB-Local container, several running full suites at once. CI: a dedicated 2-core runner. So
   `AC-AV.11` — which asserts a forced race *did* interleave — fails locally under contention and
   passes in isolation (**five dispatches hit it in one day**), while **three dispatches
   independently reported that whole-suite reds are untrustworthy on first read**, because
   source-scanning gates read files another agent was mid-write on.
3. **ENVIRONMENT.** The suite runs **45s** locally and **98s** at `--maxWorkers=2`, but two
   consecutive CI runs stalled dead after the same spec with **18 and 86 minutes of total
   silence**. ~2× is not 50×, so it is not the suite outgrowing the runner.

**RULES:**

- **State the environment with the verdict.** "Green" alone is not a report. Say *shared tree,
  N cores, M agents live* or *CI, run id*. A tier result whose environment is unstated cannot be
  compared to the one that contradicts it, which is how a day gets spent re-litigating a red.
- **A local red is a finding until ATTRIBUTED, never dismissed.** Attribution means naming the
  concurrent writer or the load, not asserting one. "Passes in isolation" is attribution only when
  the isolated run is stated. Discounting a local red without attribution is the reflex that lets a
  real regression through, and it is now a measured habit rather than a risk.
- **A verdict that depends on host load is a DEFECT in the assertion, not a fact about the host**
  (`DEFECT-OAG-134`). An interleaving that did not occur must be reported **distinctly** from an
  invariant that was violated — the exit-3 / exit-4 vocabulary already exists for this.
- **Before a push, confirm in a CI-FAITHFUL checkout** — `IMP-032`. Both mechanisms already exist
  and neither was pointed at the suite: `bundle-at-sha.sh` builds in a **disposable worktree at a
  committed sha** (so no shared-tree contention), and `check-probes-standalone` builds a **real
  lifted-out tree** (so the CI topology). Compose them; do not invent a third.
- **Never a nested clone.** `DEFECT-OAG-072` was delivered complete and destroyed by exactly that
  shape. `git worktree` or a file copy, per the two existing precedents.

**DIVERGENCE 4 — TOOLING: the local tier may not RUN a check CI runs at all** [v148, ROC retro
2026-08-24, `DEF-ROC-086`]. The three divergences above are all about the same checks giving
different answers in two environments. This one is worse and was found in a second project two days
later: a whole class of check had **no local equivalent**, so the local tier could not disagree — it
had nothing to say.

Measured: `npm test` is vitest, and vitest transforms with **esbuild, which strips types without
checking them**. So a committed test carrying a hard `tsc` error was green locally and would have
stayed green for ever. CI type-checks; nothing local did. The consequence was not a round-trip — the
CI job failed, `deploy-test` declares `needs:` on it, so the deploy was **SKIPPED, not failed**, and
**three pushes reached trunk without reaching the only environment**, with no red mark anywhere
naming the deploy as the casualty.

- **Enumerate what CI runs, then check the local set COVERS it.** Not "do we have tests" — a
  per-step comparison. A step with no local counterpart is the dangerous kind, because it produces
  no local signal to be suspicious of. `make typecheck` (ROC) exists for exactly the leg that had
  none.
- **A pre-push target must state its SCOPE, so a green cannot be over-read.** `make typecheck`
  documents that it covers the type-check leg ONLY, so a green means "CI will not fail the
  DEF-ROC-086 way" and not "CI is green". A pre-push check whose coverage is unstated will be read
  as total.
- **A test framework that does not type-check is not a type checker.** Generalise past this
  instance: any tool that *transforms* rather than *validates* (esbuild, babel, swc, `tsx`,
  `ts-node --swc`) gives no verdict on the thing it stripped. Ask, per tool, what it silently
  discards.

Target: **change failure rate** (a CI-only red is a change that failed after being called done);
secondary **lead time** (a CI round-trip is the slowest possible way to learn this), and for
divergence 4 specifically **deployment frequency** — the measured cost was three pushes that never
deployed.

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

## 19c. §F11's exit gate ALSO binds at the push boundary, and it gains one active step [v156→superseded-in-part by §F11; reconciled 2026-08-29]

**READ §F11 FIRST. It is the governing text** and it is broader than this section: complexity
AND coupling AND coverage AND outside-in tests, as EXIT CONDITIONS on the engineering step,
with `AeroCloudSystems/CodeAnalysisTools` as the named instrument.

This section was written independently on OagEventSource the same day §F11 landed from ROC,
and **most of it was duplicate.** It is cut to the parts §F11 does not already say. That
duplication is itself recorded — see the fold-forward note in §19d.

**(a) The gate binds at the PUSH boundary too, not only at handover.** §F11 is an exit
condition before the tester takes over. On a trunk-based, continuously-deployed project the
push happens many times before that, and *the push is the apply*. So the ratchets are checked
where work leaves the machine, not only where the item changes hands.

**(b) NO-WORSE IS A FLOOR; YOU ALSO ATTEMPT AN IMPROVEMENT.** §F11.1 asks *did it get
worse*. The owner also asked, verbatim, to *"look at and attempt refactors to improve
coupling of work that is about to be pushed"*. So: read the GENERATED analysis, attempt a
refactor, re-run the tests. **"I looked, and here is why I left it" is a valid outcome;
skipping the look is not.** A mandatory refactor every time would be ignored within a week; a
mandatory LOOK is affordable every time. And the outcome is **RECORDED on the item**, so
*considered-and-declined* is distinguishable from *not-done* — an unfalsifiable rule is
decoration, which is the family §F11 itself exists to fight.

**(c) A RATCHET MUST FAIL HONESTLY, AND ITS TOLERANCE IS MEASURED.**
- *Cannot measure* is a THIRD outcome, never folded into pass or fail. A caller who cannot
  tell a broken measurement from a real regression will fix the wrong one.
- Any jitter tolerance is **measured and declared next to the numbers it applies to**, and an
  absurd one FAILS CLOSED — switching a gate off has to look like switching it off, not like
  configuring it. (Measured, OagEventSource 2026-08-29: v8 branch attribution is not
  bit-stable, ±0.01 across identical green runs. A gate that reds on noise is a gate someone
  disables.)
- **Raising the floor after an improvement is part of FINISHING the work.** A ratchet that
  only ever holds is a ratchet nobody turns.
- **A floor read off a RED run is not a floor.** Measured the same day: a baseline taken from
  a run with five failing specs described a surface no green run reproduces, and the gate
  caught it by reddening on the very next commit.
Target: CFR + gross lead time. (Per-role: `engineer.md`.)

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

**IDS ARE PER-PROJECT NAMESPACED, AND THE BARE-NUMERIC SPACE IS FROZEN (v145).** A new
experiment takes `EXP-<PROJ>-<nnn>`; `EXP-127`…`EXP-143` are legacy and closed. v143 scoped
the CAP per-project and left the ID SPACE global — the fix was applied to the budget and not
to the namespace — so ids kept coming from one monotonic counter read per-instance from
whatever a worktree held. That is a read-modify-write race with a stale read, and on
2026-08-18 it produced two different experiments both minted **`EXP-142`**: main's
test-requirement-gate ratchet and ROC's screen-viewport hypothesis. v144 found the collision
and correctly refused to relabel either half, because neither instance has standing to rewrite
the other's records. **The same day, `DEF-ROC-077` was the identical defect in a different
registry** — `acceptance-audit` read a GLOBAL declared-exception registry against a
PER-PROJECT sweep and printed "delete the row" for five of another project's legitimate
declarations, a remedy that would have destroyed their data. Shared global namespace +
per-instance writers + no uniqueness check = one project silently invalidating another's
record. Work items were project-namespaced from the start (`DEF-ROC-077`, `DEFECT-OAG-091`);
experiments now match, so the collision is impossible by construction rather than caught by a
human reading two files. **Enforced by `make process-lint`, a prerequisite of `make doc-lint`,
so the retro's step-7 gate covers it** — including the per-project cap v143 routed to "a
committed tool" and nobody built.

**A FINDING AWAITING A DECISION IS AN ITEM, NEVER AN `## EXP-` SECTION (v145).**
`experiments.md` holds only rows of the capped table plus their scoring notes. Six
ROC-authored `##` sections lived there for three weeks with NO row: the cap never governed
them, no retro ever scored them, and "8 active, AT cap" was therefore untrue for two
consecutive retros. Worse than the accounting, one of them had reached **ten measured
instances across six roles** with its replacement mechanism already stated and still no row —
an unregistered finding accretes evidence indefinitely and never becomes work, which is the
prose-remedy failure §17c.5 exists to stop, committed inside the registry built to keep
learning honest. Route such a finding to a work item (owner + acceptance) or to a dated
`open-items.md` entry; `process-lint` fails the build on a section with no row.

**LEAN REGISTRY — a HARD WIP cap of 8 active experiments PER PROJECT (v88; scoped
per-project at v143).** The registry is a WIP-limited queue, not a museum: **at or above 8
`active` rows FOR YOUR PROJECT you may NOT open a new experiment without first retiring one**
(adopt or kill). Reduction is therefore a hard constraint every retro must satisfy, not an
aspiration.

**WHY THE CAP IS PER-PROJECT, and it is a repair rather than a relaxation (v143).** It was
measured across the whole registry while **scoring authority is per-instance** — an instance
can only judge rows whose evidence it holds. So the cap was satisfiable by NO SINGLE ACTOR:
OagEventSource could retire its own rows and still be "over cap" on ROC's, and ROC the mirror
image. It breached at **12 of 8 for three consecutive retros** (v141 excused it on exactly
that standing argument, v142 escalated it to the owner rather than re-excusing, and the
escalation was still open at v143). **A rule that no single actor has standing to satisfy is
not a strict rule, it is an unenforceable one** — and an unenforceable rule decays into
folklore the same way a gate that cannot fail does (§17e). Scoping the cap to the unit that
holds the scoring authority makes it obeyable, and therefore enforceable, without loosening
the number. Cross-project totals stay VISIBLE (the registry is one file) but no instance is
judged on rows it cannot score.

Corollaries:
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
  **MEASURED 2026-08-19, and it is the reason this rule needs a machine: EIGHT of the NINE
  OagEventSource rows sat at `0/3` — unscored, not unmoved.** So the 3-strikes rule has never
  once fired in its life; it cannot kill a row because nobody performs the scoring step it
  depends on, and the cap it protects therefore only ever grows. That is precisely the
  gate-that-cannot-fail shape (§17e) committed INSIDE the registry built to keep learning
  honest. Prose has now failed at this twice, so the enforcement is routed to a committed tool
  (§25's "repeated manual action" row) and wired into `loop-gate` as a blocking check, exactly
  as the acceptance audit was: **over cap, or a row past its horizon still `0/N`, must BLOCK
  the pull rather than be reported to a reader who is not there.**
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

## F2b. Schedule by RESOURCE CLASS, not only by logical dependency [v131]

The owner, on a session that lost 12+ agents: *"if we have multiple gates that are serialising then
we need to think about how to schedule this so we are not getting failures. We also need to be
mapping bottlenecks etc to flow work around — dynamodb scans do not sound like things that should be
connected with linting, committing and pushing."*

They are not connected — logically. A 6M-item store scan and an `eslint` run share no file, no item,
no `deps` edge. They serialise anyway, because they compete for one machine's CPU, disk and network.

**MEASURED:** `eslint src tests` takes **8 s** idle and **19 s** under concurrent load — 2.4× on load
alone, nothing else changed. Load average was **14.68** during the failures and **8.19** once quiet.

**The flow layer has ONE axis where it needs TWO.** `wip_limit` caps by *queue* (a logical stage);
`deps` edges express *logical* ordering. **Nothing anywhere models the machine as a finite
resource** — so two activities that cannot logically conflict are dispatched as freely parallel
while physically contending.

**And the failure is self-concealing.** Contention slows a command; the liveness watchdog kills at
600 s of **silence**; a slow command and a hung one are indistinguishable to it; the kill then reads
as an infrastructure flake and the diagnosis lands on the wrong layer. That happened: two agents died
at the identical step and `DEFECT-OAG-064` was registered blaming gate cost — **without timing the
command**, which turned out to take 8 seconds.

*Therefore, cross-agent and binding:*
1. **Declare a resource class on dispatch.** Every dispatched activity names its dominant physical
   resource — `full-store-scan`, `full-test-suite`, `type-aware-lint`, `external-api`, `light`.
   Unclassified defaults to `light`; a dispatch that is obviously not light and says nothing is the
   defect.
2. **Cap concurrency PER CLASS, independent of queue membership.** Two full-store scans do not run
   together regardless of which items own them. This is a **second** cap that composes with
   `wip_limit`; neither replaces the other.
3. **No long command may be silent.** Anything that can consume a meaningful fraction of the watchdog
   budget either **emits progress** or is **backgrounded with a waiter**. A silent command is
   indistinguishable from a hung one, and the watchdog resolves that ambiguity by killing the agent.
4. **Diagnose a stall by measuring the command, not by reasoning about it** (§17f). A stall at a step
   is evidence about *timing*, not about *cost*: time the command idle and under load before naming
   a cause. Two agents dying at the same step is a correlation, not a mechanism.
5. **Do not fix contention by weakening a gate** (§17e). The remedy is scheduling — cache, sequence,
   background, or cap — never removing the check that made the work slow.
Target: **CFR** (an agent killed mid-task leaves half-applied state and re-dispatch rework) and
**lead time** (every death is a resumption paid in wall-clock). Mechanism: the resource-class cap
plus the no-silent-command rule [EXP-127].

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

## F5c. PROD IS LIVE WITH CUSTOMERS — rollback readiness is a PRECONDITION of the deploy, not a reaction to a failure [v151, owner instruction 2026-08-25]

**The owner has stated that production is live with customers.** That does not change §F5a's
diagnosis — when something wrong reaches prod the failure IS upstream — but it changes the
**consequence**, and §F5a was written for a prod with no customers. An upstream fix takes hours.
A customer harmed takes seconds. So the upstream fix remains the cure and is no longer the whole
answer: **the ability to STOP the harm must exist before the change ships, and be provable.**

**This section does NOT reintroduce a human promotion gate.** §F5a's rejection of that stands and
is unchanged — a human clicking approve masks upstream weakness and adds idle. Everything below is
an automated precondition or an automated signal.

### F5c.1 The tester runs in DEV and then again in PROD. Both. Always.

Already the rule (§11b, §F5a) and already in the state graph:
`dev-validating --dev_validated--> prod-deploying --promoted--> prod-validating --validated--> done`.
It is restated here because it is now non-negotiable, and because the enforcement is easy to miss:
`loop-gate`'s **stalled-validation** check is what makes the second dispatch happen — an item whose
work is done and only wants a tester BLOCKS the pull. Two items sat 47h in `prod-validating`
this week and only moved because the gate named them.

**A prod validation is not a repeat of the dev one.** Dev proves the behaviour; prod CONFIRMS it on
the real population and the real consumers. Where dev bounded an observation window, prod must bound
its own — a window you have not bounded is not an observation.

### F5c.2 Every outward-emitting change must be disarmable AT PROD ALONE, before it deploys

This promotes `delta-078`'s stage-keyed-arm ruling from architecture into process, because the
measured consequence is a rollback that does not exist when you need it.

An arm that is a bare constant is the same in every stage. So disarming prod also disarms dev and
sandbox — which destroys the very environment you need to diagnose the fault you are rolling back.
**A rollback that costs you the reproduction is not a rollback.**

**MEASURED, 2026-08-25** — of five outward-emitting arms in `core/arm-constants.ts`, only **two**
carry a per-stage table. `DIVERSION_MAPPER_ENABLED` is a bare `true` with `stageKeyed: 'none'`, and
it is the arm that published false diversions to two live prod consumers for five days.

**RULE:** an arm with `outwardEmitting: true` MUST carry `stageKeyed: 'table'` and a lane term
before the change that arms it may deploy. Absent ⇒ disarmed, always. This is checkable from the
registry the arms already declare themselves in.

### F5c.3 A prod-affecting change declares its ROLLBACK CLASS, and one with none fails CLOSED

"Reversibly rollable" is currently the fourth bullet of §F5a's auto-approve list and nothing
computes it. Make it explicit — every prod-affecting change names one of:

| class | mechanism | expected time-to-stop |
|---|---|---|
| **A — arm flip** | set the stage's arm `false`; no redeploy, no consumer retraction | seconds |
| **B — revert + redeploy** | revert the commit, let CD re-apply | one pipeline |
| **C — irreversible** | prod DATA, or anything already delivered to a third party | **no rollback exists** |

**Class C is the one that matters.** A published event cannot be unpublished — AdixOut and FIDS
received those diversions and no revert reaches them. So a change that can emit outward is class C
*for events already sent* and class A *for events not yet sent*, which is exactly why F5c.2 is a
precondition and not a nicety. A class-C change with no class-A arm in front of it does not ship.

### F5c.4 An unrehearsed rollback is an unfired guard

This project's signature failure is a control that reads healthy while doing nothing, and it has
been found in a gate, a census, a search, a vacuity check and an arm. **A rollback path nobody has
executed is the same shape.** Where a rollback is claimed, it is REHEARSED — in dev — and the
rehearsal is recorded on the item. Declaring the class is not evidence; performing it is.

### F5c.5 A rollback nobody triggers is not a rollback — declare the DETECTION signal

`DEFECT-OAG-140` was found by a **census**, five days after the first false event reached
customers. Nothing alarmed. A rollback capability with a five-day time-to-detect protects nobody.

So an outward-emitting change also declares **what would tell us it is wrong, and how fast**. The
honest default when no signal exists is to say so on the item — an undetected class-C change is a
risk the owner is entitled to see before it ships, not after.

### Why this carries no experiment row

Per §25a's validity bar, **a fix is not an experiment**, and neither is mandatory safety practice
adopted because the operating context changed. There is no hypothesis here we would abandon if a
metric failed to move — we would not resume shipping un-rollable outward changes to live customers
because MTTR looked flat. It is routed as plain practice and scored the ordinary way: **recovery /
MTTR** is the metric it exists to protect, with CFR secondary.

## F5d. A tier that cannot exercise the change is not confirmation of it [v152, ROC retro 2026-08-26]

**Evidence.** `UC-ROC-102` shipped the Simulator's Publish control **unable to publish at
all** — 100% of screen publishes were `400`, from shipping until a human reported it
(`DEF-ROC-111`). Every gate was green. The `built_green` note read *"LIVE CONFIRMED on the
deployed host in a REAL BROWSER"*, 26 assertions; the probe it cited says of itself *"It
NEVER WRITES. It issues no POST to the publish route at all — deliberately."* The claim was
true of the closed-window state and read as end-to-end.

### F5d.1 Name what the tier did NOT exercise, or do not call it live confirmation

A validation tier that **structurally cannot** exercise an item's primary mutating path may
not be cited as live confirmation of that path. Citing it is permitted — abstention is often
correct and load-bearing (this probe must not POST, because an unexplained
`requests{outcome:"disabled"}` is the runbook's intrusion signal) — but the citation MUST
name the excluded path and the ACs it therefore leaves unexercised. **The failure was never
that the probe abstained; it was calling an abstention a confirmation.**

Concretely: a `built_green`/`fixed` note asserting live confirmation states, in the same
sentence, which acceptance criteria remain **unexercised** and what tier would exercise
them. An AC covering a mutating action **cannot be discharged by read-only evidence**.

### F5d.2 A contract with two sides gets one declared list, not two assertions

`DEF-ROC-111` was **not** a missing test — **three** tests PINNED it: two asserted the
client sends `airport`, one asserted the route refuses `airport` but only as a non-empty
string, never the `null` the screen actually sent. Both suites green, contradictory, because
each checked its own side against a fixture of our own making. **A client assertion verified
against our own mock proves only that we are self-consistent.**

Where two components must agree on a wire shape, the agreement is declared **ONCE** in a
place neither owns (`src/contracts/*.json` is the established pattern) and both sides pin it,
so drift on either side fails the build. Prefer a shared declaration to a shared *module*
when the trees have different build roots: importing across roots here dragged dashboard
source into `src/app`'s `tsc --outDir dist`, emitted a second `dist/app/**` layout and left
the Function App's real `dist/host/*.js` **stale** — a green build serving old code.

### F5d.3 Under a pipeline deploy the orchestrator fires `deployed` — and the gate now checks

Restating §F5a's existing rule because it was missed and the miss was invisible: where the
deploy is pipeline-triggered, **no agent runs an interactive deploy, so none fires
`deployed`**. The orchestrator fires the CI-confirmed event (`AGENT=cicd`, `REF=`, citing the
green run); engineers and testers must never spoof it. Until it is fired the item **cannot
reach a tester at all** — `UC-ROC-102` sat in `deploying` **12.0h** against a `deploying`
median of **166s** (260x) and no limb of `loop-gate` named it, because check 1 closed the
window at 4h for validating states while check 11 waited until 24h for `deploying`.

`loop-gate` check 1 now covers `deploying`/`prod-deploying` on the same
work-is-provably-done evidence (a ref-bearing `built_green`/`deployed`), with a
state-appropriate remedy — a remedy naming an edge the state graph refuses is the
`DEF-ROC-084` class. **This is a RECURRENCE**: the identical mechanism was recorded on
AdixOut on 2026-07-22 (`UC-ADIX-015`) and the improvement slice it promised was never built.
See `process/principle-failures/2026-08-26-roc-uc-102-shipped-100pct-broken-behind-a-read-only-live-probe.md`.

### F5d.4 Run the whole tier before you call it green

Running only the files you named is not running the tier. The `DEF-ROC-111` fix passed every
targeted file and was pushed with a **third** pinning test still red in a file that was never
run; CI caught it and the deploy **skipped**. Before a push, run the tiers CI runs.


## F5e. A control is not finished until it can fire, is aimed at something real, and can say "I don't know" [v154, ROC retro 2026-08-26]

**Evidence: NINE controls found faulty in ONE session, and every one of them read
healthy.** They were found by agents doing something else entirely — never by anything
looking for them. They fall into three kinds, and the kinds are the checklist.

**PHANTOM — declared, never wired.** `deploy,wip_limit,1` sits in `policy.csv` and **no
state maps to a `deploy` queue**, so the cap can never bind (`DEF-ROC-119`); `EXP-ROC-005`
was cited by three live knobs with **no row in the registry or the archive**, so the WIP
limit in force had never been scoreable; §F5a's *"the push and the tester dispatch are ONE
act"* was documented and checked by nothing, so three testers left validated state on one
disk; and `wi-append`/`wi-project` **write item files that nothing commits**, so a day's
registrations existed only locally while `wi-validate` read clean — because it reads the
disk.

**MISCALIBRATED — measures something other than the claim.** `paintsScrollbarX` measured
**Playwright's `--hide-scrollbars`**, not the app, and mis-filed a value-5 defect against
three screens (`DEF-ROC-117`); `make-refs-tracked` reads a **guarded existence test**
(`if [ -f X ]`) as an invocation and blocks on a file deliberately designed to be absent;
the test-requirement gate's parser reads a runtime `test.skip(cond, msg)` as an untagged
bare test; the screen gate's reachability limb inspects only **below/right**, never
above/left.

**VOCABULARY-LIMITED — cannot express the honest answer.** `deploy_failed` is not a legal
transition from `validating`, so a change failure during validation **cannot be recorded by
any role** and CFR reads a false 0% (`DEF-ROC-120`); and a blocker probe that correctly
answers *"NOT OBSERVED in this window"* — refusing to call non-observation clearance — is
reported by `loop-gate` as **unreadable**, because the contract admits only `standing` or
`cleared`.

### F5e.1 Three questions, asked of every control before it is called done

1. **What would make you fire?** Demonstrate it: break the thing the control guards and
   watch it go red, naming the instance. This is §EXP-122's non-vacuity limb, generalised
   from tests to **every** gate, probe, cap and metric. `DEF-ROC-110` is the model — it
   deleted its allowlist and proved the gate red by reverting one site.
2. **What do you actually measure?** State the subject, and check the control can reach it.
   A cap needs a queue with members. A probe needs a signal it can observe — with a
   **positive control** proving the instrument works, as `DEF-ROC-085` did (`rows=0` beside
   a known-good `rows=3`). A predicate that answers identically in every arm is measuring
   its harness.
3. **What can you NOT say?** Every control needs an expressible **not-established** answer
   (§17i) and a legal way to record bad news. "Not observed" is not "cleared"; a superseded
   CI run is neither a pass nor a fail; a change failure must be recordable from whatever
   state the item is in when it happens.

### F5e.2 A declared control with no possible subject is deleted, not left standing

If a cap names a queue nothing maps to, or a knob cites an experiment that does not exist,
**remove the declaration or wire it** — the same cycle. Leaving it reads as governance and
is worse than an admitted gap, because it answers the question nobody then re-asks.

### F5e.3 A green from a shared tree is not a green

Every gate here scans the working tree, so with concurrent agents it reports the **union of
everyone's uncommitted work**. Four gates reported another agent's state today
(`check-docs`, `typecheck`, the test-requirement ratchet, and a load-induced timeout that
was 19/19 green in isolation). **Before reporting a red, establish whose it is** — is the
offending file tracked? — and say so. None of the four reached CI; the cost was attribution,
paid four times.


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

## F8a. Loop preconditions are MECHANISED, for the same reason §F8 is
**An obligation with no mechanism is not an obligation.** §F8 works — it is obeyed because
it exits non-zero. Every sibling precondition in STAGE F was expressed as orchestrator
judgement and was, measurably, not performed. In one OAG cycle (v126) `make retro-debt`
fired and forced a retro, while in the SAME cycle: two fixes already pushed **and** deployed
sat awaiting a tester dispatch for **127,636s (35.5h)** and **98,224s**; Ready sat at 1
against a `min_items` floor of 3; and intake sat **over its `wip_limit` of 10** — a cap
enforced nowhere in the machinery. The obligations did not differ in importance or
difficulty. They differed in whether a command returned non-zero. (The intake cap is now
enforced as an **ADVISORY**, not a block — the v126-addendum rule below corrects that part of the model; the
lesson about mechanisation is unchanged, only the severity was wrong.)

A second lesson landed while this rule was being written. The orchestrator quoted intake as
**14** from `views/queues.md`; the gate, folding LIVE item state, read **22** and then 23 —
the view was 8 minutes stale. **So the gate must fold item events itself, never read a
derived view**, and neither may you: a derived view is a snapshot, and quoting one as
current is the same error as quoting an event note (§17c). The number in a retro finding
must come from the fold, not from the last time someone regenerated the views.

**`make loop-gate PROJECT=P` runs before EVERY pull.** Exit 0 = the loop may pull; **exit 2
= blocked**, printing every violation with the ids involved and the remedy (all of them, not
the first). It checks:
1. **Stalled validation** — any item in `validating`/`dev-validating`/`prod-validating`
   dwelling past `--stale-hours` (default 4) whose latest `fixed`/`built_green`/`deployed`
   event carries a `ref:`. **This is the highest-value check**: it is the class where the
   work is finished and only a dispatch is missing, and it is invisible unless looked for.
2. **Ready below floor** — `len(ready) < min_items` (§F2). BLOCKING.
3. **Queue over cap** — a queue depth > its `wip_limit` (§F2), at **two severities**.
4. **Retro debt due** — delegating to §F8's existing logic, never reimplementing it.
5. **Awaiting observation** [state-graph v9, §12d.3] — every item parked in
   `awaiting_observation` is reported AND its liveness predicate **re-evaluated on this run**,
   exactly as `blocked` is re-checked each cycle. `OBSERVATION: observed` ⇒ **BLOCKING** (a
   tester dispatch is now actionable — the same lever as check 1); `OBSERVATION: not-yet` ⇒
   **ADVISORY** (legitimate, outstanding, never "satisfied"); a broken or absent predicate ⇒
   **BLOCKING**, because an unrunnable liveness predicate is not a predicate (§17c.2). Check 1
   deliberately does not also fire on a parked item: it HAS been dispatched and the tester
   recorded a machine-checkable reason it could not conclude. That is not an exemption —
   check 5 carries it and blocks the moment the predicate flips, so parking cannot hide a
   missing dispatch. `NO_OBSERVE=1` skips the evaluation and then reports each parked item as
   NOT EVALUATED, and the run's headline says `NOT ESTABLISHED` rather than "all preconditions
   hold" — a skipped check may never read as satisfied.

**A gate blocks only on harm that STOPPING relieves (v126 addendum) — Little's Law governs WIP, not
backlog depth.** Check 3 originally blocked on ANY queue over its cap; that was a modelling
error, and this gate's FIRST REAL RUN exposed it. `intake` is an unstarted **BACKLOG**, not
work-in-progress. Blocking the pull because the backlog is deep INVERTS the constraint: the
one remedy for a deep backlog is to deliver faster, and the block prevents exactly that — and
it manufactures pressure to close real findings to shrink a number. Founding case: a
legitimate differential sweep produced ~15 verified-real sub-cost-4 findings; the flow-manager
correctly refused to close any of them, and the loop halted **for having done good discovery
work**. So check 3 splits:
- **BLOCKING (exit 2) — a WIP-STAGE queue over cap**: `ready`, `wip`, `rework`, and any
  future in-flight stage. Concurrent work past the cap is real harm (aging,
  context-switching) and stopping intake genuinely relieves it.
- **ADVISORY (exit code UNAFFECTED) — a BACKLOG queue over cap**: `intake`. Still reported
  prominently on its own `!` line with the depth, the overage and the remedy (deliver faster:
  raise throughput, or decline/defer what will never be pulled), and explicitly marked
  advisory-and-still-outstanding so it can never be read as satisfied. An advisory-only run
  exits **0** and says `no BLOCKING precondition violated, the loop may pull; N advisory
  (non-blocking, still outstanding)` while printing the advisory.
The classification is **DECLARED, not a hardcoded name list**: `queues/policy.csv` carries a
`kind` param row (`intake,kind,backlog`; `ready|rework|deploy,kind,wip`) — a new ROW in the
existing long format, so no column changed and no other reader or older `policy.csv` breaks.
A queue with no `kind` row falls back to ONE named map in the machinery, and an **undeclared
queue defaults to `wip`, i.e. fail-CLOSED**: a future in-flight stage blocks until somebody
classifies it. A deep backlog remains a real signal the retro must act on — it is simply not
a reason to stop delivering. Generalisation: when adding a gate check, ask what stopping
achieves; if stopping makes the measured harm worse, the finding is an advisory, not a block.

**Push/deploy state is DERIVED, never read from prose.** Use the structured `ref:` field
verified against git. **Never** infer it from an event note. Event notes are append-only and
are not corrected when the world moves on: at v126 a note reading `"NOT pushed — push is the
prod apply"` was ~35 hours stale while its commit had been on `origin/main` the whole time,
and reasoning from it produced a confident, precisely-quantified, WRONG constraint diagnosis.

**A `ref:` is REPO-SCOPED, so the derivation has FOUR outcomes, not two, and it must search
BOTH repos [v144, DEFECT-OAG-128].** This instruction previously said `git merge-base
--is-ancestor <ref> origin/main` inside the project repo (`git -C work/P`) — and that was
wrong in the most damaging way available. A **parent-lane** ref (`.claude/`, `process/`,
`Makefile`, `CLAUDE.md`) does not exist in the project repo *at all*, so the lookup did not
answer merely wrong: **the ref failed to RESOLVE**, which is the `git cat-file -t fb080d9` →
*fatal: Not a valid object name* signature by which `DEFECT-OAG-072`'s destruction was
diagnosed — an item delivered complete and annihilated. **Seven refs in the OAG registry read
that way**, and `loop-gate` rendered them with the same string as a sha that exists nowhere,
so the one alarm meaning real data loss was **muted inside a routine UNKNOWN**. That is §17i
in both directions at once. The derivation therefore:
- **searches EVERY repo**, project first, then the agent system;
- reports **ON-TRUNK** (ancestor of that repo's `origin` trunk — for the parent repo in a
  per-project worktree that is `origin/instance/<project>`, *not* `origin/main`);
  **NOT-ON-TRUNK** (the object EXISTS but is on no origin trunk — unpushed, **not lost**, and
  the normal state of parent-lane work because the owner owns that push); **ABSENT** (every
  repo was readable and none holds it — *the only reading that means work may have been
  destroyed*; rescue first via `make worktree-guard DIR=--all`, never re-run to see if it
  clears); or **CANNOT-DETERMINE** (a repo was unreadable, so absence was never established —
  not a pass and not an alarm).
- Staleness is asymmetric and that is what makes NOT-ON-TRUNK safe to report: a
  remote-tracking ref can be weeks behind, which can only ever produce a false
  NOT-ON-TRUNK — never a false ON-TRUNK and never a false ABSENT.

**`lane:` is a CROSS-CHECKED ASSERTION, never the routing key for resolution.** Two
measurements killed that design before it was built: `lane:` is **absent on 382 of 478 items
(79.9%)**, and it is **single-valued while real items span both repos** — `DEFECT-OAG-091` was
reported as an outright misdeclaration and is not one; its own log reads *"two lanes, two
repos, never mixed"*, so declaring either lane is INCOMPLETE, not false. It remains
load-bearing for `make dispatch-check` (fails closed, `DEFECT-OAG-076`), which is the point of
use where its absence already bites. `loop-gate` check 12 reports a lane every one of its refs
contradicts, as an **advisory** — a wrong `lane:` misroutes a dispatch, and halting delivery
over a bookkeeping field would be the wrong trade.

**And a `ref:` is a STRING, never a number.** `IMP-029` (opened 2026-08-01) prescribed exactly
this and sat unswept for 19 days while the consequence it predicted happened verbatim: an
all-digit sha is int-coerced on read, so `0605428` was re-rendered into `UC-XA5` **without its
leading zero** and now resolves in neither repo — indistinguishable from destroyed work, while
the real commit `06054289ae9d…` was on `origin/main` the whole time. Fixed at both ends
(never coerced on read; an all-digit ref is retried zero-padded to recover the 11 already
damaged on disk), and IMP-029's audit is closed: across all 478 items the only number-parsed
fields are `value`/`cost`/`tokens`/`duration_ms`, all numeric by intent.

**Always `git -C <path>` / `make -C <path>` — a bare git command resolves against the WRONG
repository, silently [v127].** This is a two-repo tree (§v50: `work/<project>/` is its own
independent repo, gitignored by the parent) and the Bash tool's working directory **resets
between calls** rather than persisting after a `cd`. So a bare `git log origin/main` run by an
agent that believes it is "in" the project repo actually answers about the INTEGRATION tree —
returning real, plausible, entirely wrong output. Observed 2026-08-02: a tester derived push
state for a project item from the parent repo's `main` and caught it only because the commit
subjects were obviously unrelated (process-layer work vs the item's commits). Nothing in the
output says which repo answered.
This hazard **directly attacks the rule above**: §F8a mandates deriving push/deploy state from
`git merge-base --is-ancestor`, and run in the wrong repo that produces a confidently wrong
answer of exactly the class the rule exists to prevent. Therefore: every git/make invocation
against a project names its path explicitly, and any derived push-state claim states WHICH
repo it was read from. A claim that cannot name its repo is UNKNOWN, not true.

**A hold on a push needs a NAMED precondition on the HELD ITEM, and the hold is SCOPED to the
paths that actually deploy.** v124 prescribed "push on green" against a misdiagnosis and the
prescription was followed while the dwell continued — because the missing act was the
**dispatch after** the push, not the push. Check the trigger paths against
`git diff --name-only origin/main..HEAD` rather than from habit; a blanket "the push is the
apply" over-generalises a rule that is true only of the declared trigger paths.

**The dispatch and the state event are ONE act (v124), and so are the push and the tester
dispatch.** A turn that pushes green work and does not dispatch its validation has not
finished; record the deferral explicitly or dispatch.

### F8a.2. A DEFER BUYS TIME, NOT IMMUNITY [v155]
§F8a.1 made an aged backlog item block until a DECISION is recorded, and made a dated
`defer_until:` the cheap honest answer. That was right and it stays. **What it missed is that
the same cheap answer can be given for ever.** An in-date defer exempted an item no matter how
many times it had been re-dated, so the gate was satisfiable INDEFINITELY WITHOUT MOVING ANY
WORK — and re-dating is the cheapest compliant action, so re-dating is what happened.

**MEASURED, OagEventSource 2026-08-27:** one 36-item batch had been mechanically re-staggered
**TWICE in 9 days** (2026-08-18, 2026-08-19), items 22–25 days old re-dated three weeks out,
and **not one of them reached `done` in between**. The gate reported satisfied throughout,
because every individual defer was legal and in date. **The check measured DECISION and never
MOVEMENT** — this project's control-satisfiable-without-achieving-its-purpose family (§17i)
arriving in the flow gate itself.

So `loop-gate` gains a **total-age CEILING** (`--max-defer-total-days`, default 30): past it an
in-date defer stops exempting the item, and the three available answers are **SCHEDULE**,
**DECLINE**, or **ESCALATE to a named party**. Re-dating is not one of them. §F8a's prohibition
is unchanged and restated in the remedy text: **do NOT close a real finding to clear this gate.**

**Keyed on TOTAL IN-QUEUE AGE, not on a defer COUNT**, and the reason is worth keeping: the
count is recorded nowhere (frontmatter holds one value, overwritten on each re-date), whereas
age is already computed and is exactly the quantity serial re-dating is used to hide. A rule
that needs a number nobody stores is a rule that cannot fire.

**The ceiling sits well above the 7-day decision threshold on purpose.** A defer is a
legitimate instrument for a genuine wait and must stay cheap; only *serial* re-dating is the
failure. 30d ≈ four re-dates at the threshold.

**And if a whole CLASS is real but never pulled, that is a CAPACITY decision for the retro, not
a dating decision** — see §F2d. Target: gross lead time (state `open`, the standing constraint).

Pointers: `loop-run.md` step 0b. Citations: mechanised-not-documented [EXP-123]; the
recurring root cause and both compounding orchestrator errors are logged in
`principle-failures/2026-08-01-loop-obligations-as-judgement-are-skipped.md`.

## F2d. A STARVED CLASS needs a standing allocation, not better intentions [v155]
Measured, OagEventSource 2026-08-27: intake held 127 items against a cap of 10, and the driver
was **not** backlog size. It was that **process/tooling debt (the `OI-*` class) had no standing
capacity**, so it was only ever re-dated while every WIP slot went to production defects — WIP
was **6 of 7 slots `DEFECT-*`** at measurement. The same 36-item batch had then been re-staggered
twice in 9 days with nothing reaching `done` (§F8a.2).

**The corrective is capacity, not diligence.** When replenishing Ready, if intake holds any
item of a class that has produced no `done` in the previous cycle, **at least one pick must come
from that class.** Prefer the cheapest genuinely-ready item in it — the point is to prove the
class can move, not to move the most.

**Evidence it works, from the cycle that found it:** replenishment was deliberately steered to
that class and **both picks closed inside the same session** —
`OI-GH-WORKFLOW-CAPTURE-REFRESH-OWED` (a 19-day-stale capture, three registry entries modelled
rather than observed) and `OI-WI-VALIDATE-IGNORES-DERIVED-STATE-LEGALITY` (which landed
invariant **I8** and revealed the `derived:` block was never parsed at all). 2-for-2 in one
cycle, against 0-for-36 over 9 days without it.

Target: gross lead time (state `open`). **Falsifier:** if the reserved pick does NOT close at a
higher rate than the unreserved class over three cycles, the reservation is not the lever and
this rule dies rather than being re-tuned.

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


## F9a. A role that DOES the work may always RECORD its outcome [v156, ROC]

**No role's only legal forward move may be a statement it believes false.** This is a
constraint on the type graph and on every future edit to it.

**The evidence.** From `reproducing`, an engineer's only forward event is `confirmed`. An
engineer that performs a reproduction and finds the premise FALSE therefore has **no legal
event of any kind** — not even an annotation. Measured 2026-08-27: an engineer reproduced
`DEF-ROC-063` across six viewports (60/60 checks, exit 0) on the deployed host, found the
report false, and had to write its verdict to a scratch file and hand it back. It declined
to fire `confirmed`. **The graph's only affordance for an honest negative was a false
assertion**, and `confirmed` feeds the defect-confirmation and MTTR measures.

The mirror case, same cycle: an engineer that sharpened `DEF-ROC-071`'s stated mechanism
while building adjacent code could not append it (`amended` excludes `engineer` from
`reported`). Instance 9 shows the graph COMPELLING a false record; instance 10 shows it
SILENTLY DISCARDING a true one. **The engineer is the role most likely to disprove or
sharpen an unpulled item's premise — because it reads the surrounding source in anger —
and it is the one role that cannot say so.**

**So:** whenever a transition's domain is widened or an allowlist is edited, assert that
every role which can reach a state can also record what it found there. `DEF-ROC-128`
(ten recorded instances across five roles) is the implementing item.

**It may NOT be closed by adding one more role to one more allowlist** — that would be the
fourth such extension. Attribution integrity is a real requirement and is what
`EXP-ROC-002` protects, but it is currently enforced by conflating *"you may not
impersonate someone else"* with *"you may not report what you found"*. Those are separable,
and separating them is the fix.

**Target metric:** lead time — specifically the `reported` state, **29.78% of GLT at
median 8.7h/item across 98 items**, whose root cause is that the orchestrator is a
mandatory serialisation point for the first transition of every defect.

## F9b. A finding is registered WITH its triage decision, in the same act [v156, ROC]

**The role that finds something holds the context to decide it. Deciding later is a second
dispatch that may never come.**

Measured 2026-08-27, and it is the orchestrator's own failure: seven findings were
registered in one cycle (`DEF-ROC-125` … `DEF-ROC-131`, `OI-ROC-012`) and **one** was
triaged. Six items were added to `reported` — the queue the same retro then named as the
exploitable constraint. Every finding was real, and §F8a rightly forbids closing one to
shrink a number; but **registering a finding and not deciding it converts discovery into
inventory.**

So at registration, the discovering role records ONE of:
- **triage it now** (for a defect: `triaged`, which is the orchestrator's event — so an
  orchestrator that registers a defect triages it in the same turn); or
- **an explicit dated defer** with the reason and a near date tied to a named
  precondition; or
- **decline it**, with the reason.

**Intake gains NO cap from this rule.** Little's Law governs WIP, not backlog depth
(v126), and blocking on backlog inverts the constraint. This acts on the ARRIVAL, not the
depth.

**Note the interaction with §F8a.2:** a dated defer no longer exempts an item past a
total-age ceiling, so a far date on an already-aged item does not buy the time it appears
to.

### F9b.1 — a defer under SEVEN DAYS is not a decision [v157, ROC]

**AMENDED, and this reverses the "pick near dates" advice above, which was wrong.**

v156 said to pick near dates tied to preconditions. Measured one cycle later: §F9b was
honoured **9 of 9** — every finding registered since the v156 close carried a decision in
the same commit that created its file — and `reported` still rose from **29.78% to 31.32%**
of gross lead time, median **8.7h → 13.0h**. **Six of the nine decisions were the identical
`defer_until: 2026-08-28`, written in one batch, expiring inside thirteen hours.** Every
one was back in front of the gate by morning.

So the rule is not "decide", it is **decide something that schedules**:

- A `defer_until` must be **at least `DEFAULT_MAX_BACKLOG_AGE_DAYS` (7d) in the future**,
  measured from now, or it does not count as a decision at all. The arithmetic is the
  whole argument: check 4 grants seven days of silence for free, so a defer inside seven
  days buys **exactly nothing the item did not already have**. It costs one line,
  satisfies the gate, and re-poses the same question a few hours later.
- Measured from **now**, not from queue entry. From entry, any future date trivially
  clears the bar on an already-aged item, so the rule would protect arrivals and do
  nothing about daily snoozing in the 7d-to-30d window below the total-age ceiling.
- **A genuinely short, bounded wait is not what this forbids.** "Check back in four hours,
  CI is running" is a `blocked` park with a re-checkable probe predicate — the graph
  already supports it and `loop-gate` check 5 already re-reads it every cycle. That route
  stays open and is the honest one.

Mechanised as `_defer_is_decision`, shared by `loop-gate` check 4 and the new check 17
`undecided-arrival`, which reads the CYCLE clock (since the last retro close) where check
4 reads seven days — because §F9b's whole claim is that the decision is owed at
REGISTRATION, and an arrival is invisible to a seven-day limb for a week.

**The generalisable lesson, which outlives this rule:** ask of every control not only *did
the rule fire* but *did the quantity move* — and where they disagree, believe the quantity
and go looking for the cheapest legal way to satisfy the rule, because that is what will
be happening. §F9b's compliance was perfect and its effect was negative.

**Target metric:** lead time — the `reported` state share above. **Anticipated effect:**
the median dwell in `reported` falls, because arrivals carry a decision that actually
schedules. Scored on `EXP-ROC-009`, which **dies at strike 2** if the median does not fall
at v158.

### F9c. The retro's own outputs are gated too [v157, ROC]

**Every producer in this system is gated except the one that writes the gates**, and that
is why the same constraint survived five retros that each identified it correctly. Item
transitions are edge-checked; a test must name its criterion; a park must carry a probe; a
deploy must show its `needs` closure. A fold-back, an improvement slice and a routed rule
were checked by nothing.

- **`loop-gate` check 18 `reconcile-latency`** — §0a Rule 4 mechanised. Unmerged
  `main..HEAD` commits older than 12h BLOCK **when the integration tree is clean** (so
  `make project-foldback` would exit 0: one command, always available) and are ADVISORY
  when it is dirty (fold-back would exit 3 by design, and blocking on a remedy the loop
  cannot reach is the `DEF-ROC-083` unsatisfiable-gate failure). Baseline at v157: **37.4h,
  12 commits**, third consecutive rise, integration tree clean throughout.
- **`loop-gate` check 19 `retro-output-unbuilt`** — an OPEN improvement slice cited by an
  ACTIVE registry row **this project owns** BLOCKS, because that row is being scored
  against a mechanism that does not exist: it will exhaust its three strikes and be
  archived as *"no measurable effect"* when the truth is *"never built"*. **A false
  negative is worse than no row** — it retires the hypothesis AND records an untrue
  reason. Another project's rows are ADVISORY only (§25a v143/v145: report and add a
  strike, never retire). The remaining open slices are reported as aging inventory, which
  every retro owes a decision exactly as §F9b requires of a finding.
- **When a slice is not built, PAUSE its row's clock — do not score it and do not retire
  it.** Record the resume condition, and let check 19 keep reporting the slice every run
  so the pause cannot become a silencer. `EXP-ROC-004` is the founding case.

## F9d. The intake cap gates ARRIVAL, not the pull — admission by displacement [v158, ROC]

**Owner ruling, 2026-08-29: _"the lead time on everything is going up and up"_ and _"the
art is finishing things."_**

**The measurement that settles it.** Over the trailing 14 days ROC registered **179** items
and finished **83** — arrival:completion **2.16 : 1**, net **+96**. July net **+49**, August
net **+99**. Two days carry most of it (2026-08-18 **+38**, 2026-08-27 **+26**): batch
finding-generation, from retros and gate sweeps. A queue fed at twice its drain rate makes
rising lead time a **mechanical certainty**, not a puzzle. This is why `orchestrator`/
`reported` has been the named constraint for **six consecutive reads** while every remedy
aimed at it succeeded on its own terms.

**The error this corrects, and it is a real misreading of our own rule.** v126 made
intake-over-cap **advisory** for the **pull**, and was right: the remedy for a deep backlog
is to deliver faster, so a block that stops delivery inverts the constraint. v156 then wrote
*"Intake gains NO cap from this rule. Little's Law governs WIP, not backlog depth (v126)"* —
carrying an argument about the **drain** across to the **feed**. Those are opposite
interventions. Blocking the pull suppresses the drain; capping arrival suppresses the feed.
**Little's Law does not merely permit the second, it prescribes it:** L = λW, and with λ
(arrivals) at 2.16× the departure rate, W rises without bound whatever we do downstream.
For three versions every remedy went at the *quality of the decision* — §F9b (decide at
registration), §F9b.1 (a defer under 7d is not a decision), §F9c (gate the retro's own
output) — and **not one went at the number of arrivals.**

**And the decisions did improve.** §F9b was honoured **9 of 9**; v157 re-decided 17 findings
onto a real staggered schedule. Intake still grew. That is the finding: **a decision is not a
finish.** A decided item still sits in the queue accumulating dwell, and it counts in `L`
exactly as an undecided one does.

### The rule

**When intake is AT or OVER its `wip_limit`, a new finding is admitted only by DISPLACEMENT.**
In the same act that registers it, the discovering role must do one of:

1. **Decline an existing intake item**, with the reason — the new finding takes its slot; or
2. **Attach the finding as evidence to an existing item** rather than creating a new one
   (the cheapest and usually the most honest option — see the duplicate/subsumption sweep
   below); or
3. **Decline the new finding at birth**, recorded with its evidence so it is findable if it
   recurs.

Registration without one of these is refused. **Below the cap, arrival is unrestricted** —
this is a cap, not a tax on discovery.

### The objection this must answer, because it is the strongest one

**§F8a says: never close a verified-real finding to shrink a number.** That rule stands and
this does not repeal it. The resolution is that **the choice was never "keep it or lose it"**:

> An item that sits in a queue for fifteen days and is never pulled **is already a decline**
> — one nobody wrote down, that cost fifteen days of lead time to not-decide, and that
> misreports itself as planned work in every view.

So the distinction §F8a draws is between closing a finding **as if fixed**, or to make a
metric look good — still forbidden, and a lie — and **declining it with its reason recorded**,
which is an explicit, honest product decision that we accept this defect. The second is what
this rule requires. **Say plainly what is being accepted.** The oldest ROC intake item is
14.7 days old against a whole-project finish rate near 6 items/day; pretending 54 items are
scheduled work is the less honest position.

### Anticipating the evasion — because every rule here has been met by its cheapest legal move

v157's lesson, stated generally: *ask of every control not only did the rule fire, but did the
quantity move; where they disagree, believe the quantity.* So, in advance:

- **The displaced item may not be the one just registered**, nor one created this cycle. That
  is self-satisfaction, and it is the obvious cheap move.
- **A displacement is not a re-defer.** Moving an item's `defer_until` is not declining it and
  does not free a slot; §F9b.1 already governs defers.
- **Batch registration does not get a batch exemption.** N findings at the cap need N
  displacements. A retro that generates 40 findings in a day is exactly the event this rule
  exists to price — and pricing it is the point, not a side effect.

### Scored on EFFECT, not on compliance

**The scored quantity is the trailing-14-day arrival:completion ratio, and the target is
≤ 1.0.** Not "did every registration carry a displacement" — that is the compliance reading
whose perfect score coexisted with a rising metric at v157. Baseline at v158: **2.16 : 1
(179 / 83)**. Secondary: intake depth (54) and the `reported` share of gross lead time
(33.78%, median 37h, n=105).

**If the ratio does not fall below 1.5 by the next retro, this rule is wrong and should die
at strike 2** — the same commitment `EXP-ROC-009` carries. The honest alternative it would
lose to: that findings are not over-generated at all, and the real fault is that the system
finishes too little (see F9d.1, which is the other half of this and may be the larger half).

### F9d.1 — a cycle that runs at WIP occupancy 1 of 8 is the other half [v158, ROC]

**Capping arrivals only helps if the drain is real, and ours is barely running.** The numbers
that make this a peer of the rule above, not a footnote:

- v157 recorded `wip` occupancy at **1 of 8 all cycle**, and that one item had **no recorded
  activity for 23h** of it.
- v157 also recorded that the cycle ran **as a single session with ZERO subagent dispatches**
  — an orchestration loop that dispatched nobody.
- Agent work-effort is **0.2% of gross lead time** (§F). Everyone doing the work is **11.98%**
  of GLT combined (§B).

**The system is not slow. It is idle.** Which is why five retros correctly declined to
ELEVATE (add capacity): capacity is not the constraint when it is 99% unused.

So: **the loop's obligation is to FILL WIP, not to pull one item and report.** Concretely,
when the maximal independent set comes back smaller than `wip_limit`:

- **A pull of K < `wip_limit` is a finding, not an outcome.** Record why. "The independent set
  was 1" is a statement about the *dependency model*, not about available work — with 54 items
  in intake, a system that can only work on one thing has a modelling problem or a seam
  problem, and both are fixable.
- **Look across TYPES before concluding the set is full.** Defects and machinery items are
  usually file-disjoint from UI use-cases; a three-way collision inside one React file
  (`OverviewPage.tsx`, this cycle) caps the *use-case* set at 1 and says nothing about whether
  a defect could run alongside it. Ready holding only same-seam items is itself the finding.
- **Resource-class exclusivity is real and stays** (§F2b — e.g. an edit to `work-items.py`,
  the sole writer every `wi-append` calls, runs alone). The point is that exclusivity should be
  *named and rare*, not the accidental default.

**Target metric:** lead time. **Anticipated effect:** median `wip` occupancy per cycle rises
from 1 toward `wip_limit`, and the completion rate rises with it — which is the denominator of
the ratio §F9d is scored on. **The two limbs are scored together, and they can fail
independently:** if arrivals fall and completions do not, we have bought a smaller queue and no
delivery, which is not what the owner asked for.

### F9d.2 — the arrivals are REQUIREMENTS, not findings, and §F9d above would not have stopped them [v158, ROC]

**Written within the hour of §F9d, against §F9d.** A flow-manager sweep of all 54 intake
items went looking for the generating mechanism behind the 2.16:1 ratio and found it, and it
is not the one §F9d prices.

- **2026-08-18 (+38 net).** Sixteen requirements — `REQ-ROC-007` … `REQ-ROC-022` — registered
  **in one sitting**. That is the source event.
- **2026-08-27 (+26 net).** Twenty-two arrivals, **every one `agent: product`**:
  `CHK-ROC-014`…`018`, `SLC-ROC-030`…`037`, `UC-ROC-108`…`116`. This is `/slice-next` JIT
  replenishment (§F3) **working exactly as designed** — decomposing the 08-18 requirements
  ahead of Ready starvation. **It is not a defect and must not be "fixed".** It is the
  cascade, and treating the cascade as the fault would break the replenishment that keeps
  the loop fed.
- **A third, quieter source:** roughly half the 43 intake defects are self-referential
  process/machinery findings thrown off by agents doing real work against the young v82
  substrate — every dispatch stress-testing a gate for the first time. Expected to taper.
  A real tax on throughput, **not noise to suppress**, and not the thing to attack.

**So §F9d has a hole, and it is the main one.** §F9d caps FINDINGS against the intake
`wip_limit`. The 08-18 batch entered through `/requirement`, the human gate, as
requirements — and would have passed §F9d untouched. **A rule aimed at the wrong producer
is the v157 failure repeating one layer out**, and it is recorded here rather than quietly
patched because the compliance reading of §F9d would have looked perfect through the exact
event that caused the problem.

**The rule: the requirement gate must state the downstream cost before the human accepts.**

A requirement is not one item. It is a commitment to a *cascade* of chunks, slices,
use-cases and the defects they generate, drawn down at a **measurable** finish rate. Sixteen
requirements accepted against a whole-project rate near **6 items/day** is accepting a queue
that cannot be drained, and nothing at the gate said so.

- At `/requirement`, before sign-off, the dossier carries the **current finish rate**, the
  **current intake depth**, and the **implied completion horizon** for what is being
  accepted — from `views/stats.md`, not from an estimate.
- **This does NOT refuse the human's requirements, and must never be implemented as a
  refusal.** §F5 makes requirement intake the human's call and that is unchanged. The
  process failure was never that too much was asked for; it is that **nothing showed the
  owner what accepting it meant.** Priced, the same sixteen may still be the right call —
  but then the queue depth is a chosen position rather than a surprise, and the retro stops
  re-diagnosing it every version.
- **Corollary for the loop:** when intake is deep, the honest report to the owner is the
  *horizon*, not the depth. "54 items" invites "close some". "At the current finish rate the
  bottom of this queue is nine weeks out" invites the decision that actually matters.

**Scored with §F9d on the same quantity** (trailing-14-day arrival:completion ratio). This
limb is the one expected to move it: the finding-generation limb governs the tail, the
requirement gate governs the head.

## F9e. An owner decision is a BLOCKED ITEM WITH A DEFAULT, never a question [v158, ROC]

**Owner ruling, 2026-08-29, and it names the constraint more precisely than six retros
did:** *"you have work you can be doing but you keep stopping to ask me questions instead
of blocking items, recording the decision and giving me an async way to handle those
blocks"* — and, plainly: *"you can hardly work for an hour without my help."*

**That is a correct description of the measured constraint, from the other side.**
`blocked` is **27.28%** of gross lead time at a median **8.8 days** across 15 items, and
`orchestrator`/`reported` is **33.78%**. Both are the same failure wearing two labels: the
loop reaches a point where it needs a judgement, and **stops**. The founding case is
`DEF-ROC-035` — escalated 2026-08-25 with three clean, well-formed options, and still
unanswered **four days later**, because the escalation existed only as a sentence in a
transcript. A question the owner must be PRESENT to receive is not an escalation; it is a
stall with good manners.

### The rule

**Never ask a blocking question. Convert it, in the same act:**

1. **Block the item** with the reason as a checkable predicate (§F7a).
2. **Record the decision** — the options, and a **RECOMMENDED DEFAULT** with its reasoning.
3. **Publish it to the async surface** — `work/<project>/open-decisions.md`, one row per
   decision, carrying the default and a **DECIDE-BY date**.
4. **Keep working.** Take the next independent thing.

**If the decide-by date passes with no answer, the DEFAULT IS TAKEN and the loop
proceeds.** Silence is a decision and is recorded as one. This is the load-bearing half: a
default that merely waits politely is the same stall with an extra file.

### Choosing the default — the constraint that makes this safe

**The default must be the REVERSIBLE option**, and its cost if wrong must be no more than
the work done under it before it is overturned. That is what makes taking it without an
answer legitimate rather than presumptuous. Where no option is reversible, the default is
the one that **preserves the most optionality** — and that case is rare enough that
genuinely irreversible acts (§0b prod-DATA, an outward-facing side effect) remain the small
set that really does wait.

### What still reaches the human, and what no longer does

- **Still a live gate:** requirement intake (§F5), and a genuinely irreversible operation.
- **No longer a stall:** every "which of these should I do" — architecture options, label
  wording, descope-or-wait, provisioning that is outside our control. Those become rows.
- **The unbounded wait is the specific thing this kills.** An item parked on an external
  precondition nobody has committed to is a decline nobody wrote down (§F9d). It gets a
  default of *descope or decline*, a date, and it moves.

### Why the surface, and not just the default

Two independent failures this cycle, both real:

- The owner **could not see** what was waiting on them. Four decisions were outstanding and
  each existed only in a different part of a transcript.
- The orchestrator **kept re-raising** them, spending the report on questions instead of
  results — which is how "report the horizon, not the depth" (§F9d.2) gets inverted into
  "report the blockers, not the progress".

A single durable file with defaults and dates fixes both: the owner reads one place on
their own clock, and the loop never has to ask twice.

**Target metric:** lead time — specifically the `blocked` share of GLT (27.28%, median
8.8d) and the count of items parked on an unbounded external wait. **Anticipated effect:**
`blocked` median falls as parks acquire dates and defaults instead of open-ended waits, and
no cycle ends with the loop idle for want of an answer. **Scored on `EXP-ROC-013`.**
**NEGATIVE — kill it — if:** decisions are published but the defaults are never taken when
dates pass (the surface became a nicer waiting room), or if a taken default causes rework
costing more than the wait it saved.

## F9f. A live probe is not evidence until it has been run adversarially [v159, ROC]

**Measured 2026-08-29, and the engineer that found it had already reported the probe as
evidence twice.** `UC-ROC-112`'s live probe passed **7/7 twice** — and both greens were
wrong for a reason neither the probe nor its author could see:

> *"The probe counted rows the instant the `<h1>` appeared — which is when the view
> MOUNTS, before its fetch resolves. Every count had been 0 and every expected answer had
> been 0, because the window happened to be empty that hour, so **a race read as
> agreement**."*

When the live corpus later gained one record, **3 of 7 cases failed immediately**:
`unhandled: tile=1 rendered=0` — the list showed nothing. A second case failed more
sharply still: while the fetch is in flight there are no records and no active filter, so
the toolbar is **not rendered at all**, and every control assertion had been reading an
*absent* element rather than an empty one.

**The part that generalises, and it is why this is a rule and not a defect note:** that
probe already carried a *count-vacuity guard* — an explicit `DISCRIMINATING` marker
designed to stop exactly this class. **It sat directly on top of a timing vacuity and
never saw it.** A guard against one flavour of "passing for the wrong reason" is not a
guard against the others, and a green from an unfalsified instrument is not evidence.

### The rule

**Before a live probe's result may be quoted as evidence — in an item event, a validation
verdict, or a report — it must have been run in at least one condition its author did not
contrive.** Specifically:

- **Run it with default arguments.** All three of `UC-ROC-112`'s probe defects surfaced
  only that way: it had only ever been run with `ROC_EXPECT_SHA` passed explicitly, and
  run plainly it failed outright.
- **Run it against a non-empty corpus, and against an empty one.** A probe whose expected
  answer and observed answer are both zero has established nothing, however many
  assertions it carries.
- **Wait on the LOAD STATE, never on the expected answer.** "Not loaded yet" and "no
  matches" are different facts and must not render identically. An error surface is a
  failure, not a zero.
- **Make it fail once, deliberately, and watch it fail.** Two of the three defects here
  were in the probe's own identity and settling logic rather than in the feature — and the
  offline suite was green throughout and could not have caught any of them.

**Corollary for the orchestrator, which is where this bit hardest:** a validation verdict
inherits the weakness of the instrument that produced it. When a tester and an engineer
both run the *same* probe, that is **one measurement, not two**, and the agreement between
them carries no independent weight. Say so when reporting it.

**Target metric:** CFR, and quality at the validating stages. **Anticipated effect:** fewer
items closed on evidence that later proves vacuous; the `dev-validating` failure rate may
RISE first, which is the good outcome — a probe that can now fail is one that was
previously silent.

## F9g. A NOTE IS NOT A QUEUE — a finding recorded on an item dies with the item [v168, ROC]

`DEF-ROC-157`. A host-dependent assertion was found by an engineer, verified at source by the
orchestrator, and **independently confirmed by a tester with its own measurements**. The
orchestrator re-scoped the acceptance criterion and recorded the ruling as an `amended` event.
Then the item closed, the re-scope was never applied, and the defect is still on trunk. It
survived only because someone re-read the source afterwards.

**An event log is an append-only history of WHAT HAPPENED. It is not a carrier of WORK STILL
OWED.** When an item reaches `done` its notes move to `items/done/` and nothing reads them
again. This system has exactly one durable carrier for outstanding work — **a work item** —
and `open-decisions.md` is the single deliberate exception, created when the same lesson was
learned for owner decisions (§F9e: *an escalation that lives only in a conversation is one the
owner has to be present to receive*). This is that sentence, applied to an item.

**THE RULE.** Before an item leaves an active state, any finding, re-scope or ruling recorded
on it that the closing change does **not** discharge must be **registered as its own item**.
The test is mechanical and requires no judgement:

> *Is there a sentence on this item describing work that the commit I am about to close does
> not contain?* If yes, it is an item.

This binds the closing role — engineer, tester or orchestrator — not "someone later".

**The generalisation, which is worth more than the rule.** Three instances landed in one
session and they share a shape: a `lane:` correction recorded in an event whose edit had
actually aborted; a co-owned merge whose report read green while duplicating a row; and this.
**In every case the RECORD said the thing was done and only the STATE said otherwise.**
`CLAUDE.md` already requires re-reading a co-owned file out of HEAD after committing; that is
this rule in one narrow place. Generally: **after acting, verify the STATE, never the REPORT
of the action** — and that includes your own report.

## F11. The engineering step has an EXIT GATE: design metrics, coverage, and outside-in tests [v160, ROC]

**Owner ruling, 2026-08-29, verbatim and mandatory:**

> *"We need to add the code complexity analysis code tool that was built in the
> CodeAnalysisTools repository into the test step of this project. We need to constantly
> look at the numbers here (and ignore folders to do with items etc) in order to bring the
> measures of complexity and coupling down. We also should be tracking test coverage and
> ensuring its not going wrong. We also need to be testing things from the outside - we do
> not want to test functions, we want to test usecases. This is a process update and these
> things are mandatory - should be happening as part of the engineering step before being
> happy with being done for the tester to take over."*

**These are exit conditions on the ENGINEERING step.** An engineer does not report a use-case
or defect ready for the tester until all three limbs below hold. They are not advisory, and
they are not the tester's job to catch.

### Why an exit gate and not a report

`AeroCloudSystems/CodeAnalysisTools` was already wired into ROC — `code-analysis.yml`, on
push to `main` and weekly, already excluding `items/*` and auto-detecting generated files.
**It uploads an artifact and gates nothing, so nobody has ever read it.** That is this
project's most-registered failure family (`OI-ROC-014`, `IMP-021`, `DEF-ROC-140`,
`DEF-ROC-146`): a control that exists and is never consulted. A number nobody is accountable
to does not move.

### F11.1 — Complexity and coupling RATCHET DOWN

The analysis runs **in the test step**, not in a side workflow, and its headline measures are
held against a **committed baseline that may only shrink** — the `test-requirement-gate`
shape, which is already proven in this project.

- **Scope:** exclude `items/**` (the backlog: real work, but not code anyone reasons about,
  and it dominates the report). Generated files are excluded by the tool's own
  `detect-generated`, which reads the "do not hand-edit" banners — so `views/**` needs no
  hand-maintained rule. **Everything excluded is listed in `generated.csv`, so the
  exclusion stays auditable.** Never widen the ignore list to make a number move: that is
  the allowlist-widening anti-pattern `OI-ROC-006` retired.
- **The ratchet direction is DOWN.** A change that worsens the measure fails the gate. A
  change that improves it may lower the baseline. **The baseline may never be raised** — if
  a genuinely necessary change worsens a measure, that is an explicit, reasoned decision
  recorded on the item, not a silent re-baselining.
- **Read the hotspot and coupling reports, not just the totals.** A pair of files that keeps
  changing together is a design statement; the point of the tool is to act on it.

### F11.2 — Coverage as a REGRESSION DETECTOR, never as a target

**This limb must be reconciled with §17d, and the reconciliation is load-bearing.** v127
records the owner's ruling: *"I do not care AT ALL about code coverage. The ONLY thing tests
should be validating is the requirements. If we are making up tests for coverage that do not
map onto requirements then either (a) we are wasting time, or (b) we have identified a new
acceptance criteria."*

That ruling and this one are **compatible, and the distinction is the whole of it**:

- **Coverage as a TARGET is still forbidden.** Writing a test to raise a number is coverage
  theatre, and §17d's binary still binds: an untagged test is either waste (delete it) or an
  undiscovered acceptance criterion (register it, and the discovery gap earns a retro).
  `EXP-124` explicitly scores mass-tagging as FAILED.
- **Coverage as a REGRESSION DETECTOR is required.** A *fall* in coverage means something
  real: a use-case lost its test, or code shipped with none. That is a signal about
  requirements, not about a percentage. So the gate asks **"did it get worse?"** and never
  **"is it high enough?"** There is no target figure, and none may be introduced.

Held against a committed baseline on the same may-only-shrink ratchet. A drop is a **finding
to explain**, not a number to top up.

### F11.3 — ALL tests are outside-in, and the use-cases form a GRAPH OF VARIATIONS [amended by owner ruling, v161]

**Owner ruling, 2026-08-29, amending the first draft of this limb, which was too weak:**

> *"1. all tests should be outside in. 2. any tests that are not need to be routed back to
> a usecase and rewritten as outside in - and moreover we do not want duplicate tests which
> means we need to approach the collection of usecases as a graph of variations not as a
> list of unconnected tests."*

The first draft said internal tests were "subordinate, not banned". **That is superseded.**
The three clauses below are one rule seen from three sides.

#### (1) ALL tests are outside-in

The unit of test is the **use-case exercised through its own public surface** — the API for
a backend capability, the rendered UI for a screen. Not an internal function reached
directly.

There is no permitted category of "fast internal test kept alongside". A test that reaches
inside the implementation proves the code agrees with itself, and this project has the
receipts: v127's founding case built its precondition by deleting the very leaf whose
presence breaks the heal, and **2,171 tests were green while nine real cancellations sat
unhealed in production.** The test did not miss the bug; it encoded the bug's assumption as
its fixture. An outside-in test could not have been written that way.

**The seam under test is never stubbed** (§17d, unchanged) — stubbing the boundary you are
asserting across converts an outside-in test back into an inside-out one wearing the label.

#### (2) An inside-out test is MIGRATION DEBT, not grandfathered

Every existing test that is not outside-in must be **routed back to the use-case it is
really about, and rewritten from the outside.** It is not deleted (that loses the
requirement it encodes) and it is not left alone (that is the state this ruling rejects).

**This is a large, real backlog and must be treated as one.** ROC currently carries ~2,566
`src/app` + ~1,151 dashboard + ~203 injector tests against a use-case count in the dozens.
That ratio is itself the finding.

So it ratchets, on the mechanism already proven here: **the count of tests not attached to
a use-case variation may only SHRINK.** Never raise the baseline; never delete a test merely
to move the number — if a test genuinely asserts nothing worth naming, deleting it is
honest, but say which and why (§17d's binary: waste, or an undiscovered acceptance
criterion).

#### (3) The use-cases are a GRAPH OF VARIATIONS, not a list of tests

**This is the clause that makes the other two achievable, and it is the substantive one.**

A use-case is not one behaviour. It is a **happy path plus its variations** — alternate
flows, error branches, boundary conditions, absent-value cases — and those variations
**compose**. "Device breakdown" × "empty window" × "unrecognised parameter" is a region of a
space, not three unrelated files.

Model that space explicitly. **The unit of coverage is a VARIATION NODE, and each node is
certified by exactly one test.** Then all three of the owner's concerns become readable
facts about one structure:

| question | reading on the graph |
|---|---|
| is this test outside-in? | it is attached to a node, or it is attached to nothing |
| is this test a DUPLICATE? | two tests on the same node |
| is there a GAP? | a node with no test |
| what does this use-case actually do? | the shape of its subgraph |

**A flat list cannot answer any of them.** 2,566 tests tell you nothing about whether they
cover forty distinct behaviours or four hundred, and duplication is invisible by
construction — which is precisely why the count grew to that ratio without anyone deciding
it should.

**The graph is the artifact, and it is authored — not derived from the tests.** Deriving it
from what the tests happen to do would make it agree with itself, which is this project's
dominant failure family (§17i: a mechanism that cannot come back negative). The variations
come from the use-case and its acceptance criteria; the tests are then mapped onto it, and
the gaps and duplicates are what the mapping reveals.

#### (4) The graph is ROOTED IN PERSONAS

> *"to reiterate all the usecases should connect back to a persona"*

The full chain, and every link is mandatory:

**persona → job (JTBD) → use-case → variation → test**

A test therefore traces to a **person who wanted something**. That is what makes "is this
test worth having?" answerable instead of a matter of taste: a test attached to a variation
of a use-case that no persona wants is testing something nobody asked for, and a use-case
with no persona is a capability we invented.

**Measured 2026-08-29, and the result locates the break precisely:** all **116 of 116** ROC
use-cases already carry both `personas:` and `job:` in their authored frontmatter — zero
missing — against a catalog in `product/personas.md` and `docs/personas-and-jobs.md`, with
P1 and P2 dominant (75 and 79 references) across eight personas.

**So the chain is intact from persona down to the use-case, and broken below it.** The two
missing hops are use-case → variation (no variation graph exists) and variation → test (the
~3,900 tests attach to nothing). That is a much narrower problem than it first appears, and
it says where the work is: **do not re-do the persona and job modelling — it is already
sound. Build the two hops underneath it.**

Personas and jobs remain **reference artifacts, not work items** (`requirements-discovery`
skill): use-cases reference them by id. The variation graph hangs off the same ids.

**Connection to §17d, which this completes.** §17d requires every test to name its
`AC-<ID>.<n>`. That gives each test an owner but leaves the *set* unstructured — nothing
notices two tests naming the same criterion, or a criterion with three variations and one
test. The variation graph is the missing structure: `AC-<ID>.<n>` names the criterion, the
node names **which variation of it**.

### What the gate does NOT do

It does not replace the tester. The tester still validates in the deployed environment
against the real system (§17c: nothing is established until observed in a state that could
have come back negative). **This gate is about what the engineer owes BEFORE handing over** —
so the tester is validating a change whose design cost, test placement and coverage are
already known, instead of discovering them.

### Proof-of-fire is required, per §17c.2

**A gate is not a gate until it has been observed going RED.** Each limb must be demonstrated
failing on a seeded violation, once, and the demonstration quoted. A limb wired in but never
seen to fail is worth exactly as much as the artifact-uploading workflow this replaces.

**Target metrics:** lead time (a design that resists change is the slowest thing to change)
and CFR (an outside-in test catches what an inside-out one structurally cannot). **Guarded
on:** the requirement gate's floor must not rise, and `dev-validating` failure rate must not
rise — if it does, the engineering exit gate is passing work the tester then rejects, which
means the gate is measuring the wrong thing. **Scored on `EXP-ROC-014`.**

## F11.4. A GATE MUST ALSO PROVE IT SPOKE — non-execution is not a pass [v165, ROC]

`DEF-ROC-153`. The §F11 exit gate stopped running. Not red — **unloadable**. A third party
moved `CodeAnalysisTools`' floating `v1` tag onto an unreleased commit whose `action.yml`
puts input-only keys inside its `outputs:` block, and GitHub refuses to load such an action,
so the job died in **19 seconds during `Set up job`, before a single step ran**.

Every earlier member of this project's most-registered family was **a control we wrote that
could not fail**. This one is **a control someone else switched off** — no release, no PR
here, no commit of ours. It was found by a human reading a run list.

**1. Verify that the gate SPOKE, not only what it said.** `loop-gate` carried twenty checks
and not one asked whether the exit gate produced a verdict for trunk head. A gate that did
not run is indistinguishable from a gate that passed — `DEF-ROC-086`'s skipped-not-failed
shape reached by a completely different road, which is what makes it a rule and not a
patch. Where a gate's verdict is load-bearing, something must assert **a verdict exists for
this commit**. Absence of a verdict is a finding; it is never a pass. Note the honest limit
of the general form: a path-filtered workflow legitimately produces no run for some commits
(`DEF-ROC-142`), so the assertion is *"a verdict exists or its absence is explained"*, never
a naive "a run exists".

**2. ~~Pin third-party refs immutably.~~ SUPERSEDED BY OWNER RULING (v166): TRACK LATEST.**
The owner ruled the pin must go and that every run should take the latest release. Both
lanes are unpinned. The reasoning that produced the original clause is not wrong — a
floating ref is a value someone else can change without telling you, and one did, taking
this gate dark for three commits — but the owner's call is that currency is worth more than
determinism here, and **the trade is now defensible because the failure is detected**:
`make exit-gate-ran` reports a missing verdict instead of letting silence read as a pass.
Unpin only where that detection exists. `make action-current` enforces the ruling in the
inverse direction — **a pin is the violation** — and reports SPLIT when the lanes resolve
apart.

**3. A two-lane control is pinned in BOTH lanes, TOGETHER — and a TAG IS NOT A VERSION.**
This is the clause that cost the most, because it was created by the fix for clause 2.
Pinning CI to the v1.5.0 action SHA left `quality/analysis-config.json` naming the local
lane's image by the mutable tag `:v1`, which resolved to **v1.7.0** — so CI ran one binary
and every developer's `make exit-gate` ran another. That file's own header, written three
days earlier in good faith, promised *"same tool, same version tag, same flags"*: a tag is
not a version, and the two lanes had been free to diverge since the day they were written.
Where a control runs in two lanes to give one number, the two version references are ONE
fact and must move as one.

**4. ADOPT THE LATEST VERSION — AUTOMATICALLY, not as a reviewed bump (v166).** v165 wrote
this clause as *latest-by-review*; the owner ruled *latest-by-default*, and that is the
policy. There is no scheduled-bump step and no approval: each run resolves the ref afresh.

Two things carry over from the superseded wording because they cost nothing and remain true:

* **A version change can move the ratchet.** Before adopting a new major, diff the ratcheted
  outputs (coupling, complexity, hotspot, generated) across versions on the same trunk mirror.
  Done for v1.5.0 → v1.7.1: byte-identical. If a future version moves them, the ratchet has
  recorded a **tool** change as a **design** change, and the baseline must be re-cut with that
  stated — never silently absorbed.
* **Tracking latest is not a reason to trust the tag.** `@v1` is a major line that can point
  at unreleased, unloadable code, and did. The policy is not "the tag is fine"; it is "we take
  the newest, and we detect it when that breaks us".

**Generalisable shape, and it is the one worth carrying:** ask of every control not only
*"can this come back negative?"* (§17i) but *"can this fail to run at all, and would anyone
know?"* The second question has now been answered wrong twice here — once by a skipped job
(`DEF-ROC-086`) and once by an unloadable action — and both times the run list looked
untroubled to everything automated.

## F11.5. A GUARD THAT CAN SKIP MUST RECORD THAT IT SKIPPED [v169, ROC]

`DEF-ROC-157`. Three separate cases — `StatTiles` AC-112-6, `BreakdownTable` AC-113-2 and
AC-114-2 — noticed that contrast cannot be measured against a transparent colour and handled
it **by skipping the assertion**. Every input they ever saw was transparent. So all three
**asserted nothing, on any host, ever**, while reading green in every run and looking like a
complete check to anyone auditing the source.

**This is not §17i restated, and the difference is the point.** §17i asks *can this come back
negative?* — and each of these CAN: the assertion is real and would fire on an opaque
background. The defect is that **the input never arrives**, so the negative branch is
unreachable at runtime. The skip is also the correct local instinct, which is exactly why it
survived review three times.

**THE RULE.** A guard that may decline to assert must **record that it declined**. A declared
assertion that never runs is a **finding**, not a pass. Two acceptable forms:

* **Assert the precondition first** (what the fix used): `expect(isFullyTransparent(against))
  .toBe(false)` before measuring the property. An unmeasurable input becomes a RED.
* **Count the skips and ratchet them**, where skipping is legitimately expected. A skip count
  that may only shrink turns silent opt-out into a visible, reviewable number.

**What it cost to find:** the item was dispatched to fix ONE host-dependent assertion. The
sweep found three worse ones beside it, and **the reported defect was the least harmful of the
four** — a host-dependent check at least fails somewhere. So when you fix an instance of a
shape, **sweep for the shape**; and when you find a guard with a conditional around its
assertion, ask what happens when the condition is always false.

## F12. In a shared tree, a cleanliness check is a SAMPLE, not evidence [v162, ROC]

Measured 2026-08-29 by an engineer completing `DEF-ROC-143`, and it invalidates a habit
every agent here has:

> *"`git status --porcelain` read empty seconds before the merge failed on that file, so a
> cleanliness check taken once is not evidence in this tree."*

Up to eight agents share one working tree. **A check on the tree's state is true at the
instant it runs and says nothing about the instant you act.** Every `test -z "$(git status
--porcelain)"` gate in this process is therefore a *sample*, and the window between the
sample and the act is exactly where a concurrent agent's save lands.

**What follows, and what does not.**

- **The gates stay.** A sample that usually holds is far better than no check, and the
  index-emptiness gate (CLAUDE.md limit 2) has already refused a real sweep this session.
  This does not license skipping them.
- **But never report "the tree was clean" as evidence of anything.** It is evidence about a
  past instant. Where the claim matters, re-establish it **after** the act — the same
  discipline CLAUDE.md already requires for a co-owned append target: *re-read the file out
  of HEAD and assert its invariant*.
- **Prefer operations that cannot be invalidated by the window.** `isolated-commit.js`
  builds a **private index from HEAD** and never consults the shared one, so its correctness
  does not depend on a cleanliness sample at all. That is why it is the prescribed path.
- **Wait rather than force.** The same engineer was blocked ~2 minutes by another agent's
  dirty file, and **polled until it was clean** rather than stashing or merging over it.
  That is the correct move: `git stash -u` steals other agents' untracked files (CLAUDE.md
  limit 4), and merging over is silent loss.

### F12.1 — a commit can be ORPHANED by a concurrent branch move

Same session, same engineer: its first commit `6db6d42` was **orphaned by a concurrent
branch move** — afterwards `git merge-base --is-ancestor 6db6d42 HEAD` returned NO and it
was on neither `HEAD` nor `origin/main`. This is CLAUDE.md limit 3 arriving through a door
nobody was watching: not a `checkout` the agent performed, but one that happened *around*
it.

**No content was lost, and the recovery is the part worth copying:** the working tree still
held the change, so the engineer **re-ran every gate against the moved HEAD** — whose item
store had itself changed — and re-committed. It did not assume the earlier green still
applied to a different base.

**So: after committing in a shared tree, assert your commit is actually reachable** —
`git merge-base --is-ancestor <sha> HEAD` — and if it is not, re-validate against the new
HEAD before re-committing. A green obtained against a base that no longer exists is not a
green.

**Target metric:** CFR and rework. **Anticipated effect:** fewer greens claimed against a
base that has moved, and no silent loss from stashing or merging over a concurrent agent.

## F13. A SPECIALIST ADVANCES ITS OWN ITEM'S STATE — the orchestrator is not a state-machine clerk [v163, ROC]

**This is the v163 retro's exploit, and it names a constraint the orchestrator created
itself.**

### The measurement that forces it

v159 asked how to go 2.2x faster and answered: raise `wip` occupancy from **1 of 8**. The
next session took it to **8 of 8** — an eight-fold rise in concurrency. What came out:

| | v159 | v163 | factor |
|---|---|---|---|
| `wip` occupancy | 1 of 8 | **8 of 8** | **8.0x** |
| completions, trailing 14d | 83 | **119** | **1.43x** |
| agent work-effort | 116,737 s | **163,837 s** | 1.40x |
| arrival : completion | 2.16 : 1 | **1.60 : 1** | improving |

**Eight times the concurrency bought 1.4 times the throughput.** That is badly sub-linear,
and the gap is the finding: **capacity stopped being the constraint and the orchestrator
became it.**

### Why-chain

1. `orchestrator`/`reported` is the #1 GLT owner at **33.90%**, median **58,718 s/item**,
   n=114 — the **seventh** consecutive read.
2. It is #1 because **every** item's first transition and every subsequent state event is
   fired by **one actor**.
3. Raising occupancy 8x moved completions only 1.4x, so the specialists were not the limit.
4. That one actor also writes every dispatch brief, every commit message, every correction
   and every report — all serialised.
5. **ROOT CAUSE, and it is self-inflicted: the orchestrator instructs every dispatched
   agent "do NOT run any `wi-*` command."** Every state event therefore queues behind one
   actor by explicit instruction.

### Why that instruction existed, and why it is now obsolete

It was not arbitrary. It was written against a **measured** hazard: an engineer editing
`work-items.py` — the sole writer every `wi-append` shells out to — **froze every item
state change in the project for hours**, with 28 declines and six amendments staged and
unfireable. Centralising the writes was the correct response *to that hazard*.

**Two things have since changed it.**

- **`OI-ROC-006` landed**: 101 per-transition agent allowlists were removed and firing
  rights are now derived from the item's **declared owner**. An engineer firing its own
  `built_green` is no longer a spoof — it is the rights model working as designed.
- **The hazard is now named and bounded**: `§F2b` resource-class exclusivity covers the
  sole-writer case, and `IMP-034` is its structural fix. The blanket instruction was a
  *proxy* for that narrow hazard, and a proxy applied to every dispatch became the
  constraint.

### The rule

**A dispatched specialist fires the state events for the transitions it owns.** The
orchestrator fires only what it legitimately owns: `pulled`, `triaged`, `blocked`/
`unblocked`, `made_ready`, and the CI-confirmed `deployed` under a pipeline deploy (§F5a).

- **The blanket "do NOT run any `wi-*` command" instruction is RETIRED.** It may be issued
  only when a **named, live resource-class conflict** exists — concretely, another dispatch
  is mid-edit on `work-items.py` — and the brief must say which.
- **`AGENT=` is still never spoofed.** The point is not to relax attribution; it is that a
  specialist attributing its *own* work needs no intermediary. §F9a's rule — a role that
  performs work may always record its outcome, including a negative one — is what this
  makes routine.
- **`TOKENS=`/`DURATION_MS=` stay the orchestrator's to attach where it owns the event.**
  `OI-ROC-008`'s residue is unchanged: a dispatched agent cannot observe its own
  `subagent_tokens`, so a specialist firing its own event will carry no cost figure. That is
  a known, recorded gap — do not close it by having the agent invent a number.

### Anticipated effect and how it is falsified

**Target metric: lead time**, specifically the `reported` median and the `orchestrator`
share. **Anticipated:** completions rise super-linearly relative to occupancy next cycle,
because state transitions stop queueing behind one actor.

**NEGATIVE — kill it — if any of:** (a) `dev-validating` failure rate rises (currently
**9.2%**, the highest in the system), meaning self-recorded state is being claimed without
the evidence an orchestrator would have demanded; (b) `wi-validate` starts failing, i.e.
distributed writes corrupt the log; (c) attribution quality falls — a rise in events whose
`AGENT=` is contradicted by their own note. Scored on **`EXP-ROC-015`**.

## F13a. CORRECTION to F13 — the constraint is TURN-ENDING, and §F9.4 already forbade it [v164, ROC]

**Owner correction, 2026-08-29, within the hour of the v163 retro:**

> *"the slowdown really isnt the wi commands in orchestrator - the problem is the wait time
> for me to answer questions whilst you do not do things in the background"*

**This is correct and §F13's diagnosis was wrong.** §F13 stands as a real improvement — a
specialist should advance its own item's state — but it **cannot be the binding
constraint**, and one number forbids it: **agent work-effort is 0.2% of gross lead time.**
Even if the orchestrator fired *zero* state events, **99.8% of elapsed time would still be
wait.** A serialisation inside 0.2% cannot explain a 99.8% figure. v163 named a real
inefficiency and mistook it for the constraint.

### The actual constraint, and the rule that already forbade it

**The loop stops when the orchestrator stops talking.** Every turn that ends with work
available parks the entire system until the human re-prompts, and that dead time is
recorded in the item log as `reported` and `queue` dwell — which is why it *looks* like
bookkeeping latency and is not.

**§F9.4 already says this, in terms, and has since it was written:**

> *"ENDING THE TURN IS the stop, even with a polite report — parking the loop with 'I'll
> resume / refresh to confirm' still forces the human to re-prompt, and every restart is
> idle gross lead time. RULE: do not end the turn at a non-gate boundary."*

**So this is not a missing rule. It is an unobeyed one — violated repeatedly in a single
session by the role that owns it, while that same role wrote a retro naming a different
cause.** That is this project's most-registered failure family arriving at the top of the
process: a control that exists and is never consulted (`OI-ROC-014`, `IMP-021`,
`DEF-ROC-140`, `DEF-ROC-146`, and now §F9.4 itself).

### Why a prose rule is not the fix, and what is

§F9.4 has been prose since it was written, and prose is exactly what failed. **A rule
violated ~20 times in one session by its own author does not need restating — it needs a
mechanism**, which is §17c.5's standing prohibition on discharging a finding of this class
with prose.

**The mechanism is a self-scheduled wake.** The loop schedules its own next tick, so that
ending a turn does not end the loop:

- **When work is in flight or available, the orchestrator does not end the turn** — it
  dispatches the next thing in the same turn (§F9.4, unchanged).
- **When it must yield** — context, or a genuinely awaited external result — it
  **schedules a wake** rather than parking. The loop resumes on its own clock instead of on
  the human's next message.
- **The turn ends without a wake ONLY at a real gate**: §F5 requirement intake,
  requirement-complete, or a genuinely irreversible operation (§0b). **A blocked decision is
  NOT one of those** — §F9e already converts it into a dated default and the loop proceeds.

### The mechanism, built and proven (not prose)

`.claude/hooks/loop-continue.mjs`, wired as a **`Stop` hook** in `.claude/settings.json`.
The harness runs it when the turn ends — so this is enforced by something other than the
role that keeps breaking it.

It returns `{"decision":"block"}` when the loop **could have pulled and did not**, quoting
§F9.4 back and naming the depths. Three properties stop it being worse than the disease:

1. **It does NOT block merely because work exists.** `ready` is almost never empty here, so
   "block while any work exists" would make the session unstoppable. It blocks only on
   **capacity to act**: `ready > 0 AND wip < wip_limit`, or any `rework` (§F2 drains rework
   first). **Waiting on agents at cap is the loop working, not stalling.**
2. **It FAILS OPEN** — missing project, unreadable view, bad JSON, `ACTIVE=none` all allow
   the stop and say why on stderr. A hook that can trap a session on its own bug is worse
   than no hook, and this one sits at the top of the process.
3. **It is BOUNDED** — after 3 consecutive blocks it allows the stop regardless, so a fault
   here costs a few turns and never a session.

**The escape hatch is the point, not a loophole.** A legitimate stop is *declared*:

```
echo "<one line: why this is a real gate>" > work/<project>/.loop-yield
```

It is **consumed on use**, so it cannot persist into the next turn. Stopping becomes an
explicit, recorded act instead of the default — which is the whole difference between this
and the prose that failed.

**Proof-of-fire, all five arms (§17c.2):** blocks at `ready 2, wip 1/8`; blocks on `rework`
even at cap; allows on a declared yield and consumes the file; allows on the 4th consecutive
attempt naming the bound; fails open on corrupt JSON and on `ACTIVE=none`.

### How this is falsified

**Target metric: gross lead time**, specifically the share held by `reported` + `queue`
(currently **33.90% + 23.74% = 57.6%**), and wall-clock between an item becoming ready and
being pulled.

**NEGATIVE — kill it — if:** the loop wakes and does nothing useful (a tick that reports
"still waiting" is the polite report §F9.4 already forbids, wearing a scheduler's clothes);
or if unattended running produces work the tester rejects at a higher rate, i.e. speed
bought by dropping the evidence standard. **Scored on `EXP-ROC-016`.**

**Note what this does NOT license.** It is not permission to act without evidence, to skip
a gate, or to stop reporting. The report stays — it becomes **inline and terse**, alongside
the next dispatch, instead of being the thing that replaces it.

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
