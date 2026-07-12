---
process_version: 88
effective_from: 2026-07-12
supersedes: v86, v85, v84, v83, v82, v81, v80, v76
status: active
---

# Current Process — v88

<!-- v88 (2026-07-12, ROC — experiment-leanness + honest measurement reform, human-directed):
§25a — HARD WIP cap of 8 active experiments (retire one to open one); a fix is NOT an experiment
(fold as plain practice, no row); 3-strikes score-or-kill (unscored/unmoved at 3 opportunities →
killed); archive-with-outcome mandatory. §F3 — REVERTED the v87 "defer registration" idea as
metric-gaming; the honest lever for chain lead-time is independent decomposition, not deferred
counting; GLT rightly includes all waits/gaps/outages (minimise them indirectly). Plus: agent
per-stage cycle time (duration_ms) recorded alongside GLT; registry backfilled to the cap. -->


<!-- v85 (retro, AdixOut 2026-07-12; renumbered from a v84 that collided with main's concurrent v84 CORE-job-done-gate retro — both sets of learning coexist, only the version number was reconciled): constraint = QUEUE WAIT (ready 48.9% + registered 27.7% = 76.6% of GLT by owner `queue`), sample n=2 and heavily contaminated by non-system waits (mid-session org spend-limit outage, heavy human-steering gaps, deliberate serial-build pacing) — treat DIRECTIONAL, not a capacity signal. CFR 33% from ONE rejection (UC-ADIX-003 deploy-race), a GOOD catch. Changes routed this cycle (all already applied + folded): aws-architecture IaC default CDK→SST v3 Ion; ADR-0006 (release/provenance) + ADR-0007 (tagging) encoded into aws-architecture §9a/§2a; 3 principle-failures (rushed-to-register-before-understanding; skipped-solution-architecture-gate→wrong-IaC; build-identity-claimed-before-code-live); documenter standing duty (living root README); safe-deploy stream-drain (AdixOut cicd). Forward lever for the queue constraint = per-UC worktree isolation so the inner loop's maximal-independent-set actually builds in parallel (improvement-slice IMP-017, deferred — validate on a cleaner sample). Token review: 811k delivery tokens for 2 UCs; dominant WASTE = the CDK→SST full-infra rebuild forced by the skipped architecture gate — the gate fix (check tech choices vs org before build) is the token lever too. -->
<!-- v87 (ROC retro 2026-07-12): §F0 — per-item board push + docs-refresh are HARD in-cycle invariants (board never lags item-file state by >1 cycle; documenter required at each slice close); founding lapse principle-failures/2026-07-11-board-and-docs-lag-during-loop.md. §F3 — register linear dependency-chain use-cases JIT per-UC, not batch up front (ROC: `registered` was 70% of GLT purely as a batch-registration artifact). BOTH folded as PLAIN process practice, deliberately NOT new experiment rows — enacting the same-retro directive to stop over-generating experiments and to fix DORA measurement. -->


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
a full retro only when the constraint SHIFTS. Target: gross lead time. [EXP-100]

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
