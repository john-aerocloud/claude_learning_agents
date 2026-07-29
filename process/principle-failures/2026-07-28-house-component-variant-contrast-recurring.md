# House design-system component VARIANTS fail WCAG non-text contrast, invisible offline (recurring, 3×)

**Date:** 2026-07-28 · **Project:** ROC · **Slices:** SLC-ROC-014 / 017 / 018 (C4 config-authoring)

## What recurred — THREE live painted-pixel contrast rejects, each a NEW unstyled variant
The tester's live painted-pixel tier (real Chromium screenshot → RGBA decode) has rejected a
config-authoring UC **three times** on WCAG 1.4.11 non-text contrast (AC-*-6f/7g/8g), each a
DIFFERENT house `@aerocloudsystems/design-system` component/variant whose default paints below
3:1 — and each invisible to the engineer's full offline bar (jsdom axe + vitest-browser's
APPROXIMATED CSS both miss it):

1. **UC-056** — `ACBadge color="warning"` fill 1.11:1 + `ACTextInput` settled border 1.47:1
   (house defaults). Fixed with a shared testid-scoped `!important` override in `index.css`.
2. **UC-064** — the SAME defaults, re-inherited: the UC-056 override was keyed only to the
   RULE surface's testids, so the new SITE surface's testids silently fell back to the failing
   house defaults (1.11:1 / 1.47:1). Fixed by extending the override to the new testids; the
   engineer added an offline `index.css.contrast.test.ts` source pin.
3. **UC-069** — `ACButton color="success"` renders transparent bg + 0 border = **1.00:1**. It is
   an UNSTYLED code path (only `ACAlert` themes `color="success"`; no other `ACButton` uses it).
   Chosen specifically to SIDESTEP the badge trap — and introduced a brand-new failing variant.

## Root cause (systemic, not per-UC)
The offline guard is **enumerative**: `index.css.contrast.test.ts` pins the contrast of the
specific testids/variants known to fail *so far*. Every new surface or new component-variant is
a NEW unstyled/underspecified path that the enumerative pin does not yet cover, so it re-enters
the failing state and is caught only at the tester's live tier — as rework, one stage late. The
house design system ships multiple variants (`color=warning|success|…`, settled input borders)
whose non-text contrast is below AA and which are not themed for every component that accepts the
prop. "Sidestep to a different variant" just moves the defect to the next un-pinned variant.

## Cost
Two full rework loops (UC-064, UC-069) + one same-slice fix (UC-056) — the dominant driver of
ROC's dev-validation failure rate (11.1%, the top ACTIVE constraint per views/stats.md §C). Each
is an honest dev-stage catch (never reached prod), but the COST of the catch is a live-tier
reject + a re-loop.

## System response — route at the imminent SLC-ROC-018 retro (do NOT enumerate-and-chase)
The enumerative pin loses the race by construction. Candidate systemic fixes to score at the retro:
- **A GENERIC offline contrast lint over rendered CSS** — assert that NO house component in the
  app renders below the AA non-text threshold for ANY variant it is used with, driven from the
  compiled `index.css` + the component usage set, so a new variant fails offline the first time
  it is used (not per-testid enumeration).
- **A design-system-level fix / allow-list**: forbid the known-unstyled variants
  (`ACButton color="success"`, bare `ACBadge color="warning"` without the override) via an eslint
  rule or a thin house-wrapper that guarantees AA, so the failing path is unreachable.
- **Shift the painted-pixel check left** into the engineer's bar for UI slices (needs the real
  browser, not vitest-browser's approximated CSS) — the tester already proves it's cheap on the
  live stack; the question is DORA-value-per-token of running it pre-`built_green`.

This entry supersedes/extends [2026-07-27-offline-green-ne-live-correct-ui-pipeline.md] with the
specific, now-3×-confirmed component-variant sub-class and its enumerative-guard root cause.
