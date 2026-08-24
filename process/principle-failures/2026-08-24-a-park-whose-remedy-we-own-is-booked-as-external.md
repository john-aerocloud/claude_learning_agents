# A park whose remedy we own for 7.2 days was booked to an owner called `external`

**Date:** 2026-08-24
**Project:** ROC
**Retro:** v150
**Principle breached:** measure what you name (§5b, §5b.1, §5b.2); and *a control that reads
confidently while measuring something other than what it names is the failure, not the number it
reports*. Also §17c Layer 2 — *a remedy written as prose reproduces the defect it was written for*.

## What happened

`external` has been ROC's top gross-lead-time owner for **five consecutive retros** — 35.40% this
cycle, median 7.19 d/item across 15 items, 0.00% backfill, so §17f permits naming it. Two of those
items are `awaiting_observation`:

| item | parked | probe | probe verdict |
|---|---|---|---|
| `DEF-ROC-035` | 7.2 d | `make probe-dash0-wired` | NOT YET OBSERVED |
| `DEF-ROC-056` | 4.9 d | `make probe-appinsights-wired` | NOT YET OBSERVED |

Both probes read the deployed Function App's app settings for a telemetry-sink endpoint. Both
settings are absent. The item that would create one is `DEF-ROC-041`, and its own Definition
states: *"Ownership: ours … Not blocked externally … buildable via the normal dev-first CICD
pipeline."* It had sat in `reported` for **7.2 days** — longer than the parks it would end.

**The wait was ours the entire time. It was recorded as external, re-checked honestly every
cycle, and reported as legitimate every cycle.**

## The aggravating half: the gate that exists made it worse, in this cycle

`loop-gate` check 4 (`aged-backlog-undecided`, EXP-131) blocked the pull on eight items aged past
7 d with no recorded decision. Correct, and it forced six real re-decisions. The orchestrator
cleared it by recording six dated defers — **and one of them was `DEF-ROC-041`, deferred to
2026-08-26.**

So the loop's own aging gate was used to push the constraint's remedy further away, and it read as
compliance. The retro's IDENTIFY step caught it roughly twenty minutes later, by reading the two
probes' source rather than the items' prose, and the defer was withdrawn. **Nothing mechanical
would have caught it.** The gate demands *a* decision; it cannot tell a sound defer from one that
parks the fix for the project's own named constraint.

## Why it is a RECURRENCE and not a first instance

Third instance of one class — *the system books its own latency to an owner outside itself* — and
each was found by a different retro looking at a different symptom:

- **v126** — `awaiting_observation` was owner `tester`; a wait was wearing the tester's name. Fixed
  by moving the owner to `external`. Correct then, and it is the move that created the blind spot
  now: `external` became a bucket with no obligation attached.
- **v144** — `DEF-ROC-004` sat `blocked` for **28.8 days after both of its blockers had already
  gone**. Fixed with EXP-143's probes, adopted v148. Probes answer *"is it still blocked?"*, which
  is the wrong question when the blocker is our own unscheduled work.
- **v150 (this)** — the park is genuinely standing, the probe is genuinely right, and the cause is
  genuinely in our backlog. Nothing in the system joins those two facts.

And it is the fourth instance in four days of the wider measurement class that §5b.1 and §5b.2 were
each written for: `defer_until` invisible to the metrics fold (v146), loop downtime invisible to the
metrics fold (v149), and now park causation invisible to the metrics fold. **Every time: two
mechanisms read the same reality, one is right, and the blind one is the one that names the
constraint the retro spends its budget on.**

## What changed

- **§12d.2** — a park declares `park_remedy:` (an item id, or the explicit claim
  `none-inside-project`), and `loop-gate` BLOCKS when that item is aging in a backlog queue with no
  in-date defer. The `external` share is reported SPLIT into remedy-inside-project and
  remedy-outside-project, never netted off.
- **`IMP-033`** builds it, with the migration of all 15 currently-parked items as AC-033.6 — because
  a limb binding only future parks leaves the whole measured 35.40% where it is.
- **`EXP-ROC-004`** opened against gross lead time, with its falsifier declared up front: if most
  parks come back `none-inside-project`, the field is ceremony and the limb should be killed.
- Immediate exploit, this cycle and independent of the machinery: `DEF-ROC-041`'s defer withdrawn
  and it is the first pull.

## The trap for next time

`park_remedy: none-inside-project` is the escape hatch, and it is one keystroke cheaper than
thinking. The moment it becomes the common value, this rule has turned into the ceremony it
replaced — which is why AC-033.8 makes the inside/outside split a REQUIRED output that the next
retro must read, and why the split must never be netted off the reported `external` share.
