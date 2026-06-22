# 2026-06-23 — false-green: fixtures hand-authored to the code's wrong data shape

**Class:** test-validity gap / escaped defect (DEFECT-OAG-016). HIGH — shipped a broken surface to prod.

## What happened
The FIDS demo's `active-filter.ts` (and the table columns) read flight times from
`departure.scheduled.outGate.utc` / `arrival.scheduled.inGate.utc`. The real OAG
folded aggregate has **no `scheduled` object at all** — times live at top-level
`estimated.*` / `actual.*`. So `isActive()` returned false for **every** flight and
the deployed board was **permanently empty**.

The full unit suite was **152 tests green**. They passed because the fixtures were
**hand-authored to match the code's assumed shape** — the same `departure.scheduled.*`
paths the code read. Test and code shared one wrong assumption, so no test could ever
catch it. The empty board reached prod and was only found by an out-of-band
ground-truth check against the live feed.

## Why it's a deviation
Tests exist to catch the code being wrong about the world. A fixture authored to
mirror the code cannot do that — it asserts the code agrees with itself. For code
that consumes a data shape we do not own (an API/event/third-party schema), the
fixture must come from the real source, or the green is meaningless.

## Root cause
No rule required external-data fixtures to be captured from the real source. The
product acceptance reconciliation (thin-delta) corrected `body.flight`→`body.delta`
but never verified the *field paths* against live data; the engineer then authored
fixtures to the acceptance's (still-wrong) paths.

## Fix (routed → engineer.md §2 + EXP-073)
When code consumes an external/live data shape, unit fixtures MUST be captured from
the REAL source (recorded sample committed under `tests/fixtures/`), never
hand-authored to match the code. Failing-test-first against the real shape. Targets
CFR (escaped wrong-shape defects → 0). See companion failure
[ui-validated-without-observing-render] — the second line of defence that also missed it.
