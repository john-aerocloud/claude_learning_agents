"""Security policy tests — each checkbox in architecture/security/cli-process.md
becomes one assertion that the control holds."""
import io
import os
import re
import pathlib

import ox
from ox.parser import parse, Move, Rejection
from ox.game import play_game
from ox.board import win

SRC_ROOT = pathlib.Path(ox.__file__).resolve().parent
GRAMMAR = re.compile(r"^[A-Ca-c][1-3]$")


def _runtime_sources():
    return list(SRC_ROOT.glob("*.py"))


def _runtime_text():
    return "\n".join(p.read_text() for p in _runtime_sources())


# === Input handling (untrusted stdin) ===

def test_stdin_input_validated_before_use():
    # Garbage input is rejected (turn not lost), only valid moves take effect.
    moves = ["DROP TABLE", "A1", "B1", "A2", "B2", "A3"]
    it = iter(moves)
    supplier = lambda prompt="": next(it)
    out = io.StringIO()
    res = play_game(players={"X": supplier, "O": supplier}, out=out)
    assert res == win("X")


def test_accepted_input_matches_coordinate_grammar():
    for raw in ["A1", "a1", " B3 ", "C2"]:
        m = parse(raw, occupied=set())
        assert isinstance(m, Move)
        assert GRAMMAR.match(m.cell)
    for raw in ["Z9", "b", "", "12", "AA", "A4", "D1"]:
        assert isinstance(parse(raw, occupied=set()), Rejection)


def test_input_length_is_bounded():
    # A pathologically long line is rejected, not buffered/parsed as valid.
    r = parse("A" * 1_000_000, occupied=set())
    assert isinstance(r, Rejection)


def test_rejected_input_does_not_forfeit_turn_or_crash():
    moves = ["???", "A1", "A1", "B1", "A2", "B2", "A3"]
    it = iter(moves)
    supplier = lambda prompt="": next(it)
    out = io.StringIO()
    res = play_game(players={"X": supplier, "O": supplier}, out=out)
    assert res == win("X")  # X still completes column A despite bad/occupied tries


# === No code/command execution from input ===

def test_no_dynamic_execution_primitives_in_runtime():
    text = _runtime_text()
    for forbidden in ["eval(", "exec(", "pickle", "__import__", "importlib"]:
        assert forbidden not in text, f"forbidden primitive {forbidden!r} present"
    # The builtin compile() is forbidden, but re.compile() on a literal pattern
    # is the only compile in the runtime path.
    bare_compile = re.findall(r"(?<!\.)\bcompile\(", text)
    assert bare_compile == [], "builtin compile() present in runtime"


def test_no_subprocess_or_shell_in_runtime():
    text = _runtime_text()
    for forbidden in ["subprocess", "os.system", "os.popen", "pty.spawn"]:
        assert forbidden not in text, f"shell/subprocess primitive {forbidden!r} present"


def test_input_not_used_to_build_format_string_regex_or_attr():
    # Parser returns structured data; it never getattr/setattr on raw input,
    # and the only regex is the fixed grammar (not built from input).
    text = (SRC_ROOT / "parser.py").read_text()
    assert "getattr(" not in text
    assert "setattr(" not in text
    # re.compile must use a literal pattern, never an f-string / variable input.
    for m in re.finditer(r"re\.compile\(([^)]*)\)", text):
        arg = m.group(1)
        assert "f'" not in arg and 'f"' not in arg


# === No filesystem / IO side effects ===

