---
slice: 001
slug: playable-board
co-authored-by: product + solution-architect
created: 2026-06-04
---

# Acceptance criteria — Slice 001: Playable board

Each criterion is observable and automatable (pytest with monkeypatched stdin/stdout).
Criteria are grouped by module, then by game-loop behaviour.

---

## AC-01: Board / Rules — centre move accepted and recorded

Given a fresh board.  
When `apply("B2", "X")` is called.  
Then `state["B2"] == "X"` and `"B2"` is no longer in `legal_moves()`.

---

## AC-02: Board / Rules — win detection (all 8 lines)

For each of the 8 winning lines (rows A, B, C; columns 1, 2, 3; diagonals A1-B2-C3 and A3-B2-C1):  
Given the three cells of that line are set to the same mark and remaining cells are empty or the opponent's.  
When `result()` is called.  
Then it returns `win(<mark>)`.

---

## AC-03: Board / Rules — draw detection

Given all 9 cells are filled and no winning line exists.  
When `result()` is called.  
Then it returns `draw`.

---

## AC-04: Input Parser — valid coordinates accepted

For each valid input in `["A1", "a1", " B3 ", "C2"]`:  
When the parser processes it.  
Then it returns the correct `(row, col)` tuple with no error.

---

## AC-05: Input Parser — malformed input rejected with typed reason

For each malformed input in `["Z9", "b", "", "12", "AA"]`:  
When the parser processes it.  
Then it returns a rejection with reason `malformed` or `out_of_range` (as appropriate), never a Python exception.

---

## AC-06: Input Parser — occupied cell rejected with typed reason

Given cell `A1` is occupied.  
When the parser (or game loop) processes the input `"A1"`.  
Then it returns a rejection with reason `occupied`.

---

## AC-07: Renderer — board fits 80 columns

Given any legal board state (empty, mid-game, full).  
When `render(state)` is called.  
Then every line in the returned string is <= 80 characters wide.

---

## AC-08: Renderer — alignment consistent across states

Given the board rendered at the start of the game and after any sequence of moves.  
When each rendered string is split into lines.  
Then the column header line and all row lines share the same width and character positions for grid separators.

---

## AC-09: Game loop — turn not lost on invalid input

Given it is X's turn.  
When stdin yields an invalid input followed by a valid input.  
Then the board reflects only the valid move as X's; turn passes to O.

---

## AC-10: Game loop — X moves first

Given a new game is started.  
When the first prompt is issued.  
Then the prompt identifies the current player as X.

---

## AC-11: Game loop — result announced and process exits 0

Given a game is driven to completion (win or draw) through a scripted move sequence.  
When the final move is accepted.  
Then the game announces the result (including the winning mark or "draw") and `play_game()` returns that result value; when run as `python -m ox` the process exits with status 0.

---

## AC-12: play_game() is importable and callable without subprocess

Given `from ox.game import play_game` (or equivalent import path).  
When `play_game()` is called with stdin/stdout monkeypatched.  
Then it returns a result value and does not raise; no global side-effects prevent repeated calls in the same process.

---

## AC-13: Player move-supplier is a parameter (interface stability)

Given the game loop accepts a `players` argument mapping mark to a callable that returns a move string.  
When the callable for O is replaced with a stub that always returns a fixed valid move.  
Then the game completes correctly without touching Board, Parser, or Renderer internals.

---

## Out-of-scope (not tested in this slice)

- AI / minimax correctness (Chunk 2).
- Play-again loop (Chunk 3).
- Any network or GUI path.
