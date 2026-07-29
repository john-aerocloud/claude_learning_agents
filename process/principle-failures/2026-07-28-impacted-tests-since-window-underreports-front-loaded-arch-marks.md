# Principle failure (RECURRING): impacted-tests SINCE-window under-reports when arch marks are front-loaded

**Date:** 2026-07-28
**Project:** OperationalFlowSimulator
**Agent:** tester (hit it repeatedly), cicd (owns the tool)
**Principle:** §12c plan-from-the-change-map / §5b (a recurring root cause is a system failure to smooth it)
**Recurrences:** UC-H2, UC-H3, UC-I2, UC-J1, UC-J2 (5 this span)

## What happened
`make impacted-tests SINCE=<prior-UC-validated-ref>` returned "no changed nodes"/a thin set
even though code + `.mmd` clearly moved. Root: this project's architecture gate marks ALL of a
slice's `:::changed` nodes in ONE commit at slice-registration (before any UC in the slice is
built). A later UC's own last-validated-ref SINCE window therefore starts AFTER that arch-gate
commit, so the diff misses the marks. Each time, the tester had to notice the false-clean and
re-run with an earlier SINCE (the slice's pre-registration baseline) to recover the real scope.

## Root cause (≥3-level)
1. impacted-tests reports a thin/empty changed-set for a real change.
2. Because the SINCE window (prior-UC validated ref → HEAD) excludes the arch-gate commit.
3. Because the arch gate front-loads all slice marks in one pre-build commit — a sound practice
   for the model, but it decouples "when a node was marked changed" from "when its UC is built".
4. Root: the tool assumes marks land in the same window as the UC that consumes them; under
   front-loaded arch gating that assumption is false, and nothing warns the operator — the
   false-clean is silent (only tester diligence catches it).

## Remediation (routed this retro)
- tester.md: when the result looks empty/thin but code+`.mmd` moved, re-run with SINCE = the
  slice's PRE-REGISTRATION baseline (spans the arch-gate commit); never accept a false-clean.
- open-items → cicd (tool owner): make `impacted-tests` auto-resolve or WARN when the SINCE
  window predates the slice's arch-gate commit (or default SINCE to the slice baseline), so the
  operator isn't the only guard.

## Standing lesson
A mechanical scope tool that silently under-reports is worse than none — it invites a false-clean
pass. Where a sound practice (front-loaded arch marks) breaks a tool's window assumption, fix the
tool to detect the mismatch, not rely on the operator noticing every time.
