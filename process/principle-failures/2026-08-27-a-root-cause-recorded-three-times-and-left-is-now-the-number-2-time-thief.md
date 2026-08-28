# A root cause recorded three times and left is now the #2 time thief

**Date:** 2026-08-27 · **Project:** ROC · **Found at:** the v156 retro, walking the
Theory-of-Constraints loop on the default focus question.

This entry is opened under process §5b — *a recurring root cause opens a
`principle-failures/` entry even when nothing "failed"* — because nothing failed today.
The failure is thirteen days long.

## What was recorded, and when

`UC-ROC-093`'s own event log, **2026-08-14**, in a `made_ready` note:

> "the **seventh recorded instance** of the per-transition allowlist blocking legitimate
> work across four different roles in one day; note the incoherence explicitly —
> orchestrator may fire `pulled` (consume from Ready) but not `made_ready` (populate
> Ready), which is a **boundary asymmetry, not a safety property**. Do not patch the
> graph — replace the mechanism, not the allowlist a fourth time."

That note is correct in every particular. It was written, committed, and read. The
incoherence was noted. Nothing was done.

## What it cost, measured today

`views/stats.md` §B, backfill 0.00%, count-independent per §17f:

- `orchestrator` is the **#2 contributor to gross lead time at 29.78%**
- **every second of it is the `reported` state** — 98 items, median **31,485s (8.7h)** each
- the #1 contributor (`external`, 31.73%) is platform decision debt the owner has closed
  the ask list on, so it is **not exploitable by this project**. The allowlist is the
  largest thing ROC can actually act on, and it is two points behind.

## The chain, in one line

Leaving `reported` requires `triaged` → `triaged`'s only legal agent is `orchestrator` →
the orchestrator is a single serialised actor that also runs the pull loop, fires pipeline
`deployed` events, dispatches every agent and reports to the human → triage happens in
batches whenever it next looks → **the allowlist makes one actor a mandatory serialisation
point for the first transition of all 130 defects.**

## Two new instances today, and one of them is worse than friction

**Instance 9.** An engineer reproduced `DEF-ROC-063` on the deployed host (60/60 checks,
six viewports, exit 0), found the human's report **false**, and had **no legal event of any
kind** to record it — from `reproducing` its only forward event is `confirmed`, which would
have been a lie. It declined, wrote its verdict to a scratch file, and handed it back.
**The graph's only affordance for an honest negative was a false assertion**, and
`confirmed` feeds the defect-confirmation and MTTR measures. Nothing was corrupted only
because the agent refused.

**Instance 10.** An engineer that sharpened `DEF-ROC-071`'s stated mechanism while building
adjacent code could not append it. The finding survives only because an orchestrator
relayed it by hand — a hand-off nothing enforces, invisible if the agent ends or is not
asked.

Instance 9 is the graph **compelling a false record**. Instance 10 is it **silently
discarding a true one**. Ten instances, five roles, and the count is recorded in event
notes because until today no item tracked it (`DEF-ROC-128`).

## The orchestrator's own contribution, unsoftened

The same retro that named `reported` as the exploitable constraint had, in the same cycle,
**registered seven findings into it and triaged one**: `DEF-ROC-125` … `DEF-ROC-131` and
`OI-ROC-012`, six left undecided.

Every one is real, and §F8a rightly forbids closing a finding to shrink a number. That is
not the defence. The failure is that **registering a finding and not deciding it converts
discovery into inventory**, and the role that found it always held the context to decide.
Naming a constraint while feeding it in the same turn is the specific thing to stop.

## Routed

- **§F9a** — a role that performs work may always record its outcome, including a negative
  one; no role's only legal forward move may be a statement it believes false. Implementing
  item `DEF-ROC-128`. Explicitly **not** closable by adding one more role to one more
  allowlist, which would be the fourth extension the 2026-08-14 note already warned against.
- **§F9b / `EXP-ROC-009`** — a finding is registered WITH its triage decision, in the same
  act. Scored on the `reported` median, with findings-registered-per-cycle as the guard: if
  the rule suppresses discovery it is strictly worse than the inventory it prevents, and it
  dies rather than being tuned.

## The generalisable lesson

**A root cause that is recorded and left is not documentation, it is a decision to keep
paying.** Three notes across thirteen days described this precisely and none of them was a
change. The mechanism that finally moved it was a *metric* — it became the #2 GLT owner and
the retro had to answer for it. Prose in an event log is not a mechanism; this repo already
knows that mechanised obligations are honoured and documented ones are skipped (EXP-123),
and this is that pattern applied to its own findings.
