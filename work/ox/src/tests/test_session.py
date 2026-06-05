"""Session-loop tests — Slice 003 AC-01..AC-09.

The session is exercised through ``run_session(players=..., out=..., again=...)``.
``players`` is stubbed to drive each game to a known terminal result, ``out`` is
captured via StringIO, and ``again`` scripts the play-again answers. No
subprocess is used anywhere.
"""
import io

import pytest

from ox.game import run_session, play_game
from ox.board import win, DRAW, new_board
from ox.renderer import render


# --- helpers -------------------------------------------------------------

def both(moves):
    """Single shared move-supplier for both players, drawing from one list."""
    it = iter(moves)

    def supplier(prompt=""):
        return next(it)

    return {"X": supplier, "O": supplier}


def x_win_players():
    """Players that drive a fresh game to an X column-A win each time it is
    constructed. Re-callable: returns a NEW players map per game so iterators
    are not exhausted across games."""
    return both(["A1", "B1", "A2", "B2", "A3"])


def draw_players():
    """Players driving a fresh game to a draw."""
    return both(["A1", "B1", "C1", "A2", "C2", "B2", "A3", "C3", "B3"])


class GameStub:
    """A callable players-factory-like stub usable as the ``players`` argument
    by forcing results through a scripted sequence. Because real ``play_game``
    consumes moves, we instead drive results by handing a fresh move list per
    game via an ``again``-synchronised counter. For result-sequence tests we use
    a monkeypatched ``play_game`` (see below)."""


def answers(seq):
    """Return an ``again`` supplier yielding scripted play-again answers."""
    it = iter(seq)

    def supplier(prompt=""):
        return next(it)

    return supplier


# --- AC-02 / AC-08: "y" replays, "n" exits; play_game invoked per game ----

def test_ac02_y_replays_then_n_exits(monkeypatch):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    score = run_session(players={}, out=out, again=answers(["y", "n"]))
    assert calls["n"] == 2  # first game + one replay
    assert score == {"O": 2, "draws": 0, "X": 0}


def test_ac02_uppercase_Y_accepted(monkeypatch):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    run_session(players={}, out=out, again=answers(["Y", "n"]))
    assert calls["n"] == 2


def test_ac08_multi_game_session_runs_to_completion(monkeypatch):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    score = run_session(players={}, out=out, again=answers(["y", "y", "n"]))
    assert calls["n"] == 3  # first game + two replays
    assert score == {"O": 3, "draws": 0, "X": 0}


# --- AC-01: prompt appears after every result -----------------------------

def test_ac01_prompt_after_result(monkeypatch):
    order = []

    def fake_play_game(players=None, out=None):
        out.write("RESULT-MARKER\n")
        return win("O")

    def again(prompt=""):
        order.append(("prompt", prompt))
        return "n"

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    run_session(players={}, out=out, again=again)
    text = out.getvalue()
    assert "Play again" in text
    # the play-again supplier was actually consulted (session blocked on it)
    assert order and "y" in order[0][1].lower() and "n" in order[0][1].lower()
    # prompt-related text appears after the game's result marker
    assert text.index("RESULT-MARKER") < text.index("Play again")


# --- AC-03: "n" exits cleanly, no further game, no traceback --------------

def test_ac03_n_exits_no_replay(monkeypatch):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    score = run_session(players={}, out=out, again=answers(["n"]))
    assert calls["n"] == 1
    assert score == {"O": 1, "draws": 0, "X": 0}


def test_ac03_uppercase_N_exits(monkeypatch):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    run_session(players={}, out=out, again=answers(["N"]))
    assert calls["n"] == 1


def test_ac03_closing_message_emitted(monkeypatch):
    monkeypatch.setattr("ox.game.play_game", lambda players=None, out=None: win("O"))
    out = io.StringIO()
    run_session(players={}, out=out, again=answers(["n"]))
    # some brief closing message is emitted (non-empty beyond score/prompt)
    assert "Thanks" in out.getvalue() or "Goodbye" in out.getvalue() or "Bye" in out.getvalue()


# --- AC-04: invalid input re-prompts exactly once -------------------------

@pytest.mark.parametrize("bad", ["", "z", "7", "maybe", "x" * 500])
def test_ac04_invalid_then_y_replays(monkeypatch, bad):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    # invalid first, then y -> second game, then n exits
    run_session(players={}, out=out, again=answers([bad, "y", "n"]))
    assert calls["n"] == 2


@pytest.mark.parametrize("bad", ["", "z", "7", "maybe", "x" * 500])
def test_ac04_invalid_then_non_y_exits(monkeypatch, bad):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    run_session(players={}, out=out, again=answers([bad, "no"]))
    assert calls["n"] == 1


def test_ac04_prompt_displayed_exactly_twice_on_one_invalid(monkeypatch):
    prompts = []

    def again(prompt=""):
        prompts.append(prompt)
        return ["", "n"][len(prompts) - 1]

    monkeypatch.setattr("ox.game.play_game", lambda players=None, out=None: win("O"))
    out = io.StringIO()
    run_session(players={}, out=out, again=again)
    # one initial prompt + exactly one re-prompt
    assert len(prompts) == 2


