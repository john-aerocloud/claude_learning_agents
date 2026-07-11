# Principle failure: work-items machinery corrupted its own event notes (comma/quote)

**Date:** 2026-07-11
**Project:** OperationalFlowSimulator (impact was ALL projects — shared machinery)
**Agent:** machinery (`work-items.py`) — no owning role caught it; found in the OFS run
**Principle:** §F0 (the item file is the single source of truth) / self-service tooling (§16.4)

## What happened
`work-items.py` re-serialises every item file on `wi-project`/`wi-append`. Two parser
bugs corrupted the `note:` field of `events:` entries on each pass:
1. `_split_top_commas` ignored quote state, so a note containing a comma was **truncated**
   at the first comma (`value=7 (core job across J9/J10, J11 ...)` lost everything after the comma).
2. `_parse_scalar` did not unescape, so backslashes **compounded on every pass** — a note
   accreted `\\\\\\\"` prefixes over successive `wi-project` runs.

Because the item file is the single source of truth (§F0) and the audit trail lives in the
event notes, this silently corrupted the audit trail across ALL projects, not just OFS.
Observed on OFS in UC-E1/E2/E3, CHK-E/F, SLC-E1, REQ-OFS-2 `registered` notes.

## Root cause
The machinery that is the SSOT writer had **no round-trip test for its own note field**.
A store whose correctness the whole system depends on was never asserted to preserve the
one free-text field most likely to contain the delimiter it splits on (comma) and the
escape char it re-emits (backslash). The single-writer discipline (§F0) removed multi-store
drift but left the writer's own serialisation unverified.

## Remediation (DONE this session)
- Fixed `_split_top_commas` to be quote-aware and `_parse_scalar` to unescape — parent-repo
  commit **938db37** — plus **5 regression tests** round-tripping notes with commas, quotes,
  and backslashes. Verified: `wi-project` now round-trips comma/em-dash notes with no
  compounding (confirmed on the repaired OFS notes; `wi-validate` I1–I4 clean).
- **Residual repaired this retro:** the pre-fix corrupted notes on the 7 OFS items were
  swept clean by hand (truncated tails were unrecoverable and marked as such; value/cost
  remained intact in frontmatter). They no longer worsen.

## Standing lesson
Any committed tool that SERIALISES the SSOT must have a round-trip test over its own
adversarial field content (delimiters, escapes, unicode) as part of its done-condition —
the SSOT writer is exactly where a silent-corruption bug is most expensive. Protection is
the regression test committed alongside the fix (not a note). No process-rule change: this
is a self-service-tooling done-condition already implied by §16.4; the failure was a missing
test, now added.
