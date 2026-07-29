# IMP-024 — Generic offline non-text-contrast check (beat the enumerative pin)

**Status:** QUEUED (owned by cicd / ui-designer + engineer to build; queue with UI product work)
**Opened:** 2026-07-28 (ROC, SLC-ROC-018 retro, process v116)
**Founding evidence:** principle-failure `2026-07-28-house-component-variant-contrast-recurring.md`
— THREE live painted-pixel contrast rejects in the ROC config-authoring line, each a DIFFERENT
unstyled house-component variant (UC-056 `ACBadge warning` fill + `ACTextInput` border; UC-064 a
new surface's testids re-inheriting the failing defaults; UC-069 `ACButton color="success"`
transparent = 1.00:1).

## Problem
The current offline guard against WCAG 1.4.11 non-text contrast is **enumerative**:
`work/ROC/src/dashboard/src/index.css.contrast.test.ts` pins the contrast of the specific
`data-testid`s/variants known to fail *so far*. Every new surface or new component-variant is a
NEW un-pinned path that silently re-inherits the sub-AA house default, so it is caught only at the
tester's live painted-pixel tier — as rework, one stage late. "Sidestep to a different variant"
just moves the defect to the next un-pinned variant. This is the dominant driver of ROC's
dev-validation failure rate (11.8%, the top ACTIONABLE GLT constraint per views/stats.md §C).

## Proposed change (needs building — hence an improvement slice, not a one-line fix)
A GENERIC offline check that fails when ANY house design-system component instance would render
below the AA non-text threshold for the variant it is used with — driven from the COMPILED
`index.css` (the real cascade, resolving the design-system tokens) + the set of component usages,
NOT a per-testid enumeration. Candidate shapes to evaluate at build time:
- a build-step that resolves each shipped component/variant's painted fill+border against its
  panel background from the compiled CSS custom properties and asserts ≥3:1 (non-text) / ≥4.5:1
  (text), failing the build on any violation — so a new variant fails offline the FIRST time it is
  used; and/or
- an eslint rule / thin house-wrapper that forbids the known-unstyled variants
  (`ACButton color="success"`, bare `ACBadge color="warning"` without the override), making the
  failing path unreachable rather than caught-after-the-fact.

## Target DORA metric + measurement (score when built)
CFR + lead time: the next UI slices' dev-validation **contrast-reject rate** should fall to ~0
(vs the 3× rejects across SLC-014/017/018), removing the contrast rework loop (each reject costs a
full engineer re-fix + tester re-validate cycle — also the top token sink). Falsifiable: if a UI
slice still takes a live contrast reject for a variant the generic check should have caught, the
check is insufficient.

## Interim (already in force, v116, plain practice — engineer.md)
Until IMP-024 is built: never rely on an un-themed house color/variant for a painted affordance;
every new testid'd control MUST be added to the shared `index.css` override AND pinned in
`index.css.contrast.test.ts` in the same change. This is the enumerative stopgap; IMP-024 is the
generic replacement.
