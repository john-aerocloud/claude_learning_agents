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
> predicate that cannot be evaluated BLOCKS too (state-graph v9, §12d.3/§17c). It also runs three DELEGATED checks: (6) the §17d
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
> from the structured `ref:` plus `git merge-base --is-ancestor <ref> origin/main` in the
> project repo (`git -C work/$1`); you must too. A note reading "NOT pushed" was ~35h stale
> while its commit had been on `origin/main` the whole time, and reasoning from it produced a
> confident, precisely-quantified, WRONG diagnosis (§17c Layer 2, against our own metrics).
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
   structure (if UI) → `engineer` (TDD red→green→refactor on trunk) →
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
   - **`deployed` under a PIPELINE (push→CI) deploy (2026-07-22, UC-ADIX-015).** When
     the deploy is pipeline-triggered (push to `main` → CI applies the infra), NO agent
     runs an interactive `sst deploy`, so none fires `deployed` automatically and the UC
     stalls in `deploying`, blocking the tester. YOU (the orchestrator) fire the
     CI-confirmed `deployed` (`AGENT=cicd`, `REF=<deployed sha>`, `NOTE` citing the green
     CI run) once you confirm the pipeline deploy landed green — engineers/testers must
     NOT spoof `AGENT=cicd`. (Interactive per-UC deploys are unchanged: cicd fires its own
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
5b. **Full-sweep board reconcile — periodic BACKSTOP only (the primary path is the
   step-4 per-item push).** After a slice/chunk close, dispatch the `linear`/`jira` projection
   agent in full-sweep mode to reconcile structure (create/prune the Project/Milestone
   hierarchy, catch anything the per-item pushes missed) from the item files (mapping in
   `process/linear-mapping.md`). State-only mirror. Skip silently if the project has no board
   binding. Never block the loop on the API; a failure is logged, not fatal. This does NOT
   replace the per-item push — if you find the sweep is doing real work every time, the
   per-item push (step 4) is being skipped, which is the board/doc-lag failure.
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
