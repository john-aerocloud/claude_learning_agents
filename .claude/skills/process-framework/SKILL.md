---
name: process-framework
description: Map of the agent operating system — what documents exist, where they live, what to read for a given task, and the rules for the persistent /process self-state vs the resettable /work project space. Use this to navigate the repo efficiently and to keep the orchestration context small, instead of loading whole document trees.
---

# Process framework (the doc map)

Read this instead of crawling directories. It tells you the minimum to load for a
task, which protects the context window.

## Two spaces (never mix them)
- `/process` — PERSISTENT self-state: how the agents work. Survives any project
  reset. Holds `process-current.md`, `process-history/` (README only — snapshots
  are git tags `process-v<NN>`), `principles/`, `principle-failures/`, `dora/`
  (the FROZEN QueueApproach CSV archive; live metrics are derived by `make wi-project`).
- `/work/<project>` — RESETTABLE project artifacts. Can be wiped without harming
  what the agents learned.

Rule: nothing in `/process` may reference a specific project. Lessons cross from
`/work` to `/process` only as generalised entries in `principle-failures/` (and,
at retro, into the process itself).

## What to read for a task (load only these)
| Task | Read |
|------|------|
| Switch/resume a project | `work/ACTIVE`; target `project.md`; tail of `decision-log.md`; `work/<project>/views/{queues,state,tree}.md` |
| Run a project loop | `process-current.md`; project `project.md`, `decision-log.md`, `chunks.md`; `work/<project>/views/stats.md` |
| Understand item state / append an event | `process/machinery/CONTRACT.md` + `state-graphs.json`; `work-items` skill (the substrate) |
| Define vision / slice | `principles/00-default-approaches.md` (JTBD+slicing); project `project.md`, `chunks.md` |
| Architecture for a slice | the slice item `work/<project>/items/active/SLC-*.md`; `architecture/current.md`; `aws-architecture` skill |
| Build a slice | the slice + child use-case items `work/<project>/items/active/*.md` (job/value/acceptance in the body), the arch delta + security notes |
| UI structure for a slice | the slice + use-case items `work/<project>/items/active/*.md`, the arch delta, `work/<project>/design/`; `ui-design-system` skill |
| UI polish for a slice | the slice item, `work/<project>/design/`, the built UI; `ui-design-system` skill |
| Validate a slice | the slice + use-case items `work/<project>/items/active/*.md` (success measures + acceptance in the body) |
| Retro | `work/<project>/views/stats.md`, `principle-failures/`, `process-current.md` |

Do NOT load full architecture/history unless a decision needs it — ask the owning
agent for a summary instead. Specialists write detail to files and return only
decisions + paths.

## Three document sets the self-state maintains (the user's spec)
1. **Current**: `process-current.md` — current process + DORA + expected
   improvement + the change-set queued next.
2. **History**: process snapshots are annotated git tags `process-v<NN>` (NOT
   files); `process-history/` holds only its README. Each tag captures the old
   process, its DORA, the change made, and anticipated-vs-observed improvement
   (recorded in the retro).
3. **Per-change DORA note** (process §23): expected DORA per change, actual, and
   on regression a reflection on why — recorded in the retro record / `process-v<NN>`
   tag (numbers DERIVED from `views/stats.md`, not a hand-written file); a regression
   graduates to `principle-failures/`.

## Rule lifecycle: experiment → graduate-to-skill → prune from /process (v68)
`/process` must stay **LEAN and on-target** — the ACTIVE process carries only what
is still being learned or is genuinely cross-agent and live. A rule that is PROVEN
and STABLE does not belong in the active process; it belongs in the **skills (the
stable methodology layer)** so the active `/process` is not bloated by it. The
lifecycle, explicit:

1. **EXPERIMENT** — a new routed change is an `EXP-` row in
   `/process/experiments.md` (the falsifiable-hypothesis bar, §25a). It lives in
   the active process while it is being scored.
2. **INTEGRATE (existing step)** — when it scores positive K times, the behaviour
   is folded into its **owning agent file** (`.claude/agents/<agent>.md`) as plain
   practice and the row is pruned to `experiments-archive.md`. This handles
   **single-agent** behaviour.
