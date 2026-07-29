# Principle failure (recurrence): impacted-tests reported an empty change-map for
UC-G2 because the shared arch-gate commit for its 2-UC slice landed BEFORE the
tester's SINCE boundary (the sibling UC's own validated ref)

**Date:** 2026-07-21
**Project:** OperationalFlowSimulator
**Agent:** tester (hit it)
**Principle:** "Plan from the change map, then validate" — "If the model diff is
empty but code clearly changed behaviour, that is an updated-in-commit principle
failure — log it and derive your plan from the code diff instead." Same class as
`2026-07-16-uc-adix-013-changed-node-not-marked-empty-impacted-tests.md`, but a
distinct trigger mechanism worth naming separately.

## What happened
Validating UC-G2 (last UC of SLC-G1), `make impacted-tests SINCE=af6f949
PROJECT=OperationalFlowSimulator` (af6f949 = UC-G1's own `validated` ref, the
correct SINCE per the tester skill) reported:

    No changed/added/removed nodes in architecture/dependencies/*.mmd.
    EXIT 0 (clean — nothing to tick off).

This is FALSE as a scope signal for UC-G2. `git diff af6f949..HEAD --stat` shows
substantial UC-G2 behaviour landed: `src/app/src/ui/App.tsx` (+159),
`src/app/src/ui/distributionChart.ts` (new, +230), `src/app/src/flags.ts`,
`src/app/src/index.css`, plus the e2e/unit specs. But the `class-deps.mmd` /
`data-flow.mmd` / `use-case-deps.mmd` `:::changed` marks for `app`/`distribution`/
`UCG2` were all added in commit `95c04e9` (the solution-architect's SLC-G1 delta
gate) — which landed BEFORE `af6f949` (UC-G1's build+validate). Because SLC-G1 is
a 2-UC sequential slice (UC-G1 -> UC-G2) sharing ONE upfront arch-gate commit, and
each UC's tester SINCE is keyed to the PRECEDING UC's own validated ref, the
second UC in the sequence will structurally never see that shared commit's
`changed` marks in its own window — they are always already-behind its SINCE.

## Fallback taken (this validation)
Did not rely on the empty impacted-tests report. Confirmed via `grep @covers` that
the three affected nodes (`app`, `distribution`, `UCG2`) ARE covered by committed
specs (`uc-g2-distribution.spec.ts`, `tests/ui/distributionChart.test.ts`) added in
this window, derived scope from `git diff af6f949..HEAD --stat` directly, and ran
the full suite (258 unit / 135 e2e / lint / build, all green) plus a manual
requirement-level visual check (screenshot of both shipped samples' rendered
charts) before validating.

## Standing lesson
For any slice with >1 sequential UC sharing a single upfront arch-gate commit, the
LAST UC(s) in the sequence will predictably get a false-clean `impacted-tests`
report keyed off the immediately-preceding UC's validated ref, because the shared
`:::changed` marks pre-date every UC's own SINCE window. Two options worth the
tool owning (flagged for cicd/engineer, not fixed here): (a) tester SINCE for a
slice's Nth UC should default to the SLICE's own arch-gate commit (or the slice's
first `pulled` timestamp), not merely the immediately-prior sibling UC's validated
ref; or (b) each UC's own `built_green` commit should re-touch (or re-timestamp)
the specific node/edge lines it delivers, even when the textual content is
unchanged from the arch-gate commit, so the "ADDED in-window" diff has something to
see. Until either lands, treat an empty impacted-tests report on a multi-UC slice's
non-first UC as UNRELIABLE by default — cross-check `@covers` tags against the
code diff directly, as done here.
