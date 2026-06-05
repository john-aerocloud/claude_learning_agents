# Delta 002 — Perfect opponent: minimax AI Engine (Chunk 2)

**Slice goal:** a single human (X) plays a complete game against an unbeatable
computer (O). The computer never loses — every game ends in a draw or an O win.

## Architecture introduced (minimum to deliver value)

New (one module only):

- **AI Engine** module (`ox/ai.py`) — a pure function of board state that
  returns the optimal move for the side to play. Promoted from
  "Chunk 2 — deferred" to active. No I/O, no shared mutable state.

Nothing else is added. No new container, account, network, or persistence.

## The interface

```python
def ai_move(board_state) -> str:
    """Return the optimal move (coordinate string, e.g. "B2") for the side
    whose turn it is in board_state. Pure: same state -> same family of
    optimal moves. No stdin/stdout, no globals, no I/O."""
```

- Input: the same board-state representation the Game Loop already holds and the
  Board module already exposes (cells + whose turn). The AI derives "side to
  play" from the state (X has moved one more time than O, or O when counts are
  equal — X starts), so the supplier needs no extra argument.
- Output: a coordinate string in the **same grammar the Parser already accepts**
  (`A1..C3`). This is deliberate: the AI feeds its move back through the existing
  `Parser -> Board.apply` path, so the move is validated by the same code as a
  human move. The AI is never given a privileged write path into the Board.

## How it plugs in (the seam already exists)

Slice 001 made the move-supplier a parameter:
`play_game(players={"X": ..., "O": ...})`, each value a callable returning a
move string. Slice 002 supplies `play_game(players={"O": ai_move})` — X keeps
the default stdin prompt, O is the AI.

```
   stdin (X) ─┐
              ├─> play_game(players={"O": ai_move})
   ai_move ───┘        │
                       ├─ supplier returns "B2" (string)
                       ├─ Parser validates "B2"      (unchanged)
                       ├─ Board.apply(cell, mark)     (unchanged)
                       └─ Renderer renders new board  (unchanged)
```

`__main__.py` wires `players={"O": ai_move}` as the default for
`python3 -m ox`. The Game Loop already, per slice 001 AC-13, calls the O
supplier instead of prompting when one is provided — so **no prompt is shown for
O** and the computer "moves immediately". This behaviour is exercised but not
newly built here.

## Algorithm

Negamax (the single-relation form of minimax) over the full game tree:

- Terminal value (from the perspective of the side to move): `+1` win, `-1`
  loss, `0` draw. Depth is folded in only to prefer faster wins / slower losses
  if desired (optional; correctness for "never loses" does not require it).
- For each legal move, recurse on the resulting state with the sign negated;
  pick the move with the maximum negated child value.
- The tree is at most 9 plies and ~362,880 leaf orderings — trivially
  enumerable, so **no alpha-beta pruning is required**. It is permitted if it
  keeps the code simple, but is not a correctness condition.
- Determinism: ties are broken by a fixed, total ordering of cells so the AI is
  reproducible in tests. (Any optimal move is acceptable for the "never loses"
  guarantee; the fixed tie-break is purely for test stability.)

This yields the standard tic-tac-toe result: against optimal play the game is a
draw, and against any sub-optimal human the AI wins or draws — **it cannot
lose.**

## Why no other module changes

| Module | Touched? | Reason |
|--------|----------|--------|
| Board / Rules | No | AI reads state and reuses `legal_moves`/`apply`/`result` that already exist. The recursion needs apply-on-a-copy and result-detection, both already public and pure. |
| Input Parser | No | AI emits the same `A1..C3` grammar; its move goes through the existing parse path. |
| Renderer | No | Rendering after a move is identical for human and AI moves. |
| Game Loop | No (behavioural reuse only) | The `players` seam and "call supplier vs prompt" branch already exist (slice 001 AC-13). |
| `__main__` | Config only | Sets the default `players={"O": ai_move}`. No logic change. |

If the recursion needs an "apply move to a copy without mutating the live board",
that must be served by Board's existing pure/immutable-ish contract (slice 001
treats Board as immutable-ish). If a copy helper is not already public, the
engineer adds a non-mutating `with_move`/copy on Board — a pure addition, no
behaviour change to existing callers. Flag for engineer; not a new module.

## Explicitly deferred (no build-ahead)

- Play-again loop — Chunk 3 (still one game then exit).
- Side selection (human as O), difficulty levels, beatable mode.
- Alpha-beta as a required optimisation; "thinking"/rationale display.

## Security

The AI Engine introduces **no new input surface**: it is a pure function of
in-process board state, produces a bounded coordinate string, and that string
re-enters through the existing validated Parser path. No new file, socket,
subprocess, eval, or untrusted input is created. See security verdict in
`architecture/security/ai-engine.md`. No new controls beyond confirming the
existing `cli-process.md` controls continue to hold.
