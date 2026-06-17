# Version 2 — Pull-based delivery system (design)

Status: **IMPLEMENTED as process v40 (2026-06-08).** The live system now embodies
this design (see §12 *Implementation map* for the exact files changed). This
document remains the rationale of record. The v1 system is preserved verbatim
under `Version1/`; every v40 change is a registered experiment (EXP-020…EXP-029)
scored at future retros.

The goal is unchanged: agents that build software and **learn to deliver it
faster**, measured by DORA, improved by retros and experiments. What changes is
the *flow control*: v1 is **push** (a human runs `/slice-next` then
`/iteration-run`, pausing at four gates); v2 is **pull** (a continuous inner dev
loop pulls ready work from a costed, prioritised queue; planning happens
just-in-time to keep that queue from starving, and only two gates remain).

This is the same logic as the penny game: small batches, a shallow buffer, and
relentless visibility of *wait* — because wait, not work, is what dominates gross
lead time.

---

## 1. What v2 must achieve (acceptance for this design)

1. **Hierarchy with two-way links.** Requirement → Chunk → Slice → Use-case (→
   route steps). Every item records its **parent** at creation and maintains a
   **child index**, so the tree is traversable top-down and bottom-up.
2. **Per-item DORA.** Every item (requirement, chunk, slice, use-case, defect)
   carries its own lead time, wait time, service time, and — where it deploys —
   change-failure and recovery. Metrics roll up the tree.
3. **Queues as costed handover points.** Work is handed over through queues. Each
   queue tracks **length** and **wait time per item**; every item carries an
   estimated **value** and **cost** so the queue is **prioritised** and re-costed
   on every insertion.
