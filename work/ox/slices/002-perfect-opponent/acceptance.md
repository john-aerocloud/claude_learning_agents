---
slice: 002
slug: perfect-opponent
co-authored-by: product + solution-architect
created: 2026-06-04
---

# Acceptance criteria — Slice 002: Perfect computer opponent

Each criterion is observable and automatable (pytest; stdin/stdout monkeypatched
where the loop is exercised; AI exercised as a pure import). Criteria trace to
the slice success measures (SM-n).

---

## AC-01: Exhaustive correctness — the AI never loses (SM-1)

Given the AI plays O and the human plays X (X first).
When **every** reachable game is enumerated by exploring all legal X moves at
each X turn while O always plays `ai_move(state)`, recursing to every terminal
state.
Then **every** terminal state is either `win("O")` or `draw`; **no** terminal
state is `win("X")`.

- This is a full game-tree walk over the AI's responses (bounded, <= 9 plies),
  not random sampling.
- A symmetric variant also holds: with the AI playing **both** sides, every game
  is a `draw` (optimal vs optimal).

---

## AC-02: AI is optimal on known tactical positions (SM-1)

For a fixed table of positions with a unique forcing best move:
Given a board state with an immediate winning move for O available.
When `ai_move(state)` is called.
Then it returns the winning move (completes O's line).

And given a state where X threatens to win next move and O has no win:
When `ai_move(state)` is called.
Then it returns a move that blocks X's threat.

---

## AC-03: Auto-move — no O prompt, computer moves after X (SM-2)

Given a game running with `play_game(players={"O": ai_move})` and X moves
supplied via stdin.
When X submits a valid move.
Then O's move is applied and the board re-rendered **without any prompt
addressed to player O appearing on stdout/stderr** (no "O" prompt string is
emitted), and no read from stdin occurs for O's turn.

---

## AC-04: One-player UX end to end (SM-3)

Given `python3 -m ox` (or the loop invoked with the default AI players map) and
a scripted sequence of valid X moves driving the game to its end.
When the game completes.
Then only player-X prompts ever appear, the final result is announced (O win or
draw — never an X win), and when run as a process it exits with status 0.

---

## AC-05: Regression — all slice 001 ACs still pass (SM-4)

Given the slice 001 acceptance suite (AC-01..AC-13 in
`slices/001-playable-board/acceptance.md`).
When the suite is run unmodified against the slice-002 code.
Then every slice 001 AC passes — Board, Parser, Renderer, Game Loop, and the
`players` seam are unchanged in behaviour.

---

## AC-06: Performance — AI move within 1 second (SM-5)

Given any reachable board state (including the empty board, the worst case).
When `ai_move(state)` is timed.
Then it returns in under 1 second on a standard developer laptop. A full game
of AI moves completes well within the per-game budget; no perceptible lag.

---

## AC-07: Interface — importable and callable without subprocess (SM-6)

Given `from ox.ai import ai_move` (or the equivalent import path).
When `ai_move(state)` is called directly in a unit test with no subprocess and
no terminal.
Then it returns a coordinate string in the `A1..C3` grammar and raises nothing.

And given `play_game(players={"X": stub_x, "O": ai_move})` with both suppliers
as callables.
When `play_game()` is called.
Then a complete game runs programmatically and returns a result value with no
subprocess.

---

## AC-08: Move is purely a function of state; no I/O; no live-board mutation

Given the same board state passed to `ai_move` twice.
When called repeatedly.
Then it returns the same move (deterministic tie-break) and performs no read
from stdin, no write to stdout/stderr, opens no file, and the board state object
passed in is **not mutated** by the call.

---

## AC-09: Security — AI supplier adds no untrusted input surface (security)

Given the AI move-supplier path.
When the code is inspected/tested per `architecture/security/ai-engine.md`.
Then: the AI consumes only in-process board state (no stdin/file/socket/env);
its output re-enters through the existing validated Parser path (it is not
written to the Board by a privileged path); and no `eval`/`exec`/`subprocess`/
file/socket is introduced by the AI module.

---

## Out-of-scope (not tested in this slice)

- Play-again loop (Chunk 3).
- Side selection (human as O) and difficulty / beatable modes.
- Alpha-beta pruning as a required behaviour (optional implementation detail).
