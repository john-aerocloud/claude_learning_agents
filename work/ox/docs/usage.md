# ox — Noughts and Crosses

## What does this do?

ox is a command-line noughts and crosses (tic-tac-toe) game where a single human
plays X against an unbeatable computer opponent that plays O. X always moves
first. You enter coordinates for your moves; the computer responds immediately and
automatically without prompting. The board is redrawn after every move. The game
announces the result (O win or draw — the human cannot win with optimal computer
play), displays a running session score, then asks whether you want to play again.
Answering yes resets the board and starts a fresh game without leaving the
terminal. The product is feature-complete. The one fixed limitation is that you
always play X; side selection is not available.

---

## How do I run it?

**Prerequisite:** Python 3 (any version in the 3.x series). No third-party
packages required; only the standard library is used.

From the `src/` directory inside the project:

```
cd work/ox/src
python3 -m ox
```

`ox` is a package, not a single script file — `python3 -m ox` is the only supported entry point.

---

## How do I use it?

**Coordinate notation:** columns are labelled A–C (left to right), rows are
labelled 1–3 (top to bottom). A move is the column letter followed by the row
number, e.g. `B2` for the centre cell. Input is case-insensitive and leading/
trailing whitespace is ignored.

**Example session (draw, then exit):**

```
Player X, enter your move (e.g. B2): A1
    A   B   C
 1  X | . | .
    -----------
 2  . | . | .
    -----------
 3  . | . | .

...
It's a draw.
Score — O wins: 0  Draws: 1  X wins: 0
Play again? [y/n]: n
Thanks for playing!
```

After you enter a valid move, the computer places O automatically — no prompt
appears for O's turn. The board is redrawn showing both moves before you are
asked again.

**Session score:** after every game result a score line appears showing cumulative
counts for the current process run: `Score — O wins: N  Draws: N  X wins: N`.
Counts reset when the process exits; there is no persistent storage.

**Play again:** after the score line, `Play again? [y/n]:` appears. Enter `y` or
`Y` to replay with an empty board. Enter `n`, `N`, or any other input to exit
with `Thanks for playing!` and status 0. If your first response is neither `y`
nor `n`, the prompt re-appears once; a second non-"y" response exits the program.

**What to expect:** the computer uses minimax and never makes a suboptimal move.
Every game ends in either a computer win or a draw. You can force a draw with
perfect play; you cannot win.

**Error messages you may see:**

| Message | Meaning |
|---|---|
| `'ZZ' is not a move — type a cell like B2 (A-C, 1-3).` | Input could not be parsed as a column-row pair. |
| `'D4' is off the board — columns A-C, rows 1-3.` | Column or row is outside the valid range. |
| `B2 is already taken — pick another.` | The cell you entered is already occupied. |
| `Input too long — type a cell like B2.` | Input exceeded the expected length. |
| `Game aborted.` | The input stream ended unexpectedly (e.g. Ctrl-C or EOF). |
| `Please answer y or n.` | The play-again prompt received unrecognised input; re-enter. |

In every move-input error case the same player is re-prompted; the turn is not lost.

**Exit behaviour:** the process exits with status 0 after a win, a draw, an
aborted game, or choosing not to play again.
