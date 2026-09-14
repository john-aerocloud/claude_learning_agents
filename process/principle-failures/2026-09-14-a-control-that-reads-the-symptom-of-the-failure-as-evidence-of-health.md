# A control that reads the symptom of the failure it guards against as evidence of health

**Date:** 2026-09-14
**Project:** ROC
**Retro:** v176
**Principle breached:** §17i — *a control that cannot report is not a control, and silence is
never a pass* — in its most expensive form: not a control that says nothing, but one that says
**"all clear"** in precisely the circumstance it exists to catch.

## The headline instance

`.claude/hooks/loop-continue.mjs` is the one mechanism that blocks a turn ending while the loop
could still pull (§F13a, `EXP-ROC-016`). Its capacity test was queue DEPTH:

```js
if (rework === 0 && (ready === 0 || wip >= cap)) allow('nothing pullable');
```

with the comment *"Waiting on agents at cap is legitimate — that is the loop working, not
stalling."*

ROC's `wip` has been **16 against a cap of 8 since 2026-08-29, with nine slots idle**. So the
"agents are busy" branch was true **because** work had stalled. The guard's stall signal and its
healthy signal were the same number, which means **the worse the stall got, the more confidently
it permitted the stop.** A monotone-wrong guard.

Demonstrated on the identical state rather than argued:

| | verdict |
|---|---|
| pre-fix hook, real state | `nothing pullable (ready 7, wip 16/8, rework 0)` → **ALLOW** |
| fixed hook, same state | **BLOCK** — 8 items idle up to 16.1d, named with ages |
| fixed hook, `LOOP_STALE_HOURS=1000` | reproduces the old ALLOW exactly — isolating idleness as the cause |

**The cost.** Loop uptime since the last retro close: **10.0%** — 14.1 quiet days of 15.7. And the
loop did not simply stop, which is worse: it ran on at least five separate days and produced 128
events while `DEF-ROC-145/147/151/154/163/165` and `UC-ROC-117` recorded nothing at all. Sessions
happened and walked past the same eight items every time. `DEF-ROC-153`'s fix sat pushed, green and
unvalidated in `validating` for **15.8 days** with no tester ever dispatched.

**`loop-gate` had the right words the whole time** — *"THIS DEPTH IS OCCUPANCY, NOT ACTIVITY … those
slots are NOT capacity in use"* — and the hook never asked it. Two controls in one system, one of
which knew, and no path between them.

## Why this is a family and not an incident — three more in the same cycle

1. **`DEF-ROC-068` — the probe re-observed the symptom and could never test the premise.** Parked
   18 days as *"not ours to patch"*. Its probe ran the REAL `npm audit` every cycle (deliberately,
   so a fix by any route would be seen) and correctly reported STILL BLOCKED every single time. The
   thing that was false was the ATTRIBUTION — `flowbite-react` was our own direct dependency all
   along — and no probe that re-runs the audit can falsify that. The park's premise was never
   checked because the probe kept answering a different question, truthfully.

2. **`DEF-ROC-153` — a gate that died read the same as a gate that passed.** A third party moved a
   floating `v1` tag onto a commit whose `action.yml` GitHub refuses to load; the engineering exit
   gate job died in **19 seconds** having reached no verdict. Absent a duration or verdict-line
   check, "no failure reported" is indistinguishable from "passed".

3. **`DEF-ROC-166` — ancestry is not a done-check.** Its `fixed` ref `29661dd` **is** an ancestor of
   `origin/main`; so is `ce4d7e1`, its own revert twelve minutes later. `closedGuidanceText` appears
   nowhere in `src/dashboard` at HEAD and the ten tests the `fixed` note cites do not exist. One
   revert in the last 200 commits on this trunk — and it produced a false green, a 100% hit rate on
   the only occasion the class could fire. `loop-gate`'s four-outcome `ref:` resolution inherits this
   directly.

## The generalised rule

**A control may not read the symptom of the failure it guards against as evidence of health.**

Wherever a check answers *"is it fine?"* by measuring a quantity that ALSO rises when things go
wrong, re-express it against the thing it actually cares about:

| the check measured | it must measure |
|---|---|
| queue depth | **activity** — has this slot recorded anything |
| ref ancestry | **effect** — do the ref's changes survive in the tree |
| the advisory is still present | **the premise** — is it still true that we cannot fix it |
| the job did not report failure | **the verdict** — did it reach one, and how long did it run |

CLAUDE.md already carries the neighbouring half of this (*"wherever absence is treated as evidence,
ask whether the thing still exists on the reference side"*, `DEFECT-OAG-142`). This is its mirror:
wherever PRESENCE or a COUNT is treated as evidence, ask whether that quantity also grows in the
failure case.

## The compounding failure, which is the part to actually fix

The loop-uptime gap was **recorded as a principle failure on 2026-08-24**
(`a-constraint-movement-quoted-without-loop-uptime`, OagEventSource: 60.9h of downtime accounting
for 72% of that constraint's median) and **left as prose**. Three weeks later the same blindness
cost ROC 14.1 quiet days and made this retro's constraint reading unattributable in exactly the way
that entry predicted.

**A recorded root cause that is left un-mechanised does not stay the same size.** 60.9 hours became
14.1 days. The mechanism was cheap the whole time — `make loop-uptime` needs no new recording,
because the item event logs already carried every timestamp it reads.

This is the third entry in this register about a root cause recorded and not acted on (with
`2026-08-27-a-root-cause-recorded-three-times-and-left-is-now-the-number-2-time-thief`). The pattern
is now strong enough to bind: **a principle-failure entry whose remedy is a mechanism must name the
mechanism and the retro that will land it, or it is a note, not a remedy.**

## Fixed / routed

- `.claude/hooks/loop-continue.mjs` — capacity measured on ACTIVITY, not depth; idle slots block the
  stop in their own right; fails open and bounded; discloses when activity cannot be established.
- `.claude/tools/loop-uptime.js` + `make loop-uptime` — read before quoting any constraint movement.
- `EXP-ROC-019` scores it. `EXP-ROC-016` deleted as superseded by its own rewrite.
- Still OPEN and routed to the loop, not fixed here: the ancestry false-green (an establishment gate
  must test effect, not ancestry) and `_compute_quality` counting non-verdict exits (`cancelled`,
  `blocked`) in the `validating` denominator, which makes a stage's failure rate fall when work is
  cancelled out of it.
