"""Game Loop — the ONLY module that performs I/O.

play_game(players=None, out=None) drives one game and returns the final result
value (win(mark) or DRAW), or None if aborted (EOF / Ctrl-C).

The ``players`` argument maps a mark ("X"/"O") to a callable that, given an
optional prompt string, returns the player's raw move string. The default
supplier reads stdin. This seam lets Chunk 2 substitute an AI supplier for one
side without touching Board, Parser, or Renderer.
"""
import inspect
import sys
from typing import Callable, Dict, Optional

from . import board as board_mod
from .board import new_board, apply, legal_moves, result, IN_PROGRESS, DRAW
from .parser import parse, Move, Rejection
from .renderer import render
from .ai import ai_move

MoveSupplier = Callable[..., str]
MARKS = ("X", "O")


def _stdin_supplier(prompt: str = "") -> str:
    """Default move supplier: read one line from stdin."""
    return input(prompt)


def default_players() -> Dict[str, MoveSupplier]:
    """Shipped default: human X (stdin) vs perfect AI O (slice 002)."""
    return {"X": _stdin_supplier, "O": ai_move}


def _wants_state(supplier) -> bool:
    """True if the supplier declares a parameter named ``state`` or ``board``.

    Such a supplier (e.g. the AI move-supplier ``ai_move(state)``) is handed the
    live board state and is NOT prompted; a plain supplier keeps receiving the
    prompt string (stdin behaviour, unchanged from slice 001).
    """
    try:
        params = inspect.signature(supplier).parameters
    except (TypeError, ValueError):
        return False
    return "state" in params or "board" in params


def _emit(out, text: str) -> None:
    print(text, file=out)


def _announce(out, res) -> None:
    if res == DRAW:
        _emit(out, "It's a draw.")
    elif isinstance(res, tuple) and res and res[0] == "win":
        _emit(out, f"Player {res[1]} wins!")


def play_game(
    players: Optional[Dict[str, MoveSupplier]] = None,
    out=None,
):
    if players is None:
        players = default_players()
    if out is None:
        out = sys.stdout

    state = new_board()
    turn_index = 0  # X starts (MARKS[0])

    _emit(out, render(state))

    res = result(state)
    while res == IN_PROGRESS:
        mark = MARKS[turn_index % 2]
        supplier = players[mark]

        try:
            if _wants_state(supplier):
                # State-aware supplier (e.g. AI): hand it the board, no prompt.
                raw = supplier(state)
            else:
                prompt = f"Player {mark}, enter your move (e.g. B2): "
                raw = supplier(prompt)
        except (EOFError, KeyboardInterrupt):
            _emit(out, "\nGame aborted.")
            return None

        occupied = {cell for cell in board_mod.CELLS if state[cell] is not None}
        parsed = parse(raw, occupied=occupied)
        if isinstance(parsed, Rejection):
            # Turn NOT lost: same player re-prompted next loop iteration.
            _emit(out, f"Player {mark}: {parsed.message}")
            continue

        state = apply(state, parsed.cell, mark)
        _emit(out, render(state))
        res = result(state)
        turn_index += 1

    _announce(out, res)
    return res


def _stdin_again(prompt: str = "") -> str:
    """Default play-again supplier: read one line from stdin."""
    return input(prompt)


_AGAIN_PROMPT = "Play again? [y/n]: "


def _ask_play_again(out, again) -> bool:
    """Ask the play-again question, re-prompting EXACTLY once on invalid input.

    Returns True to replay (answer's first char is "y"/"Y"), False otherwise.
    EOF / KeyboardInterrupt is treated as a clean "no" (handled by the caller).

    Security posture (mirrors move input): the answer is stripped and only its
    first character is inspected (length-bounded use). The line is never passed
    to any dynamic-execution or shell primitive, nor used as a path / attribute
    name / format string.
    """
    for attempt in range(2):  # initial prompt + at most one re-prompt
        _emit(out, _AGAIN_PROMPT)
        raw = again(_AGAIN_PROMPT)
        answer = raw.strip()
        first = answer[:1]  # length-bounded: first char only
        if first in ("y", "Y"):
            return True
        if first in ("n", "N"):
            return False
        # Invalid / ambiguous input: re-prompt once, then treat as "no".
        if attempt == 0:
            _emit(out, "Please answer y or n.")
    return False


def run_session(players=None, out=None, again=None) -> dict:
    """Run games until the player declines; return the final score dict.

    Wraps ``play_game()`` in a loop. After each completed game the matching
    score counter is incremented, a score line is emitted, and the play-again
    supplier ``again`` (defaults to stdin) is consulted. "y"/"Y" replays;
    anything else ends the session. A mid-game abort (``play_game`` returns
    None) ends the session without prompting. EOF / Ctrl-C at the play-again
    prompt ends the session cleanly with no traceback.

    Score counters are per-session (created here, no persistence).
    """
    if out is None:
        out = sys.stdout
    if again is None:
        again = _stdin_again

    score = {"O": 0, "draws": 0, "X": 0}

    while True:
        res = play_game(players=players, out=out)
        if res is None:
            # Mid-game EOF/Ctrl-C: clean abort, no score line, no prompt.
            return score

        if res == DRAW:
            score["draws"] += 1
        elif isinstance(res, tuple) and res and res[0] == "win":
            score[res[1]] += 1

        _emit(
            out,
            f"Score — O wins: {score['O']}  "
            f"Draws: {score['draws']}  X wins: {score['X']}",
        )

        try:
            replay = _ask_play_again(out, again)
        except (EOFError, KeyboardInterrupt):
            _emit(out, "")
            return score

        if not replay:
            _emit(out, "Thanks for playing!")
            return score


def main() -> int:
    run_session()
    return 0
