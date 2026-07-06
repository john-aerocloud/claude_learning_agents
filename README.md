# Self-improving delivery agents for Claude Code

A small set of Claude Code agents that run software projects through an XP loop,
measure themselves with DORA metrics, and improve their own process via
retrospectives — while keeping that learned process separate from (and surviving)
any project they work on.

## The two spaces (the core idea)

```
/process   PERSISTENT  — how the agents work. Survives project resets.
/work      RESETTABLE  — what a project produces. Can be wiped anytime.
```

Lessons cross from `/work` to `/process` only as generalised
`principle-failures/` entries, and — at retro — into the process itself. Nothing
in `/process` may reference a specific project.

## The agents (nested under one orchestrator)

```
orchestrator  (flow, gates, DORA, Theory of Constraints — NO product/eng calls)
  ├── flow-manager        (derives flow decisions — pull/replenish/parallelism/collisions — from item event-logs)
  ├── product             (Jobs to Be Done, vision, next-smallest slice, value/cost)
  ├── solution-architect  (C4 / AWS Well-Architected, arch delta, security review)
  ├── cicd                (environments-on-need, pipeline, rollback assets)
  ├── engineer            (strict TDD on trunk)
  ├── ui-designer         (wraps engineer on UI slices: structure before, polish after; a11y)
  ├── tester              (validate the deployed system through its public surface)
  ├── linear              (per-item, idempotent projection of the item file onto its Linear issue)
  └── jira                (per-item, idempotent projection of the item file onto its Jira issue)
```

The `linear` and `jira` agents are **pure projections**: each reads one item file
(the SSOT) and upserts that one board issue — they make no flow/product/eng
decisions and never write back to the item, so any number of them run in parallel.

The orchestrator only regulates delivery. Every product, architecture and
implementation decision is delegated to the specialist and returned as a tight
summary, which keeps the orchestrating context small. Specialists write full
artifacts to `/work/<project>/…` and hand back paths + decisions.

> Runtime note: if subagents cannot spawn subagents in your Claude Code build,
> the main session plays the orchestrator by running the slash commands below and
> dispatching the specialists. The logic and files are identical.

> **How to use it, step by step:** see [`USER-MANUAL.md`](USER-MANUAL.md) (root).
> This README describes *what the system is*; the manual is the operating guide.

## Event-sourced work items (v82 — current)

The **work item is the single source of truth**. Each item is one self-contained
file holding its definition, its dependency edges, and an **append-only event
log**; its current state is not stored but **computed** — `state = fold(events)`
through the item's per-type state graph. Because the fact "what state is X in?"
lives in exactly one place, the drift class that plagued the old multi-store model
is **unrepresentable**.

Everything else is a **derived view**, recomputed on read, never
persisted-and-hand-synced:

- **Queues** ("what's ready to pull?") are a query over the item set. Delivery is
  still **pull**: the loop reads the derived Ready view and pulls the **maximal
  independent set** of use-cases, runs them concurrently (TDD on trunk → per-UC
  deploy → validate-in-prod), and product replenishes just-in-time (penny game).
- **The board** (Linear / Jira) is a projection — the `linear`/`jira` agents
  mirror each item file to its issue.
- **DORA + flow metrics** fall out of the event timestamps that are already in the
  item.

The write path is a single edge-checked appender; an event that isn't a legal
transition from the item's current folded state is **rejected**, and wanting an
undefined move becomes a governed amendment (an `EXP-NNN` experiment) rather than a
silent half-transition. **Drift is a construction gate**, not an after-the-fact
reconcile: `make wi-validate` fails the build if any invariant is violated. One
blocking human gate remains — requirement/defect intake; infra-bearing deploy
auto-approves under an automated policy assurance (§F5/§F5a, EXP-093), leaving only
a genuinely irreversible prod-DATA op (§0b) human-confirmed. Collisions between
parallel work teach the dependency tree. Build contract:
`process/machinery/CONTRACT.md`; cross-agent rules: `process/process-current.md`
**STAGE F**. Rationale, diagrams, and a worked retro: `Version2-design/`. The prior
QueueApproach model is archived at git tag `QueueApproach`.

## The loops (slash commands)

The machinery underneath is three targets — `make wi-append` (the sole state
writer, edge-checked), `make wi-project` (recompute all derived views + stats),
`make wi-validate` (the drift gate).

