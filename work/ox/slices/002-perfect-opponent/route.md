# Route — Slice 002: Perfect opponent (AI Engine)

The thin route that advanced the slice most per step, taken strictly
red -> green -> refactor on trunk. Each step landed independently.

## Seam discovered up front
`game.play_game` calls a move-supplier as `supplier(prompt)` (slice 001). The
AI must be a pure function of board *state* (`ai_move(state)`), per the slice-002
acceptance. So the supplier seam had to be widened to hand the board state to a
state-aware supplier while leaving stdin suppliers (which take a `prompt`)
untouched. Resolved by signature introspection (`_wants_state`): a supplier
declaring a `state`/`board` parameter is handed the live board and is never
prompted. This is the minimal, behaviour-preserving change to the loop.

## TDD steps (ordered)

1. **AC-07 interface (red->green).** Test: `ai_move(new_board())` returns a
   coordinate in the `A1..C3` grammar and a legal cell. Implemented
   `ox/ai.py` with `_side_to_play` (X starts; X to move when counts equal) and a
   negamax search returning the best legal cell. Green.

2. **AC-02 tactics (red->green).** Tests: takes an immediate win; blocks an
   opponent threat; prefers its own win over a block. Drove the depth-aware
   tie-break (`_better`: higher score wins; among equal scores prefer faster
   wins / slower losses; draws keep the first cell in fixed `CELLS` order for
   determinism). Fixed test fixtures so O is genuinely to move (X has one more
   mark than O). Green.

3. **AC-08 purity (red->green).** Tests: deterministic (same state -> same
   move); does not mutate the input board (recursion uses `Board.apply`, which
   already returns a new board — no Board addition needed); performs no
   stdin/stdout (input() sabotaged, capsys empty). Green with no code change
   beyond confirming purity.

4. **AC-06 performance (red->green).** Test: empty board (worst case) under 1s.
   Full 9-ply negamax runs in well under the budget. Green.

5. **AC-01 exhaustive correctness (red->green).** Tests: walk the whole game
   tree exploring every legal X move while O always plays `ai_move` — assert no
   terminal is `win("X")`; and AI-vs-AI is always a draw. Green: the AI never
   loses.

6. **Game-loop seam (red->green).** Tests in `test_game.py`: a state-aware
   supplier receives the dict board (not a prompt); no "Player O, enter your
   move" prompt is emitted when O is a state supplier (AC-03). Implemented
   `_wants_state` + the state/prompt branch in `play_game`. Existing AC-13
   prompt-based suppliers unchanged. Green.

7. **AC-04 one-player wiring (red->green).** Tests: `default_players()` puts
   `ai_move` on O; a default game prompts only X and X never wins. Changed
   `game.default_players` to `{"X": stdin, "O": ai_move}`. `__main__` stays
   config-only (docstring updated). Green.

8. **AC-09 security (red->green).** Added policy tests in `test_security.py`:
   `ai.py` contains no dynamic-execution / IO / network / subprocess primitive;
   the AI reads no stdin (input() sabotaged still succeeds); output is a bounded
   legal cell over sampled reachable states; no state mutation. Reworded the
   `ai.py` docstring so prose ("no sockets") no longer trips the substring
   scanners. Green; all slice-001 security controls still hold.

## Regression (AC-05)
All 39 slice-001 tests pass unchanged. Final suite: 58 passed.

## Files touched
- Added `ox/ai.py` (negamax, pure).
- `ox/game.py`: `_wants_state` introspection + state/prompt branch; default O =
  `ai_move`.
- `ox/__main__.py`: docstring only (config-only entry point).
- Added `tests/test_ai.py`; extended `tests/test_security.py` (AC-09) and
  `tests/test_game.py` (state-supplier seam, AC-03).

## WIP independence
Each step was sequentially independent and small enough to land on trunk
continuously. No Board/Parser/Renderer behaviour changed; the loop change is a
pure widening of the existing supplier seam.
