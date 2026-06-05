# oxo-online — Usage

## What is this?

oxo-online is a noughts and crosses (tic-tac-toe) game that runs in a web
browser. Before each game you choose a mode: play against another person at
the same device, or play solo against an unbeatable computer opponent. The
game detects wins and draws, locks the board when the game ends, and lets you
start a new game without refreshing the page. All game logic runs in the
browser — no server is involved once the page has loaded.

**Not yet available:** online play between separate browsers, player accounts,
score tracking across sessions, and in-game chat. These are planned for later
chunks.

---

## How to access it

Open this URL in any modern browser:

```
https://d3pf3kcvzpau1x.cloudfront.net
```

No installation, no account, no login required. The game loads immediately.
All gameplay is handled in the browser — no network requests are made after
the page loads.

---

## Choosing a mode

A mode selector appears at the top of the game screen before the first move.
Two options are available:

- **Two player** (default) — both players share the keyboard and mouse and
  take turns clicking squares.
- **vs Computer** — you play as X; the computer plays as O automatically after
  each of your moves.

Click the option you want. The board resets and "X's turn" is shown. The mode
stays active if you click "Play again" — you do not need to reselect it.

---

## How to play — Two player

1. **X always goes first.** The turn indicator at the top of the board shows
   whose turn it is: "X's turn" or "O's turn".

2. **Click an empty square** to place your symbol. The square shows X or O
   and is then disabled.

3. **Turns alternate automatically.** After X plays, the indicator switches to
   "O's turn", and vice versa.

4. **Win detection:** After every move the game checks all eight lines (three
   rows, three columns, two diagonals). If one player completes a line, the
   board locks and the result is shown: **"X wins"** or **"O wins"**.

5. **Draw detection:** If all nine squares are filled with no winning line, the
   result shows **"Draw"** and the board locks.

6. **Play again:** A "Play again" button appears on the result screen. Clicking
   it clears the board, resets the turn indicator to "X's turn", and starts a
   fresh game.

---

## How to play — vs Computer

The rules above apply, with these differences:

- You are always **X**. The computer is always **O**.
- After you click a square, the computer places its move automatically —
  no second click required. The computer responds in under 200ms (measured
  at 47ms in production).
- The computer plays optimally using the minimax algorithm. **You cannot
  win.** Every completed game ends in a draw or an O win. There is no move
  sequence that leads to X winning.
- The board locks and the result ("Draw" or "O wins") is shown when the
  game ends.
- "Play again" resets the board and keeps you in vs Computer mode.

---

## Example session — vs Computer

```
[Page loads — "Two player" selected by default]

User clicks "vs Computer"
Turn: X's turn

X clicks top-left          →  X | . | .
                               . | . | .
                               . | . | .

Computer plays O           →  X | . | .
                               . | O | .   (AI placed O, no click needed)
                               . | . | .
Turn: X's turn

... (play continues) ...

Game ends                  →  Result: "Draw"
                               Board locked. [Play again] button shown.

User clicks "Play again"   →  board cleared, turn = "X's turn", mode = vs Computer
```

---

## Known limitations

- The game is a local game only. Both players (in two-player mode) must share
  the same browser tab — there is no way to play from separate devices in this
  version.
- Mobile layout is functional but not optimised for small screens.
- There is no undo, no move history, and no score tally across multiple games.
