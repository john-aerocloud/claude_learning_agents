'use strict';
/**
 * tool-coverage.test.js — DEF-ROC-211 self-tests.
 *
 * `tool-coverage.js` is the checker that makes `.claude/tools/*.test.js` a real
 * CI gate instead of a suite nobody consults (see that file's header). Every
 * failure mode it can report is driven here against a seeded, disposable tree
 * — never the real `.claude/tools/` directory, so a case here cannot be
 * defeated by editing the real ledger to match whatever the code currently
 * does (the same discipline `laneSplit.test.js` and `guardCoverage`'s own
 * suite use one repo over). The real repo is asserted against separately,
 * and read-only, as its own non-vacuous positive case.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const toolCoverage = require('./tool-coverage.js');

const REAL_TOOLS_DIR = __dirname;
const REAL_REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_LEDGER_PATH = path.join(REAL_TOOLS_DIR, 'tool-coverage.json');
const CHECKER_PATH = path.join(REAL_TOOLS_DIR, 'tool-coverage.js');

// --- fixture builder ---------------------------------------------------------

function makeFixture({ withUndeclared = false, withStale = false, laneContent = null, ledgerOverrides = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-coverage-fixture-'));
  const toolsDir = path.join(dir, '.claude', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  const workflowsDir = path.join(dir, '.github', 'workflows');
  fs.mkdirSync(workflowsDir, { recursive: true });

  // A tiny, fast, real test file the fixture always declares.
  fs.writeFileSync(path.join(toolsDir, 'alpha.test.js'), `
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('alpha: passes', () => { assert.equal(1, 1); });
`);

  const guards = [{ id: 'alpha.test.js', what: 'fixture: always passes' }];

  if (withUndeclared) {
    // A real file with NO ledger row.
    fs.writeFileSync(path.join(toolsDir, 'beta.test.js'), `
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('beta: passes', () => { assert.equal(1, 1); });
`);
  }

  if (withStale) {
    guards.push({ id: 'ghost.test.js', what: 'fixture: declared but deleted' });
  }

  const lanePath = path.join(workflowsDir, 'tools-tests.yml');
  fs.writeFileSync(lanePath, laneContent !== null ? laneContent : 'jobs:\n  test:\n    steps:\n      - run: make test-tools-ci\n');

  const ledger = {
    _why: 'fixture',
    lane: '.github/workflows/tools-tests.yml',
    runBy: 'make test-tools-ci',
    guards,
    knownEnvironmentGaps: [],
    ...ledgerOverrides,
  };
  const ledgerPath = path.join(toolsDir, 'tool-coverage.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  return { dir, toolsDir, repoRoot: dir, ledgerPath };
}

function cleanup(fixture) {
  fs.rmSync(fixture.dir, { recursive: true, force: true });
}

// --- Step 1: DECLARED --------------------------------------------------------

test('AC-TC.1: an undeclared real test file is reported, not silently absorbed', () => {
  const fx = makeFixture({ withUndeclared: true });
  try {
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath, staticOnly: true });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.startsWith('UNDECLARED') && p.includes('beta.test.js')),
      `expected an UNDECLARED finding naming beta.test.js, got: ${JSON.stringify(result.problems)}`);
  } finally { cleanup(fx); }
});

test('AC-TC.1: a declared row naming a deleted file is reported STALE', () => {
  const fx = makeFixture({ withStale: true });
  try {
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath, staticOnly: true });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.startsWith('STALE') && p.includes('ghost.test.js')),
      `expected a STALE finding naming ghost.test.js, got: ${JSON.stringify(result.problems)}`);
  } finally { cleanup(fx); }
});

test('AC-TC.1: a fully declared, matching tree has NO declared-coverage findings', () => {
  const fx = makeFixture();
  try {
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath, staticOnly: true });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
  } finally { cleanup(fx); }
});

// --- Step 2: WIRED ------------------------------------------------------------

test('AC-TC.2: a declared lane file that does not exist is UNWIRED', () => {
  const fx = makeFixture();
  try {
    fs.rmSync(path.join(fx.repoRoot, '.github', 'workflows', 'tools-tests.yml'));
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath, staticOnly: true });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.startsWith('UNWIRED') && p.includes('does not exist')),
      JSON.stringify(result.problems));
  } finally { cleanup(fx); }
});

test("AC-TC.2: a declared lane file that never mentions runBy is UNWIRED — a carrier with no caller (DEF-ROC-165's class)", () => {
  const fx = makeFixture({ laneContent: 'jobs:\n  test:\n    steps:\n      - run: echo hello\n' });
  try {
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath, staticOnly: true });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.startsWith('UNWIRED') && p.includes('does not invoke')),
      JSON.stringify(result.problems));
  } finally { cleanup(fx); }
});

test('AC-TC.2: a lane file that DOES mention runBy is wired — non-vacuous positive', () => {
  const fx = makeFixture();
  try {
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath, staticOnly: true });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
  } finally { cleanup(fx); }
});

// --- Step 3: GREEN-OR-KNOWN — actually runs the suite via a real subprocess --

test('AC-TC.3: a real passing suite with no declared gaps reports ok', () => {
  const fx = makeFixture();
  try {
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    assert.equal(result.detail.ran, true);
    assert.equal(result.detail.newFailures.length, 0);
  } finally { cleanup(fx); }
});

test('AC-TC.3: runSuite strips NODE_TEST_CONTEXT before spawning, DIFFERENTIALLY — with it left set (the naive/pre-fix form) node\'s own recursion guard silently runs NOTHING and the check reports a false-clean pass; with it stripped (the fixed form) the real failure is seen', () => {
  const fx = makeFixture();
  try {
    fs.writeFileSync(path.join(fx.toolsDir, 'alpha.test.js'), `
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('alpha: passes', () => { assert.equal(1, 2); });
`);
    // This process is itself running under `node --test`, so NODE_TEST_CONTEXT
    // is already set in process.env — exactly the condition the fix handles.
    assert.ok(process.env.NODE_TEST_CONTEXT, 'expected this suite itself to be running under node --test');

    // Naive/pre-fix form: spawn without stripping the inherited var.
    const naive = spawnSync(process.execPath,
      ['--test', '--test-reporter=tap', path.join(fx.toolsDir, 'alpha.test.js')],
      { cwd: fx.repoRoot, encoding: 'utf8' });
    assert.equal(naive.status, 0, 'pre-fix control: expected the recursion guard to make the child exit 0');
    assert.ok(!/^not ok/m.test(naive.stdout), 'pre-fix control: expected NO failures visible (swallowed by the recursion guard)');

    // Fixed form: the real runSuite(), which strips NODE_TEST_CONTEXT.
    const { failing } = toolCoverage.runSuite(fx.toolsDir, fx.repoRoot);
    assert.equal(failing.length, 1, 'fixed form: the real failure must be visible once NODE_TEST_CONTEXT is stripped');
  } finally { cleanup(fx); }
});

test('AC-TC.3: a NEW, undeclared failure is red — DEMONSTRATED, not assumed (the class this whole item exists to catch)', () => {
  const fx = makeFixture();
  try {
    // Break one assertion in the fixture suite — mirrors the acceptance
    // criterion's own "break one assertion, watch it go red" demonstration,
    // run here against the checker's logic rather than a live CI pipeline.
    fs.writeFileSync(path.join(fx.toolsDir, 'alpha.test.js'), `
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('alpha: passes', () => { assert.equal(1, 2); });
`);
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath });
    assert.equal(result.ok, false);
    assert.equal(result.detail.newFailures.length, 1);
    assert.ok(result.detail.newFailures[0].includes('alpha: passes'));
  } finally { cleanup(fx); }
});

test('AC-TC.3: a failure matching a declared knownEnvironmentGaps row is TOLERATED, never silently dropped from the report', () => {
  const fx = makeFixture({
    ledgerOverrides: {
      knownEnvironmentGaps: [
        { file: 'alpha.test.js', test: 'alpha: passes', reason: 'fixture: deliberately broken for this case', owner: 'DEF-ROC-000' },
      ],
    },
  });
  try {
    fs.writeFileSync(path.join(fx.toolsDir, 'alpha.test.js'), `
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('alpha: passes', () => { assert.equal(1, 2); });
`);
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    assert.equal(result.detail.tolerated, 1);
    assert.equal(result.detail.totalFailing, 1);
    assert.equal(result.detail.newFailures.length, 0);
  } finally { cleanup(fx); }
});

test('AC-TC.3: a knownEnvironmentGaps row that STOPS failing (test now passes) is fine — shrinking the tolerance list is never a red', () => {
  const fx = makeFixture({
    ledgerOverrides: {
      knownEnvironmentGaps: [
        { file: 'alpha.test.js', test: 'alpha: passes', reason: 'fixture: declared but this test currently passes', owner: 'DEF-ROC-000' },
      ],
    },
  });
  try {
    const result = toolCoverage.check({ toolsDir: fx.toolsDir, repoRoot: fx.repoRoot, ledgerPath: fx.ledgerPath });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    assert.equal(result.detail.totalFailing, 0);
    assert.equal(result.detail.tolerated, 0);
  } finally { cleanup(fx); }
});

// --- classifyFailures unit (pure function, no subprocess) --------------------

test('classifyFailures: separates new from tolerated by exact test description', () => {
  const gaps = [{ test: 'known one', owner: 'X' }];
  const { newFailures, tolerated } = toolCoverage.classifyFailures(['known one', 'brand new one'], gaps);
  assert.deepEqual(newFailures, ['brand new one']);
  assert.deepEqual(tolerated, ['known one']);
});

// --- Non-vacuous positive against the REAL repo, read-only -------------------

test('AC-TC.4: the REAL .claude/tools ledger declares every real *.test.js file (self-coverage, static)', () => {
  const result = toolCoverage.check({ staticOnly: true });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
});

test('AC-TC.4: the ledger covers ITS OWN checker (tool-coverage.js / .test.js) — an unwired coverage check is the defect it exists to catch', () => {
  const ledger = toolCoverage.loadLedger(REAL_LEDGER_PATH);
  const ids = ledger.guards.map((g) => g.id);
  assert.ok(ids.includes('tool-coverage.test.js'), 'tool-coverage.test.js is not declared in its own ledger');
});

test('AC-TC.4: the REAL declared lane actually invokes the REAL runBy command — non-vacuous, against the real workflow file', () => {
  const ledger = toolCoverage.loadLedger(REAL_LEDGER_PATH);
  const wired = toolCoverage.checkWired(ledger, REAL_REPO_ROOT);
  assert.equal(wired.ok, true, wired.reason);
});

test('AC-TC.4: the real 10 pre-existing environment-dependent failures are ALL declared knownEnvironmentGaps rows (nothing new, nothing forgotten)', () => {
  const ledger = toolCoverage.loadLedger(REAL_LEDGER_PATH);
  const gaps = ledger.knownEnvironmentGaps || [];
  assert.equal(gaps.length, 10, `expected exactly the 10 DEF-ROC-213-owned rows, found ${gaps.length}`);
  assert.ok(gaps.every((g) => g.owner === 'DEF-ROC-213'),
    'every knownEnvironmentGaps row must cite its owning item (a skip with no owner is a silent skip)');
});

// --- CLI smoke ----------------------------------------------------------------

test('CLI: `node tool-coverage.js --static-only --json` against the real repo exits 0 and prints parseable PASS json', () => {
  const res = spawnSync(process.execPath, [CHECKER_PATH, '--static-only', '--json'], {
    cwd: REAL_REPO_ROOT, encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.status, 'PASS');
});

test('CLI: a seeded fixture with an undeclared file exits 1 through the real CLI entrypoint, not just the library function', () => {
  const fx = makeFixture({ withUndeclared: true });
  try {
    const res = spawnSync(process.execPath, [
      CHECKER_PATH, '--static-only',
      '--tools-dir', fx.toolsDir, '--repo-root', fx.repoRoot, '--ledger-path', fx.ledgerPath,
    ], { cwd: fx.repoRoot, encoding: 'utf8' });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /UNDECLARED/);
    assert.match(res.stderr, /beta\.test\.js/);
  } finally { cleanup(fx); }
});

test('CLI: the same fixture, once fixed, exits 0 through the real CLI entrypoint — the round trip is proven, not assumed', () => {
  const fx = makeFixture();
  try {
    const res = spawnSync(process.execPath, [
      CHECKER_PATH, '--static-only',
      '--tools-dir', fx.toolsDir, '--repo-root', fx.repoRoot, '--ledger-path', fx.ledgerPath,
    ], { cwd: fx.repoRoot, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
  } finally { cleanup(fx); }
});
