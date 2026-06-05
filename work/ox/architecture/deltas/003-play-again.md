# Delta 003 — Play-again loop + session score (Chunk 3)

**Slice goal:** after a game ends, the player is asked whether to play again;
"y" resets the board and starts a fresh game in the **same process**; "n" (or
anything else) exits cleanly. A running session score (O wins / draws / X wins)
is shown after each game. This closes the last functional gap in the primary
job — replay without leaving the terminal.

## Architecture introduced (minimum to deliver value)

No new module is warranted. The whole change is a thin **session loop** that
wraps the existing `play_game()`. It lives in `ox/game.py` as a new
`run_session()` function, with `main()` (and therefore `python -m ox`) calling
it. `__main__.py` is unchanged. No new file, no change to Board, Parser,
Renderer, AI, or to the body of `play_game()`.

Rationale for not adding `session.py`: the session loop is a few lines of pure
control flow over the existing I/O seam already centralised in `game.py`. A new
module would add an import edge for no boundary benefit. If a future slice adds
side-selection or persistence the loop can be extracted then (re-slice economy).

## What changes

### 1. Score data structure — three plain counters

```python
# session score: counts reset every process start, no persistence.
score = {"O": 0, "draws": 0, "X": 0}
```

A plain `dict[str, int]` with three keys. No class, no file, no global. It is
created inside `run_session()` and lives only for the process lifetime.

### 2. Reading `play_game()`'s return value

`play_game()` already returns:
- `("win", "O")` — O (the AI) won,
- `("win", "X")` — X (the human) won (unreachable vs the perfect AI, but counted
  honestly),
- `DRAW` (sentinel) — a draw,
- `None` — game aborted by EOF / Ctrl-C mid-game (existing behaviour).

The session maps the result to exactly one counter increment:

```python
res = play_game(players=players, out=out)
if res is None:
    return          # mid-game EOF/Ctrl-C: existing clean abort, no prompt
if res == DRAW:
    score["draws"] += 1
elif isinstance(res, tuple) and res[0] == "win":
    score[res[1]] += 1   # res[1] is "O" or "X"
```

The loop depends only on `play_game()`'s **public return contract** — it does not
inspect board state.

### 3. Score display — after the result, before the prompt

After each non-aborted game, emit one line through the existing `out` sink:

```
Score — O wins: <o>  Draws: <d>  X wins: <x>
```

### 4. Play-again prompt flow

A play-again read uses a supplier with the **same shape as the move supplier**
(`prompt -> str`, defaulting to stdin `input`), so it is injectable in tests
exactly like moves are. The prompt is `"Play again? [y/n]: "`.

Loop structure (`run_session`):

```
loop forever:
    res = play_game(...)
    if res is None: return            # aborted mid-game -> exit
    update score from res
    emit score line
    answer = ask_play_again()         # may re-prompt ONCE on invalid input
    if answer is "y"/"Y": continue    # new game, fresh board (play_game makes one)
    else:                             # "n", "N", or anything else
        emit closing message
        return
```

Play-again input handling (mirrors move-input rules):
- Read one line; strip whitespace; treat only the **first** char (length-bounded,
  same defensive posture as move input — no unbounded use of the line).
- `y`/`Y` → replay. Any other value → treated as "no" / exit.
- **Invalid** input (empty, or not y/n) re-displays the prompt **exactly once**.
  On the second read, any non-`y` answer exits (no infinite loop — success
  measure 4).
- EOF / Ctrl-C at the play-again prompt → clean exit, no traceback (consistent
  with the in-game abort path).

Board reset is **automatic**: each `play_game()` call constructs a new board via
`new_board()`, so "replay" inherently starts from an empty board — no shared
mutable state carries over (success measure 5).

## Interfaces (new, all in `game.py`)

```python
def run_session(players=None, out=None, again=None) -> dict:
    """Run games until the player declines. Return the final score dict.
    `again` is an injectable play-again supplier (prompt -> str); defaults to
    stdin. `players`/`out` pass straight through to play_game()."""
```

`main()` becomes `run_session(); return 0`. The injectable `again` seam is what
lets an acceptance test drive a multi-game session (e.g. feed "y" then "n")
without a subprocess (success measure 8).

## Not changed

`board.py`, `parser.py`, `renderer.py`, `ai.py`, `__main__.py`, and the body of
`play_game()` are untouched. No new container, account, network, persistence, or
dependency.

## Security

The only new input is the single play-again character from stdin. It reuses the
move-input posture: read a line, strip, length-bounded use (first char only),
never passed to `eval`/`exec`/`subprocess`/path/format. No new attack surface.
See `architecture/security/cli-process.md` (play-again clause added).
