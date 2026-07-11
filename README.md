<!--
  👋 Fork this freely — that's what it's here for. Take it apart, wipe it down, start
  from scratch on your own copy.

  Two asks:
  • If you build an improvement, great — open a PR, or better yet come and talk to me
    first. I'd love to hear what you're doing with it.
  • `main` is protected; I generally don't take external pushes into the learned
    *process* (`/process`, especially `process/experiments.md` and
    `process/process-history/`). A lot of how this system actually works for me lives in
    those experiments and that version history — if you wipe them on a fork, that's fine,
    but know that's where the accumulated behaviour is, not just in the agent prompts.
-->

# Self-improving delivery agents for Claude Code

A small team of Claude Code agents that builds software the way a good delivery team
does — and **gets better every time it does it**.

> **Forking?** Go for it. Improvements are welcome via PR — come talk to me first if you
> can. `main` is protected (CODEOWNERS), and the learned process under `/process` is mine;
> your fork can do whatever it likes with it, but note that much of how this behaves lives
> in `process/experiments.md` and the process history, not just the agent files.

## What this is for

There are **two goals**, and the second is the point:

1. **Build something real.** Turn a plain-language ask into working, deployed,
   production-validated software by walking it down a disciplined chain:

   ```
   persona ─▶ job-to-be-done ─▶ requirement ─▶ chunk ─▶ slice ─▶ use-case ─▶ built · deployed · validated
     who         the root         the agreed     a       thinnest    one         (TDD on trunk,
    it serves   need (5-whys)      value         theme   valuable     testable    deployed per-UC,
                                                          increment    unit        checked in prod)
   ```

   Nothing is built until we know **who** it serves and **what job** they are really
   trying to get done. Value is sliced thin (Neil Killick style) so each increment
   ships something a real person can use.

2. **Learn.** The agents run an XP loop, measure themselves with DORA metrics, and
   **rewrite their own process at retrospectives** — so the *next* project starts from a
   sharper team than the last one did. That learned process is deliberately kept
   separate from (and survives) any single project.

   ```
   act ─▶ measure (DORA) ─▶ reflect (retro) ─▶ revise the process ─▶ repeat
   ```

> **Two documents, two jobs.** This README says *what the system is and how to drive it
> at a glance*. [`USER-MANUAL.md`](USER-MANUAL.md) is the full operating guide — read it
> once before your first real project.

---

## How to get there — the walkthrough (and what to check at each gate)

The single most important habit: **at every gate, open the files the agents just wrote
and read them yourself. Do not trust the terminal summary alone.** The agents report a
tight summary to keep their context small — that summary is a pointer to the real
artifact, not a substitute for it. A dossier that *reads* fine in a one-line summary can
still miss a persona; a use-case that reports "ready" can still be missing its
persona/job link. The files are the truth. Look at them.

### 0. Start a project
```
/project-new my-thing "the problem in one line"
```
Scaffolds `work/my-thing/` (its own git repo) and starts the new-requirement workflow.

### 1. Requirement — the human sign-off gate  ⟵ *the one gate you must not rubber-stamp*
```
/requirement "the thing users need"
```
The **discovery** agent interviews you: it enumerates every user (the four mandatory
operator classes — **consumer, build-engineer, platform-engineer, support**), drills each
job to its root need with 5-whys, and captures *what failure looks like for each persona*.
It loops with you until you sign off.

**Go and read these files before you sign off** (all under `work/my-thing/product/`):

| Open this | Check that… |
|-----------|-------------|
| `personas.md` | every one of the four operator classes is present — or explicitly marked `N/A` **with a reason**. Each persona has a concrete "what failure looks like for them" line, not a generic "error". |
| `jtbd-map.md` | each job's 5-whys actually reaches a *real-world* root need (stops being about the software), not the surface request. |
| `requirements/<REQ-ID>-dossier.md` | the personas/jobs in scope match your intent, out-of-scope is stated, and **the `Sign-off` line is filled in**. This is the document you are approving. |

The dossier is not registered until you sign it. **A vague ask is sent back for
clarification, not guessed.**

