# A constraint movement was quoted, twice, without stating the loop's uptime

**Date:** 2026-08-24
**Project:** OagEventSource
**Retro:** v149
**Principle breached:** measure what you name (§5b, §5b.1); and *a control that reads confidently
while measuring something other than what it names is the failure, not the number it reports*.

## What happened

Two consecutive retros quoted a movement in the top constraint as a finding, in opposite
directions, and neither could attribute it.

| close | `queue` median/item | what was concluded |
|---|---|---|
| v146 | 246,033 s | constraint unmoved |
| v146 (late) | 161,635 s | — |
| **v147** | **119,684 s** | *"−51%, the first sustained move in this constraint"* |
| **v149** | **303,881 s** | **+154%**, n unchanged at 218 |

Between the v147 and v149 closes **the loop was stopped for 60.9 hours (2.54 days)** at the owner's
request. **That downtime alone accounts for 72% of the current median.**

`loop-gate` independently measured the same interval from the other side and agreed: two items
47.0 h in `prod-validating`, one 2.7 d idle in `reproducing`, five `scheduled` open-items 2.6 d
idle. Every one of those was correctly recorded as dwell. None of it was latency the system could
have avoided.

## Why it is a principle failure and not just a number

Gross lead time is **wall-clock**. `/loop-run` is specified as a **continuous background process**
(§F9). Those two facts are only consistent while the loop is actually running — and **nothing
records whether it was.** So the figure the retro names its constraint from, and gates its entire
change budget on (§5b), is bidirectionally sensitive to an input nobody measures.

The damage is not the wrong number. It is that:

1. **v147 drew a strong positive conclusion from it** — "the first sustained move in this
   constraint" — and that claim is now unsupportable, not because it was false but because it was
   never attributable.
2. **v149 was about to draw the opposite conclusion** from the same artifact, and would have spent
   this cycle's change budget hunting a regression that was a switched-off system.
3. Any step-5 anticipated-vs-observed score computed across such an interval is **scored against
   noise**, and "the constraint did not shift" then reads as a failed change instead of an
   unmeasured one.

## Why it is a RECURRENCE

This is the second instance of the identical class in the measurement layer, three days apart:

- **v146 / §5b.1 / `EXP-OAG-002`** — the constraint's denominator was 65% *decided-and-parked*, not
  waiting. The gate honoured `defer_until`; the metrics fold did not know the field existed.
- **v149 / §5b.2 / `EXP-OAG-005`** — the constraint's denominator conflates *calendar* with
  *latency*. `loop-gate` measures per-item idleness; the metrics fold does not know downtime exists.

Both times: **two mechanisms read the same reality, one is right, and the blind one is the one that
names the constraint.** That it recurred within three days, in the same subsystem, after the first
was written up, is why this is logged rather than folded silently into the rule.

## What changed

- **§5b.2** — four rules at IDENTIFY: state uptime before quoting any movement; attribute
  loop-stopped dwell separately and never net it off; never score a prior change across an interval
  with material downtime without saying so; if uptime is unknown, say **UNKNOWN**, not zero.
- **`IMP-031` AC-031.6–AC-031.10** — folded into the *same* slice as the decided/parked partition,
  because they are one job: make the fold's denominator mean what it says. AC-031.7 pins that the
  split **conserves total dwell** — attribution moves, the total does not.
- **`EXP-OAG-005`** — opened against gross-lead-time integrity, with the anti-gaming trap declared
  up front: this rule could be used to *excuse* a real regression as downtime, so scoring must
  confirm a genuine latency rise is still reported as one.

## The trap for next time

The rule is deliberately **symmetric**. It forbids claiming a win exactly as much as it forbids
reporting a regression. The moment it is used only in the direction that flatters the cycle, it has
become the thing it was written to prevent.
