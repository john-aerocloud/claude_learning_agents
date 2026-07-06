# IMP-016 — DORA derived-state correctness: `item_done` is terminal + a mechanical reconcile-first gate

**Status:** RESOLVED by the v82 cutover. `item_done`-in-no-queue is now invariant
I2 in `process/machinery/state-graphs.json` (a terminal item in a non-null queue
is unrepresentable and caught by `make wi-validate`); ledger-drift is superseded
by the fold-state single-store model + `wi-validate`. This IMP is the evidence
that justified F0 — retained as the record. (Registered 2026-07-05, human-directed,
HIGH priority — "a bug in these things corrupts data; we need to understand how we
are working"; active project at registration: Viggo-fix.)

## Problem (data-integrity bug in the SSOT)

`dora.py derive_project_state()` projects each item's state by walking its events in
timestamp order, **latest event wins** (`.../dora.py:489-494`): `dequeue → in-flight`,
`item_done → done`. So any `dequeue` **timestamped after** an `item_done` silently
reverts a finished item to `in-flight`. The derived state (`state.md`) then LIES about
what is done.

## Evidence (it already corrupted decisions)

On the 2026-07-05 reconcile, VF-001/002/004/005 and UC-W3/UC-W4 all showed `in-flight`
in `state.md` despite valid `item_done` rows in the ledger from 2026-06-28/07-02 — because
later queue-bookkeeping `dequeue` events clobbered them. This is the same close-drift class
v73 §F1 targeted; the earlier symptom (v73 evidence) was two engineers **re-dispatched to
build already-built UCs**. A lie in the projection ⇒ wasted rework + wrong routing.
The flow-manager's fix was a band-aid (append trailing `item_done`); the real fix is the
projection semantics.

## Fix

1. **`item_done` is TERMINAL.** Once an item is done, a subsequent bare `dequeue` MUST NOT
   reopen it. Only an explicit re-entry — a later `enqueue` (rework), `item_registered`,
   or `state_transition` — reopens it (genuine rework then legitimately shows in-flight).
   Design the rule so ALL of these hold (as regression tests):
   - registered→enqueue(ready)→dequeue→item_done→**dequeue** ⇒ **done** (the bug)
   - registered→enqueue→dequeue→item_done→**enqueue(rework)**→dequeue ⇒ **in-flight** (real rework)
   - registered→enqueue→dequeue ⇒ in-flight;  …→item_done ⇒ done (unchanged)
2. **Add `make ledger-drift PROJECT=<p>`** (the v73 reconcile-first gate that was never
   built): a `dora.py ledger-drift` subcommand that diffs the project trunk's git-log
   UC/SLC/VF SHAs (commit-message ids) against ledger `item_done` refs and **exits non-zero**
   listing built-but-unclosed items, so RECONCILE-FIRST is mechanical, not hand-grepped.
3. **Regression tests** in `test_project_state.py` pinning the cases above, plus a
   ledger-drift smoke.

## Target

CFR + gross lead time (no re-dispatch of already-built work; no reconcile-rework token
burn) and, above all, **trust in the SSOT** — the ledger/derived-state is how the team
understands its own delivery; a projection bug there is the highest-leverage correctness
fix. Routed to the engineer (TDD-on-trunk, parent repo, `instance/viggo-fix`).
