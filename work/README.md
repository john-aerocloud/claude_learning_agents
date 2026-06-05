# /work — Project artifacts (RESETTABLE)

Everything an actual project produces lives here. This directory can be wiped or
restarted without touching the agents' learned process in `/process`.

Projects coexist; `ACTIVE` (a one-line file in this directory) names the one
commands default to. Manage it with `/project-switch` and `/project-list` —
never by hand-editing mid-session. Each project is self-contained: its decision
log, gate state and DORA rows are project-tagged, so switching loses nothing.

One subdirectory per project, created by `/project-new`:

```
work/<project>/
  project.md            # status (active|stopped), JTBD vision, owner, dates
  decision-log.md       # append-only log of every gate decision (auditable)
  architecture/
    current.md          # C4 solution architecture as it stands now
    deltas/             # one file per slice: the architecture change it made
    security/           # per-infrastructure security notes → later become policy test cases
  chunks.md             # high-level sequence of value slices ("Chunks")
  capabilities.md       # environments, test approach, CD needs for the next iteration
  slices/
    <nnn>-<slug>/
      slice.md          # JTBD link, scope, success measures
      acceptance.md     # acceptance test cases
      route.md          # the thin TDD route engineering will take
      result.md         # what shipped, test-in-prod outcome
  dora/
    per-project.md      # expected-vs-actual DORA per change + regressions & reflections
```

`per-project.md` mirrors the global ledger but is project-scoped: for each
change it records the DORA outcome that was *expected*, and when a change harmed
a metric, a reflection on why. Those reflections graduate to
`/process/principle-failures/` when they reveal a reusable lesson.

A project template lives in `_TEMPLATE/`.