| Command | What it does | Gates |
|---------|--------------|-------|
| `/intake "<req or defect>"` | **(v82)** JTBD-frame + value/cost + register item + `wi-append registered/made_ready` (defects pre-empt) | **intake** |
| `/loop-run <name>` | **(v82)** continuous pull loop: read derived Ready view → pull independent set → build/deploy/validate (`wi-append` per stage) → `wi-project` → replenish → retro | deploy (infra-only) |
| `/flow-status <name>` | **(v82)** derived queues vs buffers, time thieves, parallelism efficiency, item tree (from `wi-project`) | — |
| `/project-new <name> [problem]` | Create the project, start the new-requirement workflow | intake |
| `/requirement-new <name>` | (push mode) Vision → architecture → Chunks → capabilities | — |
| `/slice-next <name>` | (v40) product's just-in-time replenishment routine — no longer a gate | — |
| `/retro <name> [slice]` | recompute DORA + flow, score experiments, tune buffers/N, write next process version | — |
| `/defect …` | structured defect intake → reproduce → prioritise → fix → gap-closing retro | intake |
| `/project-list` | All projects: status, current slice, last activity, pending gates | — |
| `/project-switch <name>` | Set the active project and rebuild minimal resume context | — |
| `/project-stop <name>` | Park the project; `/process` untouched | — |

**Multiple projects.** Projects coexist under `work/`; the machine-local
`work/ACTIVE` pointer names the active one **for this instance** and every command
defaults to it when the project argument is omitted (`/project-new` sets it,
`/project-stop` clears it). `work/ACTIVE` is gitignored — under the multi-instance
operating model each machine owns its own pointer, so two instances working
different projects never flip each other's active project. Switching is cheap
and lossless: each project carries its own decision log, gates and
project-tagged DORA rows, so `/project-switch` resumes exactly where that
project stopped — the decision log is the resume mechanism. `/process`
(the agents' learned process) is shared across all projects by design; that is
what makes them improve from one project to the next.

**Checkpoint model:** the orchestrator pauses for human sign-off only at the
gates above and logs every decision to the project `decision-log.md`. Because
decisions are logged, planning the *next* slice can run in parallel with the
*current* slice's build whenever the two are sequentially independent
(trunk-based rule); otherwise they serialise.

## DORA + Theory of Constraints

Every agent brackets its work by appending events to the relevant item file via
`make wi-append` (the sole, edge-checked state writer). `make wi-project` then
folds those event timestamps into `work/<project>/views/stats.json` — the four
DORA metrics (gross lead time, deployment frequency, change failure rate, MTTR)
plus **gross-lead-time contribution by owner**, **quality by stage**, and
**recovery/MTTR by class** — and names the current **constraint**. Nothing is
recorded by hand and nothing is stored twice: the metrics are a pure function of
the same events that carry state. The old `process/dora/ledger*.csv` is a **frozen
QueueApproach archive** (read-only, never extended). The orchestrator optimises the
*whole* pipeline against the constraint, not local agent speed.

The self-improvement loop: **act → measure → reflect → revise process → repeat.**
Three document sets carry it: `process-current.md` (now), `process-history/`
(superseded versions with anticipated-vs-observed improvement), and each project's
derived `views/stats.*`.

## Skills (context protection)

- `work-items` — the event-sourced substrate: how to register/pull items, append
  events, and read derived queues/tree/metrics. Read this before touching item
  state.
- `process-framework` — the doc map: what to read for each task, the `/process`
  vs `/work` rules. Read this instead of crawling directories.
- `delivery-principles` — XP/TDD/slicing/trunk/CD/JTBD reference + the deviation
  procedure (loaded on demand, not held in context).
- `ui-design-system` — the UI Designer's method (tokens, component-driven
  decomposition, nav/click-reduction heuristics, WCAG 2.2 AA checklist, library
  mapping, spec templates), loaded on demand.
- `aws-architecture` — AWS Well-Architected reference for solution-architect/cicd.
- `otel-*` bundle — OpenTelemetry collector / instrumentation / OTTL / semantic
  conventions, loaded on demand for observability work.
- `dora-ledger` — now a **frozen-archive stub** that only reads the retired CSV
  ledger; for anything live use `work-items`.

## Layout

```
.claude/agents/        orchestrator, flow-manager, product, solution-architect, cicd,
                       engineer, ui-designer, tester, documenter, linear, jira
.claude/commands/      the workflow commands above (13)
.claude/skills/        work-items, process-framework, delivery-principles, ui-design-system,
                       aws-architecture, otel-* bundle, dora-ledger (frozen stub)
process/               persistent self-state (see process/README.md)
process/machinery/     the work-item build contract (CONTRACT.md) + type state-graphs.json
work/                  projects + _TEMPLATE/ (see work/README.md)
```

## Start here

1. `/project-new my-thing "the problem in one line"`
2. Walk the gates; sign off when asked.
3. `/intake "<req>"` → `/loop-run my-thing` → `/retro my-thing`.
4. `make wi-project PROJECT=my-thing` then read `work/my-thing/views/stats.md`
   to see the constraint to attack next.

For the full operating guide, read [`USER-MANUAL.md`](USER-MANUAL.md).
