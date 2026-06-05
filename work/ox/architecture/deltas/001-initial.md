# Delta 001 — Initial: playable board (Chunk 1)

**Slice goal:** a real, testable game loop for two human players on a rendered
ASCII board, reaching win/draw. No AI yet (Chunk 2), no play-again (Chunk 3).

## Architecture introduced (minimum to deliver value)

New (from nothing):

- **Board / Rules** module — 3x3 state, `legal_moves`, `apply(cell, mark)`,
  `result()` -> {in_progress, win(mark), draw}. Pure, no I/O.
- **Input Parser** module — accepts coordinate notation `A1..C3` (case-insensitive),
  trims whitespace; returns either a `(row, col)` or a typed rejection reason
  (out-of-range, malformed, cell occupied). Pure.
- **Renderer** module — pure function: state -> ASCII grid string that fits and
  aligns within 80 columns; shows column letters and row numbers.
- **Game Loop** module — alternates X and O (X starts), prompts, reads stdin,
  dispatches to Parser then Board, re-prompts the same player on rejection
  (turn not lost), renders after each accepted move, announces the result.
- **Entry point** — `python -m ox` (or `python ox.py`) runs a single game and
  exits cleanly at the result.

## Explicitly deferred (no build-ahead)

- AI Engine / minimax — Chunk 2.
- Play-again loop — Chunk 3. Loop runs exactly one game and exits for now, but
  the loop is structured so a single game is a callable unit (a `play_game()`
  function) that Chunk 3 can wrap.

## Interfaces that must hold (so later chunks slot in)

- `play_game()` is a function returning the final result — Chunk 3 wraps it.
- The active-player concept is a parameter (mark + "who supplies the move"),
  so Chunk 2 can substitute the AI Engine for one side without changing Board,
  Parser, or Renderer.

## Acceptance conditions (technical/observable — co-authored with Product)

- Given an empty board, X's move `B2` is accepted and the rendered board shows X
  centre; turn passes to O.
- Invalid inputs (`Z9`, `b`, ``, `A1` when A1 is occupied) are each rejected with
  a distinct clear message and the **same** player is re-prompted.
- A completed line (row/col/diagonal) is detected and announced as that mark's
  win; a full board with no line is announced as a draw.
- Rendered board is <= 80 columns wide and columns stay aligned after any move.
- The process exits with status 0 after announcing a result.
```
