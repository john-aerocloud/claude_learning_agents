---
date: 2026-06-05
agent: engineer
project: oxo-online
slice: 002-local-game
principle: done condition must include smoke test update when visible surface changes
---

# Principle deviation — smoke tests not updated when root route changed

## What happened

Slice 002 Phase C changed the app root route from `TitleScreen` to `GameRoot`.
The engineer updated `App.test.tsx` (unit test) to verify `/` renders the game,
but did not update `tests/smoke/shell.spec.ts` which still asserted:
- `h1` heading containing "oxo-online" (TitleScreen-specific)
- "Play Online" button visible (TitleScreen-specific)

The pipeline failed on deploy; recovery took ~5 min (MTTR 222s). This broke
the 0% CFR target (CFR now 20%).

## Root cause

The smoke test was written for the TitleScreen content that existed at `/` in
slice 001. When the engineer moved the root to `GameRoot`, the smoke test
became a broken spec — it described the old observable rather than the new one.
The done condition ("lint clean, build succeeds, unit tests pass") did not
include smoke test correctness.

## Fix applied

Orchestrator diagnosed and fixed directly: smoke tests updated to assert game
board elements (9 cell buttons, "X's turn" turn indicator) consistent with
the deployed slice 002 content.

## Generalised rule

**Whenever a slice changes the principal visible element at a well-known URL
(root `/`, key deep-links), the engineer's done condition must include: verify
that `tests/smoke/` assertions still match what the new surface renders.**

This is especially true for "Phase C style" changes — any step that rewires
the root route or replaces a prominent landmark element in the deployed SPA.

## Reversal condition

If smoke tests are restructured to be purely infrastructure-checking (HTTP 200,
TLS, S3 403, CloudFront routing) with no content assertions, this rule can be
relaxed for content changes. Until then, content smoke tests must travel with
the content changes that invalidate them.
