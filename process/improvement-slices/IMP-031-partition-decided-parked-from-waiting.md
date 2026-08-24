# IMP-031 — the constraint metric counts DECIDED-AND-PARKED inventory as WAITING

**Opened:** 2026-08-21 (v146 retro, OagEventSource)
**Owner:** work-item machinery (`.claude/skills/work-items/scripts/work-items.py`) — parent-repo lane
**Targets:** lead time (via making the named constraint actionable)

## The finding, measured

`views/stats.md` names the constraint as `queue` — **64.63% of gross lead time** — dominated by the
`open` state at **56.20%**, median **608,869 s (7.05 d)** across 139 items, zero backfill.

Every retro for weeks has therefore prescribed the same remedy: *deliver faster*.

**Measured this cycle over the 130 items in an intake state:**

| | count | share |
|---|---|---|
| carry `defer_until` **in the future** — decided, parked, not waiting | **85** | **65.4%** |
| carry `defer_until` in the past/today — genuinely due | 3 | 2.3% |
| carry **no** `defer_until` at all — genuinely undecided | 42 | 32.3% |

So roughly **two thirds of the inventory the constraint metric is measuring has already been
decided** and is waiting on a *date*, not on capacity. The actionable intake is **45 items, not
130**, and "deliver faster" is aimed largely at work that was deliberately parked.

## The gate and the metric disagree — and the gate is right

`defer_until` appears **9 times** in `work-items.py` and **every one is inside a `loop-gate`
limb**. None is in the metrics fold. So:

- **`loop-gate` already treats a dated defer as a decision.** Its `aged-backlog-undecided` limb
  blocks on *age without a decision* — the count-independent quantity — and an **expired** defer
  re-blocks by design (it fired this morning on five items and forced a real re-decision).
- **The stats fold does not know `defer_until` exists.** It folds parked and waiting into one
  `open` bucket and one `queue` owner.

Two mechanisms reading the same frontmatter field, one honouring it and one blind to it. The blind
one is the one that names the constraint the retro then spends its change budget on.

## What to build

Partition `open` in the fold, and report both:

- `open/undecided` — no `defer_until`, or one that has passed. **This is the constraint candidate.**
- `open/parked` — `defer_until` in the future. Reported with its **own** age distribution and its
  **own** expiry pressure. Never hidden, never netted off.

The `by_owner` `queue` row splits the same way.

## The failure mode to guard against, stated up front

**This change could be pure metric-gaming** — making a bad number smaller by relabelling. Three
guards, and the slice fails if any is dropped:

1. **The parked bucket is REPORTED, not removed.** Its count, median age and next-expiry date
   appear in `stats.md` every cycle. A reader must be able to see that 85 items are parked.
2. **Expiry pressure already exists and stays.** An expired defer re-blocks the pull. Parking is
   not free and cannot become a way to make work disappear — that mechanism is already built and
   already fires.
3. **A growth tripwire.** If `open/parked` grows while completed items do not, the change is a
   relabelling and this slice is **killed**, not tuned. Score it that way.

## Acceptance

- **AC-031.1** — `stats.md` reports `open/undecided` and `open/parked` separately, with count,
  median age and next-expiry for the parked bucket. Demonstrated on the real registry (today: 45
  undecided vs 85 parked).
- **AC-031.2** — the `by_owner` `queue` row splits the same way, so the constraint call is made on
  the undecided share.
- **AC-031.3** — non-vacuity: a fixture with a parked item whose `defer_until` **passes** moves it
  from `parked` to `undecided` with no other change. Red before the fix.
- **AC-031.4** — the parked bucket's growth-vs-throughput ratio is emitted, so guard 3 above is a
  number and not a promise.
- **AC-031.5** — `make wi-validate` and `make loop-gate` behaviour is **unchanged**. This slice
  touches reporting only; the gate already had this right and must not be "improved" here.

## Why this is not a cosmetic reporting change

The retro is the mechanism by which this system improves itself, and its change budget is gated
on the constraint (§5b). A constraint named from a denominator that is 65% decided-and-parked sends
that budget at the wrong target every cycle. This is the measurement equivalent of the class this
project keeps finding — a control that reads confidently while the thing it measures is not the
thing it names.

---

## SECOND LIMB, added v149 (retro 2026-08-24) — partition by LOOP UPTIME as well as by decision

Same job, second confound on the same denominator (§5b.2). `defer_until` separates *decided* from
*waiting*; this limb separates *latency* from *calendar*.

**The measurement that opened it.** `queue` median/item went 119,684 s at the v147 close to
**303,881 s** now, n unchanged at 218 — **+154%**. The loop was **stopped for 60.9 h** at the
owner's request across that interval, and that downtime alone accounts for **72%** of the current
median. v147's celebrated **−51%** across the previous interval is exposed to the same confound in
the opposite direction. Two consecutive retros reasoned from a number neither could attribute.

- **AC-031.6** — the fold emits, per interval between retro closes, the **loop uptime** for that
  interval and splits each owner's dwell into `dwell_loop_running` and `dwell_loop_stopped`.
- **AC-031.7** — non-vacuity, and this is the limb that matters: a fixture containing a synthetic
  stop interval must move dwell out of `dwell_loop_running` and into `dwell_loop_stopped` **with
  no change to total dwell**. Total is conserved; only its attribution moves. Red before the fix.
- **AC-031.8** — the split is **REPORTED, never netted off**. A stopped loop is a real cost to the
  person waiting for the work; it is simply not a cost any exploit/subordinate/elevate move can
  reduce, and §5b.2 requires it stated rather than removed.
- **AC-031.9** — where uptime cannot be determined for an interval, the fold emits **`UNKNOWN`**
  and NOT zero. §5b.2 rule 4 exists because an unmeasured interval is unattributable, and a
  default of zero would silently assert the loop ran the whole time.
- **AC-031.10** — `make wi-validate` / `make loop-gate` behaviour unchanged, as AC-031.5.

**Where uptime comes from — do not invent a new store.** The item event stream already carries
every dispatch's timestamps, and `retro-log.md` already carries the close marks. An interval with
no appended events across all items is a candidate stop; the honest signal is
absence-of-events-across-the-whole-project, not a per-item gap (a single item can idle while the
loop runs, which is precisely what `loop-gate`'s `stalled-work` check is for and must not be
conflated with).
