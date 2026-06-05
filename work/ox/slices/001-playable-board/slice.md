---
slice: 001
slug: playable-board
chunk: 1
status: pending
created: 2026-06-04
---

# Slice 001 — Playable board

## Job served

Primary job: "When a person has a few minutes at a terminal, they want to play
noughts and crosses against an opponent that does not make mistakes, so they can
get a genuine result."

This slice serves the foundational functional dimension of that job: a player
can enter moves, see the board update, and reach an unambiguous win/draw result.
The opponent is a second human; the AI (Chunk 2) is not yet present. Killick's
test: before this slice, the user cannot play any game at all. After it, they
can complete a full two-player game from first prompt to result.

## Thin scope — what IS in this slice

- 3x3 board state with legal-move tracking and win/draw detection across all
  rows, columns, and both diagonals.
- Input parser accepting coordinate notation `A1`–`C3` (case-insensitive,
  whitespace-trimmed), returning either a valid `(row, col)` or a typed
  rejection reason (malformed, out-of-range, cell occupied).
- ASCII renderer producing a board string that fits within 80 columns, with
  column letters and row numbers visible, aligned correctly after every move.
- Game loop: X moves first; turns alternate; on invalid input the same player
  is re-prompted (turn not lost); after each accepted move the board is
  re-rendered; when a result is reached it is announced and the process exits 0.
- Entry point: `python -m ox` (or `python ox.py`) runs one game and exits.
- `play_game()` function as a callable unit returning the final result, so
  Chunk 3 can wrap it without touching internals.
- Player concept parameterised by (mark, move-supplier) so Chunk 2 can swap in
  an AI supplier for one side without changing Board, Parser, or Renderer.

## Explicitly NOT in scope

- AI / computer opponent (Chunk 2).
- Play-again loop (Chunk 3) — the program exits after one game.
- Difficulty levels, beatable AI, undo/take-back.
- Networked or GUI play.
- Score persistence, leaderboards.
- Any interactive installer or dependency beyond Python 3 stdlib.

## Success measures

Observable outcomes that determine whether this slice succeeded:

1. **Complete game reachable** — starting from a terminal with Python 3, a user
   with no instructions can reach a win or draw result through typed moves alone.
   No dead-end prompt or crash during normal play.
2. **Invalid input handled** — every invalid input (`Z9`, single letter, empty
   string, an already-occupied cell) produces a distinct, clear rejection message
   and the same player is re-prompted; the turn is not lost.
3. **Win/draw detection correct** — all 8 win lines (3 rows, 3 columns,
   2 diagonals) are detected and announced with the correct mark; a full board
   with no winning line is announced as a draw.
4. **Board legible** — rendered board is never wider than 80 columns and column
   alignment does not shift after any move sequence.
5. **Clean exit** — after announcing the result the process exits with status 0.
6. **Callable unit** — `play_game()` can be imported and called in a test
   without launching a subprocess; it returns the result value.
