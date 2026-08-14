/**
 * PROOF-OF-FIRE SEED — NOT A TEST. This file is never executed; it is scanned.
 *
 * The founding evidence for limb 2, recovered VERBATIM from git history so the gate
 * is fired against the real shape and not against a shape invented to suit it:
 *
 *  A. `seedPreFixStream` — work/OagEventSource/src/app/tests/
 *     uc-hf041-cancellation-recovery.test.ts, still on trunk at 4e76014. It builds the
 *     "pre-fix stream" by re-ingesting the REAL captured record with
 *     `statusDetails[].state` DELETED — precisely the leaf whose presence breaks the
 *     heal. 2,171 tests green; nine real cancellations silently unhealed in prod.
 *
 *  B. `priorAlreadyCancelled` / `legacyPrior` — the same repo at 4e76014^,
 *     defect-oag-041-coarse-state.test.ts lines 194-206. A folded field hand-set on an
 *     object literal cast to the aggregate: a prior that CANNOT arise from a stream
 *     which emitted a cancellation and CAN arise from one that never did. It asserted
 *     the wrong fact and stayed green.
 *
 * The corrected shapes are in hf041-corrected-folded-prior.fixture.ts and must scan
 * CLEAN — a gate that cannot tell the fix from the bug is not a gate.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FIXTURES_ROOT = resolve(__dirname, '../../../../fixtures')

const CAPTURE = JSON.parse(
  readFileSync(resolve(FIXTURES_ROOT, 'oag-rest/2026-06-23-probe.json'), 'utf-8'),
) as RestCapture

const CAPTURED_RECORDS: readonly RestFlightRecord[] = CAPTURE.data ?? []

const CAPTURED_CANCELLED: RestFlightRecord = ((): RestFlightRecord => {
  const hits = CAPTURED_RECORDS.filter(
    (r) => currentCoarseStateOf(r).canonical === CANONICAL_CANCELLED,
  )
  return hits[0]!
})()

/** Deep-clone a captured record so no test can dedup on object identity. */
function freshCopy(r: RestFlightRecord): RestFlightRecord {
  return JSON.parse(JSON.stringify(r)) as RestFlightRecord
}

/**
 * A prod-LIKE stream: the flight's live-ingested history WITHOUT the cancellation.
 * (A) — the authored prior.
 */
async function seedPreFixStream(store: InMemoryEventStore): Promise<void> {
  const stripped = freshCopy(CAPTURED_CANCELLED) as {
    statusDetails?: { state?: string }[]
  }
  for (const sd of stripped.statusDetails ?? []) delete sd.state
  let i = 0
  for (const { body } of restRecordToFlightStatusBodies(stripped as RestFlightRecord)) {
    i += 1
    await ingest({ ...body, messageId: `live-eh-${i}` }, store)
  }
}

describe('DEFECT-OAG-041 — a cancellation from real OAG data emits OagFlightCancelled', () => {
  it('AC-041.9 is emitted ONCE — a re-delivered cancellation against a cancelled prior is a no-op', () => {
    const { record } = cancelledRecordFromCorpus()
    const body = restRecordToFlightStatusBodies(record).at(-1)!.body
    // (B) — the hand-set folded field.
    const priorAlreadyCancelled = { state: CANONICAL_CANCELLED } as unknown as FlightAggregate
    const types = normalise(body, priorAlreadyCancelled).map((e) => e.metadata.eventType)
    expect(types).not.toContain(CanonicalEventType.FlightCancelled)
  })

  it('AC-041.9 a prior set from the RAW OAG spelling still suppresses a duplicate', () => {
    const { record, rawState } = cancelledRecordFromCorpus()
    const body = restRecordToFlightStatusBodies(record).at(-1)!.body
    const legacyPrior = { state: rawState } as unknown as FlightAggregate
    const types = normalise(body, legacyPrior).map((e) => e.metadata.eventType)
    expect(types).not.toContain(CanonicalEventType.FlightCancelled)
  })

  it('AC-041.9 the pre-fix stream plans the recovery', async () => {
    const store = new InMemoryEventStore()
    await seedPreFixStream(store)
    expect(store).toBeDefined()
  })
})
