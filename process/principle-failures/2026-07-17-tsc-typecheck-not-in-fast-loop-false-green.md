# False-green: type-check absent from the fast test loop (DEF-ROC-002)

**Date:** 2026-07-17 · **Project:** ROC · **Class:** false-green (recurring)

## What happened

UC-ROC-019 (Service Bus managed-identity auth, commit `a5877f8`) shipped with a
**production** TypeScript error — `ServiceBusTelemetrySource.ts:119` TS2556 (spread
of a non-tuple into the `ServiceBusClient` constructor) — plus 8 test-file type
errors. It was marked `built_green` → done with **189 vitest tests passing and
eslint clean**. The break was invisible to the fast loop because:

- **vitest runs via esbuild** — transpile-only, NO type-checking.
- **eslint does not type-check** (no `@typescript-eslint` type-aware rules in the
  fast gate).

So `npm run build` (`tsc --noEmit false --outDir dist` — the REAL deployable-artifact
build) was red on trunk while every gate the engineer ran was green. Found only at
the next UC's close (UC-ROC-020), reproduced as DEF-ROC-002, fixed at `e3d1e98`
(all three gates — build/lint/test — then verified green).

## Why it matters

The pipeline (UC-ROC-022) emits the Function artifact with `npm run build`; the
production TS2556 would have **broken the dev/prod deploy**. A green suite that
hides a broken build is exactly the false-green class this system keeps re-learning.

## Recurring root-cause class

This is the **third false-green variant** recorded:
1. `2026-07-12-infra-pushed-green-locally-red-in-ci.md` — infra green locally, un-synthed → CI red.
2. `2026-07-12-roc-core-slice-local-only-real-delivery-untracked.md` / DEF-ROC-001 — file gitignored, code never on trunk despite green suite.
3. **This** — type-broken code green because the fast runner skips type-checking.

Common root: **the fast gate does not exercise the same checks the real
build/deploy does.** Each variant closed by widening "green" to include the missing
check.

## Fix (routed)

- **Engineer agent** (`.claude/agents/engineer.md`): "green" now REQUIRES the
  project's `build`/`typecheck` (`tsc`) to pass — a passing suite + clean lint is not
  sufficient in a typed project; a type error is red. Prefer wiring the type-check into
  the pre-commit/CI fast gate. This is a defect-preventing fix, not an experiment
  (no registry row).

## Recurrence check (next retro)

Confirm no `built_green` UC lands with a red `npm run build` on a typed project; if the
type-check gets wired into CI, confirm it fires. Targets **CFR / MTTR** (fewer escaped
build-breaking defects).
