/**
 * Self-tests for the test-requirement gate (process §17d).
 *
 * DISCIPLINE NOTE, and it is the whole point of the tool under test: these tests do
 * NOT stub the analyser's inputs. Every case writes REAL files to a REAL temp
 * directory and runs the REAL scanner over them. Stubbing `readFileSync` here would
 * be founding-evidence instance 2 (`subprocess.run` stubbed, so the mapping only
 * proved it agreed with itself) committed inside the gate built to prevent it.
 *
 * node --test .claude/tools/*.test.js   (make test-tools)
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const gate = require('./test-requirement-gate.js')

// --------------------------------------------------------------------------
// A real scratch repo per case. No mocks, no in-memory filesystem.
// --------------------------------------------------------------------------
function scratch(files, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trg-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body, 'utf8')
  }
  const cfg = Object.assign(
    { project: 'Scratch', mode: 'enforce', roots: [{ path: 'tests', limbs: ['ac', 'authored'] }] },
    config || {},
  )
  fs.mkdirSync(path.join(root, '.claude/config/test-requirement-gate'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.claude/config/test-requirement-gate/Scratch.json'),
    JSON.stringify(cfg, null, 2),
    'utf8',
  )
  return root
}

function run(files, config) {
  const root = scratch(files, config)
  return gate.runGate({ repoRoot: root, project: 'Scratch' })
}

const rules = (r, limb) => r.violations.filter((v) => v.limb === limb).map((v) => v.rule)
const lines = (r, limb) => r.violations.filter((v) => v.limb === limb)

// ==========================================================================
// LIMB 1 — every test case declares the acceptance criterion it validates.
// ==========================================================================

test('limb1: an it() with no AC reference anywhere is a violation', () => {
  const r = run({
    'tests/a.test.ts': `
describe('some grouping', () => {
  it('does a thing', () => { expect(1).toBe(1) })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), ['no-ac-reference'])
  assert.strictEqual(lines(r, 'ac')[0].test, 'does a thing')
})

test('limb1: an AC tag in the it() title satisfies the gate', () => {
  const r = run({
    'tests/a.test.ts': `
describe('g', () => {
  it('AC-ML1.12 does a thing', () => { expect(1).toBe(1) })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), [])
})

test('limb1: an AC tag on the enclosing describe satisfies its cases', () => {
  const r = run({
    'tests/a.test.ts': `
describe('AC-BPC1.3 — the grouping states the criterion', () => {
  it('one', () => {})
  it('two', () => {})
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), [])
})

test('limb1: an AC tag in the comment attached to the case satisfies it', () => {
  const r = run({
    'tests/a.test.ts': `
describe('g', () => {
  // AC-XE1.9: the fan-out registry is the sole source
  it('one', () => {})
  it('two', () => {})
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), ['no-ac-reference'])
  assert.strictEqual(lines(r, 'ac')[0].test, 'two')
})

test('limb1: a file-header @covers AC tag does NOT satisfy per-case declaration, and is counted apart', () => {
  const r = run({
    'tests/a.test.ts': `
/**
 * @covers AC-HF041.1
 */
describe('g', () => {
  it('one', () => {})
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), ['no-ac-reference'])
  assert.strictEqual(r.counts.acCoveredByFileHeaderOnly, 1)
})

test('limb1: fileHeaderCoversCounts=true flips those cases to satisfied', () => {
  const r = run(
    {
      'tests/a.test.ts': `
/** @covers AC-HF041.1 */
describe('g', () => { it('one', () => {}) })
`,
    },
    { fileHeaderCoversCounts: true },
  )
  assert.deepStrictEqual(rules(r, 'ac'), [])
})

