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
  ├── flow-manager        (v40: queues, per-queue buffers, pull/replenish, parallelism by independence, collisions)
  ├── product             (Jobs to Be Done, vision, next-smallest slice, value/cost)
  ├── solution-architect  (C4 / AWS Well-Architected, arch delta, security review)
  ├── cicd                (environments-on-need, pipeline, rollback assets)
  ├── engineer            (strict TDD on trunk)
  ├── ui-designer         (wraps engineer on UI slices: structure before, polish after; a11y)
  └── tester              (validate the deployed system through its public surface)
```

The orchestrator only regulates delivery. Every product, architecture and
implementation decision is delegated to the specialist and returned as a tight
summary, which keeps the orchestrating context small. Specialists write full
artifacts to `/work/<project>/…` and hand back paths + decisions.

> Runtime note: if subagents cannot spawn subagents in your Claude Code build,
> the main session plays the orchestrator by running the slash commands below and
> dispatching the specialists. The logic and files are identical.

## Pull-based flow (v40 — current)

Delivery is **pull**, not push. New work passes a single **intake** gate into a
costed, prioritised, per-queue-buffered set of queues; a continuous inner dev loop
pulls the **maximal independent set** of ready use-cases and runs them concurrently
(TDD on trunk → per-UC deploy → validate-in-prod); product replenishes the Ready
queue just-in-time so it never starves but stays shallow (penny game); completed
requirements ask for more work. **Two blocking gates only:** requirement/defect
intake, and deploy-to-prod for infra-bearing change. Collisions between parallel
work teach the dependency tree. Cross-agent rules: `process/process-current.md`
**STAGE F**. Rationale, diagrams, and a worked retro: `Version2-design/`.

## The loops (slash commands)

| Command | What it does | Gates |
|---------|--------------|-------|
| `/intake "<req or defect>"` | **(v40)** JTBD-frame + value/cost + register + enqueue (defects pre-empt) | **intake** |
| `/loop-run <name>` | **(v40)** continuous pull loop: pull independent set → build/deploy/validate → replenish → retro | deploy (infra-only) |
| `/flow-status <name>` | **(v40)** queues vs buffers, time thieves, parallelism efficiency, item tree | — |
| `/project-new <name> [problem]` | Create the project, start the new-requirement workflow | intake |
| `/requirement-new <name>` | (push mode) Vision → architecture → Chunks → capabilities | — |
| `/slice-next <name>` | (v40) product's just-in-time replenishment routine — no longer a gate | — |
| `/iteration-run <name> <slice>` | the single inner-loop pass `/loop-run` invokes | deploy (infra-only) |
| `/retro <name> [slice]` | recompute DORA + flow, score experiments, tune buffers/N, write next process version | — |
| `/defect …` | structured defect intake → reproduce → prioritise → fix → gap-closing retro | intake |
| `/project-list` | All projects: status, current slice, last activity, pending gates | — |
| `/project-switch <name>` | Set the active project and rebuild minimal resume context | — |
| `/project-stop <name>` | Park the project; `/process` untouched | — |

**Multiple projects.** Projects coexist under `work/`; `work/ACTIVE` names the
active one and every command defaults to it when the project argument is
omitted (`/project-new` sets it, `/project-stop` clears it). Switching is cheap
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

Every agent brackets its work with events in `/process/dora/ledger.csv` via the
`dora-ledger` skill. `dora.py compute` rebuilds `/process/dora/baseline.md` with
per-agent modal/median/mean task times and the four metrics (gross lead time,
deployment frequency, change failure rate, MTTR), and names the current
**constraint**. The orchestrator optimises the *whole* pipeline against that
constraint, not local agent speed.

The self-improvement loop: **act → measure → reflect → revise process → repeat.**
Three document sets carry it: `process-current.md` (now), `process-history/`
(superseded versions with anticipated-vs-observed improvement), and per-project
`dora/per-project.md` (expected vs actual per change, with regression reflections).

## Skills (context protection)

- `process-framework` — the doc map: what to read for each task, the `/process`
  vs `/work` rules. Read this instead of crawling directories.
- `dora-ledger` — record events + compute metrics.
- `delivery-principles` — XP/TDD/slicing/trunk/CD/JTBD reference + the deviation
  procedure (loaded on demand, not held in context).
- `ui-design-system` — the UI Designer's method (tokens, component-driven
  decomposition, nav/click-reduction heuristics, WCAG 2.2 AA checklist, library
  mapping, spec templates), loaded on demand.

## Layout

```
.claude/agents/        orchestrator, product, solution-architect, cicd, engineer, ui-designer, tester, documenter
.claude/commands/      the six workflow commands above
.claude/skills/        process-framework, dora-ledger, delivery-principles
process/               persistent self-state (see process/README.md)
work/                  projects + _TEMPLATE/ (see work/README.md)
```

## Start here

1. `/project-new my-thing "the problem in one line"`
2. Walk the gates; sign off when asked.
3. `/slice-next my-thing` → `/iteration-run my-thing <slice>` → `/retro my-thing`.
4. Read `process/dora/baseline.md` to see the constraint to attack next.
