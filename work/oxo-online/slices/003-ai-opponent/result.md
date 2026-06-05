---
slice: 003-ai-opponent
tester: tester
validated: 2026-06-05
production-url: https://d3pf3kcvzpau1x.cloudfront.net
outcome: PASS
---

# Slice 003 — Validation Result

## Outcome: PASS

All 11 acceptance-criteria tests pass against the live production URL.
Slice 002 regression suite (10 tests) also passes — two-player mode unchanged.

## Surface exercised

Playwright / Chromium against `https://d3pf3kcvzpau1x.cloudfront.net` (production CloudFront).

## Evidence

### Slice 003 suite — 11/11 pass (3.6s total)

| Test | AC | Result | Notes |
|------|----|--------|-------|
| F1 — vs Computer option visible; starts game as X | F1 | PASS | aria-pressed toggling confirmed; board reset; "X's turn" visible |
| F2 — AI O responds automatically after human X | F2 | PASS | O appeared in empty cell without second click; 1 X + 1 O confirmed |
| F3 — AI move within 200ms | F3 | PASS | In-page elapsed 47.4ms (well under 200ms); O rendered within 500ms waitForFunction |
| F4a — top-row attempt: no X win | F4 | PASS | Drew or O won; X-wins never shown |
| F4b — diagonal attempt: no X win | F4 | PASS | AI blocked diagonal; X never won |
| F4c — full game to completion: never X wins | F4 | PASS | Greedy human sequence; result = Draw or O wins |
| F5 — locked board + correct result (Draw or O wins) | F5 | PASS | All 9 cells disabled after end; Play Again visible |
| F6 — Play again resets and stays in vs-Computer | F6 | PASS | Board cleared; "X's turn"; aria-pressed="true" on vs Computer; AI responded to next move |
| T5/S2/S3 — zero network during gameplay | T5/S2/S3 | PASS | 0 fetch/XHR/WebSocket requests logged after initial load |
| T7 — two-player default mode unchanged | T7 | PASS | Only human-clicked O counted; X wins in two-player confirmed |
| S1 — cell values closed to {X, O, empty} | S1 | PASS | All cells inspected; no unexpected values |

### Slice 002 regression — 10/10 pass (2.2s total)

All prior two-player acceptance criteria still green. No regression introduced.

## Adversarial checks performed

- **F4 unbeatable**: Tested three distinct human strategies (top row, main diagonal, greedy lowest-index).  
  Result in every case was Draw or O wins — X never won.
- **AI speed**: Measured in-browser elapsed time at 47.4ms — well under the 200ms threshold.
- **Mode stickiness**: After Play Again, verified `aria-pressed="true"` on vs Computer and confirmed AI
  responded to the next move, ruling out silent mode reset.
- **Network isolation**: Listener registered after `networkidle`; zero gameplay requests detected
  across full game + play-again + second game.
- **Cell lock after game end**: Verified all 9 cells show `disabled` attribute; board rejects input.
- **Two-player regression**: Default `aria-pressed` state, alternating turns, and X-wins path all
  confirmed by both the T7 test and the full slice 002 regression suite.

## Test file

`/work/oxo-online/src/app/tests/smoke/slice003-validation.spec.ts`
