---
slice: 002-local-game
chunk: 2
status: proposed
created: 2026-06-05
---

# Slice 002 — Local two-player game

## Job served

**Core job — playing against a real human (functional core)**

> When I want to play noughts and crosses with someone next to me, I want to
> open the URL in a browser and take turns clicking squares on the same device,
> so that we can play a complete game and find out who won.

This is the first slice that does something real for a user. Two people, one
browser, no accounts, no server — they can play a full game to completion and
see the result. Every slice after this builds on a working game; without this,
nothing that follows is testable end-to-end.

Killick's test: a user can now do something they could not do before — play a
complete game of noughts and crosses at the live URL.

## Thin scope — what IS in this slice

All changes are React components delivered as a new build of the existing SPA.
No backend changes. The current shell (placeholder screen) is replaced by a
playable game.

- **3x3 board** — nine clickable squares; clicking a square claims it for the
  current player (X or O) and marks it as taken.
- **Turn indicator** — a visible label showing whose turn it is ("X's turn" /
  "O's turn"), updated after each move.
- **Move alternation** — X always goes first; turns alternate correctly after
  each valid click; clicking an already-taken square has no effect.
- **Win detection** — after every move the game checks all eight winning lines
  (three rows, three columns, two diagonals); if one is complete the game ends.
- **Draw detection** — if all nine squares are filled with no winning line, the
  game ends as a draw.
- **Result display** — when the game ends, the board is locked (no further
  clicks accepted) and the result is shown: "X wins", "O wins", or "Draw".
- **Play again** — a single button on the result display resets the board to
  the start state so a new game can begin without a page refresh.

## Explicitly NOT in scope

**Features deferred to later chunks:**
- Online play — no server, no WebSocket, no real-time sync between browsers.
- AI opponent — no computer player; both sides are human.
- Player identity — no names, no accounts, no session persistence.
- Leaderboard — no win/loss tracking beyond the current game.
- In-game chat.

**Scope creep deferred within this UI:**
- Animations or transitions on moves, wins, or the result screen.
- Theming, custom colour palettes, or dark mode.
- Undo / take-back move.
- Move history or game log.
- Score tally across multiple games in the same session.
- Responsive/mobile layout polish (functional but not optimised for mobile).
- Keyboard or accessibility (a11y) hardening beyond default browser behaviour.
- Any loading states — there is nothing async in this slice.

## Success measures

Observable by a person or automated browser test. No access to internal state
required.

| # | Measure | How verified |
|---|---------|--------------|
| 1 | A player can click any empty square and see their symbol (X or O) appear in that square | Click square; symbol renders in the clicked cell |
| 2 | After X plays, the turn indicator changes to "O's turn"; after O plays, it changes back to "X's turn" | Observe label text after each click |
| 3 | Clicking a square that is already taken has no effect — the symbol does not change and the turn does not advance | Click an occupied square; board state and turn indicator are unchanged |
| 4 | When three matching symbols complete a line (row, column, or diagonal), the board is locked and the result screen shows "X wins" or "O wins" | Play a winning sequence; no further squares are clickable; correct winner is shown |
| 5 | When all nine squares are filled with no winning line, the result screen shows "Draw" | Play to a drawn board; result text reads "Draw" |
| 6 | Clicking "Play again" on the result screen resets the board to nine empty squares, sets the turn indicator to "X's turn", and allows a new game to proceed | Click "Play again"; board clears; a full new game can be played |
