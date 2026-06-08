#!/usr/bin/env node
'use strict';
/**
 * validate-impacted.js — IMP-009 L2 (OI-45) impacted-driven smoke selection.
 *
 * Invoked by the ROOT Makefile target:
 *   make validate-impacted SINCE=<sha> [PROJECT=oxo-online] [PROD_URL=https://…]
 * which runs:
 *   node work/oxo-online/scripts/validate-impacted.js \
 *     --since <sha> --project <name> [--prod-url <url>]
 *
 * WHAT IT DOES
 *   1. Calls `make impacted-tests SINCE=<sha> PROJECT=<project>` to get the set
 *      of impacted specs for the window (changed nodes → covering spec paths).
 *   2. Unions those spec paths with the REGRESSION CORE (below).
 *   3. Runs ONLY that union via `playwright test --config=playwright.config.ts
 *      <specFile1> <specFile2> …` — not the full suite.
 *   4. Logs every smoke spec NOT in the union as SKIPPED (coverage-honesty guard:
 *      a narrowed run must never be mistaken for full coverage).
 *   5. Exits nonzero on any test failure.
 *
 * REGRESSION CORE — the always-run set (see CORE_RATIONALE below).
 * These spec FILES are always included regardless of the SINCE window.
 *
 * COVERAGE GUARD (process §17, IMP-009 §3)
 *   - The regression core always runs.
 *   - Any uncovered-changed-node in the impacted-tests output still requires a
 *     spec or explicit waiver (existing §12a rule — unchanged).
 *   - A FULL `make smoke` runs at chunk delivery (the periodic backstop) so a
 *     break in a non-impacted, non-core spec surfaces.
 *   - This script logs the SKIPPED specs so the operator knows exactly what
 *     was not exercised in this run.
 *
 * Per IMP-009 L2 — the CALLER records the DORA validation_run row via the
 * Makefile target (mirrors how make validate/smoke record their rows).
 */

const { execFileSync, execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// REGRESSION CORE
// ---------------------------------------------------------------------------
// Each entry: { file: relative-from-smoke-dir, rationale: string }
// File paths are relative to work/<project>/src/app/tests/smoke/ for
// display; SPEC_PATH is computed as the full path for the Playwright CLI.
//
// Design rule: keep it small (speed) but sufficient that a break in a core
// user journey can NEVER be skipped. Add to this list only when the journey
// is not covered by any feasible impacted-spec selection.
// ---------------------------------------------------------------------------
const CORE_RATIONALE = [
  {
    file: 'shell.spec.ts',
    rationale:
      'Identity gate (build-sha / principles/01) + SPA loads. ' +
      'Must run every slice: a failed deploy or stale-edge CDN breaks every downstream spec.',
  },
  {
    file: 'board-geometry.spec.ts',
    rationale:
      'Board 3×3 geometry (EXP-016 / DEFECT-S002-001). ' +
      'CSS regressions silently break layout while functional tests stay green. ' +
      'The s002 lesson: geometry must be asserted every slice.',
  },
  {
    file: 'slice005-h2-pairing.spec.ts',
    rationale:
      'Pairing within SLA via real WS authorizer (AC7.3). ' +
      'If the WS authorizer rejects a legitimate credential no online game can start — ' +
      'the most critical infrastructure gate, must run every slice.',
  },
  {
    file: 'slice006-move-relay.spec.ts',
    rationale:
      'Full online game create→join→play→result (F1/T1/T2/T3). ' +
      'The primary customer journey end-to-end. ' +
      'Any regression in game logic, relay, or board-lock is caught here.',
  },
  {
    file: 'slice007-disconnect.spec.ts',
    rationale:
      'Disconnect flow both directions + new-game-after-disconnect (AC4.1/AC4.1B/AC4.5). ' +
      'Opponent disconnect is a frequent real-world event; the survivor UX must not break.',
  },
  {
    file: 'slice009-arcade-scoreboard.spec.ts',
    rationale:
      'Leaderboard cross-instance read (SM-1/F1/T-LB-7). ' +
      'The shared observable state: Player B sees Player A\'s win update within 10s. ' +
      'Validates the DynamoDB Stream path end-to-end on every slice.',
  },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since')      opts.since    = argv[++i];
    if (a === '--project')    opts.project  = argv[++i];
    if (a === '--prod-url')   opts.prodUrl  = argv[++i];
    if (a === '--root')       opts.root     = argv[++i];
  }
  return opts;
}

