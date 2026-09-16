#!/usr/bin/env node
'use strict';
/**
 * tool-coverage.js — DEF-ROC-211.
 *
 * The parent-repo half of the `guard-coverage.json` class (work/ROC/scripts/
 * guard-coverage.json, DEF-ROC-165): a control nobody consults reads as
 * assurance while catching nothing. `grep -rn "claude/tools" .github/workflows/`
 * returned NOTHING before this landed — the 352-case suite under
 * `.claude/tools/*.test.js` (including `isolated-commit.test.js`, the tool every
 * agent's every commit passes through) ran only when a human or agent happened
 * to type `node --test`.
 *
 * This checker does THREE things, in order, and each can fail independently:
 *
 *   1. DECLARED    — every `.claude/tools/*.test.js` file has a row in
 *                     `tool-coverage.json`'s `guards[]` (UNDECLARED if a real
 *                     file has no row; STALE if a row names a file that no
 *                     longer exists).
 *   2. WIRED        — the ledger's declared `lane` (a committed workflow file)
 *                      actually invokes the declared `runBy` command. A carrier
 *                      with no caller (DEF-ROC-165's `exit-gate-ran`, DEF-ROC-202's
 *                      quarantine gauge) is not a control.
 *   3. GREEN-OR-KNOWN — the suite is actually RUN, and every failure is either
 *                        absent or a pre-declared `knownEnvironmentGaps` entry
 *                        (a corpus-dependent case that cannot pass in a
 *                        parent-repo checkout, DEF-ROC-213 owns fixing the
 *                        fail-vs-skip mismatch). A NEW, undeclared failure is
 *                        always red.
 *
 * `--static-only` runs steps 1–2 only (fast, no subprocess) — used by
 * `tool-coverage.test.js`'s seeded-tree cases, which do not want to pay for a
 * real `node --test` run per case.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TOOLS_DIR = __dirname;
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

function listTestFiles(toolsDir) {
  return fs.readdirSync(toolsDir)
    .filter((f) => f.endsWith('.test.js'))
    .sort();
}

function loadLedger(ledgerPath) {
  return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
}

// Step 1 — DECLARED.
function checkDeclared(ledger, realFiles) {
  const declaredIds = ledger.guards.map((g) => g.id);
  const declaredSet = new Set(declaredIds);
  const realSet = new Set(realFiles);
  const undeclared = realFiles.filter((f) => !declaredSet.has(f));
  const stale = declaredIds.filter((id) => !realSet.has(id));
  return { undeclared, stale };
}

// Step 2 — WIRED. Confirms the ledger's declared lane file exists and its
// content references the declared runBy command (a plain substring check, same
// shape as the repo's other carrier/caller checks — no yaml parser needed to
// answer "does this text mention that command").
function checkWired(ledger, repoRoot) {
  const lanePath = path.join(repoRoot, ledger.lane);
  if (!fs.existsSync(lanePath)) {
    return { ok: false, reason: `declared lane "${ledger.lane}" does not exist` };
  }
  const content = fs.readFileSync(lanePath, 'utf8');
  if (!content.includes(ledger.runBy)) {
    return {
      ok: false,
      reason: `"${ledger.lane}" does not invoke the declared runBy command `
        + `("${ledger.runBy}") — a carrier with no caller`,
    };
  }
  return { ok: true };
}

// Step 3 — GREEN-OR-KNOWN. Runs the whole suite once via node's TAP reporter
// and returns the full list of `not ok` descriptions.
function runSuite(toolsDir, repoRoot) {
  const files = listTestFiles(toolsDir).map((f) => path.join(toolsDir, f));
  // NODE_TEST_CONTEXT is how node's own test runner marks a process as already
  // running under `--test`; a child inheriting it hits node's own recursion
  // guard ("run() is being called recursively ... skipping running files") and
  // silently runs NOTHING while exiting 0 — which would make this checker
  // report a false-clean suite whenever it is invoked from WITHIN a `node --test`
  // run, exactly the case `tool-coverage.test.js` (this checker's own suite,
  // itself one of the `.claude/tools/*.test.js` files) exercises. Strip it so
  // the nested run is real, whether called standalone (CI) or from inside our
  // own suite.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', ...files],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env },
  );
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  const failing = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^not ok \d+ - (.*)$/);
    if (m) failing.push(m[1].trim());
  }
  return { failing, raw: out, spawnError: res.error || null };
}

function classifyFailures(failing, knownGaps) {
  const knownTests = new Set(knownGaps.map((g) => g.test));
  const newFailures = failing.filter((f) => !knownTests.has(f));
  const tolerated = failing.filter((f) => knownTests.has(f));
  return { newFailures, tolerated };
}

/**
 * The whole check. Returns { ok, problems, detail } — never throws, never
 * exits — so tests can drive it directly against seeded fixtures.
 */
