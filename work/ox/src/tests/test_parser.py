"""Input Parser tests — AC-04, AC-05, AC-06."""
from ox.parser import parse, Move, Rejection

# Rejection reasons
MALFORMED = "malformed"
OUT_OF_RANGE = "out_of_range"
OCCUPIED = "occupied"


# --- AC-04: valid coordinates accepted ---

def test_ac04_valid_inputs_parsed():
    expected = {
        "A1": ("A", "1"),
        "a1": ("A", "1"),
        " B3 ": ("B", "3"),
        "C2": ("C", "2"),
    }
    for raw, (col, row) in expected.items():
        m = parse(raw, occupied=set())
        assert isinstance(m, Move), f"{raw!r} should parse"
        assert m.cell == col + row
        assert (m.col, m.row) == (col, row)


# --- AC-05: malformed input rejected with typed reason ---

def test_ac05_malformed_rejected_no_exception():
    for raw in ["Z9", "b", "", "12", "AA"]:
        r = parse(raw, occupied=set())
        assert isinstance(r, Rejection), f"{raw!r} should be rejected"
        assert r.reason in (MALFORMED, OUT_OF_RANGE)


def test_ac05_pathologically_long_input_rejected():
    r = parse("A1" * 10000, occupied=set())
    assert isinstance(r, Rejection)
    assert r.reason == MALFORMED


# --- AC-06: occupied cell rejected ---

def test_ac06_occupied_cell_rejected():
    r = parse("A1", occupied={"A1"})
    assert isinstance(r, Rejection)
    assert r.reason == OCCUPIED


def test_ac06_unoccupied_valid_cell_accepted():
    m = parse("A1", occupied={"B2"})
    assert isinstance(m, Move)
    assert m.cell == "A1"


def test_parse_is_pure_no_mutation_of_occupied():
    occ = {"B2"}
    parse("A1", occupied=occ)
    assert occ == {"B2"}
