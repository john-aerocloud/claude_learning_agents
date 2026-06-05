---
slice: 003-ai-opponent
chunk: 3
status: proposed
created: 2026-06-05
---

# Slice 003 — Single-player vs AI

## Job served

**Supporting job — solo challenge without friction**

> When I want a quick game but no friend is available right now, I want to
> open the URL and play immediately against a computer opponent that provides
> a genuine challenge, so that I can get the satisfaction of a competitive
> game on my own schedule without any coordination required.

Functional dimension: play starts immediately with no second person needed.
Emotional dimension: an unbeatable opponent means every draw feels earned —
the challenge is real even though no human is watching.

Killick's test: a user can now do something they could not do before — play a
complete game against the computer at the live URL, alone, any time they like.

## Thin scope — what IS in this slice

All changes are client-side only. No backend changes. The existing game engine
and React components from slice 002 are reused; the AI is a new module that
plugs in as the O player.

- **Mode selector** — the game screen gains a way to choose "vs Computer"
  before play starts (a button or toggle on the initial board view; the current
  two-player behaviour is the default and is preserved unchanged).
- **AI as O** — in single-player mode the human always plays as X; the computer
  always plays as O.
- **Minimax engine** — a pure client-side minimax function determines the
  computer's move. It is optimal: given any board state it returns the best
  possible move for O. The player cannot win; every game ends in a draw or a
  computer win.
- **AI response time** — the computer move executes and renders within 200ms of
  the player's move completing. No artificial delay is added.
- **Reuse of result screen and play again** — when the game ends (draw or
  computer win) the existing result display and "Play again" button work
  identically to slice 002. "Play again" restarts in the same mode (vs
  Computer) without returning to mode selection.

## Explicitly NOT in scope

- Difficulty settings or beatable AI modes — the AI is always optimal
  (minimax). No easy / medium / hard.
- Online play — no server, no WebSocket, no second browser.
- Player identity — no names, no accounts, no session persistence.
- Leaderboard — no win/loss tracking.
- In-game chat.
- Animations or transitions on AI moves.
- Move history, undo, or take-back.
- Artificial delay or "thinking" indicator before AI move.
- Any change to the two-player mode from slice 002 — that path is untouched.
- Mobile layout polish or accessibility hardening.

## Success measures

Observable by a person or automated browser test. No access to internal state
required.

| # | Measure | How verified |
|---|---------|--------------|
| 1 | A "vs Computer" option is visible on the game screen before the first move; selecting it starts a single-player game with the human as X | Click the mode selector; board resets; turn indicator shows "X's turn" |
| 2 | After the human (X) makes a move, the computer (O) places its symbol on the board without any further user interaction | Play as X; a second symbol appears in a previously empty square without clicking |
| 3 | The computer's move appears within 200ms of the human's move being registered | Time from human click to O symbol render; measured in a browser test with `performance.now()` or equivalent |
| 4 | The human player cannot win — every completed game in "vs Computer" mode ends in a draw or a computer win; no path to an X victory exists | Exhaust game-tree permutations in test (all ~255,000 reachable states); assert no terminal state has X as winner |
| 5 | The board is locked and the result screen appears when the game ends (draw or computer win), showing the correct outcome | Play to completion; board accepts no further clicks; result text reads "Draw" or "O wins" |
| 6 | "Play again" after a single-player game resets the board and stays in "vs Computer" mode — the human can immediately play another game without re-selecting the mode | Click "Play again"; board clears; turn indicator shows "X's turn"; computer responds to the next human move |