4. **A shallow buffer, never starved — uniform per queue.** Every queue is
   modelled identically with **two buffer knobs — `min_items` (replenish floor) +
   `wip_limit` (cap)** — both in `queues/policy.csv`, both **tunable by the retro**
   (§7b); only the numbers differ per queue. Below `min_items` the queue signals
   upstream to refill (never starves); at `wip_limit` it stops accepting (work
   can't age). Each queue also reports the same four metrics — length, throughput,
   dwell, rework rate — all of which tie back to GLT and throughput (§4).
5. **Time thieves are visible.** When one item's lead time is inflated by waiting
   on another (queue displacement, shared-seam serialisation, worker contention,
   deploy serialisation), that wait is **attributed to its cause** and reported.
6. **Continuous inner dev loop** with per-stage and whole-loop DORA, ending each
   cycle by asking the process owner for a retro + experiments.
7. **Self-feeding.** When the Ready queue runs low the system replenishes itself
   from the current slice → next slice → next chunk; when the requirement is fully
   delivered it **asks for more work**.
8. **Defects re-enter through intake**, are JTBD-framed and costed, and **pre-empt**
   existing work (a defect on delivered value implies a failure in something of
   higher value than what is queued).
9. **Two gates only:** requirement/defect **intake**, and **deploy-to-prod**
   go/no-go. Every other former gate is replaced by a named automated assurance.
10. **Cost of Delay is explicitly out of scope** for v2 (value/cost ratio only);
    the model is built so CoD can replace the ranking function later without
    structural change.
11. **Parallel dev loops by construction.** The dispatcher fills worker capacity
    `N` with the *maximal set of mutually-independent* ready use-cases read from
    the dependency graph — not one at a time. **Collisions** (concurrent work that
    proves a declared independence false) are detected mechanically, recorded, and
    fed back to correct the dependency tree — so the system **learns to structure
    dependencies better** over time, minimising both hidden edges (false
    independence) and false edges (needless serialisation). See §13.

Retained from v1 unchanged: TDD-on-trunk, deploy-per-use-case, the shared
change-impact model (`architecture/dependencies/*.mmd`), security-review
auto-accept, the experiments registry and retro mechanics, the `/process` vs
`/work` separation, and the narrowest-owner routing rule.

---

## 2. The work-item model (the spine)

A single registry per project: `work/<project>/items/items.csv` (structured,
canonical) with a regenerated human view `work/<project>/items/items-tree.md`.

Columns (canonical):

| field | meaning |
|---|---|
| `id` | typed key: `REQ-001`, `CHK-001`, `SLC-007`, `UC-031`, `DEF-004` |
| `type` | requirement \| chunk \| slice \| use-case \| defect |
| `parent` | id of the parent item (empty only for a requirement) |
| `children` | maintained index of child ids (see below) |
| `job` | the JTBD this item serves; `core`/`secondary` inherited from product |
| `state` | lifecycle state (§4) |
| `value` | estimated value (product) — unitless score for now |
| `cost` | estimated cost in **time** (product) — the buffer unit |
| `vc_ratio` | value ÷ cost, the ranking key (flow-manager, recomputed on change) |
| `created_ts` | when the item entered the system |
| `done_ts` | when the item reached `done` |
| `dora_ref` | anchor joining this item to its ledger rows (= `id`) |

**Parent is canonical; children are derived-and-stored.** The parent pointer is
the single source of truth for an edge. The `children` index is rebuilt by the
flow-manager from the parent pointers on every mutation and written back, so the
two-way table the brief asks for exists without ever drifting. (A child list that
disagreed with the parent pointers would be a flow-manager defect — the rebuild
makes that state unrepresentable.)

Per-item DORA is **not** stored in this row — it is *computed* from the ledger
(§5) keyed by `id`, so metrics never go stale. `items.csv` holds estimates and
structure; the ledger holds the timestamped truth.

---

## 3. Queues — the handover points

A queue is an ordered, costed list of items waiting to be pulled by the next
stage. v2 defines a small, sufficient set. **Every queue is modelled identically**
— the same two buffer knobs (`min_items` + `wip_limit`) and the same four metrics
— so they compose and compare; only the configured numbers differ. **Every knob is
owned and tuned by the retro** (§7b).

All four queues use the **same model**: two buffer knobs (`min_items` floor +
`wip_limit` cap) and the same four metrics. Only the configured numbers and the
upstream they signal differ.

| Queue | Holds | Producer → Consumer | min_items / wip_limit (default) | what the knobs do |
|---|---|---|---|---|
| **Intake** | new requirements & defects awaiting JTBD framing + costing | human/defect → product | 2 / 10 | below floor → prompt human for more; cap framing-ahead |
| **Ready** | decomposed, costed, prioritised **use-cases** ready to build | product (replenish) → dev loop | 2 / 4 | below floor → replenish; cap keeps the buffer shallow (penny game) |
| **Deploy** | use-cases whose build is green, awaiting their pipeline slot | engineer → pipeline (concurrency group) | 0 / 1 | `wip_limit` = the pipeline concurrency group (§11a) |
| **Rework** | use-cases failed in validation, awaiting defect fix | tester → engineer | 0 / 2 | target 0; any item present pre-empts new Ready pulls (protects MTTR, §8) |

Uniform by design: the same two knobs everywhere makes queues compose and
compare, and lets the retro reason about all of them the same way. None of the
numbers is hardcoded — they live in one policy file the retro edits (§7b).

**Four metrics per queue** (computed by `dora.py flow`, §4): **length** (depth
now), **throughput** (dequeues/active-day), **dwell** (enqueue→dequeue — the time
to be taken off the queue, the queue's slice of GLT), **rework rate** (re-entries
÷ items). Every one ties back to the two system numbers: Σ dwell = the wait part
of GLT; the binding (lowest-throughput) queue's throughput = system throughput;
rework inflates both.

Storage: `work/<project>/queues/<name>.csv` (canonical) + a regenerated
`work/<project>/queues/<name>.md` view. Each queue row is `{item_id, enqueued_ts,
value, cost, vc_ratio, position, reason}` where `reason` records *why* it sits
where it does (`replenish`, `defect-preempt`, `rework`, `displaced-by:<id>`).

**The in-loop stages between Ready and Deploy** (cicd → ui-structure → engineer →
ui-validate) are a **WIP pipeline**, not standing queues: a use-case flows through
them one ownership at a time. We do not buffer them, but we **timestamp entry and
exit of every stage** (§5) so each stage gets its own DORA and any *blocking* wait
inside the loop is measured and attributed (§6). This is what makes "each part of
the dev loop needs DORA" real without inventing buffers that would only add WIP.

**Costing & prioritisation rules (flow-manager):**

- On **every** insertion into Ready (replenish or defect), recompute `vc_ratio`
  for affected items and re-sort: highest `vc_ratio` at the head, **except**
  defects, which pre-empt (§8).
- Re-costing is logged so the queue's value/cost is a time-series, not just a
  snapshot — this is what the future UI and the retro read.
- The ranking function is isolated (one place: `flow-manager.md` §rank) so Cost
  of Delay can replace `vc_ratio` later (§10) without touching anything else.

---

## 4. Item lifecycle (state machines)

**Use-case** (the unit the dev loop pulls):

```
drafted → costed → queued(Ready) → pulled → [cicd?] → ui-structure? →
building → built → deploying → deployed → validating →
  ├─ pass → done
  └─ fail → rework(Rework) → building …   (MTTR clock runs)
```

**Slice:** `open → decomposing → active → done`. A slice is `done` when **all its
child use-cases are `done`**; flow-manager bubbles this up on each use-case
completion. A slice that reaches `done` without its parent chunk's done-condition
advancing is a slicing failure to raise at retro (v1 rule, retained).

**Chunk:** `open → active → done` (done = its done-condition met, product judges).

**Requirement:** `intake → accepted → active → done`. `accepted` is the **intake
gate**. `done` = all child chunks `done` → triggers *ask-for-more-work* (§7d).

**Defect:** `reported → confirmed → costed → queued(head) → building → … → done`
(`/defect` flow, §8). `unconfirmed` is a terminal-until-reopened branch (no
phantom fixes — v1 rule retained).

Every state transition emits a ledger row (§5) so lifecycle = measured flow.

---

## 5. DORA per item — ledger schema extension

v1 ledger: `timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note`
at `/process/dora/ledger.csv`, events `task_start|task_end|deploy|failure|recovery|gate`.

v2 **adds two columns** (append-only, back-compatible) and **three event types**:

```
timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue
```

New events:

| event | emitted when | drives |
|---|---|---|
| `enqueue` | item placed on a queue (`queue` + `value`/`cost` in row) | queue length, wait-time start |
| `dequeue` | item pulled from a queue | **wait time** = dequeue − enqueue |
| `stage_enter` / `stage_exit` | a dev-loop stage takes/releases an item (`agent`=stage) | per-stage service time, in-loop wait |
| `collision` | a concurrent UC proved a declared independence false (`ref`=other UC, `note`=shared seam) | hidden-edge rate, dependency-tree learning (§13) |
| `parallel_dispatch` | N UCs dispatched concurrently (`note`=batch ids + theoretical max) | parallelism efficiency (§13) |

`item_id` is populated on **every** row (the existing `slice` column is retained
for back-compat and equals the item_id when the item is a slice). This is the only
schema change; `dora.py` is extended, not rewritten.

**What `dora.py compute` now produces (new):**

- **Per-item lead time** = `done_ts − created_ts` for any item id (rolls up: a
  slice's lead time is its own; the chunk's is its first child created → last child
  done).
- **Wait vs service split** per item: Σ queue waits + Σ in-loop blocked waits vs Σ
  stage service times. (The headline number the retro attacks.)
- **Per-queue depth time-series** and **median wait** per queue.
- **Per-stage** modal/median/mean service time (the dev-loop parts).
- **Time-thief report** (§6).
- Existing four metrics unchanged in definition (GLT, deploy freq, CFR, MTTR), now
  decomposable down the tree.

Output views (rendered, project-scoped): `work/<project>/dora/flow.md` (queues +
time thieves), plus the existing `/process/dora/baseline.md` (system constraint).

---

## 6. Time thieves — the new visibility

A **time thief** is wall-clock that lands on item A's lead time because A was
waiting on something B consumed. Because §5 timestamps every enqueue/dequeue and
every stage enter/exit, each is computable and *attributable*:

| Thief | Definition (computable) | Attributed to |
|---|---|---|
| **Queue wait** | `dequeue − enqueue` on Ready | the queue (depth/batch policy) |
| **Displacement** | extra Ready wait caused by a higher-`vc_ratio` or defect item inserted ahead | the displacing item id |
| **Seam serialisation** | UC-A `building` blocked on UC-B holding a shared seam (declared route edge) | UC-B |
| **Hidden-edge collision** | rework + re-serialisation after concurrent UCs proved a *declared independence* false | the mis-declared edge (→ §13 learning) |
| **Worker contention** | UC waiting because all dev-loop workers are busy | capacity (concurrency setting) |
| **Deploy-queue wait** | `deploying` time waiting on the pipeline concurrency group | the pipeline |
| **Gate wait** | time in `deployed`-pending awaiting the deploy gate | the gate (only infra-bearing) |
| **Session idle** | wall-clock across a session boundary mid-item | session continuity (v1 §13) |

The report ranks thieves by total inflicted wall-clock. This is the **primary
input to the retro** (§9 of this doc, and the worked example in `02-example-retro.md`)
and extends v1's wait-time taxonomy (process §5) from per-slice to per-item with
attribution.

---

## 7. The pull loop & replenishment

### 7a. Inner dev loop (continuous worker — `/loop-run`)

```
repeat until Ready empty AND nothing left to replenish:
  if length(Ready) < ready.min_items: signal replenish (§7c)  # uniform knobs, retro-tuned (§7b)
  # PARALLEL PULL — fill capacity with the independent frontier, not just the head
  batch = flow-manager.independent_set(Ready, capacity = N)   # §13
          # highest-priority ready UCs whose claimed seams/paths are mutually
          # DISJOINT and unconnected in the dependency graph; |batch| ≤ N
  emit parallel_dispatch row (batch ids, theoretical-max independent set)
  for uc in batch CONCURRENTLY:
     dequeue(uc); flow-manager.claim(uc.seams ∪ uc.paths)     # wait time recorded
     if uc.needs_capability: dispatch cicd
     if uc.ui_bearing:       dispatch ui-designer (structure)
     dispatch engineer       # TDD red→green→refactor on trunk, per-UC flag
        on attempt to touch a path/seam CLAIMED by another in-flight uc:
           → COLLISION (§13): emit collision row; stop the pair; add the missing
             edge to the dependency model; re-serialise (§19); the rework wall-clock
             is a time thief attributed to the mis-declared edge
     if uc.ui_bearing:       dispatch ui-designer (validate vs principles)
     deploy (per-UC thin deploy; GATE only if infra-bearing — §9a)
     dispatch tester         # validate in deployed env through public surface
        fail → uc → Rework (defect), MTTR clock
     mark uc done → flow-manager releases claims, bubbles slice/chunk/req state
  emit per-stage + whole-loop ledger rows
  at retro cadence (§7e): ask orchestrator → retro + experiments + edge review (§13)
```

Parallelism is the **default, not an option**: every cycle the dispatcher tries
to fill capacity `N` with mutually-independent work derived from the dependency
graph (v1 §37 seam rule, isolation by flags-in-code — never worktrees/branches/
stash choreography). Two numbers are recorded each cycle: **achieved concurrency**
and the **theoretical-max independent set** — their ratio is *parallelism
efficiency* (§13), which tells the retro whether the system is exploiting the
independence that exists. `N` is a tunable capacity; contention beyond `N` is a
measured time thief, so the retro sizes `N` from evidence.

### 7b. Per-queue buffer policy — uniform knobs, owned and tuned by the retro

Every queue has the **same two knobs — `min_items` + `wip_limit`** — in a single
structured, retro-editable file `work/<project>/queues/policy.csv`, never
hardcoded in an agent. Only the numbers differ per queue:

```
queue,param,value,unit,owner,target_metric,last_tuned,experiment
intake,min_items,2,count,flow-manager,throughput,2026-06-08,EXP-022
intake,wip_limit,10,count,flow-manager,gross-lead-time,2026-06-08,EXP-022
ready,min_items,2,count,flow-manager,throughput,2026-06-08,EXP-022
ready,wip_limit,4,count,flow-manager,gross-lead-time,2026-06-08,EXP-022
deploy,min_items,0,count,cicd,throughput,2026-06-08,EXP-022
deploy,wip_limit,1,count,cicd,gross-lead-time,2026-06-08,EXP-022
rework,min_items,0,count,flow-manager,mttr,2026-06-08,EXP-022
rework,wip_limit,2,count,flow-manager,mttr,2026-06-08,EXP-022
```

Sizing guidance (starting points; the retro moves them from evidence):

- **min_items** = the floor below which the queue signals upstream to refill, so
  it never starves the stage it feeds (targets **throughput**). Ready's floor ≈
  drain-time + replenish-time in items; Intake's keeps work framed ahead of the
  human; Deploy/Rework default 0.
- **wip_limit** = the cap (targets **gross lead time**): Ready deliberately small
  (penny game — a deep queue ages work and hides defects, start ~2× the floor);
  Deploy = the pipeline concurrency group (raise only with §13 collision
  evidence); Rework low so a defect drains before new pulls.

**Retro ownership (the key requirement).** Every row is a tunable the retro owns.
Each change to a value is a §25a experiment: it names the `target_metric`, states
an anticipated effect, stamps `last_tuned` + `experiment`, and is scored at the
next retro — reverted if it isn't a net win across the four metrics. Because the
queues are independent, the retro can tune them **independently** (e.g. shrink
`ready.wip_limit` while raising `deploy.wip_limit`) and attribute each effect to the
queue it changed. The flow-manager reads `policy.csv` at every cycle; no code
change is needed to retune a buffer.

### 7c. Replenishment protocol (product, triggered by flow-manager)

When `length(Ready) < ready.min_items`, flow-manager signals the orchestrator,
which dispatches **product** to, in order:

a. **Current slice not exhausted** → decompose more use-cases from it, value+cost
   each, hand back to flow-manager to enqueue.
b. **Slice exhausted, chunk has more** → take the next slice from the chunk
   (this is now *unattended* — no slice gate, §9), decompose, cost, enqueue.
c. **Chunk exhausted, requirement has more** → advance to the next chunk; (a).
d. **Requirement done** → flow-manager reports *starved + requirement complete* →
   orchestrator asks the human for more work (intake, §7d).

Product estimates `value` and `cost` for **every** item it creates — this is the
new product duty that feeds queue costing. Each created item is written to
`items.csv` with its parent; flow-manager enqueues, re-costs, re-prioritises (§3).

### 7d. Out of work

When intake, Ready, Deploy and Rework are all empty and the active requirement is
`done`, the loop stops and the orchestrator surfaces: *"Requirement REQ-NNN
delivered. Provide the next requirement or defect."* — the one place the system
deliberately waits for a human.

### 7e. Retro cadence

The brief says "once an iteration of the dev loop completes, ask the process owner
for a retro." A retro every single use-case would itself become the dominant
overhead (retro is service time on the constraint). v2 default: **retro at slice
completion** (preserving v1's proven per-slice economics), *plus* an
**event-triggered retro** whenever the flow data breaches a threshold — a prod
defect, an MTTR pair, or a queue-wait spike above target. Cadence is itself a
tunable the system can experiment on (register it as an experiment on day one).
The orchestrator remains the **process owner** that runs retros and owns the
experiments registry.

---

## 8. Defects re-enter through intake and pre-empt

A defect is a work item created through the **same intake discipline** as a
requirement (`/defect`, retained and extended):

1. Capture expected / actual / intent / **importance**, JTBD-framed (why it
   matters) — prompt for anything missing.
2. **Reproduce to confirm** (no phantom fixes).
3. Cost it. A confirmed defect on **delivered** value is, by the value-first
   axiom, a failure in something of **higher value than anything merely queued** —
   so it is enqueued at the **head of Ready** (pre-empts), and the displacement it
   causes is logged as a time-thief against the defect (§6), making the cost of
   interrupting visible.
4. Fix defect-as-spec, deploy, re-check the user symptom in prod (failure→recovery
   ledger rows → MTTR).
5. Gap-closing retro: what let it through, one experiment to close the gap.

Ownership classification (5xx = called service / our service = defect; 4xx =
caller data / our request bug) is the v1 §5a rule, retained.

---

## 9. Gates — two blocking, the rest replaced by assurances

v1 had four blocking gates. v2 keeps **two** and, crucially, names the **automated
assurance** that replaces each removed gate — removing a gate without a
compensating assurance would be reckless, not lean.

| v1 gate | v2 | Replacing assurance |
|---|---|---|
| **1. Vision (JTBD)** | folded into **Intake gate** (kept) | human still frames value at intake; nothing enters un-JTBD'd |
| **2. Slice accepted** | **removed** (unattended) | slices are now generated just-in-time by product against the chunk plan + open-items selection rule; the human's leverage moves to intake (what enters) and deploy (what ships). Post-hoc veto via decision log. |
| **3. Architecture + security** | **removed as a stop**; auto-accept retained | v1 §9a security-auto-accept (explicit "no new surface" conclusion) + the change-impact `data-flow.mmd` gate-node discipline + synth-time contract tests already assure this for app-only deltas; infra-bearing deltas surface at the **deploy gate** below |
| **4. Go/no-go to deploy** | **kept**, infra-bearing only | app-only diffs auto-approve on green tests+lint+build (v1 §9a); infra-bearing diffs (new stacks, IAM, new surface) remain a human gate — the real-money checkpoint |

So the two blocking gates are **Intake** (value in) and **Deploy-to-prod for
infra-bearing change** (risk out). The brief invites questioning why gates exist;
this is that audit, with each removal paying for itself in a named test/conclusion
rather than a human pause. Any later evidence that a removed gate was load-bearing
reinstates it via the null-hypothesis machinery (process §25a) — gate removals are
experiments too.

---

## 10. Cost of Delay — explicitly deferred

v2 ranks by `vc_ratio = value ÷ cost`. Cost of Delay is **out of scope** now but
the design is CoD-ready: the ranking function is a single isolated routine
(`flow-manager.md`), `value` and `cost` are already per-item, and the queue
re-costs on every change. Introducing CoD later is swapping the ranking function
and adding a `delay_cost` field — no structural change, no agent rewrites beyond
the one routine. The existing `costofdelay-optimiser` skill can back it.

---

## 11. Roster change — the Flow-Manager (9th agent)

One new agent; the other eight keep their craft and gain per-stage ledger duties.

**`flow-manager` (NEW)** — owns *queue state and flow decisions only*, never
product/eng decisions (mirrors the orchestrator's "flow only" mandate, one level
down):
- Owns `items.csv` (+ rebuilds the `children` index and `items-tree.md`).
- Owns `queues/*.csv` (+ rendered views): enqueue/dequeue, **cost** every item,
  **prioritise**, enforce **each queue's own buffer policy** read from
  `queues/policy.csv` (§7b), fire replenishment / pre-emption signals when a
  queue breaches its policy.
- Computes the **maximal independent set** of ready use-cases for parallel
  dispatch and maintains the **claimed-seam/path registry** of in-flight UCs; a
  claimed-set violation is raised as a **collision** (§13).
- Emits `enqueue`/`dequeue`/`collision`/`parallel_dispatch` ledger rows; computes
  the **time-thief report**, the **parallelism-efficiency and hidden/false-edge
  metrics** (§13), and `dora/flow.md`.
- Returns decisions ("pull UC-031", "replenish: slice exhausted, take next",
  "starved: requirement done") to the orchestrator, which holds dispatch
  authority. Tools: `Read, Write, Edit, Bash`. Model: `sonnet`.

Single dispatcher preserved: the **orchestrator** still owns `Task` dispatch,
gates, retro, experiments, and Theory-of-Constraints; it now consults the
flow-manager for "what next / replenish / starved" instead of stepping a
human-driven command sequence.

Changed agents (behaviour deltas, full text on approval):
- **product** — gains value+cost estimation on every item, and the §7c
  replenishment protocol; slicing/use-case decomposition become *just-in-time
  loop services*, not human-gated commands.
- **engineer, cicd, ui-designer, tester, documenter** — unchanged craft; gain
  `stage_enter`/`stage_exit` ledger rows so per-stage DORA is real; operate inside
  the continuous loop rather than a one-shot `/iteration-run`.
- **orchestrator** — delegates queue mechanics to flow-manager; drives `/loop-run`;
  triggers retro at the §7e cadence; keeps ToC over the whole pipeline.

---

## 12. Implementation map (executed only on approval)

New files:
- `.claude/agents/flow-manager.md` (incl. the §13 independent-set, claimed-path
  registry, collision detection, and edge-trial routines)
- `.claude/commands/loop-run.md` (continuous **parallel** pull loop),
  `.claude/commands/intake.md` (requirement+defect intake gate, generalises
  `requirement-new`), `.claude/commands/flow-status.md`
- `work/<project>/items/{items.csv,items-tree.md}`,
  `work/<project>/queues/{ready,deploy,rework}.{csv,md}`,
  `work/<project>/queues/policy.csv` (per-queue buffers, retro-tuned — §7b),
  `work/<project>/architecture/dependencies/edge-ledger.md` (declared edges +
  collision/trial history — §13), `work/<project>/dora/flow.md`
- `work/_TEMPLATE/` gains the above so new projects start pull-native.

Changed files:
- `process/process-current.md` → **v40**: new *STAGE F — Flow & queues* (work-item
  model, queue/buffer model, pull loop, replenishment, time-thief taxonomy
  extending §5, per-item DORA, the two-gate model, retro cadence). Every change
  registered as an experiment (process §25a) with a target metric.
- `.claude/agents/{orchestrator,product,engineer,cicd,ui-designer,tester}.md` —
  the deltas in §11.
- `.claude/skills/dora-ledger/SKILL.md` + `scripts/dora.py` — schema extension
  (§5), enqueue/dequeue wait, per-item lead time, queue depth series, time-thief
  report, **parallelism efficiency + hidden/false-edge rates** (§13).
- `.claude/agents/{product,solution-architect,engineer}.md` — they already
  co-own the dependency model (`architecture/dependencies/*.mmd`, process §12a);
  add the §13 duties: declare a UC's owned seams/paths, correct the model on a
  collision, and run/inform edge null-hypothesis trials.
- `.claude/commands/iteration-run.md` — becomes the *one pass* the loop invokes;
  `slice-next` becomes product's internal replenishment routine (no human gate).
- `Makefile` — `make loop`, `make flow-status`, `make dora-flow` targets
  (allowlisted), `make intake`.
- `README.md`, `CLAUDE.md` — document the pull model and the two gates.

Migration: `oxo-online` (and `ox`) get a one-pass backfill — synthesise `items.csv`
from existing chunks/slices/use-cases with parent links, seed empty queues. No
project code changes.

All of the above is an **experiment set** under process §25a: each carries a target
DORA metric and is scored/repealed by evidence at subsequent retros — including the
gate removals and the buffer sizing.

---

## 13. Parallelism by independence, and learning the dependency tree

This is the section added in response to "can it spin up multiple dev loops by
independence, and detect collisions to learn better dependency structure." It
turns v1's *primitives* (the `*.mmd` dependency model, parallel engineers,
flags-not-branches, "re-serialise a discovered hidden edge") into a **closed,
measured learning loop**.

### 13a. Independence → parallel dispatch

The dependency model is the parallelism plan. The flow-manager treats the union
of `use-case-deps.mmd` (behavioural edges) and `class-deps.mmd` (seam edges) as a
DAG and, each cycle, selects the **maximal independent set** of *ready* use-cases:

- a UC is *ready* if its parents in the DAG are `done`;
- two ready UCs are *co-schedulable* iff there is **no edge/path between them**
  AND their **claimed seam/path sets are disjoint** (a UC declares the
  files/ports/seams it will own — engineer + architect, from the route);
- pick highest-priority first (vc_ratio), greedily, up to capacity `N`.

The orchestrator dispatches that set as **concurrent inner-loop instances**,
isolated by use-case flags in code (process §40 — never branches/worktrees/stash).
Achieved concurrency and the theoretical-max set are logged (`parallel_dispatch`)
so we can see whether available independence is actually being exploited.

### 13b. Collision = a declared independence proven false

A **collision** is detected mechanically, not by hoping:

1. **Claim violation (build/commit time)** — an engineer on UC-A needs to write a
   path/seam that UC-B has *claimed*. The claimed-path registry (flow-manager)
   makes this a hard signal at the moment of the write, not a post-hoc merge
   surprise. Commits stay pathspec-scoped (process §14), so the registry is the
   guard.
2. **Composition failure (integration time)** — UC-A green in isolation
   (flag-ON) goes red when UC-B's concurrent change is integrated → a hidden
   runtime dependency the static graph missed.
3. **Schedule violation (deploy time)** — a hidden hard edge surfaces during
   parallel deploy (process §19's existing case).

On any collision the flow-manager: emits a `collision` row; **stops the pair**;
hands the missing edge to product/architect/engineer to **add to the dependency
model** (marked `classDef changed`, recorded in `edge-ledger.md`); **re-serialises**
the pair (scheduling, not compensating logic — process §19); and attributes the
rework wall-clock as a **hidden-edge time thief** to the mis-declaration (§6). The
defect-prevention discipline applies: a collision is not closed until the missing
edge is in the model and a check would catch its recurrence.

### 13c. The two errors, and learning to minimise both

Dependency-tree quality has **two** failure modes, and the system measures and
attacks each — this is the actual "learn to structure dependencies better":

| Error | What it is | Cost | Signal | Correction |
|---|---|---|---|---|
| **Hidden edge** (false independence) | ran concurrently, then collided | mid-flight rework + re-serialisation + change-failure risk | `collision` rows / slice | add the edge; **hidden-edge rate → 0** is the target |
| **False edge** (false dependency) | serialised, but never actually collides | lost parallelism → longer GLT | an edge that gates UCs which, when speculatively co-scheduled, never collide | **edge null-hypothesis trial**: relax the edge for a window; no collision across 4–5 opportunities → drop it and reclaim the parallelism |

The **edge null-hypothesis trial** is process §25a's retirement-trial applied to a
dependency edge: removing an edge that "feels load-bearing" is exactly the
experiment; an attributable collision reinstates it (validated-by-null-hypothesis),
no collision across the window retires it. At most one edge trial running per seam
at a time (the §25a concurrency guard), and never trial an edge whose collision
class is an open prod-outage risk (blast radius must be a metric, not a user).

### 13d. Metrics the retro reads (added to `dora/flow.md`)

- **Parallelism efficiency** = mean(achieved concurrency ÷ theoretical-max
  independent set). Low ⇒ either too few workers (`N`) or over-declared edges
  (false dependencies) — the retro tells which by cross-reading the false-edge
  signal.
- **Hidden-edge rate** = collisions per slice (target → 0; trend is the learning
  curve).
- **False-edge rate** = edges retired by trial per window (declares the graph was
  needlessly serial).
- **Build wall-clock vs slowest dependency chain** (v1 §37 target, now actually
  achievable): if wall-clock ≫ the critical path, parallelism is being left on the
  table.

Over successive projects these four move the dependency authoring of product /
architect / engineer toward graphs that are *neither* over- nor under-connected —
which is the system learning to slice and structure work for flow. Routed as
experiments, scored at retro, owned by the narrowest agent (the model's
co-owners), exactly like every other change.
