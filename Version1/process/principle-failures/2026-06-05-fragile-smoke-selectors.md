---
date: 2026-06-05
agent: engineer / tester
project: oxo-online
slices: 002-local-game, 003-ai-opponent
principle: smoke test selectors must be semantically stable (aria-label / data-testid), not derived from button count or text-exclusion filters
---

# Principle deviation — fragile smoke selectors (TWO occurrences, now a pattern)

## What happened

**Slice 002:** `getCells` used `page.getByRole('button').filter({ hasNotText: /play again/i })` — selected ALL buttons except "Play again". When two mode-selector buttons were added in slice 003, the count went from 9 to 11, breaking every test that expected exactly 9 cells.

**Slice 003:** The same fragile pattern was present in both `shell.spec.ts` (cell count assertion) and `slice002-validation.spec.ts` (getCells helper). Smoke tests passed on slice 002 because no extra buttons existed. Slice 003 added "Two player" and "vs Computer" buttons to the same screen, breaking both files.

Both failures were caught by the pipeline (not pre-push), causing MTTR 222s and 257s respectively. CFR rose to 33% across 6 deploys.

## Root cause

The `getCells` helper was written as "all buttons except play-again". This is an **implicit assumption about the button inventory of the screen** — fragile because it breaks whenever any new button is added, regardless of whether it's a cell or not.

Cell buttons have `aria-label="cell N"` from the very first implementation of `Cell.tsx`. A selector scoped to `[aria-label^="cell "]` would have survived both changes.

## Fix applied (both times by orchestrator, not caught pre-push)

Updated `getCells` to `page.locator('[aria-label^="cell "]')` and updated `shell.spec.ts` similarly. Fix took < 5 min each time but cost one pipeline cycle per slice.

## Generalised rule (now a pattern — warrants §23)

**All smoke test selectors for game-interactive elements must use a stable semantic identifier:**
- ✓ `[aria-label^="cell "]` — stable; scoped to cells only
- ✓ `[data-testid="board-cell"]` — stable if added
- ✗ `getByRole('button').filter({ hasNotText: /some text/ })` — fragile; breaks on any new button
- ✗ `getByRole('button').nth(N)` — fragile; breaks on any button insertion

**Applies to:** any smoke helper that selects a specific category of interactive element on a screen that will gain more interactive elements as the product evolves.

## Reversal condition

If the game UI is restructured so that aria-labels change (unlikely — `Cell.tsx` sets them explicitly), update the selector at that point. The selector itself is stable against feature additions.
