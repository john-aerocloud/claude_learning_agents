"""Board / Rules tests — AC-01, AC-02, AC-03."""
import itertools

from ox.board import (
    Board,
    new_board,
    apply,
    legal_moves,
    result,
    IN_PROGRESS,
    DRAW,
    win,
)

CELLS = [c + r for c in "ABC" for r in "123"]


# --- AC-01: centre move accepted and recorded ---

def test_ac01_centre_move_recorded():
    b = new_board()
    b2 = apply(b, "B2", "X")
    assert b2["B2"] == "X"
    assert "B2" not in legal_moves(b2)


def test_ac01_apply_is_pure_does_not_mutate_input():
    b = new_board()
    apply(b, "B2", "X")
    # original board untouched
    assert b["B2"] is None
    assert "B2" in legal_moves(b)


def test_legal_moves_full_on_empty_board():
    b = new_board()
    assert set(legal_moves(b)) == set(CELLS)


# --- AC-02: win detection across all 8 lines ---

WIN_LINES = [
    ["A1", "A2", "A3"],   # column A (col-letter rows 1..3)
    ["B1", "B2", "B3"],   # column B
    ["C1", "C2", "C3"],   # column C
    ["A1", "B1", "C1"],   # row 1
    ["A2", "B2", "C2"],   # row 2
    ["A3", "B3", "C3"],   # row 3
    ["A1", "B2", "C3"],   # diagonal
    ["A3", "B2", "C1"],   # anti-diagonal
]


def test_ac02_there_are_exactly_8_win_lines():
    assert len(WIN_LINES) == 8


def test_ac02_each_line_detected_as_win():
    for line in WIN_LINES:
        b = new_board()
        for cell in line:
            b = apply(b, cell, "X")
        assert result(b) == win("X"), f"line {line} not detected"


def test_ac02_win_with_opponent_marks_present():
    # Line filled by O while X occupies other cells -> O wins.
    b = new_board()
    b = apply(b, "A1", "O")
    b = apply(b, "B2", "X")  # opponent elsewhere
    b = apply(b, "A2", "O")
    b = apply(b, "C3", "X")  # opponent elsewhere
    b = apply(b, "A3", "O")
    assert result(b) == win("O")


def test_ac02_in_progress_when_no_line_and_cells_free():
    b = new_board()
    b = apply(b, "A1", "X")
    b = apply(b, "B2", "O")
    assert result(b) == IN_PROGRESS


# --- AC-03: draw detection ---

def test_ac03_full_board_no_line_is_draw():
    # A known drawn layout:
    #   A1 X  B1 O  C1 X
    #   A2 X  B2 O  C2 O
    #   A3 O  B3 X  C3 X
    moves = {
        "A1": "X", "B1": "O", "C1": "X",
        "A2": "X", "B2": "O", "C2": "O",
        "A3": "O", "B3": "X", "C3": "X",
    }
    b = new_board()
    for cell, mark in moves.items():
        b = apply(b, cell, mark)
    assert legal_moves(b) == []
    assert result(b) == DRAW
