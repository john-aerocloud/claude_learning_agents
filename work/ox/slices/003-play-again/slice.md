---
slice: 003
slug: play-again
chunk: 3
status: pending
created: 2026-06-05
---

# Slice 003 — Play-again loop

## Job served

Primary job: "When a person has a few minutes to kill at a terminal and wants a
quick mental challenge, they want to play noughts and crosses against an
unbeatable opponent, so they can test their own tactical thinking and get a
genuine result — and play again immediately without friction."

This slice closes the last open gap in the functional dimension of the primary
job: "play again without restarting the program." Before this slice, every game
ends with the process exiting; the player must re-invoke the program to play
again, breaking the flow of repeated play. After this slice, a player who
finishes a game is asked whether they want another; answering yes resets the
board and starts a fresh game in the same process. The job is now fully
delivered.

Killick's test: a player can now do something they could not do before — replay
immediately without leaving the terminal and re-running the program. The slice
is not split thinner because there is no intermediate state that delivers real
value: the only behaviour added is a prompt + branch at game end, making it the
smallest possible increment.

## Thin scope — what IS in this slice

- After a game ends (win, draw, or loss), display the result (as slice 002 does
  today) and then prompt the user with a play-again question, e.g.
  "Play again? [y/n]:".
- If the user enters "y" (or "Y"), reset the board to the empty state and start
  a new game with the same player configuration (human as X, computer as O,
  X moves first).
- If the user enters "n" (or "N"), or any input that is not "y"/"Y", print a
  brief closing message and exit the process with code 0.
- Invalid input at the play-again prompt re-displays the prompt once; the player
  is not silently dropped or crashed.
- The play-again loop wraps `play_game()` — no change to the internals of
  `play_game()` itself, the AI, the board, or the renderer.
- `play_game()` continues to return the result value as it does today; the loop
  is in the entry-point (`__main__` or equivalent) only.
- After each game result (and before the play-again prompt), display a running
  session score: wins (O), losses (X wins — impossible with perfect AI), and
  draws, e.g. "Score — O wins: 2  Draws: 1  X wins: 0". Counts reset when the
  process exits; no persistence.

## Explicitly NOT in scope

- Choosing sides between games (human as O / computer as X).
- Persistent score tracking (scores do not survive process restart).
- Side selection or per-side score tracking beyond O wins / draws / X wins.
- Difficulty levels or AI changes.
- Any change to board rendering, input handling for moves, or win/draw detection.
- Any change to the AI (`ai.py` / minimax) module.
- Persistent session state (scores surviving process restart).
- Networked, GUI, or multiplayer play.
- Undo / take-back moves.
- Any new command-line flags or configuration.

## Success measures

Observable outcomes that determine whether this slice succeeded:

1. **Play-again prompt appears** — after every game result (win, draw, or loss)
   the program displays a play-again prompt before exiting; the process does not
   exit without giving the player this choice.
2. **"y" replays** — entering "y" or "Y" at the play-again prompt causes the
   board to reset to empty, the game to restart from the beginning (X moves
   first), and the play-again prompt to appear again at the end of that new
   game.
3. **"n" exits cleanly** — entering "n", "N", or any non-"y" response causes
   the process to exit with code 0 and a closing message; no exception or
   traceback appears.
4. **Invalid play-again input is handled** — non-y/n input (e.g. an empty
   string, a digit, a word) causes the prompt to be re-displayed exactly once;
   the player is never silently dropped or left in an infinite re-prompt loop.
5. **Board resets correctly between games** — after choosing to replay, the
   board is fully empty; no squares carry state from the previous game.
6. **Score displayed after each game** — after the result and before the
   play-again prompt, the running session score is shown (O wins, draws, X wins).
   Counts increment correctly across games; reset when the process exits.
7. **Prior acceptance tests still pass** — all slice 001 and slice 002
   acceptance tests continue to pass without modification; the play-again loop
   introduces no regression.
8. **Callable in tests** — the entry-point loop can be driven programmatically
   (e.g. by injecting "y" then "n" as stdin input) so acceptance tests can
   cover multi-game sessions without spawning a subprocess.
