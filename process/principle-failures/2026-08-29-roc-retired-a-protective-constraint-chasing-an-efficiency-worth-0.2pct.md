# I retired a protective constraint while chasing an efficiency later measured at ~0.2%

**2026-08-29, ROC. Author of the failure: the orchestrator (me).**
Routed: §F13 REVERSED at v175; `EXP-ROC-015` killed; `DEF-ROC-162` open.

## What happened

The orchestrator had a standing instruction in every dispatch brief: **do NOT run any `wi-*`
command.** The v163 retro — mine — named that instruction as the constraint and **retired it**,
introducing §F13 (*"a specialist advances its own item's state"*).

The reasoning looked strong. 8x concurrency had bought only 1.43x throughput, and every state
event in the project queued behind one actor **by explicit instruction**. That reads as a
textbook self-inflicted bottleneck.

**It was wrong twice, and both refutations arrived from outside.**

1. **v164, the owner, within the hour:** *"the slowdown really isnt the wi commands."* One
   number settled it — **agent work-effort is 0.2% of gross lead time**, so a serialisation
   inside 0.2% cannot explain a 99.8% wait figure. `EXP-ROC-015` was scoped down to "a real but
   SECONDARY inefficiency" and never scored a single positive.
2. **`DEF-ROC-162`, the same day:** `wi-project` loads a snapshot of every item file and writes
   them all back — no lock, no re-read, no compare-and-swap. **Any `wi-append` landing during
   the run is silently and permanently destroyed.** Both commands exit 0. Neither warns.
   **`wi-validate` reports the store CLEAN afterwards**, because the invariant is
   `derived == fold(events)` and that holds just as well over a log with an event missing.
   A real `confirmed` event was destroyed and was caught only by the `DEF-ROC-154`
   re-read-from-HEAD habit.

**That race requires two concurrent writers. §F13 supplied the second one.** Under the
prohibition it replaced, `wi-append` and `wi-project` were serialised inside one actor and the
window did not exist.

Ledger: **§F13 bought at most ~0.2%, and cost silent permanent loss of the single source of
truth.** The owner's words on reversing it: *"this is evidence that it is not a problem and it
should not be run from subagents."*

## The principle that failed

**A constraint that looks like pure overhead may be holding a safety property nobody wrote
down.**

The prohibition had a *stated* rationale — a measured hazard where an engineer editing
`work-items.py` froze every state change in the project for hours. I checked that rationale,
judged it a proxy over-applied to every dispatch, and retired it. **The rationale I checked was
not the only thing it was doing.** Its protective effect on the append/project race was never
written down anywhere, so removing it looked free.

**This is the mirror of the failure family this project registers most often.** Usually the
fault is a control that *asserts nothing* — here it is a control that asserted something real
that nobody had named. Both are invisible for the same reason: **nothing states what the
mechanism is for**, so the question "what breaks without it?" has no answer on file.

## What to do differently

- **Before retiring a constraint, ask what it prevents that is NOT written down** — and leave
  it in place until that question has an answer. "I read its stated reason and disagreed" is
  not the same as "I know what it does".
- **Weigh the downside before the upside.** The efficiency claim was quantified before removal;
  the risk was not quantified at all. A change whose benefit is measured and whose cost is
  unexamined is not a measured change.
- **Suspect any efficiency argument aimed at a stage holding 0.2% of lead time.** v159 had
  already published that number. I had it, and optimised inside it anyway.

## Not reversed with it

The **v11 rights model** (`OI-ROC-006`) is independent and stays: rights derive from the item's
declared owner and a verdict is the tester's alone. It refused the orchestrator **three times in
one session** and was right every time. It governs *whose judgement an event records*; §F13 was
about *who types the command*. Only the second was wrong. **§F13a** (turn-ending) is likewise
untouched — that was v164's real constraint.

**And `DEF-ROC-162` is still a defect.** Serialising through one actor is an operational
mitigation, not a fix: a store that can silently lose its own source of truth under *any* race
is wrong regardless of who usually writes it.
