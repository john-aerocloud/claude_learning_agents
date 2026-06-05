"""Renderer — pure function: board state -> aligned ASCII grid string.

Layout (fixed width, well under 80 columns, columns A/B/C across the top,
row numbers 1/2/3 down the left):

       A   B   C
    1  X | O | .
      -----------
    2  . | X | .
      -----------
    3  O | . | X

Empty cells render as ".". Width is identical for every state because each
cell occupies exactly one character.
"""
from typing import List

from .board import Board, COLUMNS, ROWS

_EMPTY = "."


def _cell(board: Board, col: str, row: str) -> str:
    mark = board[col + row]
    return mark if mark is not None else _EMPTY


def render(board: Board) -> str:
    lines: List[str] = []
    # Header: three left-pad spaces for the row-number gutter, then columns.
    header = "    " + "   ".join(COLUMNS)
    lines.append(header)
    separator = "      " + "-" * 11
    for i, row in enumerate(ROWS):
        cells = " | ".join(_cell(board, col, row) for col in COLUMNS)
        lines.append(f" {row}    {cells}")
        if i < len(ROWS) - 1:
            lines.append(separator)
    return "\n".join(lines)