### 2. Slicing — value cut thin
The **product** agent decomposes the requirement into chunks → slices → use-cases, each
one an item file. This is just-in-time (`/slice-next` runs inside the loop); you don't
normally trigger it, but you should **inspect what it produced**:

| Open this | Check that… |
|-----------|-------------|
| `work/my-thing/items/active/<ID>.md` (the use-cases) | every use-case carries `personas: [P…]` and `job: J…` tracing back to the dossier. A use-case with no persona/job is a discovery gap and should **not** be Ready. `value` and `cost` look sane; `deps`/`parents` edges are right. |
| `work/my-thing/views/tree.md` | the dependency tree matches how you'd actually sequence the work. |
| `work/my-thing/views/queues.md` | what's Ready is what you'd expect to build next. (This view is *derived* — never hand-edited.) |

### 3. Build → deploy → validate — the loop
```
/loop-run my-thing
```
Autonomous. It pulls the largest set of **independent** ready use-cases, builds each
**TDD on trunk**, deploys per use-case, validates in production through the real public
surface, then replenishes the next work and retros at cadence. Deploys (including infra)
auto-approve under an automated policy assurance; the **only** thing that still stops for
you is a genuinely irreversible production-data operation.

Auto-proceeding is not "unattended." **Spot-check as it runs:**

| Open this | Check that… |
|-----------|-------------|
| the item file's event log (`items/active/<ID>.md`) | states advanced through real events (`built`, `deployed`, `validated`) — not skipped. |
| `work/my-thing/src/…` + its tests | the code and tests actually exist and match the acceptance criteria — the truest "did it really happen" check. |
| `work/my-thing/views/stats.md` | DORA metrics moved the way you'd expect; the named **constraint** is where you'd attack next. |

### 4. Retro — the learning gate (and your manual lever)
```
/retro my-thing
```
Recomputes DORA, reviews the learned-failure corpus, scores open experiments, and writes
the **next process version**. Read the new `process/process-current.md` diff and
`process/experiments.md`: every process change is a falsifiable experiment with a target
metric, not a permanent acquisition.

**`/retro` is *the* way process improvement happens** — it is how a lesson from `/work`
crosses into the persistent `/process`. The loop fires it automatically at a cadence, but
**if you notice the system isn't picking something up** — it keeps repeating a mistake, a
principle-failure isn't being turned into a rule, an experiment isn't being scored — **run
`/retro` yourself.** That's the intended manual lever; don't hand-edit the process to fix
it. (Hand-edits to `/process` also bypass CODEOWNERS review and the experiment-scoring
discipline that keeps the rulebook from rotting.) If a retro can't yet resolve something,
capture it as a `principle-failure` so the next retro has it.

> **Golden rule, restated:** the terminal tells you an agent *finished*. The files tell
> you *what it actually did*. At each gate above, open the files.

---

## The core idea: two spaces

```
/process   PERSISTENT  — how the agents work. Survives project resets. Project-agnostic.
/work      RESETTABLE  — what a project produces. Can be wiped anytime.
```

Lessons cross from `/work` to `/process` only as generalised `principle-failures/`
entries and — at retro — into the process itself. **Nothing in `/process` may reference a
specific project.** That firewall is what lets the team carry learning from one project to
the next without dragging the last project's specifics along.

### Work items are the single source of truth (event-sourced)

Each unit of work — requirement, chunk, slice, use-case, defect — is **one self-contained
file** holding its definition, its dependency edges, and an **append-only event log**. Its
current state is not stored but **computed**: `state = fold(events)` through the item's
per-type state graph. Because "what state is X in?" lives in exactly one place, the drift
class that plagued the old multi-store model is **unrepresentable**.

Everything else is a **derived view**, recomputed on read, never hand-synced:

- **Queues** ("what's ready to pull?") — a query over the item set.
- **The board** (Linear / Jira) — a projection the `linear`/`jira` agents mirror per item.
- **DORA + flow metrics** — fall out of the event timestamps already in the item.

