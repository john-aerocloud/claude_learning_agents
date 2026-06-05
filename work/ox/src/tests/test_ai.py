"""AI Engine tests — Slice 002 (perfect opponent).

The AI is exercised as a pure import: ai_move(state) -> coordinate string.
Covers AC-01..AC-08 (AC-09 security additions live in test_security.py).
"""
import io
import re
import time

import pytest

from ox.ai import ai_move
from ox.board import (
    new_board,
    apply,
    legal_moves,
    result,
    win,
    DRAW,
    IN_PROGRESS,
    CELLS,
)
from ox.game import play_game

GRAMMAR = re.compile(r"^[A-C][1-3]$")


# --- helpers ----------------------------------------------------------------

def board_from(xs, os):
    """Build a board with X marks at cells `xs`, O marks at cells `os`."""
    b = new_board()
    for c in xs:
        b = apply(b, c, "X")
    for c in os:
        b = apply(b, c, "O")
    return b


def side_to_play(board):
    """X starts; X plays when counts are equal, else O."""
    x = sum(1 for c in CELLS if board[c] == "X")
    o = sum(1 for c in CELLS if board[c] == "O")
    return "X" if x == o else "O"


# --- AC-07: importable / callable, returns valid grammar --------------------

def test_ac07_returns_coordinate_in_grammar():
    move = ai_move(new_board())
    assert GRAMMAR.match(move)
    # And it is a legal (empty) cell.
    assert move in legal_moves(new_board())


def test_ac04_one_player_default_only_x_prompts_never_x_win():
    # The shipped default (human X vs AI O): drive X via stdin-style supplier,
    # only X prompts ever appear and X never wins.
    from ox.game import play_game
    from ox.ai import ai_move

    x_prompts = []

    def x_human(prompt=""):
        # Human-style supplier: it RECEIVES the prompt (the real stdin supplier
        # would echo it via input()). Play a fixed safe sequence.
        x_prompts.append(prompt)
        return next(x_human.it)

    x_human.it = iter(["B2", "A1", "C3", "A3", "C1"])

    out = io.StringIO()
    res = play_game(players={"X": x_human, "O": ai_move}, out=out)
    text = out.getvalue()
    # X (human) was prompted; O (AI) was never prompted.
    assert all("Player X" in p for p in x_prompts)
    assert "Player O, enter your move" not in text
    assert res in (DRAW, win("O"))


def test_ac04_default_players_wires_ai_for_o():
    # game.default_players() / the __main__ default puts ai_move on O so a bare
    # `python -m ox` is one-player.
    from ox import game
    from ox.ai import ai_move

    players = game.default_players()
    assert players["O"] is ai_move


def test_ac07_playable_via_players_map_no_subprocess():
    # X is a state-aware stub that always plays the first legal cell, so the
    # game terminates regardless of how O (the AI) responds.
    def x_first_legal(state):
        return legal_moves(state)[0]

    players = {"X": x_first_legal, "O": ai_move}
    res = play_game(players=players, out=io.StringIO())
    # A complete game ran programmatically and returned a result value.
    # Against the perfect AI, X never wins.
    assert res in (DRAW, win("O"))


# --- AC-02: optimal on tactical positions -----------------------------------

def test_ac02_takes_immediate_win():
    # O has A1, A2 -> A3 completes column A. O to move (X has one more mark).
    #   X: B1, B2, C1 ; O: A1, A2
    board = board_from(xs=["B1", "B2", "C1"], os=["A1", "A2"])
    assert side_to_play(board) == "O"
    assert ai_move(board) == "A3"


def test_ac02_blocks_opponent_threat():
    # X threatens column A (A1, A2). O has no win. O must block at A3.
    #   X: A1, A2 ; O: C1  (X=2, O=1 -> O to move)
    board = board_from(xs=["A1", "A2"], os=["C1"])
    assert side_to_play(board) == "O"
    assert ai_move(board) == "A3"


def test_ac02_prefers_own_win_over_block():
    # O can win at A3 (A1,A2) AND X threatens C-row (C1,C2). Win beats block.
    #   X: C1, C2, B1 ; O: A1, A2  (X=3, O=2 -> O to move)
    board = board_from(xs=["C1", "C2", "B1"], os=["A1", "A2"])
    assert side_to_play(board) == "O"
    assert ai_move(board) == "A3"


# --- AC-08: deterministic, pure, no mutation --------------------------------

def test_ac08_deterministic_same_state_same_move():
    b = new_board()
    first = ai_move(b)
    for _ in range(5):
        assert ai_move(b) == first


def test_ac08_does_not_mutate_input_state():
    board = board_from(xs=["A1", "A2"], os=["C1"])
    before = dict(board)
    ai_move(board)
    assert board == before


def test_ac08_no_stdout_or_stdin(capsys, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("ai_move read stdin")

    monkeypatch.setattr("builtins.input", boom)
    ai_move(new_board())
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == ""


# --- AC-06: performance ------------------------------------------------------

def test_ac06_empty_board_under_one_second():
    start = time.perf_counter()
    ai_move(new_board())
    elapsed = time.perf_counter() - start
    assert elapsed < 1.0, f"ai_move took {elapsed:.3f}s on empty board"


# --- AC-01: exhaustive game-tree walk — AI (O) never loses ------------------

def _walk_ai_never_loses(board):
    """X explores every legal move; O always plays ai_move. Assert no X win."""
    res = result(board)
    if res != IN_PROGRESS:
        assert res != win("X"), "AI (O) lost a reachable game"
        return
    turn = side_to_play(board)
    if turn == "O":
        move = ai_move(board)
        _walk_ai_never_loses(apply(board, move, "O"))
    else:
        for move in legal_moves(board):
            _walk_ai_never_loses(apply(board, move, "X"))


def test_ac01_ai_never_loses_full_tree():
    _walk_ai_never_loses(new_board())


def test_ac01_ai_vs_ai_is_always_draw():
    board = new_board()
    while result(board) == IN_PROGRESS:
        mark = side_to_play(board)
        board = apply(board, ai_move(board), mark)
    assert result(board) == DRAW
