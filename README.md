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
  ├── product             (Jobs to Be Done, vision, next-smallest slice)
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

## The loops (slash commands)

| Command | What it does | Gates |
|---------|--------------|-------|
| `/project-new <name> [problem]` | Create the project, start the new-requirement workflow | 1 |
| `/requirement-new <name>` | Vision (JTBD) → target architecture → Chunks → capabilities | vision, arch+security |
| `/slice-next <name>` | Next smallest value slice + arch delta + acceptance tests | slice, arch+security |
| `/iteration-run <name> <slice>` | capabilities → thin route → TDD build → deploy → validate-in-prod | go/no-go to deploy |
| `/retro <name> [slice]` | recompute DORA, review failures, write next process version | — |
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
