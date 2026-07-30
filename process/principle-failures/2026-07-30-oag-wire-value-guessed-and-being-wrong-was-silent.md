# We compared against a hand-typed guess at an external wire value, and being wrong produced SILENCE

**Date:** 2026-07-30 · **Project:** OagEventSource · **Items:** DEFECT-OAG-041, DEFECT-OAG-042
(+ two known-unexploded instances of the same class)
**Principle:** "TDD + a green suite + live journey validation makes a change correct."
**DORA metric harmed:** change_failure_rate (two escaped defects, one of which had NEVER
worked in the entire life of the system), secondarily mttr (5.3M-row archaeology to find them).

## Expected
A canonical event handler with a red→green TDD test, a passing 1500-test suite, a live
end-to-end validation on the real feed, and a per-slice architecture gate would not ship a
transformation that silently never fires.

## Actual — two defects, ONE failure mode
Both are the same failure, not two lessons: **code was compared against a hand-typed guess at
a value/field owned by an external wire, and the guess being wrong produced silence rather than
an error.**

- **DEFECT-OAG-041.** OAG sends the coarse state `Canceled` (US spelling, one `l`). The handler
  tested `=== 'Cancelled'` (UK). Result: **0 `OagFlightCancelled` across 5,308,984 dev and
  5,210,600 prod events** — the event type had never fired once since the system existed. The
  handler's own docstring asserted the value was "corpus-confirmed". It was not. The only four
  occurrences of the UK spelling anywhere in the repository were **our own test expectations**,
  so the handler passed its own tests forever while never working on real data. An unmapped
  coarse state was a **no-op**, not an error, so there was nothing to observe.
- **DEFECT-OAG-042.** `departure.scheduledTimeUtc` was never read from a FlightStatus body at
  all: `buildGenesisDelta` read `times.estimated.*` and `times.actual.*` and never
  `times.scheduled`, although **all 109 captured real status bodies carry it**. 78% of flights
  had no departure time; entire airlines were invisible on departures boards. A field never read
  raises nothing. (Diagnosis also falsified the reported hypothesis — the carrier correlation was
  the coincidence rate of two independent feeds landing on one key, nothing to do with RSW or
  Southwest.)
- **Already-known, unexploded, same class:** `irregularOperationType === 'Recovery'` appears in
  **zero** captures, so the genesis `recovery` boolean has silently always been `false`; and
  `diversion`/`diversionType` is likewise unvalidated against any real capture — a diverted
  flight looks normal.

## Why the existing gates could not hold
Every gate in the loop consulted **our declaration of the wire contract, never the wire**:

| Gate | Why it passed a never-firing handler |
|---|---|
| engineer TDD (red→green) | the test asserts our guessed literal; red→green proves the code agrees with the guess. A self-consistent pair of wrong things is green. |
| unit/component/adapter suites | same guess, same source. 1,525 green tests contained the bug four times over. |
| tester live/journey validation (EXP-115) | validates that the journey WORKS end-to-end. It never asked "did every event type we can emit actually emit over real traffic?" — an output type with 0 occurrences is indistinguishable from a quiet day. |
| solution-architect gate | reviews the shape of the seam, not the vocabulary crossing it. |
| code review / docstrings | the docstring CLAIMED corpus-confirmation. Prose cannot be false-checked. |

The generalisable property: **for an inbound wire value, "wrong" is not an exception — it is a
branch that never runs or a field never read.** No test, type-checker, or live smoke that
consults only in-repo artifacts can see it, because the discriminating fact lives outside the
repo. The failure was not carelessness about spelling; it was that nothing in the process was
required to compare a claim about external data against real external data.

## Seed of the fix (already built, by the engineer, during the two fixes)
Two executable provenance ledgers now exist and are committed:
`work/OagEventSource/src/app/tests/defect-oag-041-wire-literal-provenance.test.ts` (every
claimed-confirmed wire literal must be PRESENT as a value for that key in a real capture; every
declared-unverified literal must still be ABSENT) and
`.../defect-oag-042-wire-field-provenance.test.ts` (each canonical leaf's declared OAG source
path must be present in ≥1 real capture AND actually populate that leaf when the capture is fed
through the real read path; plus a zone-shape ledger). Both read the committed corpus at
`work/OagEventSource/fixtures/`. **The 042 ledger would have failed this defect on day one.**

Known holes in the seed, which is why generalising it is a process change and not a copy-paste:
1. **Completeness is not enforced.** The declarations are hand-maintained inline `const` arrays
   inside the test files, linked to production code by a free-text `comparedIn` string. A literal
   added to production code with NO ledger entry is not detected — the guard only catches an
   entry that becomes false.
2. **Corpus soundness.** The 041 sweep indexes ALL of `fixtures/`, including derived/synthetic
   fixtures, so a literal can be "confirmed" by a fixture we authored ourselves.
3. **No refresh path.** The corpus is grown by a self-described throwaway script
   (`spike/capture.mjs`) plus manual curation of a prod S3 capture bucket. There is no committed
   `make` target, so the corpus silently ages.
4. **Offline can only ever see what we already captured** — the live probes
   (`make probe-rest-coarse-state`, `make audit-scheduled-departure-time`) are the other half.

## Guidance for next time
When a value or field crossing an external boundary is compared, parsed or mapped, the claim
"this is what the wire sends" is a **testable assertion against captured real traffic**, not a
comment. Declare it, and let the build fail when the declaration is false OR missing. And for
any type the system can EMIT, a zero-occurrence count over real traffic is a defect signal, not
silence — assert liveness of every output branch over the real corpus.

Routed at the v123 retro as **EXP-120** (target: change-failure rate), with the completeness,
corpus-soundness and refresh holes above as explicit parts of its measure.
