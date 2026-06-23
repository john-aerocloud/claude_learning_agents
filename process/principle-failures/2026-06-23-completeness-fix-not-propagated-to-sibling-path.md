# 2026-06-23 — a completeness fix was applied to one code path, not its sibling

**Class:** fix-incompleteness / escaped defect (DEFECT-OAG-019). One data point of a possible pattern — logged for a future retro to confirm before any rule change.

## What happened
DEFECT-OAG-015 fixed FIDS bootstrap completeness: a stream must be hydrated via
`getFlight` to have full identity (the backward scan + getFlight design). But the
client folds events on TWO paths — the **bootstrap** AND the **live poll**. The fix
was applied only to the bootstrap. The live poll kept creating identity-less entries
for streams it had never hydrated → DEFECT-OAG-019 (ghost rows) shipped and was
caught by the user on the live board.

## Why it's a deviation
The root reasoning of DEFECT-015 ("an un-hydrated stream has no identity; hydrate it")
applies identically to any path that folds events into the displayed map. The fix
addressed the instance (bootstrap) not the class (every fold path), so the sibling
path (poll) carried the same latent bug.

## Root cause
When fixing a completeness/correctness issue on one code path, there was no prompt to
ask "does the same issue exist on the sibling paths that share this invariant?" The
poll and bootstrap share the "folded map must have identity" invariant; only one was
guarded.

## Fix
DEFECT-OAG-019 applied the same hydrate-on-unknown + a shared `lacksIdentity` guard
to BOTH the poll path and BOTH filters (activeFlights + bidsFlights), so the invariant
holds on every path. Forward-looking learning (not yet a rule — single data point):
when a fix establishes an invariant on one path, check every sibling path that shares
it. If this recurs, a retro should route it (likely engineer.md / the change-impact
model: a fix's pin should cover all paths that share the invariant, not just the one
that failed).
