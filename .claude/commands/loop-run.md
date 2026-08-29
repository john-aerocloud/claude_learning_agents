---
description: Run the continuous pull-based inner dev loop (v40). Pulls the maximal independent set of ready use-cases, builds each TDD-on-trunk, deploys per-UC, validates in prod, replenishes the Ready queue just-in-time, and retros at the §F8 cadence. Runs until the queues drain and the requirement is done.
argument-hint: <project-name> [--max-cycles N]
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: if no project is named, use the machine-local `work/ACTIVE` pointer (per-instance — never fall back to another machine's project). If it is missing or stale, stop and suggest `/project-switch <name>`._

Act as the **orchestrator** for project **$1**, driving the v40/v41 pull loop
(process STAGE F). You hold dispatch authority; the **flow-manager** owns queue
state and flow decisions.

> **STEP 0 — FRESHNESS PRECONDITION (v92, EXP-113).** Before the FIRST pull, fold the
> current process layer forward: run `make project-update PROJECT=$1`. The loop must NOT
> run on a stale process — a stale instance re-runs already-fixed tools/agents and
> re-incurs already-fixed defects (evidence: an 8-versions-stale OFS instance re-hit the
> EXP-104 impacted-tests nested-repo bug 3× in one session, each a manual tester fallback,
> though the fix was already on `main`). This is the same fold-forward `/project-switch`
> runs on resume; entering the loop directly ("start the loops") skipped it. Handle the
> outcome exactly as §0a: exit 0 → proceed on the current process; exit 3 (DEFERRED, dirty
> integration tree) → proceed but report the owed update; exit 4 (CONFLICT) → stop and
> surface it (the one escalation automation cannot resolve). Skip only if `$1` has no
> `instance/$1` branch (non-worktree/standalone project).

> **STEP 0b — LOOP PRECONDITION GATE (v126, EXP-123, process §F8a).** Before EVERY pull —
> not just the first — run `make loop-gate PROJECT=$1`. **Exit 2 BLOCKS the pull**; the only
> permitted actions are the remedies it names. It is mechanical, never orchestrator
> discretion, for the reason §F8a records: in one cycle the four loop preconditions came due
> and the ONLY one honoured was the one that returned non-zero (`retro-debt`). The others —
> dispatch the tester once a fix is green and live, replenish below the Ready floor, respect
> a queue's `wip_limit` — were prose, and all three were skipped: two fixes already pushed
> AND deployed sat 35.5h and 27.3h awaiting a dispatch nobody made, Ready sat at 1 against a
> floor of 3, and intake sat at 14 against a cap of 10 (that last one is now an ADVISORY, not
> a block — see check 3 below).
>
> It checks (1) **stalled validation** — an item dwelling past `--stale-hours` (default 4) in
> a validation state whose latest `fixed`/`built_green`/`deployed` carries a `ref:`, i.e. the
> work is DONE and only a dispatch is missing; (2) Ready below `min_items`; (3) a queue over
> `wip_limit`; (4) retro debt due (§F8); (5) **awaiting observation** — every item parked in
> `awaiting_observation` (shipped, green, UNPROVEN) has its liveness predicate RE-RUN on this
> invocation, so an observation that has now landed BLOCKS for a tester dispatch, and a
> predicate that cannot be evaluated BLOCKS too (state-graph v9, §12d.3/§17c). It also runs DELEGATED checks: (16) the DEF-ROC-131 **deploy-lane** check (below — the only one whose remedy is a pull), (6) the §17d
> **test-requirement gate**, (7) the DEFECT-OAG-076 **worktree guard**, and (8) the
> DEFECT-OAG-091 **container reap** — which does not merely COUNT orphaned per-dispatch
> containers, it REMOVES them, because a reaper nobody invokes is the same class of failure
> as the missing one (§17e) and the loop is the only continuously-running workflow. Thirteen
> leaked DynamoDB Local containers once drove load average to 19.85 and made a two-file test
> run take 301 SECONDS instead of 877ms — 340x — killing four agents in a row and producing
> reds that were green in isolation, so this sweep is also what keeps every test result on
> this machine trustworthy. Its finding is ADVISORY and never blocks; a RECURRING nonzero
> count means dispatches are dying before `ddb-local-down`, which is a defect about the
> dispatch. Fix what it names, then re-run to confirm exit 0.
>
> **Check 16 — IS THE DEPLOY LANE OPEN? And it is the one check whose remedy is a PULL
> (DEF-ROC-131, owner ruling 2026-08-27: "we should not deploy things that are red — they
> should get fixed", and "fix the loops to fix things").** Until this existed, this gate
> carried nineteen findings and NOT ONE asked whether trunk CI was red — so the single
> condition that stops ALL delivery for a project was invisible to the mechanism whose whole
> purpose is holding the loop's preconditions. Measured 2026-08-27: four sequential genuine
> reds, each SKIPPING the deploy job (`deploy-test` declares `needs: [test-function-app,
> test-web-app]`, and a skipped job is a neutral dash that contributes nothing to the run's
> conclusion); UC-ROC-105 and UC-ROC-106 built green, committed, PUSHED and undeployable —
> therefore **un-validatable, because a tester cannot validate what is not deployed** — for
> most of a cycle; this gate run repeatedly through that window reporting OK every time; and
> the orchestrator finding out from an engineer's passing remark in a build report.
>
> It BLOCKS (`-` line, exit 2), and **the block is an instruction to DISPATCH, never a
> wait.** A limb that merely refused the pull would convert a deploy stall into a TOTAL
> stall, which is strictly worse. So it copies check 1's proven shape — name the failing
> job, name the owning item, name the exact remedy — and the remedy it names is *fix the
> red as this cycle's pull*. **It is NOT cleared by pulling something else and NOT cleared
> by waiting**; it clears when the deploy job goes green. Record `build_failed` on the named
> item BEFORE fixing forward (§3/EXP-108, recordable from every active state per
> DEF-ROC-120) or CFR reads a false 0%. If the red genuinely is not ours to fix, that is a
> `blocked` item with a named external precondition — never a silenced check.
>
> **It reads the DEPLOY JOB's own conclusion and its `needs` closure, NEVER the run's
> overall conclusion**, and that distinction is the whole limb. `Dependency audit
> (prod-runtime, blocking)` is red on EVERY push here (DEF-ROC-068, no upstream fix) and is
> deliberately not in the deploy job's `needs:`, so all three real captures the delegated
> tool is pinned against carry run conclusion `failure` **and one of them DEPLOYED**. A limb
> reading the run conclusion would fire permanently and be ignored inside a day. Equally it
> does not read a green-so-far run as a landed deploy: a Deploy job still `in_progress`
> renders as NOT ESTABLISHED (`?` line), because on 2026-08-27 the ROC health endpoint
> served the new `buildSha` mid-cutover — Function App swapped, Web App not — and
> dispatching a tester there measures a half-completed deploy. Read it ALONGSIDE check 15:
> 15 tells you the environment is N commits behind (the symptom, advisory); 16 tells you
> WHICH JOB shut the lane and WHO owns the fix (the cause, blocking). Standalone probe:
> `make deploy-lane PROJECT=<p> [JSON=1]`.
>
> **Check 3 has TWO severities (v126 addendum) — Little's Law governs WIP, not backlog depth.** A
> **WIP-stage** queue over cap (`ready`/`wip`/`rework`) BLOCKS (`-` line, exit 2). A
> **BACKLOG** queue over cap (`intake`) is **ADVISORY** (`!` line): reported with depth,
> overage and remedy, but it does NOT block — blocking on a deep backlog inverts the
> constraint, because the remedy is to deliver faster and the block prevents exactly that,
> while creating pressure to close real findings to shrink the number. An advisory-only run
> exits 0 and says so; the advisory is still outstanding, NOT satisfied — hand it to the
> flow-manager/retro as throughput work, and never close a verified-real finding to clear it.
> The classification is declared in `queues/policy.csv` as a `kind` row, not hardcoded.
>
> **Never conclude "it's pushed / it's deployed" from an event NOTE.** The gate derives it
> from the structured `ref:` verified against git; you must too. A note reading "NOT pushed"
> was ~35h stale while its commit had been on `origin/main` the whole time, and reasoning
> from it produced a confident, precisely-quantified, WRONG diagnosis (§17c Layer 2, against
> our own metrics).
>
> **A `ref:` is REPO-SCOPED — resolve it in BOTH repos, and read FOUR outcomes, not two**
> (DEFECT-OAG-128). This instruction used to say `git merge-base --is-ancestor <ref>
> origin/main` in `git -C work/$1`, and that was wrong in the most damaging way available:
> a **parent-lane** ref (`.claude/`, `process/`, `Makefile`) does not exist in the project
> repo at all, so the lookup did not answer *wrong* — it reported a **missing commit
> object**, which is the exact signature by which `DEFECT-OAG-072`'s destruction was
> diagnosed (`git cat-file -t fb080d9` → *fatal: Not a valid object name*). Seven refs in
> this registry read that way. So:
>   * **ON-TRUNK** — an ancestor of that repo's `origin` trunk. Pushed. (For the parent repo
>     in a per-project worktree the trunk is `origin/instance/<project>`, not `origin/main`.)
>   * **NOT-ON-TRUNK** — the object EXISTS but is on no origin trunk. Unpushed, **not lost**;
>     the normal state of parent-lane work, because the owner owns that push.
>   * **ABSENT** — every repo was readable and none holds it. **This is the only reading that
>     means work may have been destroyed.** Rescue first (`make worktree-guard DIR=--all`),
>     never re-run to see if it clears.
>   * **CANNOT-DETERMINE** — a repo was unreadable, so absence was never established. Not a
>     pass and not an alarm (§17i).
> `lane:` is **not** the routing key and must not be used as one: it is absent on 382 of 478
> items (79.9%) and it is single-valued while real items span both repos (`DEFECT-OAG-091`
> has a project ref *and* a parent ref). It is a **cross-checked assertion** — `loop-gate`
> check 12 reports a lane every one of its refs contradicts, and that is advisory, because a
> wrong `lane:` costs a misrouted *dispatch* (`make dispatch-check`, `DEFECT-OAG-076`), not a
> wrong push reading. Do not hand-roll any of this: read the gate's verdict.
>
> **The push and the tester dispatch are ONE act.** A turn that pushes green work without
> dispatching its validation has not finished — dispatch it, or record the deferral and the
> named precondition on the HELD item. And before holding any push, check the actual trigger
> paths (`git diff --name-only origin/main..HEAD`): "the push is the apply" is true only of
> the declared paths (`sst.config.ts`/`src/app/**`/`infra/**`), and generalising it into a
> habit is what produced the 35.5h hold on a path that never deploys.

> **v82 CUTOVER (process §F0).** State is event-sourced in per-item files
> (`work/$1/items/{active,done}/<ID>.md`); state = `fold(events)`. Change state ONLY via
> `make wi-append PROJECT=$1 ID=<id> EVENT=<e> AGENT=<role>` (edge-checked) — the stage
> events below (`made_ready`/`pulled`/`built_green`/`deployed`/`validated`/`build_failed`/`rejected`/
> `blocked`/`unblocked`) ARE those appends; nothing is hand-written to a CSV. Read
> queues from the DERIVED `work/$1/views/queues.md` (regenerated by `make wi-project`). Gate
> the resume with `make wi-validate PROJECT=$1` (I1–I4). Mirror touched items with the
> `linear`/`jira` projection agents. Metrics — incl. each part's contribution to gross lead
> time, quality, recovery — come from `make wi-project`. The DORA ledger is frozen.

**This is a CONTINUOUS BACKGROUND process (§F9).** It runs while there is ANY
work to do — any queue non-empty OR anything replenishable — and EXITS only when
**all queues are empty AND nothing is replenishable** (requirement complete →
ask the human for more work). It is NOT started on demand by the human: an
**enqueue-to-empty** (`loop_wake`, e.g. intake adding the first ready item)
restarts it without being asked. **Never** ask the human "start the loop?" or
"replenish or pull?" — those are autonomous (§F9). The human is touched only at
the §F5 intake gate (deploys auto-approve, §F5a) and at requirement-complete.

Each cycle:

1. **Check the buffers.** Dispatch `flow-manager`: read the per-queue buffer knobs
   from `queues/policy.csv` (this is a policy INPUT file — buffer config only:
   `min_items` floors + `wip_limit` caps; it is NOT stored queue state) and read the
   actual queue depths from the DERIVED `views/queues.md`. If `length(Ready or Intake)
   < min_items`, **kick off replenishment (step 2) as a PARALLEL track** (do not block
   the pull on it); if `length(Rework) > rework.min_items` (any rework present), drain
   Rework first; never exceed any queue's `wip_limit`.
2. **Replenish just-in-time — CONCURRENTLY (§F3/§F9).** Dispatch `product` to run
   ALONGSIDE the build of already-pulled UCs, not before it: more use-cases from
   the current slice → next slice → next chunk → (requirement done) ask the human
   for more work. Product values+costs each new item; flow-manager enqueues,
   re-costs (`vc_ratio`), re-prioritises (defects pre-empt). Replenishment and
   pulling/building never block each other.
3. **Pull the independent set.** First `make wi-validate PROJECT=$1` (drift gate; non-zero
   blocks the pull). Then dispatch `flow-manager` to return the maximal set of
   mutually-independent ready use-cases (≤ capacity `N`) from the items' `deps` edges
   (`views/tree.md`) + the claimed-path registry. Append `pulled` (AGENT=orchestrator) for
   each; note `achieved=K max=M` in the pull report.
4. **Run the inner dev loop for each pulled UC, concurrently** (isolated by §40
   flags, never branches): `cicd` (if capability needed) → `ui-designer`
   structure (if UI) → `engineer` (§F14: every cycle is REFACTOR → RED → GREEN — refactor on a green tree and commit it separately, then the failing test, then the code; on trunk) →
   `ui-designer` validate (if UI) → deploy (per-UC; **auto-approves under the §F5a
   policy assurance** — no human gate, §9a/§F5) → `tester` (validate in prod). Append the stage events
   via `make wi-append` as each completes: `built_green` (engineer, building→deploying),
   `deployed` (cicd, deploying→validating — fired after the per-UC deploy lands green),
   `validated` (tester, validating→done); `build_failed`/`rejected` on failure.
   Each stage `wi-append` carries `TOKENS=<n>` — the `subagent_tokens` the dispatched
   specialist reported for that transition — so the plumbing-vs-delivery cost-split
   (§E `token_cost`) is computed automatically by `make wi-project` from event tokens.
   It ALSO carries `DURATION_MS=<n>` — the dispatch's reported `duration_ms` (the
   agent's REAL wall-clock cycle time for that transition) — so the agent-cycle-time
   vs gross-lead-time block (§F `agent_cycle_time`) is derived by `make wi-project`.
   GLT stays the honest TOTAL elapsed; §F is its complement (work-effort vs wait/
   overhead), e.g. `make wi-append … EVENT=built_green AGENT=engineer TOKENS=<n> DURATION_MS=<n>`.
   - **PLUMBING EVENTS CARRY THEM TOO — otherwise §E cannot come back non-zero (v150, ROC).**
     `stats.md` §E has reported **plumbing 0.0% / delivery 100.0%** for three consecutive retros,
     each concluding "coverage too sparse to act on". That reading is wrong: `TOKENS=` was
     specified ONLY on the stage events (`built_green`/`deployed`/`validated`), and **all three
     are classified DELIVERY**, so the plumbing share is 0.0% BY CONSTRUCTION — a metric that
     cannot come back non-zero, which is §17i's class arriving in the cost split. Measured the
     cycle this was found: one `product` replenishment (**179,231 tokens / 549,039 ms**) and one
     `flow-manager` promotion (**76,532 tokens / 312,395 ms**) — 255,763 tokens and 14.4 minutes
     of unambiguous flow mechanics with **no event to record them on**. *Therefore:* the
     replenishment/flow events — `created`, `registered`, `made_ready`, `pulled`, `blocked`,
     `unblocked`, `collision` — carry `TOKENS=`/`DURATION_MS=` from the dispatch that produced
     them exactly as the stage events do. **YOU hold those numbers, not the specialist**: a
     dispatched agent generally cannot see its own `subagent_tokens`, and both dispatches this
     cycle correctly said so rather than inventing one — so read them off the dispatch result and
     attach them yourself, and never ask the agent to self-report a figure it cannot observe.
     - **LIMIT, measured within the hour of writing the rule above (`OI-ROC-008`): this is only
       executable for events YOU fire.** `built_green`/`fixed`/`validated` are fired by the
       engineer/tester themselves, and the numbers are visible only to you — so attaching them
       would mean appending under `AGENT=engineer`, which is the spoofed attribution v143 and
       `EXP-ROC-002` exist to stop, and it corrupts the very `by_owner` table the retro names the
       constraint from. Three dispatches in one cycle proved the gap: `product` 179,231 tokens,
       `flow-manager` 76,532, `engineer` 113,064 — every figure in the orchestrator's hand, every
       agent correctly reporting it could not see its own, and **no legal event to carry any of
       them.** So attach them on the events you legitimately own, and do NOT read a still-0.0%
       plumbing share as this rule failing — the residue is `OI-ROC-008`, which needs either a
       dispatch-cost annotation the orchestrator can attach WITHOUT owning the event, or a harness
       that exposes usage to the subagent. Never spoof `AGENT=` to close the gap.
   - **`deployed` under a PIPELINE (push→CI) deploy (2026-07-22, UC-ADIX-015).** When
     the deploy is pipeline-triggered (push to `main` → CI applies the infra), NO agent
     runs an interactive `sst deploy`, so none fires `deployed` automatically and the UC
     stalls in `deploying`, blocking the tester. YOU (the orchestrator) fire the
     CI-confirmed `deployed` (`AGENT=cicd`, `REF=<deployed sha>`, `NOTE` citing the green
     CI run) once you confirm the pipeline deploy landed green — engineers/testers must
     NOT spoof `AGENT=cicd`. (§F13 REVERSED v175 — NO specialist runs a `wi-*` command; the
     orchestrator executes every one, on the specialist's explicit report. Formerly:
     interactive per-UC deploys had cicd fire its own
     `deployed`.) principle-failure
     `2026-07-22-uc-adix-015-missing-cicd-deployed-event-blocks-tester.md`; an
     improvement-slice will move this emission into the CI pipeline itself.
   - **Collision** (a UC needs a seam/path another in-flight UC claimed, or a
     flag-compose failure): flow-manager emits `collision`, STOP the pair, add the
     missing edge to the model + `edge-ledger.md`, re-serialise (§19); the rework
     is a time thief.
   - tester fail → UC to **Rework**; MTTR clock; re-loop step 4 for it.
   - **Blocked-reason (§F7a):** whenever a UC is blocked (gate hold, collision stop, rework),
     `make wi-append ID=<uc> EVENT=blocked AGENT=flow-manager NOTE="<reason>"`; clear it with
     `EVENT=unblocked`. The blocked reason rides on the event note, so the board banner is
     DERIVED — there is no separate blocked-reason file to keep in step.
   - **Per-item board push — at MEANINGFUL transitions, in-cycle (EXP-117 cadence, v103):**
     dispatch the `linear` (and/or `jira`) projection agent for an id, in the SAME cycle, after a
     `wi-append` that reaches a **meaningful** state — **`pulled`** (work started), **`blocked`/
     `unblocked`**, and any **TERMINAL** state (**`validated`/`done`, `rejected`, `resolved`**).
     **SKIP** the transient intermediate pushes (`created`/`made_ready`/`built_green`/`deployed`/
     `dev-validating`) — they collapse to the same "In Progress" band a human cannot distinguish,
     and pushing each one was the largest plumbing-token cost with no fidelity gain (EXP-117).
     It reads the item file and upserts the one issue idempotently.
     **Invariant: a TERMINAL or `blocked` board status must never lag its item-file state by more
     than the current cycle** (the states humans act on). Intermediate in-progress detail may lag
     until the next meaningful push or the step-5b sweep. Only the external API *call* is
     best-effort (a network failure is logged; the next push/sweep reconciles) — the DISPATCH at a
     meaningful transition is NOT skippable. The step-5b full sweep is the periodic reconciling
     backstop for structure/prune AND for any intermediate drift; it is not the primary path for
     terminal/blocked fidelity. An item in `blocked` state shows Blocked on the board regardless of
     its queue.
5. **Done & bubble up.** `make wi-append ID=<uc> EVENT=validated AGENT=tester REF=<sha>`
   (same turn as the green push), then `make wi-project PROJECT=$1` — the item moves to
   `items/done/`, releases its claims, and slice→chunk→requirement done bubbles automatically
   from children (aggregate fold). Nothing to hand-transition.
   - **Note (dev-then-prod, §11b):** the `validated` (→done) event fires from
     `prod-validating` after the tester prod-validates; earlier the tester fired
     `dev_validated` (dev AC green) which AUTOMATICALLY triggered cicd's `promoted` prod
     deploy — the whole dev→prod promotion is unattended (no human gate, §F5a).
5a. **PARTS-CHECK — cheap per-close constraint read (process §5b, ToC).** After every
   slice/chunk bubble, read `views/stats.md` `by_owner`/`by_stage` and log ONE line:
   `constraint = <top owner/stage>; shifted since last close? y/n`. This is the
   after-every-piece review of the parts — no version bump, no full retro. It is cheap
   by design (one read, one line). **Escalate to a full §F8 retro (step 7) ONLY when the
   constraint SHIFTS**, or when the routine-batch/incident threshold fires (§F8). A
   stable constraint on a clean run does not pay full-retro overhead; a shifted
   constraint is real learning that a retro must walk (exploit/subordinate/elevate).
   **The routine-batch limb of that is REACHABLE (DEF-ROC-130).** Because this step
   runs after EVERY bubble, the cheap drain used to reset the routine counter on every
   run, so the batched routine retro could never fire. The two arms now have separate
   markers: the drain clears incidents only, and routine closes accumulate across
   however many bubbles it takes. Expect the OK line to report a climbing routine
   count and then, at the threshold, an exit 2 on the routine arm.
5b. **Full-sweep board reconcile — periodic BACKSTOP only (the primary path is the
   step-4 per-item push).** After a slice/chunk close, run
   `make board-sweep PROJECT=<project>` (the `linear`/`jira` projection agent uses the same
   target) to reconcile from the item files — mapping in `process/linear-mapping.md`.
   State-only mirror. Skip silently if the project has no board binding. Never block the loop
   on the API. This does NOT replace the per-item push — if you find the sweep is doing real
   work every time, the per-item push (step 4) is being skipped, which is the board/doc-lag
   failure.
   **Do NOT reconcile by looping `board-project` over every id (DEFECT-OAG-099).** That
   rewrote 269 already-correct items and then ran out of rate budget with 5 DONE items still
   showing Blocked; the same shape later left two TERMINAL items lagging for seven days.
   `board-sweep` skips items that already match, writes terminal/blocked lag FIRST, and on a
   rate limit names every id that did not land. **A failure here is logged, not fatal — but it
   is only "logged" if you QUOTE THE IDS.** Exit 3 means a shortfall: run
   `make board-sweep-resume PROJECT=<project>` in the same cycle, or carry the named ids
   forward explicitly. Exit 5 means the mapping drifted from `state-graphs.json` — run
   `make board-audit`; that is a defect, not a skip.
6. **Document — REQUIRED at each slice/UC close (docs must not drift).** Dispatch `documenter`
   to update the project README (and GitBook where bound) to match what just shipped — at
   every slice close, and for any UC that changes user-facing behaviour. Runs in the
   background, but is NOT skippable across a slice close: stale or absent user-facing docs are
   a process failure the same way a stale board is (the board/doc-lag failure). Keep it honest to shipped state
   (never document unbuilt features as done).
7. **RETRO-DEBT GATE — mechanical, not discretionary (§F8, v68).** Before pulling
   the NEXT work after any slice/chunk close or defect resolve, run
   `make retro-debt PROJECT=$1`. This is a **hard loop-state precondition, not a
   judgement call**: a **non-zero exit (code 2 = RETRO DUE)** means the loop MUST
   run `/retro $1` to drain the debt BEFORE it may advance — the orchestrator may
   NOT pull next work, and may NOT offer the retro to the human as a choice, while
   debt is outstanding. **Cadence (v69, EXP-085):** routine slice/chunk closes
   BATCH up to `--threshold` (default 3) before the gate trips; INCIDENT events
   (prod defect resolve / deploy failure) are never batched and trip the gate
   immediately. So a clean run of small closes won't force a per-slice retro, but
   a real incident always does. The retro drains the debt (recomputed by
   `make retro-debt` over item events; re-run it after the retro to confirm
   `ok` before resuming pulls). This makes "the retro fires automatically at the
   §F8 cadence" a checkable property of the loop machinery rather than a rule the
   orchestrator can skip by offering it to the human (the EXP-030 / v68 recurrence
   the gate exists to prevent). The retro tunes the per-queue buffers and `N` from
   the flow evidence; each tune is a scored experiment. Then continue the loop in
   the same turn (§F9.4 — do not end the turn at the retro boundary).

End each cycle by refreshing `make wi-project PROJECT=$1` and report from `views/stats.md`:
the pull set, queue depths vs buffers, **the current constraint (largest contributor to gross
lead time — the `by_owner`/`by_state` time-thief)**, quality/recovery at the binding stage, any
collision + edge added, and any human decision needed (intake — the sole §F5 gate).
