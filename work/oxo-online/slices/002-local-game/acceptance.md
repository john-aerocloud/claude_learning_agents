# Slice 002 — Acceptance test cases (local two-player game)

Co-authored: Product owns the functional measures; Solution Architect supplies
the technical/observable and security-observable conditions. Product's six
functional success measures live in `slice.md` (§Success measures) and are the
source for the gameplay test cases — they are not duplicated here.

## Functional (from Product — see slice.md §Success measures)
1. Click empty square -> symbol appears.
2. Turn indicator alternates X <-> O after each valid move.
3. Click on taken square -> no change to board or turn.
4. Completed line -> board locked, "X wins" / "O wins" shown.
5. Full board, no line -> "Draw" shown.
6. "Play again" -> board cleared, turn = X's, new game playable.

## Technical / observable (Solution Architect)
| # | Condition | How verified |
|---|-----------|--------------|
| T1 | No network request occurs during gameplay (move, win, draw, reset) beyond the initial static-asset load | Browser network panel / Playwright request log shows zero fetch/XHR/WebSocket from gameplay |
| T2 | Game logic is unit-testable in isolation: win on each of the 8 lines, draw, illegal-move rejection, and reset pass without React, DOM, or network | Unit test suite against the pure logic module |
| T3 | The new bundle ships through the existing S3+CloudFront pipeline and is live at the same production HTTPS URL with no infra or IAM change | Pipeline run + diff shows no IaC/IAM change; URL unchanged |

## Security-observable (Solution Architect)
| # | Condition | How verified |
|---|-----------|--------------|
| S1 | No user-supplied text is rendered; cell values are closed to {X, O, empty}; `dangerouslySetInnerHTML` is absent from the game UI | Code review / grep; render inspection |
| S2 | Gameplay triggers no outbound network call (confirms no new data flow off-device) | Same evidence as T1 |

Conclusion of the design security review: no new attack surface, data flow, or
trust boundary (see `architecture/deltas/002-local-game.md` §Security review).
Client-side state manipulation is accepted by design for a single-browser
hot-seat game; server authority is a Chunk 4 control.
