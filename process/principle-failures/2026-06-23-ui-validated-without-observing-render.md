# 2026-06-23 — UI "validated" GO-for-DONE without observing the render

**Class:** validation gap / escaped defect (DEFECT-OAG-016). HIGH — a GO was given on a broken surface.

## What happened
The tester validated the deployed FIDS slice and returned **GO for DONE**. It
checked the data pipeline thoroughly (108k-event bootstrap, client↔server fold
agreement, AD-1..AD-12 security) — but the **rendered board itself was never
observed**. The visual/geometry/a11y checks (A-10 grid, live-axe, row highlight)
were marked **DEFERRED** because Playwright "was not committed". The board was in
fact empty (companion failure [false-green-fixtures-mirrored-wrong-shape]); a
GO was issued on a surface no one had looked at.

## Why it's a deviation
`tester.md` already says: validate through the most public-facing surface, web →
drive it through a browser as a user would, via the committed framework
(`npx playwright test`). Deferring the render and passing the slice violates that.
A UI slice's customer outcome IS the render; confirming the pipeline that feeds it
is necessary but not sufficient.

## Root cause
Playwright was never installed/wired for the `fids-app`, and "no tool" was treated
as licence to DEFER rather than as a BLOCKER to fix. Compounded by the orchestrator
then improvising a headless-Chrome check itself instead of sending the tester back
(see [orchestrator-performed-validation-itself]).

## Fix (routed → tester.md "How you validate" + EXP-074; tool: Playwright e2e installed)
A UI surface is not validated until the RENDERED result is observed showing the real
outcome (populated rows/content, correct layout). Missing browser tooling is a
BLOCKER to resolve (install Playwright, author the e2e render spec), never a reason
to defer and pass. Playwright + an e2e render suite (asserts non-empty rows + A-10
geometry + axe against the live board) is now installed for fids-app. Targets CFR
(escaped UI-render defects → 0).