def test_no_file_writes_during_play(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    before = set(os.listdir(tmp_path))
    moves = ["A1", "B1", "A2", "B2", "A3"]
    it = iter(moves)
    supplier = lambda prompt="": next(it)
    play_game(players={"X": supplier, "O": supplier}, out=io.StringIO())
    after = set(os.listdir(tmp_path))
    assert before == after, "play_game created/removed files"


def test_no_open_for_write_in_runtime():
    text = _runtime_text()
    # No write-mode open() anywhere in the runtime path.
    assert "'w'" not in text and '"w"' not in text
    assert "'a'" not in text and '"a"' not in text
    assert "open(" not in text


# === No network exposure ===

def test_no_sockets_or_network_in_runtime():
    text = _runtime_text()
    for forbidden in ["socket", "urllib", "http.client", "requests", "asyncio"]:
        assert forbidden not in text, f"network primitive {forbidden!r} present"


# === Dependencies & supply chain ===

def test_runtime_imports_stdlib_only():
    text = _runtime_text()
    imports = re.findall(r"^\s*(?:from|import)\s+([\w.]+)", text, re.MULTILINE)
    third_party = {"pytest", "numpy", "requests", "django", "flask"}
    for imp in imports:
        top = imp.split(".")[0]
        assert top not in third_party, f"third-party import {top!r} in runtime"


def test_pytest_not_imported_by_runtime():
    text = _runtime_text()
    assert "import pytest" not in text and "pytest" not in text


# === Failure behaviour ===

def test_eof_ends_cleanly_without_traceback():
    # Supplier raising EOFError (Ctrl-D) must end the game cleanly.
    def eof_supplier(prompt=""):
        raise EOFError

    out = io.StringIO()
    res = play_game(players={"X": eof_supplier, "O": eof_supplier}, out=out)
    assert res is None  # aborted, no result, no traceback


def test_keyboard_interrupt_ends_cleanly():
    def interrupt_supplier(prompt=""):
        raise KeyboardInterrupt

    out = io.StringIO()
    res = play_game(players={"X": interrupt_supplier, "O": interrupt_supplier}, out=out)
    assert res is None


# === AC-09: AI supplier adds no untrusted input surface ===

def test_ac09_ai_module_has_no_dynamic_execution_or_io():
    # ai.py is part of the runtime path: it must import no I/O, network,
    # subprocess, or dynamic-execution facility.
    text = (SRC_ROOT / "ai.py").read_text()
    for forbidden in [
        "subprocess", "socket", "os.system", "os.popen",
        "eval(", "exec(", "pickle", "__import__", "importlib",
        "urllib", "http.client", "requests", "open(",
    ]:
        assert forbidden not in text, f"forbidden primitive {forbidden!r} in ai.py"
    # No bare builtin compile().
    bare_compile = re.findall(r"(?<!\.)\bcompile\(", text)
    assert bare_compile == [], "builtin compile() present in ai.py"


def test_ac09_ai_consumes_only_in_process_state_no_stdin(monkeypatch):
    # The AI never reads stdin/file/socket: calling it with input() sabotaged
    # must still succeed.
    from ox.ai import ai_move
    from ox.board import new_board

    def boom(*a, **k):
        raise AssertionError("ai_move touched stdin")

    monkeypatch.setattr("builtins.input", boom)
    move = ai_move(new_board())
    assert GRAMMAR.match(move)  # bounded coordinate token


def test_ac09_ai_output_is_bounded_legal_cell():
    # The AI's output domain is the finite set of legal cells — it cannot emit
    # an unbounded or attacker-controlled string. Sample reachable states.
    from ox.ai import ai_move
    from ox.board import new_board, apply, legal_moves, result, IN_PROGRESS

    def sample(board, depth):
        if result(board) != IN_PROGRESS or depth == 0:
            return
        x = sum(1 for c in board if board[c] == "X")
        o = sum(1 for c in board if board[c] == "O")
        mark = "X" if x == o else "O"
        move = ai_move(board)
        assert move in legal_moves(board)
        assert len(move) == 2
        for m in legal_moves(board):
            sample(apply(board, m, mark), depth - 1)

    sample(new_board(), 3)


def test_ac09_ai_does_not_mutate_state():
    from ox.ai import ai_move
    from ox.board import new_board, apply

    board = apply(apply(new_board(), "A1", "X"), "B2", "O")
    before = dict(board)
    ai_move(board)
    assert board == before
