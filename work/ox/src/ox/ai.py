"""AI Engine — a pure, optimal move-supplier for noughts-and-crosses.

`ai_move(state) -> str` returns the optimal move (a coordinate string in the
`A1..C3` grammar the Parser already validates) for whichever side is to play in
`state`. The side to play is derived from the state: X starts, so X is to move
when both marks have equal counts, otherwise O.

Pure function: no terminal, no filesystem, no network, no globals, no mutation
of the input board. Recursion uses Board.apply, which returns a new board. The
game tree is at most 9 plies, so a full negamax walk runs well within budget.
"""
from typing import Tuple

from .board import (
    CELLS,
    legal_moves,
    apply,
    result,
    win,
    DRAW,
    IN_PROGRESS,
)

_OTHER = {"X": "O", "O": "X"}


def _side_to_play(board) -> str:
    """X starts; X moves when counts are equal, otherwise O."""
    x = sum(1 for c in CELLS if board[c] == "X")
    o = sum(1 for c in CELLS if board[c] == "O")
    return "X" if x == o else "O"


def _negamax(board, mark: str) -> Tuple[int, int]:
    """Score the position for `mark` (the side to move).

    Returns (score, depth): +1 win / -1 loss / 0 draw, from `mark`'s view.
    `depth` is the number of plies until the terminal state, used only to prefer
    faster wins and slower losses — a strict refinement of correctness.
    """
    res = result(board)
    if res == win(mark):
        return (1, 0)
    if res == win(_OTHER[mark]):
        return (-1, 0)
    if res == DRAW:
        return (0, 0)

    # IN_PROGRESS: recurse over legal moves, negating the child's perspective.
    best = None  # (score, depth)
    other = _OTHER[mark]
    for cell in legal_moves(board):
        child_score, child_depth = _negamax(apply(board, cell, mark), other)
        score = -child_score
        depth = child_depth + 1
        if best is None or _better(score, depth, best):
            best = (score, depth)
    return best


def _better(score: int, depth: int, best: Tuple[int, int]) -> bool:
    """Prefer higher score; among equal scores prefer faster wins / slower
    losses (smaller depth when winning, larger depth otherwise)."""
    best_score, best_depth = best
    if score != best_score:
        return score > best_score
    if score > 0:
        return depth < best_depth   # win sooner
    if score < 0:
        return depth > best_depth   # lose later
    return False                    # draws: keep first (stable tie-break)


def ai_move(board) -> str:
    """Return the optimal move (coordinate string) for the side to play.

    Pure: same state -> same move (cells are tried in their fixed CELLS order,
    so ties break deterministically). Does not mutate `board`.
    """
    mark = _side_to_play(board)
    other = _OTHER[mark]

    best_move = None
    best = None  # (score, depth)
    for cell in legal_moves(board):
        child_score, child_depth = _negamax(apply(board, cell, mark), other)
        score = -child_score
        depth = child_depth + 1
        if best is None or _better(score, depth, best):
            best = (score, depth)
            best_move = cell
    return best_move
