/**
 * PROOF-OF-FIRE SEED — NOT A TEST. The CORRECTED counterpart, recovered verbatim from
 * work/OagEventSource @ 4e76014 (`fix(cancelled): heal a flight BORN cancelled`).
 *
 * Every prior here is FOLDED FROM DERIVED EVENTS — `foldAggregate(normalise(...))` — so
 * nothing about the world is authored. This file must scan CLEAN under limb 2. If it
 * does not, the gate cannot distinguish the fix from the bug and is worthless: it would
 * simply be measuring how much code a test file contains.
 *
 * The one line deliberately left out of this fixture is the mixed-vintage case
 *   `const mixedVintage = { ...afterEmission, state: spelling } as FlightAggregate`
 * which the gate DOES flag (spread-override on a corpus-derived value). That is a true
 * positive, not a false one — the aggregate it builds is one no fold produces — and it
 * belongs in the committed allowlist with its reason, which is where it now lives.
 */
import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'

function cancelledRecordFromCorpus(): { record: RestFlightRecord; rawState: string } {
  const hit = readConfirmingRecords().find((r) => isCancelled(r))!
  return { record: hit, rawState: rawStateOf(hit) }
}

/** The genesis of the real cancelled record: `state` seeded, NO cancellation emitted. */
function bornCancelledPrior(): { prior: FlightAggregate; genesis: CanonicalEnvelope[] } {
  const { record } = cancelledRecordFromCorpus()
  const genesis = normalise(restRecordToFlightStatusBodies(record)[0]!.body, null)
  const prior = foldAggregate(genesis)
  return { prior: prior!, genesis }
}

describe('DEFECT-OAG-041 — a cancellation from real OAG data emits OagFlightCancelled', () => {
  it('AC-041.9 a BORN-CANCELLED prior (state seeded, nothing emitted) DOES emit the heal', () => {
    const { record } = cancelledRecordFromCorpus()
    const body = restRecordToFlightStatusBodies(record).at(-1)!.body
    const { prior } = bornCancelledPrior()
    expect(readCoarseState(prior.state ?? null).canonical).toBe(CANONICAL_CANCELLED)
    expect(prior.cancellationEmitted).toBe(false)
    const types = normalise(body, prior).map((e) => e.metadata.eventType)
    expect(types).toContain(CanonicalEventType.FlightCancelled)
  })

  it('AC-041.9 is emitted ONCE — once the cancellation IS on the stream, a re-delivery is a no-op', () => {
    const { record } = cancelledRecordFromCorpus()
    const body = restRecordToFlightStatusBodies(record).at(-1)!.body
    const { prior, genesis } = bornCancelledPrior()
    const healed = normalise(body, prior)
    expect(healed.map((e) => e.metadata.eventType)).toContain(CanonicalEventType.FlightCancelled)

    const afterEmission = foldAggregate([...genesis, ...healed])!
    expect(afterEmission.cancellationEmitted).toBe(true)
    const again = normalise(body, afterEmission).map((e) => e.metadata.eventType)
    expect(again).not.toContain(CanonicalEventType.FlightCancelled)
  })
})