function check(opts) {
  const toolsDir = opts.toolsDir || DEFAULT_TOOLS_DIR;
  const repoRoot = opts.repoRoot || DEFAULT_REPO_ROOT;
  const ledgerPath = opts.ledgerPath || path.join(toolsDir, 'tool-coverage.json');
  const staticOnly = !!opts.staticOnly;

  const ledger = loadLedger(ledgerPath);
  const realFiles = listTestFiles(toolsDir);

  const { undeclared, stale } = checkDeclared(ledger, realFiles);
  const wired = checkWired(ledger, repoRoot);

  const problems = [];
  if (undeclared.length) {
    problems.push(`UNDECLARED: ${undeclared.join(', ')} — exist under the tools `
      + 'directory with no row in tool-coverage.json (a new suite would join the '
      + 'unrun tier silently)');
  }
  if (stale.length) {
    problems.push(`STALE: ${stale.join(', ')} — declared in tool-coverage.json `
      + 'but the file no longer exists');
  }
  if (!wired.ok) {
    problems.push(`UNWIRED: ${wired.reason}`);
  }

  if (problems.length || staticOnly) {
    return {
      ok: problems.length === 0,
      problems,
      detail: { undeclared, stale, wired, ran: false },
    };
  }

  const { failing, spawnError } = runSuite(toolsDir, repoRoot);
  if (spawnError) {
    return {
      ok: false,
      problems: [`could not run the suite: ${spawnError.message}`],
      detail: { undeclared, stale, wired, ran: false },
    };
  }
  const { newFailures, tolerated } = classifyFailures(failing, ledger.knownEnvironmentGaps || []);

  if (newFailures.length) {
    problems.push('UNDECLARED TEST FAILURES (not in knownEnvironmentGaps):');
    newFailures.forEach((f) => problems.push(`  - ${f}`));
  }

  return {
    ok: newFailures.length === 0,
    problems,
    detail: {
      undeclared,
      stale,
      wired,
      ran: true,
      testFiles: realFiles.length,
      totalFailing: failing.length,
      tolerated: tolerated.length,
      newFailures,
      knownGapCount: (ledger.knownEnvironmentGaps || []).length,
    },
  };
}

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const staticOnly = args.includes('--static-only');
  const toolsDir = flagValue(args, '--tools-dir');
  const repoRoot = flagValue(args, '--repo-root');
  const ledgerPath = flagValue(args, '--ledger-path');

  const result = check({ staticOnly, toolsDir, repoRoot, ledgerPath });

  if (!result.ok) {
    if (json) {
      console.log(JSON.stringify({ status: 'FAIL', problems: result.problems, detail: result.detail }));
    } else {
      console.error('tool-coverage: FAIL');
      result.problems.forEach((p) => console.error(`  - ${p}`));
    }
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify({ status: 'PASS', detail: result.detail }));
  } else if (result.detail.ran) {
    const usedLedgerPath = ledgerPath || path.join(toolsDir || DEFAULT_TOOLS_DIR, 'tool-coverage.json');
    const owners = [...new Set(
      (loadLedger(usedLedgerPath).knownEnvironmentGaps || [])
        .map((g) => g.owner),
    )];
    console.log(`tool-coverage: PASS — ${result.detail.testFiles} test files declared and wired to `
      + `the CI lane; ${result.detail.totalFailing} failing, all ${result.detail.tolerated} tolerated `
      + `as declared knownEnvironmentGaps (owner${owners.length === 1 ? '' : 's'}: ${owners.join(', ')})`);
  } else {
    console.log('tool-coverage: static checks PASS (ledger complete, lane wired)');
  }
}

module.exports = { check, checkDeclared, checkWired, classifyFailures, listTestFiles, loadLedger, runSuite };

if (require.main === module) {
  main();
}
