# A probe's scope note became a permanent product exclusion, and a counter called it healthy

**Date:** 2026-08-13
**Project:** OagEventSource
**Founding defects:** `DEFECT-OAG-107` (the instance), `DEFECT-OAG-110` (the class)
**Owner of the gap:** solution-architect (the ruling), engineer (the sweep)

---

## What happened

Unscheduled and general-aviation flights touching our three gated airports have **never** reached
consumers. At SRQ that is **29.8% of departures and 31.2% of arrivals** — nearly a third of the
airport's real traffic. TPA loses 7.2%/7.9%, RSW 5.1%/5.8%. **57 ICAO-only carriers plus 21
IATA-holding ones** — AA, DL, UA, WN, BA, B6, F9, G4, WS, and freight FX and 5X — so this is not a
small-charter niche; it is extra sections, ferry and freighter legs on major carriers.

Nobody decided this. When the owner was finally asked, they ruled in one sentence that these flights
**must come through**.

## The mechanism

A record with no `scheduleInstanceKey` cannot form a stream, because that key **is** our stream
identity. `rest-to-alert-shape-adapter.ts` returns `[]` for such a record and `normalise-rest.ts`
turns that into `{events: [], skipped: 1, skipReason: 'no_schedule_key'}`.

That is a defensible engineering behaviour. **The defect is what we called it.** In four separate
places the excluded population is named a *"benign GA/Unscheduled degenerate sample"*, and
`normalise-rest.ts:11` sources the exclusion to *"probe §E — out of scope"*.

Two moves, and both are the failure:

1. **A PROBE's scope note became PRODUCTION scope.** "Out of scope" in a probe means *I am not
   looking at these right now*. It was frozen into shipping code as *we do not carry these*. A
   diagnosis-time convenience silently became a product decision about what our customers receive.
2. **"Benign" is a HEALTH VERDICT on a population nobody had authority to exclude.** So the skip
   counter counts up forever and **nothing can ever go red**. The instrument that would have found
   this was built, wired, and pre-declared as reporting good news.

## Why no gate caught it

- **The solution-architect gate never saw it.** *Which population of the source we admit* is a
  CONTRACT decision — the identical class as `AC-110.3` (stream identity for a keyless record),
  which this very defect correctly routes to the architect and forbids an engineer to author. The
  exclusion was authored by an engineer, in a comment, with no ruling behind it. **We had the rule
  for the key and not for the population**, though both decide what a consumer receives.
- **The tester could not have caught it.** Validation exercises what arrives. Nothing compares what
  we admitted against what the source **holds**. "Non-emptiness is not coverage" is already on this
  project's record; this is that lesson on the ingest boundary rather than the test suite.

## THE SHARPEST PART — we already stood on this exact spot and swept too narrowly

`DEFECT-OAG-055` went to **this counter**, in **this file**, and wrote in its own source comment:

> *"A diversion recovery hiding inside a counter that reads '8 GA records skipped' is the
> silent-suppression family this project has been bitten by repeatedly."*

It named the family. It then **split irregular-ops out of the benign count and stopped** — fixing
the one population it had come to look at, and leaving the *"benign"* verdict standing over
everything else in the bucket. The label survived the one review that recognised it as dangerous.

That is precisely the miss **§17g's generalisation-sweep ledger** exists to prevent, and §17g was
introduced at **v138 — after DEFECT-OAG-055**. So this is not a new class; it is a **pre-§17g
instance surfacing after the remedy existed**, which is the honest reading and is why the remedy
below is a *gate*, not another rule telling agents to generalise.

## The correction that must not be lost

"One defect, not two" is **TRUE** about ICAO-versus-keyless and **FALSE** about the two lanes:

| lane | who is at fault | fix |
|---|---|---|
| **REST** | ours — we drop what OAG sends | keyless stream identity (`AC-110.3`) |
| **Event Hub (PRIMARY, the only lane with deployed compute)** | supplier — OAG has never sent one | flip `unscheduledFlights` + `gaFlights` on the subscription |

Prod holds **57,206** `OagFlightCreated` genesis events with `generalAviation` TRUE on **zero**, and
the live alert config carries **no** `unscheduledFlights` and **no** `gaFlights` key at all — so both
sit at OAG's default and the default **excludes**. The identical shape to `codeshare: false`
suppressing every marketing leg upstream until it was flipped.

**A perfect identity fix delivers nothing on the primary lane until the flags are flipped, and the
flags deliver nothing without the identity fix.** Both required; neither sufficient.

## The rule this produces

**§17h — an exclusion needs an authority, and a counter may not pre-judge its population healthy.**
See `process-current.md` §17h and `EXP-135`.