def test_ac04_eof_at_prompt_exits_cleanly(monkeypatch):
    monkeypatch.setattr("ox.game.play_game", lambda players=None, out=None: win("O"))

    def again(prompt=""):
        raise EOFError

    out = io.StringIO()
    score = run_session(players={}, out=out, again=again)  # must not raise
    assert score == {"O": 1, "draws": 0, "X": 0}


def test_ac04_keyboardinterrupt_at_prompt_exits_cleanly(monkeypatch):
    monkeypatch.setattr("ox.game.play_game", lambda players=None, out=None: win("O"))

    def again(prompt=""):
        raise KeyboardInterrupt

    out = io.StringIO()
    score = run_session(players={}, out=out, again=again)  # must not raise
    assert score == {"O": 1, "draws": 0, "X": 0}


# --- AC-05: board resets between games (real play_game, no monkeypatch) ----

def test_ac05_board_resets_between_games():
    # Two real games via stubbed move suppliers; the first render of the second
    # game must equal render(new_board()).
    games = iter([x_win_players(), x_win_players()])

    def players_for_call():
        return next(games)

    out = io.StringIO()
    # Run two real games by scripting again y then n; supply a fresh players map
    # per game through a wrapper that play_game consumes.
    # Because run_session passes one `players` map for the whole session, we
    # instead drive two real games by giving suppliers enough moves for both,
    # resetting via new game construction inside play_game.
    moves = ["A1", "B1", "A2", "B2", "A3",   # game 1: X col A win
             "A1", "B1", "A2", "B2", "A3"]   # game 2: X col A win
    it = iter(moves)

    def supplier(prompt=""):
        return next(it)

    out = io.StringIO()
    run_session(players={"X": supplier, "O": supplier}, out=out,
                again=answers(["y", "n"]))
    text = out.getvalue()
    empty = render(new_board())
    # The empty board appears at least twice (start of each game).
    assert text.count(empty) >= 2


# --- AC-06: score increments correctly, displays after each game ----------

def test_ac06_score_sequence_o_draw_o(monkeypatch):
    results = iter([win("O"), DRAW, win("O")])

    def fake_play_game(players=None, out=None):
        return next(results)

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    score = run_session(players={}, out=out, again=answers(["y", "y", "n"]))
    assert score == {"O": 2, "draws": 1, "X": 0}
    lines = [l for l in out.getvalue().splitlines() if l.startswith("Score")]
    assert lines == [
        "Score — O wins: 1  Draws: 0  X wins: 0",
        "Score — O wins: 1  Draws: 1  X wins: 0",
        "Score — O wins: 2  Draws: 1  X wins: 0",
    ]


def test_ac06_x_win_increments_x_only(monkeypatch):
    monkeypatch.setattr("ox.game.play_game", lambda players=None, out=None: win("X"))
    out = io.StringIO()
    score = run_session(players={}, out=out, again=answers(["n"]))
    assert score == {"O": 0, "draws": 0, "X": 1}
    assert "Score — O wins: 0  Draws: 0  X wins: 1" in out.getvalue()


def test_ac06_counters_per_session(monkeypatch):
    monkeypatch.setattr("ox.game.play_game", lambda players=None, out=None: win("O"))
    out1 = io.StringIO()
    s1 = run_session(players={}, out=out1, again=answers(["n"]))
    out2 = io.StringIO()
    s2 = run_session(players={}, out=out2, again=answers(["n"]))
    assert s1 == {"O": 1, "draws": 0, "X": 0}
    assert s2 == {"O": 1, "draws": 0, "X": 0}  # fresh, no persistence


# --- AC-03 (cont): mid-game abort returns without prompting ---------------

def test_midgame_abort_returns_no_prompt(monkeypatch):
    asked = {"n": 0}

    def fake_play_game(players=None, out=None):
        return None  # aborted mid-game

    def again(prompt=""):
        asked["n"] += 1
        return "n"

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    score = run_session(players={}, out=out, again=again)
    assert asked["n"] == 0  # never prompted after a mid-game abort
    assert score == {"O": 0, "draws": 0, "X": 0}


# --- AC-09: security — play-again input adds no new surface ----------------

def test_ac09_long_answer_handled_without_crash(monkeypatch):
    calls = {"n": 0}

    def fake_play_game(players=None, out=None):
        calls["n"] += 1
        return win("O")

    monkeypatch.setattr("ox.game.play_game", fake_play_game)
    out = io.StringIO()
    # A pathologically long answer starting with 'y' must replay (first char),
    # and one starting with something else exits — handled, no crash.
    run_session(players={}, out=out, again=answers(["y" + "!" * 10000, "n"]))
    assert calls["n"] == 2


def test_ac09_no_eval_exec_subprocess_in_module():
    # Inspect the AST so docstring/comment mentions of these words don't count;
    # we forbid them only as actual runtime calls / imports.
    import ast
    import inspect
    import ox.game as g

    tree = ast.parse(inspect.getsource(g))
    forbidden_calls = {"eval", "exec", "compile"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id not in forbidden_calls
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            # e.g. os.system(...) or subprocess.run(...)
            owner = getattr(node.func.value, "id", "")
            assert not (owner == "os" and node.func.attr == "system")
            assert owner != "subprocess"
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names]
            if isinstance(node, ast.ImportFrom):
                names.append(node.module or "")
            assert all(n.split(".")[0] != "subprocess" for n in names)