test('limb1: an AC-looking token inside a comment that is not an AC id is not accepted', () => {
  const r = run({
    'tests/a.test.ts': `
describe('g', () => {
  // AC- is not an identifier, and ACCEPTANCE is a word
  it('one', () => {})
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), ['no-ac-reference'])
})

test('limb1: it.skip / test() / it.each are all test cases', () => {
  const r = run({
    'tests/a.test.ts': `
describe('g', () => {
  it.skip('skipped one', () => {})
  test('plain test', () => {})
  it.each([1, 2])('each %s', () => {})
})
`,
  })
  assert.strictEqual(rules(r, 'ac').length, 3)
})

// ==========================================================================
// LIMB 2 — no authored preconditions.
// ==========================================================================

test('limb2 delete-real: deleting a leaf off a corpus-loaded capture is flagged (the HF041 shape)', () => {
  const r = run({
    'tests/a.test.ts': `
import { readFileSync } from 'node:fs'
const CAPTURE = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'oag-rest/probe.json'), 'utf-8'))
const CAPTURED_RECORDS = CAPTURE.data ?? []
const CAPTURED_CANCELLED = CAPTURED_RECORDS.filter((x) => x.cancelled)[0]
function freshCopy(r) { return JSON.parse(JSON.stringify(r)) }
async function seedPreFixStream(store) {
  const stripped = freshCopy(CAPTURED_CANCELLED)
  for (const sd of stripped.statusDetails ?? []) delete sd.state
}
describe('AC-X.1 g', () => { it('one', () => {}) })
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), ['delete-on-real-capture'])
})

