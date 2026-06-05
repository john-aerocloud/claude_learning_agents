# oxo-online — Usage

## What is this?

oxo-online is a noughts and crosses (tic-tac-toe) game that runs in a web
browser. Two players sit at the same device and take turns clicking squares on
a 3x3 board. The game detects wins and draws, locks the board when the game
ends, and lets you start a new game without refreshing the page.

**Not yet available:** online play between separate browsers, an AI opponent,
player accounts, score tracking across sessions, and in-game chat. These are
planned for later chunks.

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

## How to play

1. **X always goes first.** The turn indicator at the top of the board shows
   whose turn it is: "X's turn" or "O's turn".

2. **Click an empty square** to place your symbol. The square shows X or O
   and is then disabled — it cannot be clicked again.

3. **Turns alternate automatically.** After X plays, the indicator switches to
   "O's turn", and vice versa. Clicking an already-taken square has no effect
   and does not advance the turn.

4. **Win detection:** After every move the game checks all eight lines (three
   rows, three columns, two diagonals). If one player completes a line, the
   board locks and the result is shown: **"X wins"** or **"O wins"**. No
   further moves are accepted.

5. **Draw detection:** If all nine squares are filled with no winning line, the
   result shows **"Draw"** and the board locks.

6. **Play again:** A "Play again" button appears on the result screen. Clicking
   it clears the board, resets the turn indicator to "X's turn", and starts a
   fresh game — no page refresh needed.

---

## Example session

```
[Page loads]
Turn: X's turn

Player X clicks top-left  →  X | . | .
                               . | . | .
                               . | . | .
Turn: O's turn

Player O clicks centre     →  X | . | .
                               . | O | .
                               . | . | .
Turn: X's turn

... (play continues) ...

Player X completes top row →  X | X | X
                               . | O | .
                               . | . | O
Result: "X wins"
Board locked. [Play again] button shown.

Player clicks "Play again" →  board cleared, turn = "X's turn"
```

---

## Known limitations

- The game is a local hot-seat game only. Both players must share the same
  browser tab — there is no way to play from separate devices in this version.
- Mobile layout is functional but not optimised for small screens.
- There is no undo, no move history, and no score tally across multiple games.
