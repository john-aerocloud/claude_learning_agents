---
slice: 002
slug: perfect-opponent
chunk: 2
status: pending
created: 2026-06-04
---

# Slice 002 — Perfect computer opponent

## Job served

Primary job: "When a person has a few minutes at a terminal, they want to play
noughts and crosses against an opponent that does not make mistakes, so they can
test their own tactical thinking and get a genuine result — not a hollow victory."

This slice serves the emotional core of that job: a player faces a computer that
never loses. Before this slice, there is no computer opponent; the user must find
a second human or play against themselves. After this slice, a single user at a
terminal can play a complete, genuinely challenging game alone and know the result
reflects their own play.

Killick's test: a user can now do something they could not do before — play a
meaningful, solo game against an unbeatable opponent. The slice is not split
thinner because no intermediate state delivers real value: a "blocks but
doesn't attack" AI would be beatable and would undermine the job's emotional
dimension. The seam (`play_game(players={...})`) already exists from slice 001;
only the AI move-supplier is new.

## Thin scope — what IS in this slice

- A minimax move-supplier function that always returns the optimal move for
  the computer's mark, given any board state (no alpha-beta required, but
  permitted if it keeps the code simple).
- Wire the computer move-supplier into `play_game()` as player O by default
  when running `python -m ox` (or `python ox.py`).
- The computer plays as O; the human plays as X. Turn order is unchanged
  (X moves first).
- The computer's move is applied automatically — no human prompt for player O.
- Board is re-rendered after the computer's move, identical to slice 001
  rendering behaviour.
- No change to input handling, board rendering, win/draw detection, or
  game-loop exit behaviour from slice 001.

## Explicitly NOT in scope

- Play-again loop (Chunk 3) — the program still exits after one game.
- Choice of side (human as O, computer as X).
- Difficulty levels or a beatable AI mode.
- Displaying the computer's "thinking" or move rationale.
- Alpha-beta pruning as a required optimisation (optional, not required).
- Any change to the `Board`, `Parser`, or `Renderer` components.
- Networked, GUI, or multiplayer play.
- Score persistence or leaderboards.
- Undo / take-back moves.

## Success measures

Observable outcomes that determine whether this slice succeeded:

1. **Computer never loses** — across every possible sequence of legal human
   moves the computer either wins or draws; there is no move sequence that ends
   with the human winning. This is verifiable by exhaustive test over all game
   trees (9! = 362,880 outcomes maximum, trivially enumerable).
2. **Computer plays without human input** — after the human submits a valid
   move, the computer's move is applied and the board is re-rendered without
   any prompt to the user.
3. **One-player UX** — running `python -m ox` starts a game where only player X
   prompts appear; no player O prompt is shown; the result is announced at game
   end and the process exits 0.
4. **Existing slice 001 tests still pass** — all acceptance tests from slice 001
   (board rendering, input validation, win/draw detection, clean exit, callable
   unit) continue to pass without modification.
5. **Response time acceptable** — the computer's move is returned within 1 second
   of the human's move on a standard developer laptop; no perceptible lag.
6. **Callable in tests** — the AI move-supplier can be imported and invoked
   directly in unit tests without launching a subprocess; `play_game()` can be
   called with both players as callables (human-replaced-by-callable and AI) to
   drive acceptance tests programmatically.
