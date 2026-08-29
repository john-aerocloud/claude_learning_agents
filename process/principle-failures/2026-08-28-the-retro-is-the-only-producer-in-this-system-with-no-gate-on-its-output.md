# The retro is the only producer in this system with no gate on its output

**Date:** 2026-08-28 · **Project:** ROC · **Found at:** the v157 retro, walking the
Theory-of-Constraints loop on the default focus question.

Opened under process §5b — *a recurring root cause opens a `principle-failures/` entry
even when nothing "failed"*. Nothing failed today. What happened is that the sixth
consecutive retro read the same constraint, and this one finally asked why the previous
five retros' fixes had not moved it.

## The answer, measured three ways in one cycle

**1. The retro's fold-back did not happen, three retros running.**
`instance/ROC` is **12 commits and 37.4 hours** ahead of `main`. Step 8a is mandatory and
every one of v155, v156 and v157's predecessors recorded it as done. Reconcile latency:
**20.6h (v155) → 23.3h (v156) → 37.4h (v157)**, rising monotonically. And the integration
tree was **CLEAN** the whole time — `git status --porcelain` returns nothing — so
`make project-foldback PROJECT=ROC` would have exited 0 on every one of those occasions.
One command, no judgement, no conflict. Nothing checked whether it ran.

**2. The retro's improvement slices are not built, and one was being SCORED unbuilt.**
33 files in `process/improvement-slices/`; **eight carry no `**Status:**` line at all**;
several say QUEUED and have since 2026-06-06. `IMP-033`, opened by the **v150** retro on
2026-08-24 as the exploit move for a constraint that had held for five reads, has its
mechanism — `park_remedy` — in **zero lines of `work-items.py` and on zero items**. Four
days. Meanwhile `EXP-ROC-004` sat at **strike 1 of 3**, being scored against it.

That last part is the sharpest edge, and it is worse than waste. A row scored against a
mechanism that does not exist burns its three-strike budget and is then archived as *"no
measurable effect"* — **a false negative, which is worse than having no row: it retires
the hypothesis AND records a reason that is not true.** The registry would have ended up
asserting that declaring a park's remedy does not help, having never once declared one.

**3. The rule the LAST retro wrote was honoured 9/9 and the metric still went backwards.**
This is the one that changes how the whole class should be read. §F9b (*a finding is
registered WITH its triage decision, in the same act*) was obeyed by every single finding:
nine defects registered since the v156 close, nine decisions, each in the **same commit**
that created the item file — verified with `git log -S defer_until`, not from the item
text, which carries no timestamp for a frontmatter scalar.

And `orchestrator`/`reported` rose from **29.78% to 31.32%** of gross lead time, its median
from **8.7h to 13.0h per item**, and it took over from `external` as the **#1** contributor.

**Six of the nine decisions were the identical `defer_until: 2026-08-28`, written in one
batch, expiring inside thirteen hours.** Every one of them was back in front of the gate
by morning.

## The chain

1. `orchestrator`/`reported` is the #1 GLT owner — 31.32%, median 13.0h, n=105, backfill
   0.00% (so §17f permits naming it).
2. v156 identified the cause correctly (the allowlist makes the orchestrator a mandatory
   serialisation point for the first transition of every defect) and routed two remedies.
3. Both remedies were **prose**. §F9a's implementing item `DEF-ROC-128` is unbuilt. §F9b
   is a sentence in `process-current.md`.
4. §F9b *was* obeyed — so this is not the usual "documented obligations are skipped". It
   is one layer down: **the obligation was honoured and the system still measured whether
   a decision EXISTED, never whether anything MOVED.** The cheapest legal decision was a
   defer to tomorrow, so a defer to tomorrow is what six of nine got.
5. **ROOT CAUSE: every producer in this system is gated except the one that writes the
   gates.** Every item transition is edge-checked; every test must name its criterion;
   every park must carry a re-checkable probe; every deploy must show its job's `needs`
   closure. The retro's own outputs — a fold-back, an improvement slice, a rule — are
   checked by nothing, so they are the only outputs that can quietly not happen. That is
   why the constraint survived five retros that each correctly identified it.

## What is new here, versus v156's entry

v156 concluded *"a root cause recorded and left is not documentation, it is a decision to
keep paying"*, and *"prose in an event log is not a mechanism"*. Correct — and it then
routed its own remedy as prose. This entry is not a repeat of that. It is the finding that
**a mechanised rule can also fail, when the mechanism checks compliance instead of effect.**
§F9b's compliance was perfect and its effect was negative. A control that can be satisfied
without achieving its purpose is this project's most-registered failure family, and it has
now appeared *inside the fix for that family*.

## Routed (v157)

- **`loop-gate` check 17 `undecided-arrival`** — §F9b at the CYCLE clock, where check 4's
  is seven days. Blocks; the cheapest remedy stays a dated defer, never a close (§F8a).
- **`_defer_is_decision` — a minimum defer horizon** — a defer under `DEFAULT_MAX_BACKLOG_
  AGE_DAYS` in the future is not a decision, because that is the window the gate already
  grants for free, so it decides nothing. Measured from `now`, not from queue entry: the
  first version measured from entry and therefore did nothing about an aged item snoozed
  daily. Folded into `EXP-ROC-009` rather than opened as a new row — same hypothesis, now
  with teeth.
- **`loop-gate` check 18 `reconcile-latency`** — §0a Rule 4, mechanised. Blocks when the
  integration tree is clean (the remedy is one command), advisory when it is dirty
  (blocking on an unavailable remedy is the `DEF-ROC-083` failure).
- **`loop-gate` check 19 `retro-output-unbuilt`** — an open improvement slice cited by an
  active registry row this project owns. Advisory for another project's rows: §25a
  (v143/v145) gives a retro no standing over those. Found `IMP-033` on its first live run.
- **`EXP-ROC-004` PAUSED at 0/3, not scored and not retired**, with a resume condition, so
  nothing untrue is recorded about a hypothesis that was never tested.
- Registered as **`EXP-ROC-012`**, scored on reconcile latency and on the counts — never
  on whether the limbs exist.

## The generalisable lesson

**Ask of every control not only "did the rule fire" but "did the quantity move" — and
where they disagree, believe the quantity and go looking for the cheapest legal way to
satisfy the rule, because that is what will be happening.** §F9b was obeyed nine times out
of nine by six identical one-day defers. Compliance was the metric that lied.