test('limb2 delete-real: deleting off an object we authored ourselves is NOT flagged', () => {
  const r = run({
    'tests/a.test.ts': `
describe('AC-X.1 g', () => {
  it('one', () => {
    const body = { documentType: 'FlightStatus', state: 'Scheduled' }
    delete body['documentType']
    delete process.env['OAG_TEST_TTL']
  })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), [])
})

test('limb2 delete-real: taint reaches through the manifest-gated corpus reader import', () => {
  const r = run({
    'tests/a.test.ts': `
import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'
const records = readConfirmingRecords()
describe('AC-X.1 g', () => {
  it('one', () => {
    const one = records[0]
    delete one.statusDetails
  })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), ['delete-on-real-capture'])
})

test('limb2 spread-override: overriding a field over a corpus-loaded value is flagged', () => {
  const r = run({
    'tests/a.test.ts': `
import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'
const record = readConfirmingRecords()[0]
describe('AC-X.1 g', () => {
  it('one', () => {
    const doctored = { ...record, state: 'Cancelled' }
    expect(doctored).toBeDefined()
  })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), ['spread-override-on-real-capture'])
})

test('limb2 spread-override: a plain clone spread with no override is NOT flagged', () => {
  const r = run({
    'tests/a.test.ts': `
import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'
const record = readConfirmingRecords()[0]
describe('AC-X.1 g', () => {
  it('one', () => {
    const clone = { ...record }
    const arr = [...record.statusDetails, 1]
    expect(clone).toBeDefined()
  })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), [])
})

test('limb2 mutate-real: assigning into a corpus-loaded capture is flagged', () => {
  const r = run({
    'tests/a.test.ts': `
import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'
const record = readConfirmingRecords()[0]
describe('AC-X.1 g', () => {
  it('one', () => {
    record.departure.airport.iata = 'DFW'
  })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), ['mutate-real-capture'])
})

test('limb2 authored-derived-prior: an object literal cast to a folded aggregate is flagged', () => {
  const r = run(
    {
      'tests/a.test.ts': `
describe('AC-X.1 g', () => {
  it('one', () => {
    const priorAlreadyCancelled = { state: CANONICAL_CANCELLED } as unknown as FlightAggregate
    expect(priorAlreadyCancelled).toBeDefined()
  })
})
`,
    },
    { derived: { types: ['FlightAggregate'], fields: ['state', 'cancellationEmitted'] } },
  )
  assert.deepStrictEqual(rules(r, 'authored'), ['authored-derived-prior'])
})

test('limb2 authored-derived-prior: a cast that sets no DERIVED field is not flagged', () => {
  const r = run(
    {
      'tests/a.test.ts': `
describe('AC-X.1 g', () => {
  it('one', () => {
    const p = { flightNumber: '123' } as unknown as FlightAggregate
    expect(p).toBeDefined()
  })
})
`,
    },
    { derived: { types: ['FlightAggregate'], fields: ['state', 'cancellationEmitted'] } },
  )
  assert.deepStrictEqual(rules(r, 'authored'), [])
})

test('limb2 exec-stub: stubbing subprocess.run in a python test is flagged', () => {
  const r = run(
    {
      'tests/test_probe.py': `
import subprocess
class T(unittest.TestCase):
    def test_mapping(self):
        orig = wi.subprocess.run
        wi.subprocess.run = fake_run
        try:
            self.assertEqual(wi._run_observation(p, "make:probe-x")[0], "observed")
        finally:
            wi.subprocess.run = orig
`,
    },
    { roots: [{ path: 'tests', limbs: ['authored'] }] },
  )
  assert.deepStrictEqual(rules(r, 'authored'), ['exec-boundary-stubbed'])
})

test('limb2 exec-stub: mock.patch of subprocess.run is flagged; calling it for real is not', () => {
  const r = run(
    {
      'tests/test_a.py': `
with patch("work_items.subprocess.run") as m:
    pass
`,
      'tests/test_b.py': `
subprocess.run(["git", "-C", repo, "add", "-A"], check=True)
`,
    },
    { roots: [{ path: 'tests', limbs: ['authored'] }] },
  )
  assert.deepStrictEqual(rules(r, 'authored'), ['exec-boundary-stubbed'])
  assert.strictEqual(lines(r, 'authored')[0].file, 'tests/test_a.py')
})

test('limb2 exec-stub: vi.mock of node:child_process is flagged', () => {
  const r = run({
    'tests/a.test.ts': `
vi.mock('node:child_process')
describe('AC-X.1 g', () => { it('one', () => {}) })
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), ['exec-boundary-stubbed'])
})

test('limb2: a violation inside a comment or a test NAME is never reported', () => {
  const r = run({
    'tests/a.test.ts': `
import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'
const record = readConfirmingRecords()[0]
// delete record.state  <- discussed and rejected
describe('AC-X.1 g', () => {
  it('explains why we never delete record.state', () => {
    expect('delete record.state').toBeTypeOf('string')
  })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'authored'), [])
})

// ==========================================================================
// The allowlist — committed, and every entry states WHY.
// ==========================================================================

test('allowlist: an entry suppresses the violation it names', () => {
  const files = {
    'tests/a.test.ts': `describe('g', () => { it('one', () => {}) })`,
  }
  const bare = run(files)
  assert.strictEqual(bare.violations.length, 1)

  const allowed = run(files, {
    allowlist: [
      {
        path: 'tests/a.test.ts',
        limb: 'ac',
        why: 'machinery invariant test — asserts the gate itself, carries no product requirement',
      },
    ],
  })
  assert.deepStrictEqual(allowed.violations, [])
  assert.strictEqual(allowed.counts.allowlisted, 1)
  assert.strictEqual(allowed.counts.allowlistEntries, 1)
})

test('allowlist: an entry with no WHY is a CONFIG ERROR, not a silent pass', () => {
  const r = run(
    { 'tests/a.test.ts': `describe('g', () => { it('one', () => {}) })` },
    { allowlist: [{ path: 'tests/a.test.ts', limb: 'ac', why: 'because' }] },
  )
  assert.strictEqual(r.verdict, 'FAIL')
  assert.ok(r.configErrors.some((e) => /why/i.test(e)), r.configErrors.join('; '))
})

test('allowlist: a glob entry matches a subtree', () => {
  const r = run(
    { 'tests/deep/nested/a.test.ts': `describe('g', () => { it('one', () => {}) })` },
    {
      roots: [{ path: 'tests', limbs: ['ac'] }],
      allowlist: [
        {
          path: 'tests/deep/**',
          limb: 'ac',
          why: 'proof-of-fire seed corpus: these files exist to be scanned, not to assert product behaviour',
        },
      ],
    },
  )
  assert.deepStrictEqual(r.violations, [])
})

test('allowlist: an entry that matches nothing is reported as stale so it cannot rot', () => {
  const r = run(
    { 'tests/a.test.ts': `describe('AC-X.1 g', () => { it('one', () => {}) })` },
    {
      allowlist: [
        {
          path: 'tests/gone.test.ts',
          limb: 'ac',
          why: 'this file was deleted long ago and the entry should have gone with it',
        },
      ],
    },
  )
  assert.strictEqual(r.counts.staleAllowlistEntries, 1)
})

// ==========================================================================
// Verdict, ratchet and the stdout sentinel (make cannot express a 3-way exit).
// ==========================================================================

test('enforce mode: any violation is FAIL', () => {
  const r = run({ 'tests/a.test.ts': `describe('g', () => { it('one', () => {}) })` })
  assert.strictEqual(r.verdict, 'FAIL')
  assert.strictEqual(r.exitCode, 2)
})

test('ratchet mode: at or below the committed baseline is PASS, and says so', () => {
  const r = run(
    { 'tests/a.test.ts': `describe('g', () => { it('one', () => {}); it('two', () => {}) })` },
    { mode: 'ratchet', baseline: { ac: 2, authored: 0 } },
  )
  assert.strictEqual(r.verdict, 'PASS')
  assert.strictEqual(r.exitCode, 0)
  assert.strictEqual(r.counts.ac, 2)
})

test('ratchet mode: ONE more than the baseline is FAIL, naming the limb that regressed', () => {
  const r = run(
    {
      'tests/a.test.ts': `describe('g', () => { it('one', () => {}); it('two', () => {}); it('three', () => {}) })`,
    },
    { mode: 'ratchet', baseline: { ac: 2, authored: 0 } },
  )
  assert.strictEqual(r.verdict, 'FAIL')
  assert.strictEqual(r.exitCode, 2)
  assert.ok(r.regressions.some((x) => x.limb === 'ac' && x.count === 3 && x.baseline === 2))
})

test('ratchet mode: the baseline can only shrink — a lower count reports the new floor', () => {
  const r = run(
    { 'tests/a.test.ts': `describe('g', () => { it('one', () => {}) })` },
    { mode: 'ratchet', baseline: { ac: 5, authored: 0 } },
  )
  assert.strictEqual(r.verdict, 'PASS')
  assert.ok(r.slack.some((x) => x.limb === 'ac' && x.count === 1 && x.baseline === 5))
})

test('the report carries a stdout sentinel, because make cannot express a three-way exit', () => {
  const root = scratch(
    { 'tests/a.test.ts': `describe('g', () => { it('one', () => {}) })` },
    { mode: 'ratchet', baseline: { ac: 1, authored: 0 } },
  )
  const out = gate.formatReport(gate.runGate({ repoRoot: root, project: 'Scratch' }))
  assert.match(out, /^TRG-VERDICT: PASS$/m)
  assert.match(out, /^TRG-COUNTS: /m)
  assert.match(out, /^TRG-MODE: ratchet$/m)
})

test('an absent project config is NOT-CONFIGURED, never a silent pass and never a crash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trg-'))
  const r = gate.runGate({ repoRoot: root, project: 'Nope' })
  assert.strictEqual(r.verdict, 'NOT-CONFIGURED')
  assert.strictEqual(r.exitCode, 0)
  assert.match(gate.formatReport(r), /^TRG-VERDICT: NOT-CONFIGURED$/m)
})

test('a configured root that does not exist is a CONFIG ERROR, so the gate cannot scan nothing and pass', () => {
  const r = run({ 'tests/a.test.ts': `describe('AC-X.1 g', () => { it('one', () => {}) })` }, {
    roots: [{ path: 'no/such/dir', limbs: ['ac', 'authored'] }],
  })
  assert.strictEqual(r.verdict, 'FAIL')
  assert.ok(r.configErrors.some((e) => /no\/such\/dir/.test(e)))
})

// ==========================================================================
// PROOF OF FIRE (§17c) — the committed founding shapes, scanned for real.
// ==========================================================================

const FIRE = path.join(__dirname, 'fixtures', 'test-requirement-gate')

test('proof-of-fire: the pre-fix UC-HF041 test shape is caught by limb 2', () => {
  const src = fs.readFileSync(path.join(FIRE, 'hf041-prefix-authored-prior.fixture.ts'), 'utf8')
  const r = run(
    { 'tests/hf041.test.ts': src },
    { derived: { types: ['FlightAggregate'], fields: ['state', 'cancellationEmitted'] } },
  )
  const hit = rules(r, 'authored')
  assert.ok(hit.includes('delete-on-real-capture'), hit.join(','))
  assert.ok(hit.includes('authored-derived-prior'), hit.join(','))
})

test('proof-of-fire: the pre-fix awaiting_observation probe test is caught by limb 2', () => {
  const src = fs.readFileSync(path.join(FIRE, 'awaiting-observation-prefix-stub.fixture.py'), 'utf8')
  const r = run({ 'tests/test_probe.py': src }, { roots: [{ path: 'tests', limbs: ['authored'] }] })
  assert.deepStrictEqual(rules(r, 'authored'), ['exec-boundary-stubbed'])
})

test('proof-of-fire: the CORRECTED shapes are clean — the gate distinguishes the fix from the bug', () => {
  const src = fs.readFileSync(path.join(FIRE, 'hf041-corrected-folded-prior.fixture.ts'), 'utf8')
  const r = run(
    { 'tests/hf041.test.ts': src },
    { derived: { types: ['FlightAggregate'], fields: ['state', 'cancellationEmitted'] } },
  )
  assert.deepStrictEqual(rules(r, 'authored'), [])
})

// ==========================================================================
// AUTO-TIGHTEN (v142) — the ratchet must move itself.
//
// These drive the REAL CLI through child_process, not runGate(), because the
// behaviour under test lives in main() and writes a file. Asserting it against a
// stubbed writer would be exactly the exec-boundary fault this gate exists to
// catch: the stub would be written by whoever was wrong about the CLI.
//
// Founding evidence: the limb-1 floor was lowered to 1749 by hand at the moment
// someone noticed a gain; 106 minutes later two commits took the true count to
// 1811, and nobody saw it for THREE DAYS because the only observer of the drift
// is the next gate run.
// ==========================================================================

const { execFileSync } = require('node:child_process')
const CLI = path.join(__dirname, 'test-requirement-gate.js')

function runCli(root, extraArgs) {
  const args = [CLI, '--project', 'Scratch', '--repo-root', root].concat(extraArgs || [])
  let stdout = ''
  let status = 0
  try {
    stdout = execFileSync(process.execPath, args, { encoding: 'utf8' })
  } catch (e) {
    stdout = (e.stdout || '') + (e.stderr || '')
    status = e.status
  }
  return { stdout, status }
}

const floorOf = (root) =>
  JSON.parse(
    fs.readFileSync(path.join(root, '.claude/config/test-requirement-gate/Scratch.json'), 'utf8'),
  ).baseline

// One clean case (names its AC) => real counts are ac:0, authored:0.
const CLEAN = { 'tests/a.test.ts': "it('AC-X.1 does a thing', () => { expect(1).toBe(1) })\n" }
// One dirty case (no AC reference) => real count is ac:1.
const DIRTY = { 'tests/a.test.ts': "it('does a thing', () => { expect(1).toBe(1) })\n" }

test('auto-tighten: a PASSING run whose count is BELOW the floor lowers the floor', () => {
  const root = scratch(CLEAN, { mode: 'ratchet', baseline: { ac: 5, authored: 3 } })
  const { stdout, status } = runCli(root)
  assert.strictEqual(status, 0, stdout)
  assert.match(stdout, /RATCHET TIGHTENED AUTOMATICALLY/, stdout)
  assert.deepStrictEqual(floorOf(root), { ac: 0, authored: 0 })
})

test('auto-tighten: NON-VACUITY — it must NOT fire when the count already equals the floor', () => {
  const root = scratch(CLEAN, { mode: 'ratchet', baseline: { ac: 0, authored: 0 } })
  const { stdout, status } = runCli(root)
  assert.strictEqual(status, 0, stdout)
  assert.doesNotMatch(stdout, /RATCHET TIGHTENED/, stdout)
  assert.deepStrictEqual(floorOf(root), { ac: 0, authored: 0 })
})

test('auto-tighten: a FAILING run tightens NOTHING and never RAISES the floor', () => {
  const root = scratch(DIRTY, { mode: 'ratchet', baseline: { ac: 0, authored: 0 } })
  const { stdout, status } = runCli(root)
  assert.strictEqual(status, 2, stdout)
  assert.doesNotMatch(stdout, /RATCHET TIGHTENED/, stdout)
  // The floor is the thing that must survive a red run untouched.
  assert.deepStrictEqual(floorOf(root), { ac: 0, authored: 0 })
})

test('auto-tighten: --no-auto-tighten suppresses the write (for scratch/diff runs)', () => {
  const root = scratch(CLEAN, { mode: 'ratchet', baseline: { ac: 5, authored: 3 } })
  const { stdout, status } = runCli(root, ['--no-auto-tighten'])
  assert.strictEqual(status, 0, stdout)
  assert.doesNotMatch(stdout, /RATCHET TIGHTENED/, stdout)
  assert.deepStrictEqual(floorOf(root), { ac: 5, authored: 3 })
})

test('auto-tighten: --json is a pure read and must never move the floor', () => {
  const root = scratch(CLEAN, { mode: 'ratchet', baseline: { ac: 5, authored: 3 } })
  const { stdout } = runCli(root, ['--json'])
  JSON.parse(stdout) // must still be valid, untruncated JSON
  assert.deepStrictEqual(floorOf(root), { ac: 5, authored: 3 })
})
