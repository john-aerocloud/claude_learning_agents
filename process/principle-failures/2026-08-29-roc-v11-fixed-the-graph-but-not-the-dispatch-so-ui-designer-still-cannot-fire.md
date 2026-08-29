---
date: 2026-08-29
project: ROC
iteration: UC-ROC-115 (pre-build STRUCTURE pass)
principle: "§F13 — each agent fires its own state events" + state-graphs v11 "firing rights are DERIVED from the item"
dora_metric_harmed: lead_time
---

## Expected

State-graphs **v11** (OI-ROC-006, authored on ROC on **2026-08-29**, the same day)
was written to end exactly this: *"the tenth arrived INSIDE the experiment built
to stop UI defects escaping to humans, and the role it blocked — `ui-designer` —
was on NO EDGE OF THE DEFECT GRAPH AT ALL."* Its replacement is item-declared
ownership, set by a flow role **"in the same act as the dispatch"**. So the next
`ui-designer` dispatch should have been able to fire its own event.

## Actual

The **first** `ui-designer` dispatch after v11 was blocked for the same reason.

```
append REJECTED: UC-ROC-115 is in state 'building'.
  event 'amended' is legal here, but 'ui-designer' does not own this item
  (owner: cicd, documenter, engineer, product, solution-architect, tester).
```

`UC-ROC-115` carries no `owner:` in its frontmatter, so it fell back to
`default_owners` — the backward-compatible closure, which by construction
excludes `ui-designer`. The `pulled` event that dispatched this pass
(orchestrator, 2026-08-29T16:13:00Z) says in its own note that it is dispatching
"the ui-designer structure pass", and declares no owner.

The two exits the agent has are both refused ones: borrow another role's name
(the substitution v11 exists to stop, which corrupts `by_owner` and the
plumbing/delivery split) or declare the owner itself (only a flow role may). So
the pass completed, was committed (`3c30da18`), and is **unrecorded in the event
log** until a flow role fires on its behalf — the extra dispatch v11 was
measuring as the cost.

## Why the principle did not hold

**v11 changed the RIGHTS MODEL but nothing changed the DISPATCH.** The rule
"ownership is declared in the same act as the dispatch" lives in a `_comment`
inside `state-graphs.json`; no gate, template or checklist makes a dispatch to a
non-default-owner role carry `OWNER=`. A rule whose only enforcement is that
someone read the rationale of the file they were not editing is the
vacuous-mechanism shape this repo keeps re-finding.

It also **fails silently in the wrong direction**: the omission is invisible at
dispatch time and only surfaces hours later, at the far end, when the specialist
has already done the work and has nothing to attribute it to.

## Guidance for next time

1. **When dispatching a specialist outside `default_owners`** — `ui-designer`,
   `discovery`, or `documenter` on a defect — **the pull event MUST carry
   `OWNER=`**. For a UI-bearing use-case the specialist does not finish, declare
   the set, not the singleton: `OWNER="ui-designer,engineer"`, so the structure
   pass can fire `amended` and the engineer can still fire `built_green`. A bare
   `OWNER=ui-designer` NARROWS and would block the build.
2. **Detection signal, cheap and mechanical:** an item in `building` whose
   dispatch note names a role that is not in its effective owner set is a
   mis-dispatch. `make dispatch-check` already gates isolation; owner
   declaration is the same shape and belongs beside it.
3. **Do not let the specialist work around it.** Borrowing a role name is worse
   than the missing row: the row can be added later, the corrupted attribution
   cannot be found later.

Retro candidate: v11's replacement is sound; its **dispatch side is
unmechanised**, and this is instance one, on day one, in the project that
authored it.
