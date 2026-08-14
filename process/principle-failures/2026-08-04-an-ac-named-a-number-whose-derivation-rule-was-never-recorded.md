# An acceptance criterion named a load-bearing number whose DERIVATION RULE was never recorded

**Date** 2026-08-04 · **Agent** solution-architect · **Cost** one rework cycle on an item that
blocks a slice's `done` report · **Instance** `AC-BPC1.7` ("the 285-physical-flight collapse is
re-derived from the live store")

## What happened

An architecture delta measured a figure — **579 born-mid-lifecycle streams collapse to 285 distinct
physical flights via codeshare clustering** — and used it to make a real argument (*"state the
physical count alongside the stream count or the impact reads 7× high"*). The figure was committed
as evidence, so it looked discharged: `docs/evidence/…json` carries
`"distinct_physical_flights": 285` plus a full cluster-size histogram.

It then became an acceptance criterion on the item chartered to make the delta's numbers
re-runnable. The engineer implemented nine of ten criteria and left this one **entirely absent** —
no code, no comment. The tester found it absent and escalated it as a posture conflict (computing a
codeshare collapse appears to require identity/route leaves the corpus deliberately excludes).

**The real cause was neither.** Going looking for the clustering rule at ruling time: **it does not
exist anywhere.** Not in the delta, not in the evidence `_capture.method`, not in a comment. So
"re-derive the 285" was never a well-formed instruction — there was nothing to re-derive it
*against*. Any implementation would have produced a *different* number under a *new* rule, and the
AC would have been scored on a coincidence. The figure was **never reproducible by anyone,
including its author**, from the moment it was written.

## The principle violated

§17c.4 — *no load-bearing measurement may exist only as prose.* The letter was satisfied (evidence
committed, referenced, dated) and the spirit was not.

> **Committing the RESULT is not committing the MEASUREMENT.** A committed number with no recorded
> derivation rule is prose with a JSON file around it. It is *less* honest than a bare prose figure,
> because the evidence file signals reproducibility that does not exist.

Three sibling figures in the same delta were fine only by luck — their rules happened to be
recoverable from committed code (`STATE_FROM_PROGRESSION`, the four `actual.*` booleans). The
distinguishing property is not "was evidence committed" but **"is the rule recoverable".**

## The cure — executable, not a resolution

Applied in `architecture/deltas/058-uc-bpc1-acceptance-rerulings.md`:

1. **A delta that quotes a derived figure states the derivation rule in the same sentence.** If the
   rule will not fit, the figure is not ready to be quoted.
2. **The rule travels WITH the number, in the artefact.** delta-058 §13 requires
   `codeshareCollapse.clusteringKeyRule` and `DECLARED_PREFIX_FLOORS[].provenance` to be quoted
   *into* the emitted snapshot. A reader of the number cannot fail to find the rule, so this failure
   is designed out rather than fixed once.
3. **An AC may not name an integer measured over an OPEN population.** The sibling half of the same
   rejection: `444/45/36` were written as reproductions over a population growing 1–20/day, so the
   AC would have gone red on its own success. Such ACs are FLOORS with a declared, provenanced
   constant and a named owner for every downward movement.
4. **An AC must be readable from a NAMED FIELD of the artefact it governs.** Three criteria were
   satisfiable only by a human re-deriving a cross-tab by hand — the same defect one level up.

## Generalisation for other agents

When you write down a number, ask which of the two things you are committing: the **observation**
(this value, at this time, from this store) or the **measurement** (the function that would produce
it again). An observation is only ever evidence *for* an argument. Only a measurement can become an
acceptance criterion, a gate, or a ratchet — and it becomes one by shipping the function, not the
value.
