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

// --------------------------------------------------------------------------
// DEF-ROC-140 — Playwright's suite form. `test.describe(...)` was rejected
// outright by the call regex (the lookbehind sees the `.` before `describe`,
// and `test` cannot absorb `.describe`), so the suite did not exist for the
// analyser and its cases inherited nothing. Every case below writes REAL
// Playwright-shaped source and runs the REAL scanner, per this file's rule.
// --------------------------------------------------------------------------

test('limb1: AC-140-1 an AC tag on an enclosing test.describe satisfies its cases', () => {
  const r = run({
    'tests/a.spec.ts': `
import { test, expect } from '@playwright/test'

test.describe('UC live — regression: the other views still work (AC-PW1.2)', () => {
  test('one', async ({ page }) => { await page.goto('/') })
  test('two', async ({ page }) => { await page.goto('/') })
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), [])
})

test('limb1: AC-140-1 an untagged test.describe still leaves its cases violating — the suite is READ, not assumed', () => {
  const r = run({
    'tests/a.spec.ts': `
import { test } from '@playwright/test'

test.describe('a grouping that names no criterion', () => {
  test('one', async () => {})
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), ['no-ac-reference'])
  assert.strictEqual(lines(r, 'ac')[0].test, 'one')
  assert.strictEqual(lines(r, 'ac')[0].suite, 'a grouping that names no criterion')
})

test('limb1: AC-140-2 the Playwright suite modifiers are recognised on the same footing', () => {
  for (const form of [
    'test.describe.serial',
    'test.describe.parallel',
    'test.describe.only',
    'test.describe.skip',
    'test.describe.fixme',
    'test.describe.serial.only',
  ]) {
    const r = run({
      'tests/a.spec.ts': `
import { test } from '@playwright/test'

${form}('AC-PW1.3 — the grouping states the criterion', () => {
  test('one', async () => {})
})
`,
    })
    assert.deepStrictEqual(rules(r, 'ac'), [], `${form} must resolve its cases' AC tag`)
  }
})

test('limb1: AC-140-3 test.describe.configure is neither a suite nor a case', () => {
  const r = run({
    'tests/a.spec.ts': `
import { test } from '@playwright/test'

test.describe.configure({ mode: 'parallel' })

test('AC-PW1.4 the only case in this file', async () => {})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), [])
  assert.strictEqual(r.counts.cases, 1)
})

test('limb1: AC-140-3 a configure() call cannot borrow the file header as a suite title either', () => {
  const r = run({
    'tests/a.spec.ts': `
import { test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.describe('AC-PW1.5 — real suite', () => {
  test('one', async () => {})
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), [])
  assert.strictEqual(r.counts.cases, 1)
})

test('limb1: AC-140-1 a nested test.describe contributes its own tag to the cases below it', () => {
  const r = run({
    'tests/a.spec.ts': `
import { test } from '@playwright/test'

test.describe('outer, no criterion', () => {
  test.describe('AC-PW1.6 — inner states it', () => {
    test('one', async () => {})
  })
  test('two', async () => {})
})
`,
  })
  assert.deepStrictEqual(rules(r, 'ac'), ['no-ac-reference'])
  assert.strictEqual(lines(r, 'ac')[0].test, 'two')
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

test('limb2 spread-override: an ARRAY spread is not an object override, even in a block holding a typed declaration', () => {
  // The false positive this rule shipped with (defect-oag-110-keyless-corpus-and-guard.test.ts:417):
  // `[...a, ...b]` has no enclosing OBJECT literal, so a `{`-only walk back finds the enclosing
  // BLOCK and reads the `const x: T =` annotation's colon as an override key.
  const r = run({
    'tests/a.test.ts': `
import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'
const record = readConfirmingRecords()
describe('AC-X.1 g', () => {
  it('one', () => {
    const before = record
    const after = record
    const lateKeyed: SomeType = 1
    const ids = new Set([...before, ...after].map((e) => e.id))
    void lateKeyed
    void ids
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

// ==========================================================================
// DEFECT-OAG-106 — A DIRECTIVE IS NOT A TEST CASE.
//
// Playwright's `skip`/`fixme`/`fail`/`slow` modifiers are DUAL-PURPOSE: with a
// title they declare a case, with a CONDITION (or nothing) they are a runtime
// GUARD. The gate admitted `.skip` and classified every match as a case, so a
// describe-level guard was reported as an untagged case with no title — and the
// ratchet became UNSATISFIABLE BY ITS OWN DICHOTOMY: a guard asserts nothing so
// it cannot honestly be tagged, and deleting it would let an operator-only
// LIVE-WRITE suite run unguarded (the exact protection `AC-104.1` demands). The
// cheapest path to green was to delete a safety guard, which is worse than no
// gate. Measured on the real tree: 22 of the 1737 floor were directives.
//
// The distinction is the FIRST ARGUMENT: a case DECLARES A TITLE (a string
// literal); a guard's first argument is a condition, or absent. The fix must be
// a CLASSIFICATION correction and not an exclusion — every test below that
// asserts a guard is ignored has a sibling asserting a real untagged case in the
// same shape is STILL COUNTED.
// ==========================================================================

// The verbatim shape of `src/admin-app/e2e/ob8-scratch-repair.spec.ts:43-48`, which is the
// fixture the defect names. Reproduced here rather than referenced because that file is in
// the PROJECT repo and this test is parent-repo — but it is copied, not paraphrased.
const OB8_GUARD_SHAPE = `
import { test, expect } from '@playwright/test'
const CREDS = credsFromEnv()

test.describe('AC-104.1 scratch-airport repair @repair', () => {
  test.skip(
    !repairMode(),
    'repair lane — run it via \`make -C work/OagEventSource admin-console-scratch-repair\`',
  )
  test.skip(!hasCreds(CREDS), 'ADMIN_STS_* creds not supplied in env')

  test('AC-104.1 removes the scratch airport left by an interrupted run', async () => {})
})
`

test('AC-106.1/AC-106.2: a describe-level `test.skip(cond, reason)` GUARD is a directive, not a case', () => {
  const r = run({ 'tests/ob8.spec.ts': OB8_GUARD_SHAPE })
  assert.deepStrictEqual(
    lines(r, 'ac').map((v) => `${v.line}:${v.test}`),
    [],
    'the two guards must not be counted, and the one real case names AC-104.1',
  )
  assert.strictEqual(r.counts.cases, 1, 'exactly ONE case is declared in that file')
})

test('AC-106.3: a string-first `.skip` is a GENUINE skipped case and is STILL counted', () => {
  const r = run({
    'tests/a.test.ts': `
describe('g', () => {
  it.skip('an untagged skipped case', () => {})
  test.skip('another untagged skipped case', () => {})
})
`,
  })
  assert.strictEqual(lines(r, 'ac').length, 2, 'the fix must not become a hole for real cases')
  assert.strictEqual(r.counts.cases, 2)
})

test('AC-106.7a: a bare `test.skip()` inside a test BODY is a directive; the case around it still counts', () => {
  const r = run({
    'tests/a.test.ts': `
test('an untagged case that bails out at runtime', async () => {
  if (!liveEnv()) test.skip()
  expect(1).toBe(1)
})
`,
  })
  assert.strictEqual(r.counts.cases, 1, 'the bare skip() is not a second case')
  assert.strictEqual(lines(r, 'ac').length, 1, 'the ENCLOSING case is untagged and must still be counted')
})

test('AC-106.7b: `test.describe` is a SUITE — its title satisfies its cases, and `test.describe.skip` is not a case', () => {
  const r = run({
    'tests/a.spec.ts': `
test.describe('AC-Z.9 — the suite states the criterion', () => {
  test('a case with no tag of its own', async () => {})
})
test.describe.skip('AC-Z.9 — a whole suite skipped', () => {
  test('AC-Z.9 another case', async () => {})
})
`,
  })
  assert.deepStrictEqual(lines(r, 'ac'), [], 'a Playwright suite title is one of the three sanctioned places')
  assert.strictEqual(r.counts.cases, 2, 'two cases; neither describe is one')
})

test('AC-106.7b-inverse: NON-VACUITY — an UNTAGGED `test.describe` suite still yields a counted case', () => {
  const r = run({
    'tests/a.spec.ts': `
test.describe('a suite naming no criterion', () => {
  test('a case naming no criterion', async () => {})
})
`,
  })
  assert.strictEqual(lines(r, 'ac').length, 1)
})

test('AC-106.7c: `fixme`/`fail`/`slow` guards are directives — and their TITLED forms are counted cases', () => {
  const guards = run({
    'tests/a.spec.ts': `
test.describe('AC-Z.1 g', () => {
  test.fixme(!ready(), 'not implemented on this env')
  test.fail(isBroken(), 'known-broken upstream')
  test.slow(isCi(), 'triples the timeout on CI')
  test('AC-Z.1 the one real case', async () => {})
})
`,
  })
  assert.deepStrictEqual(lines(guards, 'ac'), [])
  assert.strictEqual(guards.counts.cases, 1)

  // The same modifiers with a TITLE are real cases the gate previously could not see at
  // all (`fixme`/`fail`/`slow` were absent from its modifier set), so a pending test
  // escaped limb 1 entirely. Closing the over-count must not leave that under-count.
  const cases = run({
    'tests/b.spec.ts': `
test.fixme('an untagged pending case', async () => {})
test.fail('an untagged expected-to-fail case', async () => {})
test.slow('an untagged slow case', async () => {})
`,
  })
  assert.strictEqual(cases.counts.cases, 3)
  assert.strictEqual(lines(cases, 'ac').length, 3)
})

test('AC-106.7d: a HELPER that wraps `test.skip` is still a directive at the wrapped site', () => {
  const r = run({
    'tests/a.spec.ts': `
function requireLiveCreds(reason) {
  test.skip(!hasCreds(), reason)
}
test.describe('AC-Z.2 g', () => {
  requireLiveCreds('ADMIN_STS_* creds not supplied in env')
  test('AC-Z.2 the one real case', async () => {})
})
`,
  })
  assert.deepStrictEqual(lines(r, 'ac'), [])
  assert.strictEqual(r.counts.cases, 1)
})

test('AC-106.7e: NON-VACUITY — a computed-title `describe(rel, fn)` stays a SUITE, not a directive', () => {
  const r = run({
    'tests/a.test.ts': `
for (const rel of FILES) {
  describe(rel, () => {
    it('AC-Z.3 the case is tagged and the suite must remain its ancestor', () => {})
    it('an untagged sibling', () => {})
  })
}
`,
  })
  assert.strictEqual(r.counts.cases, 2, 'both cases are cases; the describe is not one')
  assert.strictEqual(lines(r, 'ac').length, 1, 'only the untagged sibling')
})

test('AC-106.7f: NON-VACUITY — `it.each(files)(...)` has a non-string first arg and is STILL a case', () => {
  const r = run({
    'tests/a.test.ts': `
describe('g', () => {
  it.each(FILES)('%s is untagged', (f) => {})
  it.each([1, 2])('%s is untagged too', (n) => {})
})
`,
  })
  assert.strictEqual(lines(r, 'ac').length, 2, 'the .each currying rule must survive the directive rule')
})

// ==========================================================================
// `--clean-tree` — the ratchet-regression triage method (DEFECT-OAG-106 `AC-106.5`).
//
// "It reads 1757 against its 1755 floor and nobody knows whose +2 that is" had
// defeated two passes. Measuring the COMMITTED copy of every scanned file answers it:
// if HEAD scores the floor exactly, the regression is in the uncommitted range.
// ==========================================================================

function gitScratch(committed, working, config) {
  const root = scratch(committed, config)
  const git = (...args) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t'].concat(args),
      { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'committed corpus')
  for (const [rel, body] of Object.entries(working || {})) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body, 'utf8')
  }
  return root
}

test('AC-106.5: `--clean-tree` measures HEAD, so an UNTRACKED violating spec is not counted', () => {
  const root = gitScratch(
    { 'tests/a.test.ts': "it('AC-X.1 committed and tagged', () => {})\n" },
    { 'tests/zz-scratch.test.ts': "it('an untracked diagnostic nobody committed', () => {})\n" },
    { mode: 'ratchet', baseline: { ac: 0, authored: 0 } },
  )
  const dirty = runCli(root, ['--json', '--no-auto-tighten'])
  assert.strictEqual(JSON.parse(dirty.stdout).counts.ac, 1, 'the working tree carries the violation')

  const head = runCli(root, ['--clean-tree', '--json'])
  const r = JSON.parse(head.stdout)
  assert.strictEqual(r.counts.ac, 0, 'HEAD is clean, so the +1 is in the uncommitted range')
  assert.strictEqual(r.counts.files, 1, 'only the COMMITTED spec was materialised')
  assert.match(r.note, /COMMITTED \(HEAD\)/)
})

test('AC-106.5: `--clean-tree` is a DIAGNOSTIC — it can neither auto-tighten nor write a baseline', () => {
  const root = gitScratch(
    { 'tests/a.test.ts': "it('AC-X.1 committed and tagged', () => {})\n" },
    null,
    { mode: 'ratchet', baseline: { ac: 5, authored: 3 } },
  )
  const diag = runCli(root, ['--clean-tree'])
  assert.strictEqual(diag.status, 0, diag.stdout)
  assert.doesNotMatch(diag.stdout, /RATCHET TIGHTENED/, 'a temp root\'s count is not this tree\'s count')
  assert.deepStrictEqual(floorOf(root), { ac: 5, authored: 3 })

  const write = runCli(root, ['--clean-tree', '--write-baseline'])
  assert.strictEqual(write.status, 2, write.stdout)
  assert.match(write.stdout, /may not write a baseline/)
  assert.deepStrictEqual(floorOf(root), { ac: 5, authored: 3 })

  // NON-VACUITY: the same run WITHOUT --clean-tree does tighten, so the guard above is
  // suppressing a real write rather than describing a tool that never writes.
  const plain = runCli(root, ['--no-auto-tighten', '--write-baseline'])
  assert.strictEqual(plain.status, 0, plain.stdout)
  assert.deepStrictEqual(floorOf(root), { ac: 0, authored: 0 })
})

// ==========================================================================
// AC-106.7 — THE CALL-FORM LEDGER IS THE SWEEP, AND IT FAILS ON AN UNDECLARED FORM.
//
// The founding fault was not "`.skip` was handled wrong" — it was that the parser
// recognised a set of modifiers and had NO POSITION on what any of them MEANT, so
// every match became a case BY DEFAULT and the one dual-purpose modifier became a
// false case silently. A modifier added later inherits the same default. So the set
// and its classification are ONE declaration, `RE_CALL` is built from it, and these
// tests are the completeness gate: a new modifier cannot enter undeclared, and an
// undeclared one is invisible rather than miscounted.
// ==========================================================================

test('AC-106.7-ledger: every recognised modifier declares a role, and the regex is built from it', () => {
  const roles = new Set(['guard', 'suite', 'curry', 'plain'])
  for (const [mod, role] of Object.entries(gate.MODIFIER_LEDGER)) {
    assert.ok(roles.has(role), `${mod} declares an unknown role ${JSON.stringify(role)}`)
    assert.match(gate.RE_CALL.source, new RegExp(`\\b${mod}\\b`), `${mod} is declared but unrecognised`)
  }
  // …and nothing is recognised that is NOT declared. Parsed out of the built alternation, so
  // this cannot drift from the regex the parser actually uses.
  const recognised = gate.RE_CALL.source.match(/\(\?:([a-zA-Z|]+)\)\)\*/)[1].split('|')
  assert.deepStrictEqual(
    recognised.slice().sort(),
    Object.keys(gate.MODIFIER_LEDGER).sort(),
    'the regex and the ledger must be the same set — otherwise a modifier is classified by default',
  )
})

test('AC-106.7-ledger: an UNDECLARED modifier is NOT recognised (fail-closed, not counted-by-default)', () => {
  const r = run({
    // `test.describe.configure({ mode: 'parallel' })` is real Playwright and is deliberately
    // NOT in the ledger. Being invisible is the safe direction: it is not a case, and it is
    // not an untagged violation nobody can satisfy.
    'tests/a.spec.ts': `
test.describe.configure({ mode: 'parallel' })
test.wibble(someCondition, 'a modifier that does not exist')
test('an untagged case, which IS counted', async () => {})
`,
  })
  assert.strictEqual(r.counts.cases, 1, 'only the real case; neither unknown form is one')
  assert.strictEqual(lines(r, 'ac').length, 1)
})

test('AC-106.7-ledger: EVERY guard modifier behaves both ways — directive without a title, case with one', () => {
  for (const mod of Object.keys(gate.MODIFIER_LEDGER).filter((m) => gate.MODIFIER_LEDGER[m] === 'guard')) {
    const guard = run({ 'tests/a.spec.ts': `test.${mod}(!ready(), 'a reason, not a title')\n` })
    assert.strictEqual(guard.counts.cases, 0, `test.${mod}(cond, reason) must be a DIRECTIVE`)
    assert.deepStrictEqual(lines(guard, 'ac'), [], `test.${mod}(cond, reason) must not be a violation`)

    const bare = run({ 'tests/a.spec.ts': `test('AC-X.1 a case', () => { test.${mod}() })\n` })
    assert.strictEqual(bare.counts.cases, 1, `a bare test.${mod}() must not be a second case`)

    const titled = run({ 'tests/a.spec.ts': `test.${mod}('an untagged case', () => {})\n` })
    assert.strictEqual(titled.counts.cases, 1, `test.${mod}('title', fn) IS a case`)
    assert.strictEqual(lines(titled, 'ac').length, 1, `test.${mod}('title', fn) must still be counted`)
  }
})
