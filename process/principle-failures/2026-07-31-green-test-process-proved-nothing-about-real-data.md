# 2026-07-31 — A green test process proved nothing about whether the system works on real data

**Project:** OagEventSource. **Raised by:** the human, unprompted by any gate.
**Class:** systemic — five instances, four recurrences of a gate that exists to catch this.
**Process response:** v125 §17c (new global rule), §12d obligation 3, EXP-122 (EXP-106 superseded), IMP-028.

## The human's words

> "most importantly we need to do a retro on the test process for this project as this is a disastrous
> fail that is a larger pattern. We have shipped a thing, we have thousands of events and we have not
> used real events to demonstrate that things work"

## What happened

Five capabilities were declared `done`/`validated`, passed an 1,804-case green suite, and had **never
once worked on real data**:

| # | Capability | Reality |
|---|---|---|
| 1 | `OagFlightCancelled` | **0 of 10,519,584** prod+dev events. OAG sends `Canceled` (US); we compared `Cancelled` (UK). The handler docstring claimed the value was "corpus-confirmed"; the only 4 occurrences of the UK spelling anywhere in the repo were **our own test expectations**. |
| 2 | `departure.scheduledTimeUtc` | **78% null.** `buildGenesisDelta` read `times.estimated.*`/`times.actual.*` and never `times.scheduled` — though **all 109** real captures carry it. Entire airlines invisible on departures boards. |
| 3 | `irregularOperationType === 'Recovery'` | **0 captures.** `recovery` has silently always been `false`. |
| 4 | `OagFlightDiverted` | **0 of 5,300,655** prod events. The doubt was **already recorded** in architecture delta `029-slc028-…` (2026-06-26) — our nested `body.diversion.airport` may not match OAG's documented root `irregularOperationType` + flat `diversionAirport` — and closed with *"re-verify when a real diversion is first captured."* Never actioned. |
| 5 | `deriveAirports()` | Derives `metadata.airports` from departure + arrival **only**. A diversion must reach **three** airports; the diversion airport is never in the routing key, and every consumer fan-out rule filters on that key. Armed but unexploded — no consumer sets `airports:` yet, so the first airport-scoped consumer detonates it. |

**None was found by a test.** Instances 1, 2, 4 and 5 were found by ad-hoc production queries the
orchestrator ran **only because a human challenged a reported flights-per-day figure ~3× reality**;
instance 5 by reading code. Nothing in the process prompted any of it.

## Root cause — two layers

**Layer 1: we only ever ran one direction.** Every test is `code → expectation` over inputs *we*
authored — an EXISTENCE proof ("there is an example where this works"). Every failure above is a
UNIVERSAL property over inputs reality authors and outputs we declare. Absence — a type that never
fires, a leaf never populated, a branch never taken, a party never routed to — cannot be detected by
an existence proof. Three inverse questions were never asked: **D1** has reality ever produced this
output? **D2** does our code read what reality sends? **D3** did the passing gate read the shipped
bytes?

This is **not** an access problem, and that correction matters: we hold ~10.5M real prod events and
109 real captures, and `times.scheduled` was in every one of them. **Reality was already in the repo,
unexamined.** The missing thing was an invariant quantified over it.

**Layer 2: the load-bearing claim lives in prose, where it cannot be false.** Every instance is a claim
asserted in a docstring or comment rather than in code:
- a handler docstring claiming a literal was "corpus-confirmed" — it was not;
- a provenance ledger whose docstring says it sweeps the whole **real** capture corpus, while it
  recursively walks all 132 `.json` under `fixtures/` including 4 hand-authored `synthetic/`, 11
  derived fixtures, 2 vendor doc samples and a config dump;
- a prod smoke whose safety comment claimed "no real consumer is fanned out to" — false, and it had
  **rotted**: the premise was true when written, real consumers were onboarded later, nothing
  re-checked it, and two runs left synthetic streams in an external consumer's live prod DLQ;
- a scope declaration citing a **1,160,377-row prod scan that exists only as a docstring**, with no
  committed script — the load-bearing measurement is unreproducible;
- an architecture delta saying "re-verify when a real diversion is first captured".

**And the proof of Layer 2: the previous day's remedy for this very class is itself prose.** v123 wrote
§17b and stated explicitly that "the fix is NOT another prose rule; it is making the claim executable."
One day later: **`make wire-provenance` does not exist**; the `_capture`/`_provenance` markers sit on
115 files that **no gate reads**; the directory filter that fixes the corpus sweep already exists in
the sibling field ledger and was never back-ported; `diversionType` carries no declaration at all.
A remedy written as prose reproduces the defect it was written for.

## Which step should have caught it, and why it did not

- **engineer / TDD** — red→green proves the code agrees with the fixture. When both encode the same
  wrong assumption the pair is self-consistent and green.
- **the suites** — 1,804 unit cases against 48 integration cases; exactly **one** file in the whole
  corpus is a real prod event-store read.
- **tester live validation** — asks "does the journey work?", never "did every type we can emit
  actually occur?" Zero occurrences is indistinguishable from a quiet day unless someone counts.
- **§12d / EXP-106 (the CORE-job done-gate, whose entire purpose is this)** — runs at slice **close**,
  when the capability has had no opportunity to occur, so the discriminating evidence does not yet
  exist. Blind by construction; 4th recurrence; its enforcement half (IMP-011's I5) never landed.
- **CI topology** — `infra.yml` is the only deploy lane, depends on `ci.yml` not at all, and never runs
  the full unit suite. Prod can deploy with the suite and the bundle-diff gate both red.
- **standing gates** — `make render-diagrams` red for ~20 days because it runs in no workflow;
  `make test-fids-integration` times out in its own 300s `beforeAll`. A gate nobody believes.

## The fix

§17c: **nothing is established until it has been observed in a state that could have come back
negative.** A capability is not `done` until observed working on data the system did not author
(else `awaiting_observation`); **a gate is not a gate until it has been observed going RED**
(proof-of-fire); a control asserted in a comment is not a control, and an environmental premise rots;
a number needs a committed re-runnable query behind it; and the rule binds the retro itself — each fix
is executable now or a registered item whose acceptance is the gate firing.

Mechanism: **IMP-028**, the real-data conformance census — provenance made unfakeable, then D1/D2 over
the real store as a committed diffable snapshot, then a real exemplar per type **and per sequence**,
rare branches judged by expected-rate × exposure, refreshed on a cadence or failing.

Counter-evidence for the strategy, from the same day: a **dry-run against real REST data** for
TPA/RSW/SRQ over 28 days falsified a work item's own stated premise in a single pass — 1,005 events
would be written rather than the 361 predicted, 644 (64%) unforecast collateral field-diffs, **274
historical flights minted into prod as if new**, and a retention-based residual fabricated from an
un-measured horizon. Reasoning, review and a green suite found none of it. Running it against real
data found all of it, immediately.

## Owner of the gap

The five defects belong to the delivery roles. **The absence of any mechanism that would have asked
belongs to the orchestrator** — the process is what that seat owns, and the queries that found four of
the five instances were prompted by a human's challenge, not by anything in the process.
