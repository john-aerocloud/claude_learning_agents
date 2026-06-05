"""Board / Rules — pure 3x3 noughts-and-crosses state and rules.

No I/O. A board is a plain dict mapping cell -> mark | None.
Cells are named by column letter (A,B,C) + row number (1,2,3): "A1".."C3".

Result values:
  IN_PROGRESS  — game not yet decided
  DRAW         — board full, no winning line
  win(mark)    — the given mark holds a complete line
"""
from typing import Dict, List, Optional, Tuple

Board = Dict[str, Optional[str]]

COLUMNS = ("A", "B", "C")
ROWS = ("1", "2", "3")
CELLS: List[str] = [c + r for c in COLUMNS for r in ROWS]

IN_PROGRESS = ("in_progress",)
DRAW = ("draw",)

# All 8 winning lines.
WIN_LINES: Tuple[Tuple[str, str, str], ...] = (
    ("A1", "A2", "A3"),
    ("B1", "B2", "B3"),
    ("C1", "C2", "C3"),
    ("A1", "B1", "C1"),
    ("A2", "B2", "C2"),
    ("A3", "B3", "C3"),
    ("A1", "B2", "C3"),
    ("A3", "B2", "C1"),
)


def win(mark: str) -> Tuple[str, str]:
    """Result value denoting a win by ``mark``."""
    return ("win", mark)


def new_board() -> Board:
    """A fresh empty board."""
    return {cell: None for cell in CELLS}


def legal_moves(board: Board) -> List[str]:
    """Cells that are still empty, in stable order."""
    return [cell for cell in CELLS if board[cell] is None]


def apply(board: Board, cell: str, mark: str) -> Board:
    """Return a NEW board with ``mark`` placed at ``cell``. Pure — input
    board is not mutated."""
    if cell not in CELLS:
        raise ValueError(f"unknown cell: {cell!r}")
    if board[cell] is not None:
        raise ValueError(f"cell already occupied: {cell!r}")
    updated = dict(board)
    updated[cell] = mark
    return updated


def result(board: Board):
    """Return IN_PROGRESS, DRAW, or win(mark)."""
    for a, b, c in WIN_LINES:
        mark = board[a]
        if mark is not None and board[b] == mark and board[c] == mark:
            return win(mark)
    if all(board[cell] is not None for cell in CELLS):
        return DRAW
    return IN_PROGRESS