function resolveProject(root, project) {
  if (project) return project;
  const active = path.join(root, 'work', 'ACTIVE');
  if (fs.existsSync(active)) return fs.readFileSync(active, 'utf8').trim();
  return null;
}

/**
 * Run `make impacted-tests SINCE=<sha> PROJECT=<project>` from root.
 * Returns the stdout string. Exit 2 (advisory uncovered) is NOT a failure —
 * we print a warning but continue (the §12a waiver/spec obligation is the
 * tester's, not a blocker here).
 */
function runImpactedTests(root, since, project) {
  try {
    const out = execFileSync(
      'make', ['impacted-tests', `SINCE=${since}`, `PROJECT=${project}`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return out;
  } catch (err) {
    // make exits 2 for advisory uncovered nodes — still usable output.
    if (err.status === 2) {
      process.stderr.write(
        '[validate-impacted] WARNING: impacted-tests exited 2 (uncovered changed nodes). ' +
        'Each uncovered node needs a @covers spec or explicit waiver (§12a).\n',
      );
      return err.stdout ?? '';
    }
    throw new Error(`make impacted-tests failed (exit ${err.status}): ${err.message}`);
  }
}

/**
 * Parse the IMPACTED SPECS section of impacted-tests output.
 * Lines of the form `        - <absolute-or-relative path>` under the
 * ## IMPACTED SPECS header.
 */
function parseImpactedSpecPaths(output) {
  const paths = new Set();
  let inSection = false;
  for (const line of output.split('\n')) {
    if (line.startsWith('## IMPACTED SPECS')) { inSection = true; continue; }
    if (line.startsWith('##'))               { inSection = false; continue; }
    if (!inSection) continue;
    const m = line.match(/^\s+-\s+(.+)$/);
    if (m) paths.add(m[1].trim());
  }
  return [...paths];
}

/**
 * Enumerate all *.spec.ts files in the smoke directory (the full suite set).
 */
function allSmokeSpecs(smokeDir) {
  return fs.readdirSync(smokeDir)
    .filter(f => f.endsWith('.spec.ts'))
    .sort()
    .map(f => path.join(smokeDir, f));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root    = opts.root || process.cwd();
  const project = resolveProject(root, opts.project);

  if (!opts.since) {
    process.stderr.write('usage: validate-impacted.js --since <sha> [--project <name>] [--prod-url <url>]\n');
    process.exit(1);
  }
  if (!project) {
    process.stderr.write('no project: pass --project or create work/ACTIVE\n');
    process.exit(1);
  }

  const appDir  = path.join(root, 'work', project, 'src', 'app');
  const smokeDir = path.join(appDir, 'tests', 'smoke');

  // 1. Run impacted-tests to get the window's impacted spec paths.
  process.stdout.write(`[validate-impacted] running make impacted-tests SINCE=${opts.since} PROJECT=${project}\n`);
  const impactedOutput = runImpactedTests(root, opts.since, project);
  process.stdout.write('[validate-impacted] impacted-tests output:\n');
  process.stdout.write(impactedOutput + '\n');

  // Parse impacted spec absolute paths.
  const rawImpactedPaths = parseImpactedSpecPaths(impactedOutput);
  // Resolve to absolute paths; keep only smoke-suite specs (validation suite
  // and skeleton/local suites are not in scope here).
  const impactedSmokeSpecs = new Set(
    rawImpactedPaths
      .map(p => path.isAbsolute(p) ? p : path.resolve(root, p))
      .filter(p => p.startsWith(smokeDir)),
  );

  // 2. Regression core — resolve to absolute paths in the smoke dir.
  const coreSpecs = CORE_RATIONALE.map(entry => path.join(smokeDir, entry.file));

  // 3. Union: impacted ∪ core.
  const runSet = new Set([...coreSpecs, ...impactedSmokeSpecs]);
  // Verify all selected files exist; warn and drop missing (guard against
  // a typo in the core list or a spec renamed between slices).
  const runList = [...runSet].filter(p => {
    if (fs.existsSync(p)) return true;
    process.stderr.write(`[validate-impacted] WARNING: selected spec not found, skipping: ${p}\n`);
    return false;
  }).sort();

  // 4. Compute the SKIPPED set (all smoke specs NOT in runList).
  const allSmoke = allSmokeSpecs(smokeDir);
  const skipped = allSmoke.filter(p => !runList.includes(p));

  // ---- report ----------------------------------------------------------------
  process.stdout.write('\n========== validate-impacted: SELECTION REPORT ==========\n');
  process.stdout.write(`Project: ${project}  SINCE: ${opts.since}\n\n`);

  process.stdout.write('REGRESSION CORE (always-run):\n');
  for (const entry of CORE_RATIONALE) {
    const abs = path.join(smokeDir, entry.file);
    const exists = fs.existsSync(abs) ? '' : ' [MISSING]';
    process.stdout.write(`  [CORE] ${entry.file}${exists}\n`);
    process.stdout.write(`         Rationale: ${entry.rationale}\n`);
  }
  process.stdout.write('\n');

  process.stdout.write('IMPACTED SPECS (from impacted-tests SINCE window):\n');
  if (impactedSmokeSpecs.size === 0) {
    process.stdout.write('  (none in smoke suite)\n');
  } else {
    for (const p of [...impactedSmokeSpecs].sort()) {
      process.stdout.write(`  [IMPACTED] ${path.relative(smokeDir, p)}\n`);
    }
  }
  process.stdout.write('\n');

  process.stdout.write(`WILL RUN (impacted ∪ core = ${runList.length} spec files / ${allSmoke.length} total):\n`);
  for (const p of runList) {
    const tag = coreSpecs.includes(p)
      ? (impactedSmokeSpecs.has(p) ? '[CORE+IMPACTED]' : '[CORE]')
      : '[IMPACTED]';
    process.stdout.write(`  ${tag} ${path.relative(smokeDir, p)}\n`);
  }
  process.stdout.write('\n');

  process.stdout.write(`SKIPPED (${skipped.length} spec files NOT in impacted ∪ core):\n`);
  process.stdout.write('  NOTE: skipped specs are exercised by the periodic FULL make smoke run\n');
  process.stdout.write('  (§17 no-silent-caps backstop — run make smoke at every chunk delivery).\n');
  if (skipped.length === 0) {
    process.stdout.write('  (none — all smoke specs are in the run set)\n');
  } else {
    for (const p of skipped) {
      process.stdout.write(`  [SKIPPED] ${path.relative(smokeDir, p)}\n`);
    }
  }
  process.stdout.write('\n');
  process.stdout.write('=========================================================\n\n');

  if (runList.length === 0) {
    process.stdout.write('[validate-impacted] Nothing to run (no core specs found). Exiting 1.\n');
    process.exit(1);
  }

  // 5. Run Playwright against the selected spec files only.
  const env = { ...process.env };
  if (opts.prodUrl) env.PROD_URL = opts.prodUrl;

  const playwrightArgs = [
    'playwright', 'test',
    '--config=playwright.config.ts',
    ...runList,   // Playwright accepts file paths as positional arguments
  ];

  process.stdout.write(`[validate-impacted] running: npx ${playwrightArgs.join(' ')}\n`);
  process.stdout.write(`[validate-impacted] cwd: ${appDir}\n\n`);

  const result = spawnSync('npx', playwrightArgs, {
    cwd: appDir,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    process.stderr.write(`[validate-impacted] spawn error: ${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main();