3. **GRADUATE-TO-SKILL (new in v68)** — when a proven rule is **cross-agent
   methodology** (a way-of-working many roles share, not one agent's behaviour),
   it graduates into the relevant **skill** rather than (or in addition to) an
   agent file:
   - delivery method / principles → `delivery-principles`
   - repo/doc navigation, the rule lifecycle itself → `process-framework`
   - work-item state / metric mechanics → `work-items`
   - cloud architecture defaults → `aws-architecture`
   - UI method → `ui-design-system`; OTel/OAG specifics → their skills
   The skill becomes the durable home; the proving `EXP-`/principle-failure
   thread is then **RETIRED/pruned from the active `/process`** (archive line
   only). Graduation criterion: **proven (positive ≥ K, default 2, with a real
   data point — not a single anecdote) AND stable (no open rework) AND
   cross-agent**. A rule that is still experimental, or that is a one-agent
   behaviour, does NOT graduate to a skill.
4. **RETIRE** — a rule the evidence refutes is undone and deleted (failed-row
   policy, §25a.6).

Direction of flow: experiments accrue in `/process`; **proven cross-agent
methodology drains OUT to skills**; the active process shrinks. At every retro,
audit the active `/process` for rules that have become proven+stable+cross-agent
and graduate them, measuring the leanness gain (line/rule count before→after).
Skills are loaded on-demand and keep the orchestration context small, so moving a
proven rule there is both correctness (stable home) and economy (smaller active
process).

## Experiment status lifecycle (the full mechanics — graduated from process §25a)
The registry is `/process/experiments.md` — one row per routed change, each row a
falsifiable hypothesis meeting the **validity bar** (process §25a keeps that bar; it is
the admissibility rule, not repeated here). The lifecycle is **adopt-or-delete**. A sound
shipped behaviour whose row was only MIS-PHRASED is handled by deleting the ROW while
KEEPING the behaviour as plain agent practice; never undo a defect-preventing behaviour
because its row failed the bar. The statuses:

1. **active** — enters at routing time meeting the bar, with a target metric, anticipated
   effect, a **scoring horizon** (default 2 scoring opportunities; "no opportunity yet"
   extends it, does not count against it), and an **applies-to** predicate (the KIND of
   work that exercises it). At work selection the orchestrator lists which active
   experiments THIS work exercises and records that with the selection, so scoring is
   honest.
2. **validated** — anticipated effect observed at retro. The change is then **INTEGRATED**:
   the owning agent file(s) are rewritten so the behaviour becomes plain operating practice
   (no `vNN`/EXP/trial scaffolding in the prose the agent reads; overlapping sections
   merged). Provenance lives in the registry row and git. **After integration the row is
   PHYSICALLY REMOVED from `experiments.md`** and replaced by a one-line entry in
   `process/experiments-archive.md` (`EXP-NNN — <lesson> — integrated <sha>`). The working
   registry holds ONLY live rows.
3. **under-question** — horizon reached with no improvement. Retro must REWRITE (sharper
   mechanism → new experiment) or mark for retirement-trial.
4. **retirement-trial (null-hypothesis test)** — the text is physically REMOVED (git + the
   row keep it recoverable) and the system runs **4–5 scoring opportunities** without it. A
   targeted-metric DROP attributable to the removal → the change was load-bearing:
   reinstate (validated-by-null-hypothesis). No drop across the full window → ornament:
   retired permanently (row records the evidence). One or two opportunities is an anecdote,
   not a sample.
5. **Concurrency guard:** at most ONE retirement-trial running per agent artifact. Never
   trial a rule whose failure mode is an open prod-outage class.
6. **failed (terminal — DELETED, not archived)** — anticipated effect NOT observed AND the
   change is abandoned/superseded. Neither integrated behaviour nor a useful null result,
   and failed rows are the most verbose, so they POLLUTE the working registry: **deleted
   outright from `experiments.md`, no archive line** (git retains the row). Guard: a failed
   experiment with a live re-route must FIRST land its successor, THEN the failed row is
   deleted in the same change. Failed rows may be deleted at any time.

**Scoring honesty:** a change with a confounded window (multiple changes on the same metric
in the same slice) is scored against its own MECHANISM (did the behaviour it prescribes
occur and visibly help?), not just the aggregate metric.

## When docs get heavy
Prefer adding a skill (see `skill-creator`) that abstracts a heavy document into a
callable procedure, rather than letting the orchestrator hold it in context.
`work-items` and `delivery-principles` already do this. The `ui-design-system` skill does the same for UI design
method; the per-project design system lives in `/work/<project>/design/`.
