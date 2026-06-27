# Principle Failure: SLC-016 dependency model not updated

**Date:** 2026-06-26
**Slice:** SLC-016 (016-fids-filter-search)
**Project:** OagEventSource
**Detected by:** tester (impacted-tests EXIT 0 despite new feature nodes)

## What happened

`make impacted-tests SINCE=403aba1 PROJECT=OagEventSource` returned EXIT 0 (no changed nodes
in architecture/dependencies/*.mmd) even though SLC-016 added two new component/function nodes:

- `C_FilterBar` (FilterBar.tsx — new controlled component)
- `N_FlightFilter` (flight-filter.ts — new pure projection)

These nodes are described in ui-design.md §9 ("Component-map delta") with the instruction to
update the `*.mmd` file in the same commit. The engineer did not update
`work/OagEventSource/architecture/dependencies/*.mmd` alongside the code commits.

## Process principle violated

Process §1 (plan from the change map): "if the model diff is empty but code clearly changed
behaviour, that is an updated-in-commit principle failure — log it and derive your plan from
the code diff instead."

ui-design.md §9 explicitly calls this out: "Updated in the same commit as this spec."

## Impact

The tester had to derive the test plan from the code diff instead of the change-impact model.
No test coverage was missed (the `@covers` tags in the e2e spec were already present), but
the tooling's advisory exit-2 coverage guard was bypassed — future slices that build on these
nodes will not see them in `make impacted-tests` output until corrected.

## Required fix

Engineering must add `C_FilterBar` and `N_FlightFilter` to
`work/OagEventSource/architecture/dependencies/*.mmd` with appropriate edges, and mark them
`classDef changed` in the next slice that touches them, OR add them in a housekeeping commit.
