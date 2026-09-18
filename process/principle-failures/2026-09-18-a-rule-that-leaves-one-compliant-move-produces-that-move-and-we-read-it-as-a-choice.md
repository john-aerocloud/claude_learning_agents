# A rule that leaves exactly one compliant move produces that move — and we keep reading it as a choice

**Date:** 2026-09-18 · **Project:** ROC · **Opened by:** the v184 retro
**Recurrence:** third recorded instance of the same shape.

## What happened

ROC's intake queue held **20 items, median in-queue age 21.6 days, oldest 32.0**.
Across those 20 items the event logs carried **79 `amended` events and zero triage
decisions**. Every one of the 20 carried an in-date `defer_until:`, and the 20
dates clustered on **three** values — 14× `2026-10-02`, 4× `2026-09-28`,
2× `2026-09-30`. That is not twenty decisions; it is three batch re-datings wearing
twenty items' names.

The `orchestrator` owner carried **34.64% of measured gross lead time**, all of it
`reported` dwell, which is that queue.

## Why this is a principle failure and not a defect

Because the obvious reading is wrong, and the system has now produced this reading
three times.

The obvious reading is *somebody kept snoozing the backlog instead of deciding.*
The machinery is built around that reading: v155 added a total-age ceiling past
which re-dating stops working, v157 added a minimum defer horizon so a defer that
expires in hours cannot count as a decision. Both are good controls. Both treat
re-dating as the behaviour to suppress.

But re-dating was **the only compliant move available.** The gate's own remedy
names three answers, and at the moment an agent reads it:

- **schedule it** requires a concurrent WIP slot, and §F5 promised every slot to
  any open defect — and a defect is always open;
- **decline it** is forbidden on a real finding by §F8a, correctly;
- **escalate it to a named party** has **no edge in the state graph at all**
  (found this cycle, registered as DEF-ROC-318, when this retro tried to take it
  for OI-ROC-004 and had nowhere to write it).

Three answers, two unreachable. An agent following the rules exactly, every time,
lands on the one that remains. **The backlog's age is the rule's output.** Suppressing
the re-dating without opening one of the other two would not have produced decisions —
it would have produced a gate nobody could satisfy, which this system logs as its own
failure class (DEF-ROC-083).

## The generalisable rule

**Before treating a repeated behaviour as a habit to be gated, enumerate the moves
the rules actually leave open. Where exactly one is reachable, the behaviour is the
rule's output and the fix belongs at the rule.** A control added on top of a forced
move does not change the move; it only makes the forced move harder to record
honestly.

The tell is cheap to check and was available the whole time: **a decision field whose
values cluster far below the item count.** Twenty items, three dates. Real decisions
made one at a time do not do that. Any field that is supposed to hold independent
judgements can be audited this way in one query, and a low distinct-value count is
evidence of a forced move long before anyone reconstructs the why-chain.

## Prior instances of the same shape

- **v155, OagEventSource** — a 36-item batch re-staggered twice in 9 days, not one
  item reaching `done`, the gate reporting satisfied throughout because each
  individual defer was legal and in-date.
- **v157, ROC** — six of nine decisions in one cycle were the same `defer_until:
  2026-08-28`, written in one batch, expiring within 13 hours.
- **v184, ROC (this)** — 20 items, 3 dates, 79 amendments, 0 decisions.

Each was fixed by tightening what counts as a decision. None asked what else the
agent could have done. That is why there is a third instance.

## Routed

- §F5.1 (v184) — one concurrent slot **reserved** for non-defect work, which no
  defect may pre-empt; a floor, not a quota, returned to the defect stream whenever
  intake and the use-case queue are both empty. Makes **schedule** reachable.
- **DEF-ROC-318** — add the missing `escalated` edge, carrying the park discipline
  `blocked` already obeys (a named party and a re-checkable reversal predicate, so
  it cannot become a better `defer_until`). Makes **escalate** reachable.
- **EXP-ROC-025** — scores both, with a falsifier that cannot be gamed by arrival
  rate (intake median age, not the GLT share) and a guard that reverts the change if
  CFR or MTTR deteriorate for two consecutive retros.