The write path is a single edge-checked appender: an event that isn't a legal transition
from the item's current folded state is **rejected**, so a half-transition can't exist.
Drift is a **construction gate** (`make wi-validate`), not an after-the-fact reconcile.
Design rationale: [`design-rationale/work-item-state-model.md`](design-rationale/work-item-state-model.md);
build contract: [`process/machinery/CONTRACT.md`](process/machinery/CONTRACT.md). The
prior QueueApproach model is archived at git tag `QueueApproach`.

---

## The agents (nested under one orchestrator)

```
orchestrator  (flow, gates, DORA, Theory of Constraints — NO product/eng calls)
  ├── flow-manager        (derives flow decisions — pull/replenish/parallelism/collisions — from item event-logs)
  ├── discovery           (requirement elaboration: personas + jobs-to-be-done → signed dossier)
  ├── product             (Jobs to Be Done, vision, next-smallest slice, value/cost)
  ├── solution-architect  (C4 / AWS Well-Architected, arch delta, security review)
  ├── cicd                (environments-on-need, pipeline, rollback assets)
  ├── engineer            (strict TDD on trunk; defects-as-spec)
  ├── ui-designer         (wraps engineer on UI slices: structure before, polish after; a11y)
  ├── tester              (validates the deployed system in prod through its public surface)
  ├── documenter          (after a slice validates, updates user-facing docs to what shipped)
  ├── linear              (per-item, idempotent projection of the item file onto its Linear issue)
  └── jira                (per-item, idempotent projection of the item file onto its Jira issue)
```

The orchestrator **only regulates delivery** — every product, architecture and
implementation decision is delegated to the specialist and returned as a tight summary,
which keeps the orchestrating context small. Specialists write full artifacts to
`work/<project>/…` and hand back paths + decisions (this is exactly why you review the
files, not the summary). The `linear`/`jira` agents are **pure projections**: each reads
one item file and upserts that one board issue, so any number run in parallel.

> Runtime note: if subagents cannot spawn subagents in your Claude Code build, the main
> session plays the orchestrator by running the slash commands below and dispatching the
> specialists. The logic and files are identical.

---

## The commands

Run all of these from the project root. `<name>` is a project; if omitted, the
machine-local `work/ACTIVE` pointer is used.

| Command | What it does | Human gate? |
|---------|--------------|-------------|
| `/project-new <name> [problem]` | Scaffold a project (its own git repo) + start the new-requirement workflow | via `/requirement` |
| `/requirement "<req>"` | Discovery elaborates personas + jobs-to-be-done into a **signed dossier**, then value/cost + register | **YES — sign off the dossier** |
| `/loop-run <name>` | Continuous pull loop: pull independent set → build (TDD) → deploy → validate → replenish → retro | only irreversible prod-data ops |
| `/defect "<exp>\|<act>\|<intent>\|<why>"` | Capture 4 fields → reproduce-to-confirm → register (defects pre-empt) → **mandatory gap-closing retro** | you decide entry |
| `/flow-status <name>` | Read-only: derived queues vs buffers, time thieves, the constraint, the item tree | — |
| `/retro <name> [slice]` | Recompute DORA, score experiments, write the next process version | — |
| `/project-list` | All projects: status, work state, last activity, active marker | — |
| `/project-switch <name>` | Set the active project and rebuild minimal resume context | — |
| `/project-stop <name>` | Park the project; `/process` untouched | — |
| `/requirement-new <name>` | (push mode) Vision → architecture → chunks → capabilities for an existing project | — |
| `/slice-next <name>` | Product's just-in-time slice replenishment (the loop calls this; you rarely do) | — |
| `/refactor-process` | Rationalize the process docs; run `make doc-lint` (major cutovers / ~every 10 versions) | — |

> `/intake` is **retired**. It split into `/requirement` (new value, with the persona +
> jobs-to-be-done elaboration and human sign-off) and `/defect` (defects, with the
> gap-closing retro). Older references resolve to a shim that points here.

