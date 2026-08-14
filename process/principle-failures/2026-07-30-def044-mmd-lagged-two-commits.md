# Principle Failure: DEFECT-OAG-044 change-graph lagged two code commits

**Date:** 2026-07-30
**Item:** DEFECT-OAG-044 (OagEventSource)
**Project:** OagEventSource
**Detected by:** engineer (self, before finishing — not by a downstream role)

## What happened

The engineer-agent rule is explicit: *"Any commit that adds, removes, or redirects a
dependency edge updates the relevant `.mmd` in that same commit, marking the changed
nodes/edges with mermaid `classDef changed`."*

Two of the three DEFECT-OAG-044 code commits added dependency edges without the
`.mmd` update in the same commit:

- `cca69be` — added the new `synthetic-event-guard` domain node (new module) and its
  edge to `config/account-id`.
- `51ceb3e` — added `aerobus-publisher --> synthetic-event-guard`, a behaviour change
  to a node modelled in `data-flow.mmd` (`PROD_PUBLISHER` / `PROD_SMOKE`).

The graph was brought fully up to date one commit later, in `1e6f3e2`, together with
the `edge-ledger.md` entry. So the delivered head is correct and complete; the
*intermediate* commits were not.

## Why it happened (the honest cause, not an excuse)

The v95 rule "commit at each green sub-step so a stall costs one increment, not the
whole UC" was followed literally for the code, and the change-graph work was treated
as a single end-of-item task. The two rules pull in opposite directions when a fix
lands as three red→green increments: committing at every green makes each increment
cheap to lose, but updating the whole `.mmd`/ledger narrative three times is wasteful
and produces a graph that describes a half-built fix.

## Impact

Small but real, and worth naming precisely:

- Anyone running `make impacted-tests` against either intermediate sha would have got
  a FALSE-CLEAN — no changed nodes — while a new domain gate had just been introduced
  on the production publish path. That is the exact under-reporting failure recorded
  for UC-ADIX-013.
- No test coverage was missed and the final head is consistent (both diagrams render,
  the `def044changed` class marks all five affected nodes, the ledger row is present).

## Required fix / suggested process amendment

Two candidate resolutions, for the retro to choose between rather than for an
individual agent to decide ad hoc:

1. **Sub-step commits are exempt, the item's final commit is not** — state explicitly
   that the same-commit `.mmd` rule binds the commit that COMPLETES the item, and that
   intermediate green sub-steps may defer it. This is what actually happened here, and
   it is defensible, but it currently reads as a violation.
2. **Cheap marker first, narrative last** — require the intermediate commit to add the
   node/edge and its `:::changed` mark only (a two-line diff, so
   `make impacted-tests` is never false-clean), and allow the prose/`edge-ledger.md`
   narrative to land with the completing commit.

Option 2 preserves the mechanical signal the rule exists to protect at every sha,
which is the point of the rule; option 1 only protects it at item boundaries.

---

## Retro disposition (v124, 2026-07-31, OagEventSource) — **OPTION 2 chosen**

The engineer's own closing argument decides it: the rule exists to keep the MECHANICAL
signal honest, and option 1 protects that signal only at item boundaries — which is
precisely the false-clean `make impacted-tests` window this file documents. Routed to
`engineer.md` (change-impact model): **every commit that adds/removes/redirects an edge
carries the node/edge plus its `:::changed` mark in that same commit — a two-line diff,
never deferred; the `edge-ledger.md` narrative and any prose may land with the commit
that COMPLETES the item.** Cheap marker first, narrative last. This is the same family
as the OFS v115 finding (front-loaded `:::changed` marks made a UC's SINCE-window
false-clean from the other direction) — both are "the graph must be truthful at the sha
a tool will actually read", so both fixes point the same way.

**How this file was nearly lost — a SECOND live instance of the DEFECT-OAG-045 class,
found by accident during this retro's close step.** The commit carrying it
(`e13d70d`, branch `worktree-agent-a28e8c1f6d5174514`) was stranded in a disposable
Agent-tool isolation worktree under `.claude/worktrees/` in the integration tree,
unmerged into `main` or any `instance/*` branch, and invisible to the retro it was
explicitly written for ("two candidate amendments, for the retro to choose between").
It surfaced only because that untracked directory dirtied the integration tree and
BLOCKED `make project-foldback`. Preserved by hand (the commit's content re-committed
on `instance/OagEventSource`) before the stale worktree was retired. This is exactly
why v124 added the durable-ref requirement to `orchestrator.md` — and it is evidence
that open-items fix (3) (*the isolation bootstrap must not clone/hold the only copy of
anything*) is the real fix and is still owed.
