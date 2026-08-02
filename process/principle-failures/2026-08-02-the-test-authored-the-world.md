# 2026-08-02 — The test authored the world, so it could only confirm the code

**Class:** recurring root cause — THREE independent instances in a single session.
**Project:** OagEventSource (v127). **Owner:** engineer + tester, with the process gap
mine. **Trigger:** human-requested retro.

## The ruling

Verbatim, and it is the specification, not a comment:

> "A test was written to match the code. I do not care AT ALL about code coverage. The ONLY
> thing tests should be validating is the requirements. If we are making up tests for
> coverage that do not map onto requirements then either (a) we are wasting time, or (b) we
> have identified a new acceptance criteria and we need to retro as to why it wasn't
> discovered earlier."

## The three instances

**1. The founding case — a real capture, mutated until it agreed with the code.**
`uc-hf041-cancellation-recovery.test.ts` built its "pre-fix stream" by re-ingesting a REAL
captured record **with `statusDetails[].state` deleted** — precisely the leaf whose presence
breaks the heal. Three sibling tests hand-set `{state: 'Cancelled'}` and asserted
suppression. **2,171 tests green.** Meanwhile nine real cancellations sat unhealed in prod on
the passenger-facing feed — nine codeshare siblings of one physical RSW→JFK flight, including
the class of flight a customer reported to us as stuck showing "scheduled". The test did not
merely fail to catch the bug; it encoded the bug's own assumption as its fixture.

**2. A stub across the seam under test.** The `awaiting_observation` probe test stubbed
`subprocess.run`. In the engineer's own words it "only proved the mapping agreed with
itself". Driven against a real `make`, every probe read BROKEN — because `make` does not
propagate a recipe's exit status, so the three-way exit-code contract it was asserting is not
expressible through `make` at all. The unit test could never have discovered that.

**3. Declared, not proven.** The provenance ledger's `read` dispositions were assertions in a
table. When the census tested them **differentially against `normalise()`** — remove the
path, does the emitted batch change? — **8 of the engineer's own claims were false.**

## Why-chain

1. **Why did a green suite coexist with a live prod defect?** Because the tests asserted
   properties of inputs we wrote, not of inputs reality writes.
2. **Why were the inputs ours?** Because constructing a prior by hand is easier than
   harvesting one, and nothing forbade it — the corpus reader existed but using it was
   optional.
3. **Why did nobody notice the fixture had been mutated into agreement?** Because a test is
   accepted if it is green and plausible. There is no artefact tying a test to the
   requirement it exists to defend, so "why does this test exist?" has no checkable answer
   and coverage silently becomes the goal.
4. **Why has this survived §17c?** §17c bound *capabilities* to observation. It did not bind
   *tests* to requirements — so the suite remained the one place where authoring the world
   was still permitted, and it is precisely the place that certifies everything else.

**Root cause:** a test whose input we authored cannot come back negative about reality. It is
§17c Layer 1 with the suite as the blind spot.

## My own contribution, unsoftened

I twice asserted that `body.changes[]` explained both the 644 unforecast collateral writes and
the nine missing cancellations, and briefed an engineer on it. The architect refuted it
structurally: **both are REST-seeded paths that carry no `changes[]` at all.** I had reasoned
from "we ignore data OAG sends us" to "that explains the symptom" without checking whether the
field is even present on the failing path. It cost nothing only by luck — the engineer already
had the real cause from the records before my correction arrived. Same shape as the tests: a
claim that felt established because nothing had contradicted it.

## Remedy — executable, per §17c.5

**§17d** (new, binding) plus **EXP-124**: a two-limb gate. Limb 1 — every test declares the
`AC-<ID>.<n>` it validates; an untagged test is forced to a binary choice, waste (delete) or
undiscovered acceptance criterion (register + discovery retro). Limb 2 — a precondition may
not be AUTHORED; a prior built by mutating a real capture is flagged, and must instead be
folded from events or harvested. Falsification is deliberately set against the easy way out:
**satisfying the baseline by mass-tagging counts as FAILED**, because that reproduces the
coverage theatre the ruling rejects.

Related: `2026-07-31-green-test-process-proved-nothing-about-real-data.md` (§17c Layer 1,
of which this is the suite-level instance), `2026-08-01-loop-obligations-as-judgement-are-skipped.md`
(the mechanised-vs-documented pattern this remedy follows).
