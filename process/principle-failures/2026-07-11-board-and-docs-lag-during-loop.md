# Principle failure — board + docs left stale during the dev loop

- **Date:** 2026-07-11
- **Agent:** orchestrator
- **Project:** ROC (but the fix is process-wide)
- **Principle:** the loop mirrors each item to the human board per-item as it
  changes state, and keeps user-facing docs honest to what shipped
  (`loop-run` steps 4/5b/6; STAGE F §F0).

## Failure

Across several loop cycles I advanced work items through their states
(`registered → building → done`) and committed the code, but did **not**
dispatch the `linear` projection agent per item, and did **not** run the
`documenter`. The result: the Linear board showed only the requirement's team
(no chunk/slice/use-case issues) and the project had **no README** — both
discovered only because the human asked "why does ROC have no tickets?" and
"ROC has no readme." Three use-cases had shipped green before anything was
visible to a human watching the board.

## Root cause

The loop doc described the per-item board push and the documenter as
"near-real-time" / "parallel, non-blocking" / "in the background." That phrasing
read as *optional* and *deferrable*, so under delivery pressure I kept deferring
them — and "later" never came until prompted. A step framed as best-effort gets
treated as skippable; the retro-debt gate does not have this problem because it
is framed as a hard, checkable precondition.

## Fix (applied)

Reframed both as **mandatory in-cycle invariants**, matching the retro-debt
gate's force, in `loop-run.md` (steps 4/5b/6) and `process-current.md` §F0:
- Every `wi-append` that changes item state MUST be followed, in the same cycle,
  by a per-item board projection dispatch for that id. **Invariant: board status
  never lags item-file state by more than the current cycle.** Only the external
  API call is best-effort; the dispatch is not skippable.
- The full-sweep is demoted to a periodic structure backstop; if it does real
  state work every time, per-item pushes are being skipped.
- The `documenter` is REQUIRED at each slice close (README / GitBook), honest to
  shipped state.

## Reversal / check

A cheap self-check each cycle: after a close, the full-sweep should find nothing
new to change. If it does, the per-item discipline has lapsed again.
