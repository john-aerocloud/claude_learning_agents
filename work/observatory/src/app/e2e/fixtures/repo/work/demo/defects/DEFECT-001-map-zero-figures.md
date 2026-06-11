# DEFECT-001 — Demo map shows zero for every figure

**Status:** CLOSED · **Severity:** HIGH

## Four fields

- **Expected:** The demo pipeline map shows the fixture's real counts.
- **Actual:** Every figure renders 0 while the fixture clearly has work.
- **Intent:** Watch the demo pipeline live.
- **Importance:** The fixture exists to prove figures render; zeros prove nothing.

## Resolution

Fixed by recomputing the stage counts from the ledger.