**Multiple projects.** Projects coexist under `work/`; the machine-local `work/ACTIVE`
pointer (gitignored) names the active one *for this instance*, so two instances on
different projects never flip each other's pointer. Switching is lossless — each project
carries its own decision log and derived state, so `/project-switch` resumes exactly where
it stopped. `/process` is shared across all projects by design; that sharing is what makes
the agents improve from one project to the next.

---

## The machinery (under the hood)

State and metrics run through one cross-platform tool
(`sh .claude/skills/work-items/scripts/work-items`, wrapped as `make` targets — never call
bare `python3`):

- `make wi-append PROJECT=<p> ID=<id> EVENT=<e> AGENT=<role>` — **the only way to change
  item state.** Edge-checked: an illegal transition is rejected (wanting a transition the
  graph lacks is a *process experiment*, `EXP-NNN`, not an ad-hoc edit).
- `make wi-project PROJECT=<p>` — regenerate all derived views (`work/<p>/views/`): queues,
  state, tree, and `stats.{md,json}`. Run after each loop pass.
- `make wi-validate PROJECT=<p>` — the **drift gate** (invariants I1–I4). Run before pulling.
- `make doc-lint` — the **docs** drift gate: fails if any live doc names a retired mechanic.

---

## DORA + Theory of Constraints

Every agent brackets its work by appending events via `make wi-append`. `make wi-project`
then folds those timestamps into `work/<project>/views/stats.json` — the four DORA metrics
(gross lead time, deployment frequency, change-failure rate, MTTR) **plus** gross-lead-time
contribution by owner, quality by stage, and recovery/MTTR by class — and names the current
**constraint**. Nothing is recorded by hand and nothing is stored twice: the metrics are a
pure function of the same events that carry state. The orchestrator optimises the *whole*
pipeline against the constraint, not local agent speed.

The old `process/dora/ledger*.csv` is a **frozen QueueApproach archive** (read-only, never
extended).

---

## Skills (context protection)

Agents load these on demand instead of holding everything in context:

- **`work-items`** — the event-sourced substrate: register/pull items, append events, read
  derived queues/tree/metrics. Read before touching item state.
- **`process-framework`** — the doc map: what to read for each task; the `/process` vs
  `/work` rules. Read this instead of crawling directories.
- **`requirements-discovery`** — the elaboration method (persona classes, 5-whys, dossier).
- **`delivery-principles`** — XP/TDD/slicing/trunk/CD/JTBD + the deviation procedure.
- **`ui-design-system`** — tokens, component decomposition, nav/click heuristics, WCAG 2.2 AA.
- **`aws-architecture`** — AWS Well-Architected reference for solution-architect/cicd.
- **`otel-*` bundle** — OpenTelemetry collector / instrumentation / OTTL / semantic conventions.
- **`dora-ledger`** — a **frozen-archive stub** that only reads the retired CSV; use `work-items` for anything live.

---

## Layout

```
.claude/agents/        orchestrator, flow-manager, discovery, product, solution-architect, cicd,
                       engineer, ui-designer, tester, documenter, linear, jira
.claude/commands/      the workflow commands above
.claude/skills/        work-items, process-framework, requirements-discovery, delivery-principles,
                       ui-design-system, aws-architecture, otel-* bundle, dora-ledger (frozen stub)
process/               persistent, project-agnostic self-state (see process/README.md)
process/machinery/     the work-item build contract (CONTRACT.md) + type state-graphs.json
design-rationale/      why the event-sourced work-item model exists (the drift-defect diagnosis)
work/                  projects + _TEMPLATE/ (see work/README.md); each project is its own git repo
```

---

## Start here

1. `/project-new my-thing "the problem in one line"`
2. `/requirement "<what users need>"` — **then open `work/my-thing/product/` and read the
   personas, JTBD map and dossier before you sign off.**
3. `/loop-run my-thing` — spot-check the item event logs and `work/my-thing/src/` as it runs.
4. `/retro my-thing` — read the new process version and the metrics.
5. `make wi-project PROJECT=my-thing` then read `work/my-thing/views/stats.md` to see the
   constraint to attack next.

For the full operating guide, read [`USER-MANUAL.md`](USER-MANUAL.md).
