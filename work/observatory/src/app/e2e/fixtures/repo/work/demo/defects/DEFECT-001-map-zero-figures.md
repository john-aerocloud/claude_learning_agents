# DEFECT-001 — Demo map shows zero for every figure

**Status:** CLOSED · **Severity:** HIGH

## Four fields

- **Expected:** The demo pipeline map shows the fixture's real counts.
- **Actual:** Every figure renders **0 for everything** while the fixture clearly has work.
- **Intent:** Watch the demo pipeline live.
- **Importance:** The fixture exists to prove figures render; zeros prove nothing.

## Root cause

The stage counts were read from the wrong column of the ledger.

## Resolution

Fixed by recomputing the stage counts from the ledger. Commits `abc1234`, `9d8f7e6`.
