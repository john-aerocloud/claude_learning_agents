"""Game loop tests — AC-09, AC-10, AC-11, AC-12, AC-13."""
import io

from ox.game import play_game
from ox.board import win, DRAW


def scripted(moves):
    """Return a move-supplier callable yielding the given moves in order."""
    it = iter(moves)

    def supplier(prompt=""):
        return next(it)

    return supplier


def both(moves):
    """Single shared supplier for both players, drawing from one move list."""
    it = iter(moves)

    def supplier(prompt=""):
        return next(it)

    return {"X": supplier, "O": supplier}


# --- AC-10: X moves first ---

def test_ac10_first_prompt_identifies_x():
    prompts = []

    def supplier(prompt=""):
        prompts.append(prompt)
        # X column A win
        return ["A1", "B1", "A2", "B2", "A3"][len(prompts) - 1]

    out = io.StringIO()
    play_game(players={"X": supplier, "O": supplier}, out=out)
    assert "X" in prompts[0]


# --- AC-09: turn not lost on invalid input ---

def test_ac09_invalid_input_reprompts_same_player():
    # X gives garbage then A1; flow proceeds with X having A1.
    moves = ["zz", "A1", "B1", "A2", "B2", "A3"]
    out = io.StringIO()
    res = play_game(players=both(moves), out=out)
    assert res == win("X")  # X column A
    # the invalid input produced a rejection message
    assert "X" in out.getvalue()


def test_ac09_occupied_cell_reprompts_same_player():
    # X:A1, O tries A1 (occupied) then B1, ... X wins column A.
    moves = ["A1", "A1", "B1", "A2", "B2", "A3"]
    out = io.StringIO()
    res = play_game(players=both(moves), out=out)
    assert res == win("X")


# --- AC-11: result announced; play_game returns the result value ---

def test_ac11_win_announced_and_returned():
    moves = ["A1", "B1", "A2", "B2", "A3"]  # X column A
    out = io.StringIO()
    res = play_game(players=both(moves), out=out)
    assert res == win("X")
    text = out.getvalue()
    assert "X" in text and ("win" in text.lower() or "wins" in text.lower())


def test_ac11_draw_announced_and_returned():
    # Drawn sequence (X first), board:
    #   X | O | X
    #   O | O | X
    #   X | X | O
    # X: A1 C1 C2 A3 B3   O: B1 A2 B2 C3
    moves = ["A1", "B1", "C1", "A2", "C2", "B2", "A3", "C3", "B3"]
    out = io.StringIO()
    res = play_game(players=both(moves), out=out)
    assert res == DRAW
    assert "draw" in out.getvalue().lower()


# --- AC-12: importable / callable without subprocess, repeatable ---

def test_ac12_callable_repeatedly_same_process():
    for _ in range(3):
        moves = ["A1", "B1", "A2", "B2", "A3"]
        out = io.StringIO()
        res = play_game(players=both(moves), out=out)
        assert res == win("X")


# --- AC-13: player supplier is a parameter; swap O without touching core ---

def test_ac13_stub_supplier_for_o():
    # O always plays from a fixed list; X from its own. Core modules untouched.
    x_moves = iter(["A1", "A2", "A3"])
    o_moves = iter(["B1", "B2"])
    players = {
        "X": lambda prompt="": next(x_moves),
        "O": lambda prompt="": next(o_moves),
    }
    out = io.StringIO()
    res = play_game(players=players, out=out)
    assert res == win("X")  # X column A


# --- Slice 002 seam: a state-aware supplier receives the board, not a prompt ---

def test_state_supplier_receives_board_state():
    # A supplier declaring a `state` parameter is handed the live board state
    # (whose-turn derivable from it), not the prompt string. This is the seam
    # the AI move-supplier uses.
    seen = []

    def x_supplier(prompt=""):
        return ["A1", "A2", "A3"][len([s for s in seen]) ]  # not used for branch

    x_iter = iter(["A1", "A2", "A3"])

    def x_sup(prompt=""):
        return next(x_iter)

    def o_state_supplier(state):
        seen.append(dict(state))
        # Play first empty cell deterministically.
        for cell in ["B1", "B2", "B3"]:
            if state[cell] is None:
                return cell

    players = {"X": x_sup, "O": o_state_supplier}
    out = io.StringIO()
    res = play_game(players=players, out=out)
    assert res == win("X")
    # The O supplier was handed a dict board state, not a prompt string.
    assert seen and isinstance(seen[0], dict)
    assert "A1" in seen[0]


def test_ac03_no_o_prompt_emitted_with_state_supplier():
    # When O is supplied by a state-aware supplier, no "Player O" prompt string
    # is ever emitted to the output stream.
    x_iter = iter(["A1", "A2", "A3"])

    def x_sup(prompt=""):
        return next(x_iter)

    def o_sup(state):
        for cell in ["B1", "B2", "B3"]:
            if state[cell] is None:
                return cell

    out = io.StringIO()
    play_game(players={"X": x_sup, "O": o_sup}, out=out)
    # No move-request prompt addressed to O is emitted.
    assert "Player O, enter your move" not in out.getvalue()
