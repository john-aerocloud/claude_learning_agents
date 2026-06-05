"""Renderer tests — AC-07, AC-08."""
from ox.board import new_board, apply
from ox.renderer import render


def _states():
    empty = new_board()
    mid = apply(apply(empty, "B2", "X"), "A1", "O")
    full = empty
    layout = {
        "A1": "X", "B1": "O", "C1": "X",
        "A2": "X", "B2": "O", "C2": "O",
        "A3": "O", "B3": "X", "C3": "X",
    }
    for cell, mark in layout.items():
        full = apply(full, cell, mark)
    return {"empty": empty, "mid": mid, "full": full}


# --- AC-07: board fits 80 columns ---

def test_ac07_every_line_within_80_columns():
    for name, state in _states().items():
        out = render(state)
        for line in out.splitlines():
            assert len(line) <= 80, f"{name}: line too wide: {line!r}"


# --- AC-08: alignment consistent across states ---

def test_ac08_line_widths_stable_across_states():
    renders = [render(s) for s in _states().values()]
    width_signatures = [
        tuple(len(l) for l in r.splitlines()) for r in renders
    ]
    first = width_signatures[0]
    for sig in width_signatures[1:]:
        assert sig == first, "line-width signature shifted between states"


def test_ac08_shows_column_letters_and_row_numbers():
    out = render(new_board())
    assert "A" in out and "B" in out and "C" in out
    assert "1" in out and "2" in out and "3" in out


def test_ac08_marks_appear_in_render():
    state = apply(new_board(), "B2", "X")
    assert "X" in render(state)
