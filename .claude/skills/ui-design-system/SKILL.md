---
name: ui-design-system
description: The UI Designer's methodology, abstracted so the agent (and orchestrator) need not hold it in context. Covers the design-token taxonomy, component-driven decomposition, navigation/IA and click-reduction heuristics, the WCAG 2.2 AA acceptance checklist, the component-library mapping procedure, and the templates for the project design system and the per-slice UI design spec. Load this before doing any UI structure or polish work.
---

# UI design system (the method)

Read this instead of re-deriving design rules each slice. It keeps a clean,
crisp, consistent, accessible UI cheap to produce and protects the orchestration
context. It does not hold any project's specifics — those live in
`work/<project>/design/`.

## The two passes (what runs when)
- **STRUCTURE** — before the engineer builds. Output: nav/IA, component
  decomposition, click-path budget, testable a11y conditions, stable selectors,
  `ui-design.md`. Goal: the engineer routes and the tester tests against a real
  interaction model.
- **POLISH** — after the engineer's functional build is green, before the deploy
  gate. Output: small presentational edits that make the result match the design
  system. Goal: crisp consistency. Rule: tweak, never rebuild; behaviour changes
  go back to the engineer as defects.

## Design tokens (the consistency primitive)
A clean UI is consistent because everything references tokens, never raw values.
Define and reuse, do not duplicate:
- **Colour** — semantic, not literal (`surface`, `surface-muted`, `text`,
  `text-muted`, `accent`, `danger`, `focus-ring`). Every text/background pairing
  records its contrast ratio and must clear AA (4.5:1 body, 3:1 large/UI).
- **Type scale** — a small stepped scale (e.g. 12/14/16/20/24/32) with line-height
  and weight per step. No off-scale font sizes.
- **Spacing scale** — one base unit and multiples (e.g. 4 -> 4/8/12/16/24/32/48).
  All margins/padding/gaps come from it. Off-scale spacing is the #1 source of a
  "messy" feel.
- **Radii, elevation, motion** — small fixed sets; one motion duration/easing
  pair for standard transitions, plus a `prefers-reduced-motion` path.
When a component library is adopted, express these tokens THROUGH its theming
(e.g. Tailwind theme, MUI theme) — the token file stays the source of truth; the
library consumes it. Never run two token systems at once.

## Component-driven decomposition
Compose screens from a small inventory of reusable components, smallest-first
(primitives -> composites -> screens). For each component define its full state
set: default, hover, focus(-visible), active, disabled, loading, empty, error.
Missing empty/loading/error states are the most common "unfinished" tell — design
them up front. Reuse before you add; adding a near-duplicate of an existing
component is a consistency failure. Record every component in
`work/<project>/design/components.md`.

## Navigation, IA & click reduction
The job is done in the fewest deliberate steps, and the user always knows where
they are and how to get back.
- Map each use case to a **click-path**: start state -> ... -> job done. State the
  budget (max clicks/keystrokes) and justify every step; cut steps before adding
  them. Defaults, sensible pre-selection, and progressive disclosure remove
  steps; modal stacking and deep menus add them.
- Keep the IA shallow and labelled in the user's language. Primary actions are
  reachable without hunting; destructive actions are guarded but not buried.
- Every flow has a back/cancel path and preserves entered work where reasonable.
Record nav model + budgets in `work/<project>/design/patterns.md`.

## Accessibility — WCAG 2.2 AA checklist (emit as testable cases)
Turn each relevant item into an acceptance case in the slice `acceptance.md`
(tagged to its use case) so the tester enforces it with axe + Playwright:
- **Keyboard**: every interactive element operable by keyboard; logical focus
  order; no traps; visible focus indicator (`:focus-visible`).
- **Contrast**: text >= 4.5:1 (>=3:1 large/UI components); focus ring >= 3:1.
- **Targets**: interactive targets >= 24x24 CSS px (2.5.8).
- **Names/roles**: every control has an accessible name; correct role; state
  exposed (aria-expanded/selected/disabled). Form fields have associated labels
  and programmatic error messaging.
- **Structure**: one h1 per view, ordered headings, landmark regions, images
  have alt or are marked decorative.
- **Motion**: honour `prefers-reduced-motion`; no content flashing > 3x/s.
- **Live regions** for async status (loading/saved/error) so it is announced.
Each item maps to an axe rule or a Playwright assertion — write it as such.

## Stable selectors (a11y contract == test hook)
For every interactive element specify ONE stable semantic identifier the build
must expose, in this preference order: `getByRole(role, { name })` (accessible
name doubles as the a11y label) > `[aria-label="…"]` > `[data-testid="…"]`.
Never a derived count, `nth(N)`, or text-exclusion filter (process §22–§23).
Hand these to the engineer in `ui-design.md`; they become the smoke + validation
selectors, so designing them up front is what makes selectors stable.

## Component-library mapping procedure
1. Detect the library from the slice/requirements (none named -> token-based
   custom components).
2. For each inventory component, pick the closest library primitive; record the
   mapping and any deviations in `components.md`.
3. Theme the library with the project tokens; do not restyle ad hoc per usage.
4. A11y: prefer the library's accessible primitive over a hand-rolled one, but
   still assert the a11y acceptance cases — library != automatically conformant.
5. Library added/changed mid-project = a design-system migration: raise an open
   item, migrate deliberately, never mix two systems silently.

## Templates

### work/<project>/design/design-system.md
```
# Design system — <project>
Library: <none|name + version>  Theming: <how tokens reach the lib>
## Colour (semantic -> value, contrast vs paired bg)
## Type scale (step -> size/line-height/weight)
## Spacing scale (base + multiples)
## Radii / Elevation / Motion (sets + reduced-motion path)
```

### work/<project>/design/components.md
```
# Component inventory — <project>
| Component | States | Stable selector | Maps to (lib primitive|custom) | A11y notes |
```

### work/<project>/design/patterns.md
```
# Patterns — <project>
## Navigation / IA model (entry points, hierarchy, back/cancel)
## Click-path budgets (core job -> max steps)
## Standard states (empty / loading / error / responsive breakpoints)
```

### work/<project>/slices/<nnn>-<slug>/ui-design.md
```
# UI design — <slice>
Applies: <yes UI surface | no-op + why>
## Surfaces touched (screens/routes)
## Navigation / IA delta
## Component decomposition (component -> states -> stable selector)
## Click-path budget (per use case, with justification)
## Accessibility conditions (AA) -> mirrored into acceptance.md
## NOT designed yet (deferred)
```

## Economy
Additive and diff-friendly: extend the design system per slice, never
speculate ahead of need. When this file or the design docs get heavy, prefer a
narrower follow-on skill over inflating context (the repo's skill-for-heavy-docs
rule).
