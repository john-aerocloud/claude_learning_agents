---
name: process-framework
description: Map of the agent operating system — what documents exist, where they live, what to read for a given task, and the rules for the persistent /process self-state vs the resettable /work project space. Use this to navigate the repo efficiently and to keep the orchestration context small, instead of loading whole document trees.
---

# Process framework (the doc map)

Read this instead of crawling directories. It tells you the minimum to load for a
task, which protects the context window.

## Two spaces (never mix them)
- `/process` — PERSISTENT self-state: how the agents work. Survives any project
  reset. Holds `process-current.md`, `process-history/`, `principles/`,
  `principle-failures/`, `dora/`.
- `/work/<project>` — RESETTABLE project artifacts. Can be wiped without harming
  what the agents learned.

Rule: nothing in `/process` may reference a specific project. Lessons cross from
`/work` to `/process` only as generalised entries in `principle-failures/` (and,
at retro, into the process itself).

## What to read for a task (load only these)
| Task | Read |
|------|------|
| Switch/resume a project | `work/ACTIVE`; target `project.md`; tail of `decision-log.md`; latest `work/<project>/slices/<nnn>-*/` artifact state |
| Run a project loop | `process-current.md`; project `project.md`, `decision-log.md`, `chunks.md`; `dora/baseline.md` |
| Define vision / slice | `principles/00-default-approaches.md` (JTBD+slicing); project `project.md`, `chunks.md` |
| Architecture for a slice | the slice `slice.md`; `architecture/current.md`; `aws-architecture` skill |
| Build a slice | `slice.md`, `acceptance.md`, `route.md`, the arch delta + security notes |
| UI structure for a slice | the slice `slice.md`, `use-cases.md`, the arch delta, `work/<project>/design/`; `ui-design-system` skill |
| UI polish for a slice | the slice `ui-design.md`, `work/<project>/design/`, the built UI; `ui-design-system` skill |
| Validate a slice | `slice.md` (success measures), `acceptance.md` |
| Retro | `dora/baseline.md`, `principle-failures/`, project `dora/per-project.md`, `process-current.md` |

Do NOT load full architecture/history unless a decision needs it — ask the owning
agent for a summary instead. Specialists write detail to files and return only
decisions + paths.

## Three document sets the self-state maintains (the user's spec)
1. **Current**: `process-current.md` — current process + DORA + expected
   improvement + the change-set queued next.
2. **History**: `process-history/vNN-*.md` — old process, its DORA, the change
   made, anticipated-vs-observed improvement.
3. **Per-project**: `/work/<p>/dora/per-project.md` — expected DORA per change,
   and on regression a reflection on why; graduates to `principle-failures/`.

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
   - metric/ledger mechanics → `dora-ledger`
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

## When docs get heavy
Prefer adding a skill (see `skill-creator`) that abstracts a heavy document into a
callable procedure, rather than letting the orchestrator hold it in context.
`dora-ledger` and `delivery-principles` already do this. The `ui-design-system` skill does the same for UI design
method; the per-project design system lives in `/work/<project>/design/`.
