# Route — Slice 001: Playable board (TDD steps taken)

Thin route chosen to advance the playable game most-per-step: build the pure
core inside-out (Board -> Parser -> Renderer), then the I/O Game Loop that wires
them, then harden against the security notes. Each step was red -> green ->
refactor. Pure modules first because the Game Loop and security policy tests
depend on their stable interfaces.

Python: pyenv 3.13.12 (project targets 3.10+ stdlib only). pytest is dev-only.

## Ordered steps

1. **Scaffold + red.** Wrote all five test files first (`test_board`,
   `test_parser`, `test_renderer`, `test_game`, `test_security`). Collection
   failed (no `ox` package) — confirmed red.

2. **Board / Rules** (`board.py`) — AC-01, AC-02, AC-03.
   - `new_board`, `legal_moves`, pure `apply(board, cell, mark)` (returns a new
     board, never mutates input), `result()` -> `IN_PROGRESS | DRAW | win(mark)`.
   - All 8 win lines enumerated; win detected even with opponent marks present;
     full board with no line -> draw.

3. **Input Parser** (`parser.py`) — AC-04, AC-05, AC-06 + input-handling
   security controls.
   - Grammar `^[A-Ca-c][1-3]$` compiled once as a fixed literal.
   - Length-bound (`MAX_INPUT_LEN`) checked BEFORE parsing -> pathologically
     long lines rejected up front.
   - Typed `Rejection(reason)`: `malformed`, `out_of_range`, `occupied`. Never
     raises on bad input. Pure (does not mutate the `occupied` set).

4. **Renderer** (`renderer.py`) — AC-07, AC-08.
   - Pure state -> fixed-width ASCII grid. Column letters A/B/C, row numbers
     1/2/3, empty cell = ".". Every line <= 80 cols; identical line-width
     signature across empty/mid/full states (one char per cell keeps alignment).

5. **Game Loop** (`game.py`, `__init__.py`, `__main__.py`) — AC-09..AC-13.
   - `play_game(players=None, out=None)` is the ONLY I/O module. Returns the
     final result value (or `None` if aborted).
   - `players` maps mark -> callable(prompt) -> raw move string. Default is a
     stdin supplier. This is the Chunk-2 seam: swap O's supplier for an AI
     without touching Board/Parser/Renderer (AC-13).
   - X moves first (AC-10). Invalid/occupied input -> typed message, same player
     re-prompted via `continue`, turn not lost (AC-09). Result announced;
     `python -m ox` exits 0 (AC-11). Importable and repeatable in-process (AC-12).
   - EOF / KeyboardInterrupt caught -> clean "Game aborted.", no traceback.

6. **Security policy tests** (`test_security.py`) — one assertion per checkbox in
   `architecture/security/cli-process.md`: validated-before-use, grammar-bounded,
   length-bounded, turn-not-forfeited; no eval/exec/compile-builtin/pickle/
   dynamic-import; no subprocess/shell; no getattr/setattr/format-string on input;
   no file writes (verified against a tmp dir) and no write-mode `open`; no
   sockets/network; stdlib-only runtime; pytest not imported by runtime;
   EOF and Ctrl-C end cleanly.

## Refactors made green-to-green

- Replaced an obscure `__import__("re")` with a plain `import re` in the parser
  (the dynamic-import form tripped its own security policy test — correct signal).
- Security test for the builtin `compile()` narrowed to `(?<!\.)\bcompile\(` so
  the legitimate `re.compile` literal pattern is allowed while the dangerous
  builtin remains forbidden.
- Corrected the draw-sequence fixture in `test_game` to a genuine no-line full
  board (the first attempt accidentally completed a column for X).

## Result

39 tests, all green. All 13 ACs covered. Smoke test (X wins column A) prints the
board after each move and exits 0. Core modules are pure and I/O-free; the loop
is the single seam — sequentially independent, lands on trunk as one slice.
