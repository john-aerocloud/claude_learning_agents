"""Input Parser — pure validation of untrusted coordinate strings.

Grammar (after stripping surrounding whitespace): ^[A-Ca-c][1-3]$
Returns either a Move (valid, unoccupied) or a typed Rejection.

Security: input is length-bounded before any work, never eval'd/exec'd, never
used to build a regex/format string/attribute. The grammar regex is a fixed
literal compiled once at import.
"""
import re
from dataclasses import dataclass
from typing import Set

# Longest legitimate input is "A1" possibly wrapped in a little whitespace.
# Bound generously but firmly so a single huge line is rejected up front.
MAX_INPUT_LEN = 16

_GRAMMAR = re.compile(r"^[A-Ca-c][1-3]$")

MALFORMED = "malformed"
OUT_OF_RANGE = "out_of_range"
OCCUPIED = "occupied"


@dataclass(frozen=True)
class Move:
    col: str   # "A".."C"
    row: str   # "1".."3"

    @property
    def cell(self) -> str:
        return self.col + self.row


@dataclass(frozen=True)
class Rejection:
    reason: str
    message: str


def parse(raw: str, occupied: Set[str]):
    """Validate ``raw`` against the grammar and occupancy.

    Returns a Move on success or a Rejection with a typed reason.
    Never raises on bad input.
    """
    if raw is None:
        return Rejection(MALFORMED, "No input received.")
    # Length-bound BEFORE any further processing (reject huge lines).
    if len(raw) > MAX_INPUT_LEN:
        return Rejection(MALFORMED, "Input too long — type a cell like B2.")

    text = raw.strip()
    if not _GRAMMAR.match(text):
        # Distinguish out-of-range (valid shape, bad coordinate) from malformed.
        upper = text.upper()
        if len(upper) == 2 and upper[0].isalpha() and upper[1].isdigit():
            return Rejection(
                OUT_OF_RANGE,
                f"{raw!r} is off the board — columns A-C, rows 1-3.",
            )
        return Rejection(
            MALFORMED,
            f"{raw!r} is not a move — type a cell like B2 (A-C, 1-3).",
        )

    col = text[0].upper()
    row = text[1]
    cell = col + row
    if cell in occupied:
        return Rejection(OCCUPIED, f"{cell} is already taken — pick another.")
    return Move(col=col, row=row)
