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
| Switch/resume a project | `work/ACTIVE`; target `project.md`; tail of `decision-log.md`; latest `slices/<nnn>-*/` artifact state |
| Run a project loop | `process-current.md`; project `project.md`, `decision-log.md`, `chunks.md`; `dora/baseline.md` |
| Define vision / slice | `principles/00-default-approaches.md` (JTBD+slicing); project `project.md`, `chunks.md` |
| Architecture for a slice | the slice `slice.md`; `architecture/current.md`; `aws-architecture` skill |
| Build a slice | `slice.md`, `acceptance.md`, `route.md`, the arch delta + security notes |
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

## When docs get heavy
Prefer adding a skill (see `skill-creator`) that abstracts a heavy document into a
callable procedure, rather than letting the orchestrator hold it in context.
`dora-ledger` and `delivery-principles` already do this.
