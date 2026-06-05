---
slice: 002-local-game
validated: 2026-06-05
tester: claude-sonnet-4-6
surface: Playwright / Chromium against live production HTTPS URL
url: https://d3pf3kcvzpau1x.cloudfront.net
test-file: work/oxo-online/src/app/tests/smoke/slice002-validation.spec.ts
verdict: PASS
---

# Slice 002 — Validation Result

## Surface exercised

Playwright (Chromium, headless) against `https://d3pf3kcvzpau1x.cloudfront.net` — the
same public-facing HTTPS URL that end-users reach. No local build or server was used.

## Acceptance cases

| # | Case | Result | Evidence |
|---|------|--------|----------|
| T3 | Production HTTPS URL serves the game (not 404, not old placeholder) | PASS | HTTP 200 over HTTPS; 9 cell buttons present; turn indicator shows "X's turn" |
| AC-1 | Click empty square → player symbol appears | PASS | Cell 0 shows "X" after first click; cell 1 shows "O" after second click |
| AC-2 | Turn indicator alternates X ↔ O after each valid move | PASS | Label cycles X's turn → O's turn → X's turn → O's turn across 3 moves |
| AC-3 | Click taken square → no change to board or turn | PASS | Cell 0 is `disabled` after X claims it; force-click does not advance turn (still O's turn); cell text remains "X" |
| AC-4 (X wins) | Completed line locks board and shows "X wins" | PASS | X top-row win sequence; "X wins" visible; post-win force-click on empty cell leaves result intact; no turn indicator visible |
| AC-4 (O wins) | "O wins" shown when O completes a line | PASS | O left-column win sequence; "O wins" visible |
| AC-5 | Full board, no winner → "Draw" shown | PASS | Known 9-move draw sequence (X:0 O:4 X:2 O:1 X:7 O:3 X:5 O:8 X:6); "Draw" visible |
| AC-6 | "Play again" resets board and turn; new game playable | PASS | After win: "Play again" click clears all 9 cells to empty, sets turn to "X's turn"; new X move registers correctly |

## Technical / security checks

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| T1 / S2 | Zero fetch/XHR/WebSocket during gameplay (moves, win, draw, reset) | PASS | Playwright request listener registered after networkidle; full gameplay sequence recorded 0 post-load network requests |
| S1 | Cell values are closed to {X, O, empty} — no arbitrary user text | PASS | All 9 cells inspected mid-game; values are exactly "X", "O", or "" — nothing else |

## Test run summary

```
Running 10 tests using 7 workers
  ✓  T3   — production HTTPS URL serves the game           (292ms)
  ✓  AC-1 — clicking an empty square renders symbol         (345ms)
  ✓  AC-2 — turn indicator alternates X and O              (359ms)
  ✓  AC-3 — clicking a taken square has no effect          (365ms)
  ✓  AC-4 — "O wins" shown when O completes a line         (413ms)
  ✓  AC-4 — completing a winning line locks board, X wins  (430ms)
  ✓  AC-5 — full board with no winner shows "Draw"         (462ms)
  ✓  AC-6 — "Play again" resets the game                   (266ms)
  ✓  S1   — cell values are closed to X, O, or empty       (210ms)
  ✓  T1/S2 — no network requests during gameplay           (1.3s)

  10 passed (2.2s)
```

## Observations

- Taken cells are implemented as `disabled` HTML buttons (`<button disabled ...>`). This
  is the correct DOM mechanism: the browser and React both prevent activation, satisfying
  AC-3 without any custom event-filtering logic.
- Board lock after a win is also `disabled` on all cells, confirmed by force-click leaving
  result text unchanged and no turn indicator visible.
- The game is purely client-side: after the initial static-asset load, not a single
  network request is made during any gameplay action, satisfying T1 and S2.

## Overall verdict

**PASS.** All 6 functional success measures, both technical checks (T1, T3), and both
security-observable conditions (S1, S2) are satisfied on the live production deployment.
Slice 002 is done.
