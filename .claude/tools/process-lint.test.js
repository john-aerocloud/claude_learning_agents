'use strict';
/**
 * process-lint.test.js — v145 (ROC) self-tests.
 *
 * THE HARM THIS PINS. Two structural inconsistencies each survived many process
 * versions because no tool read the files' own internal consistency:
 *
 *  1. `# Current Process — vNN` was 19 versions stale when v138 found it, and 2
 *     versions stale again when v145 found it. It is the line an agent reads to
 *     learn which process it is running.
 *  2. `process/experiments.md` allocated ids from a GLOBAL counter with PER-INSTANCE
 *     writers, so two experiments were both minted as `EXP-142` (main's
 *     test-requirement-gate ratchet, ROC's screen-viewport hypothesis), and six
 *     ROC-authored `## EXP-` sections existed with NO registry row — making the
 *     "8 active, AT cap" reading untrue for two consecutive retros. Same class as
 *     DEF-ROC-077 the same day: a global registry read against per-project reality.
 *
 * Acceptance criteria under test:
 *   AC-L.1  a stale version heading is caught, naming both versions.
 *   AC-L.2  an `## EXP-` section with no registry row is caught.
 *   AC-L.3  an id defined twice (two rows, or two sections) is caught.
 *   AC-L.4  a bare-numeric id outside the FROZEN legacy set is caught, so the old
 *           global counter cannot mint another row; the namespaced form passes.
 *   AC-L.5  NON-VACUITY: a table row that appears INSIDE a section (sections carry
 *           their own tables whose first column is sometimes an EXP id) must NOT
 *           satisfy AC-L.2 — otherwise C2 passes for free.
 *   AC-L.6  NON-VACUITY: the parser works on the REAL experiments.md, not just
 *           fixtures — it finds the live registry rows.
 *   AC-L.7  a clean fixture passes.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lint = require('./process-lint.js');

function fixture(procMd, expMd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-lint-'));
  fs.mkdirSync(path.join(dir, 'process'));
  fs.writeFileSync(path.join(dir, 'process', 'process-current.md'), procMd);
  fs.writeFileSync(path.join(dir, 'process', 'experiments.md'), expMd);
  return dir;
}

const CLEAN_PROC = [
  '<!-- v145 (retro, ROC 2026-08-20) ... -->',
  '<!-- v144 (retro, ROC 2026-08-20) ... -->',
  '',
  '# Current Process — v145',
  '',
].join('\n');

const CLEAN_EXP = [
  '# Experiment registry',
  '',
  '| id | routed | status |',
  '|----|--------|--------|',
  '| EXP-143 | v144 (2026-08-20, ROC) | active |',
  '| EXP-ROC-001 | v145 (2026-08-20, ROC) | active |',
  '',
  '## EXP-143 — a park with no probe never ends',
  'body',
  '',
  '## EXP-ROC-001 — a screen is evaluated as a SCREEN',
  'body',
  '',
].join('\n');

test('AC-L.7 a clean fixture passes', () => {
  const dir = fixture(CLEAN_PROC, CLEAN_EXP);
  const { violations } = lint.lint(dir);
  assert.deepStrictEqual(violations, []);
});

test('AC-L.1 a stale version heading is caught, naming both versions', () => {
  const stale = CLEAN_PROC.replace('# Current Process — v145', '# Current Process — v142');
  const dir = fixture(stale, CLEAN_EXP);
  const { violations } = lint.lint(dir);
  assert.strictEqual(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /^C1 /);
  assert.match(violations[0], /v142/);
  assert.match(violations[0], /v145/);
});

test('AC-L.2 an `## EXP-` section with no registry row is caught', () => {
  const exp = CLEAN_EXP + '\n## EXP-ROC-002 — a finding written as a section\nbody\n';
  const dir = fixture(CLEAN_PROC, exp);
  const { violations } = lint.lint(dir);
  assert.strictEqual(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /^C2 /);
  assert.match(violations[0], /EXP-ROC-002/);
  assert.match(violations[0], /NO registry row/);
});

test('AC-L.3 an id defined twice is caught — two rows, and two sections', () => {
  const dupRow = CLEAN_EXP.replace(
    '| EXP-ROC-001 | v145 (2026-08-20, ROC) | active |',
    '| EXP-ROC-001 | v145 (2026-08-20, ROC) | active |\n| EXP-ROC-001 | v145 (dup) | active |'
  );
  let r = lint.lint(fixture(CLEAN_PROC, dupRow));
  assert.strictEqual(r.violations.length, 1, r.violations.join('\n'));
  assert.match(r.violations[0], /^C2 duplicate registry row `EXP-ROC-001`/);

  const dupSection = CLEAN_EXP + '\n## EXP-ROC-001 — FOURTH INSTANCE\nbody\n';
  r = lint.lint(fixture(CLEAN_PROC, dupSection));
  assert.strictEqual(r.violations.length, 1, r.violations.join('\n'));
  assert.match(r.violations[0], /^C2 duplicate `## EXP-ROC-001` section/);
});

test('AC-L.4 a bare-numeric id outside the frozen set fails; the namespaced form passes', () => {
  // EXP-136 was a real ROC-authored id minted from the abolished global counter.
  const minted = CLEAN_EXP.replace(
    '| EXP-ROC-001 | v145 (2026-08-20, ROC) | active |',
    '| EXP-ROC-001 | v145 (2026-08-20, ROC) | active |\n| EXP-136 | v141 (ROC) | active |'
  ).replace('## EXP-ROC-001', '## EXP-136 — docs-only\nbody\n\n## EXP-ROC-001');
  const r = lint.lint(fixture(CLEAN_PROC, minted));
  const c3 = r.violations.filter((v) => v.startsWith('C3 '));
  assert.strictEqual(c3.length, 2, r.violations.join('\n')); // the row AND the section
  assert.match(c3[0], /EXP-136/);
  assert.match(c3[0], /FROZEN legacy set/);

  // A frozen legacy id is still permitted (they are grandfathered, not rewritten).
  const legacy = CLEAN_EXP.replaceAll('EXP-ROC-001', 'EXP-142');
  assert.deepStrictEqual(lint.lint(fixture(CLEAN_PROC, legacy)).violations, []);
});

test('AC-L.5 NON-VACUITY: a table row inside a section does not satisfy the row requirement', () => {
  // This exact shape is live in experiments.md: a section whose body carries a
  // cross-instance summary table with EXP ids in the first column. If the parser
  // counted those as registry rows, C2 would pass for free.
  const exp = CLEAN_EXP + [
    '',
    '## EXP-ROC-009 — a finding with its own summary table',
    '',
    '| # | shape | role |',
    '|---|-------|------|',
    '| EXP-ROC-009 | docs-only | documenter |',
    '',
  ].join('\n');
  const { violations } = lint.lint(fixture(CLEAN_PROC, exp));
  assert.strictEqual(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /EXP-ROC-009/);
  assert.match(violations[0], /NO registry row/);

  const parsed = lint.parseRegistry(exp);
  assert.ok(!parsed.rows.some((r) => r.id === 'EXP-ROC-009'), 'in-section table line was counted as a registry row');
});

test('AC-L.6 NON-VACUITY: the parser finds the live rows in the REAL experiments.md', () => {
  const real = fs.readFileSync(path.resolve(__dirname, '..', '..', 'process', 'experiments.md'), 'utf8');
  const { rows } = lint.parseRegistry(real);
  assert.ok(rows.length >= 5, `expected the real registry table to parse, got ${rows.length} rows`);

  // The anchor is the row SHAPE and the presence of live work, never a specific id.
  //
  // This assertion used to name `EXP-143`, and v148 retired that row out of the table —
  // so the check went red for a REASON THAT WAS CORRECT BEHAVIOUR, and until then it had
  // been silently anchored to a row that could vanish at any retro. That is the same fault
  // OI-CO-OWNED-LEDGER-FILES and DEFECT-OAG-137 both hit: a check keyed to something the
  // system itself moves (a retiring row, an item file relocating active/ -> done/) breaks
  // on an ordinary state transition, and the breakage lands on trunk rather than on the
  // thing that moved. A non-vacuity anchor must be LIFECYCLE-STABLE.
  //
  // Both limbs below still fail on the vacuous parse this test exists to catch (a parser
  // returning [] or returning rows with no id/status), while surviving any adopt-or-kill.
  assert.ok(
    rows.every((r) => /^EXP-([A-Z0-9]+-)?\d+$/.test(r.id)),
    `every parsed row must carry a well-formed id; got ${rows.map((r) => r.id).join(', ')}`,
  );
  // NB `line` is the line NUMBER; the row text lives in `routed` (which, per the ROC v150
  // finding, captures the whole rest of the row rather than only the routed cell).
  assert.ok(
    rows.some((r) => /\bactive\b/.test(String(r.routed ?? ''))),
    'the real registry must contain at least one ACTIVE row — an all-retired table means the parser found headings, not rows',
  );
});

test('an absent file is reported, not silently clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-lint-empty-'));
  const { violations } = lint.lint(dir);
  assert.strictEqual(violations.length, 2, violations.join('\n'));
  assert.ok(violations.every((v) => v.startsWith('C0 ')));
});

test('AC-L.8 the per-project hard cap is ENFORCED, and an unattributed row is a violation', () => {
  // Nine ROC rows against the cap of 8.
  const rows = Array.from({ length: 9 }, (_, i) => `| EXP-ROC-${String(i + 1).padStart(3, '0')} | v145 (ROC) | active |`);
  const exp = ['# Experiment registry', '', '| id | routed | status |', '|----|--------|--------|', ...rows, ''].join('\n');
  const over = lint.lint(fixture(CLEAN_PROC, exp)).violations;
  assert.strictEqual(over.length, 1, over.join('\n'));
  assert.match(over[0], /^C4 ROC has 9 active rows against the per-project hard cap of 8/);

  // Eight is fine.
  const at = ['# Experiment registry', '', '| id | routed | status |', '|----|--------|--------|', ...rows.slice(0, 8), ''].join('\n');
  assert.deepStrictEqual(lint.lint(fixture(CLEAN_PROC, at)).violations, []);

  // A row naming no project anywhere is uncapped by construction.
  const orphan = ['# Experiment registry', '', '| id | routed | status |', '|----|--------|--------|',
    '| EXP-142 | process §17d.5 + tool | active |', ''].join('\n');
  const v = lint.lint(fixture(CLEAN_PROC, orphan)).violations;
  assert.strictEqual(v.length, 1, v.join('\n'));
  assert.match(v[0], /^C4 1 row\(s\) name no project/);
});

test('AC-L.9 one project spelled two ways counts as ONE project, so the cap cannot be doubled', () => {
  // OagEventSource's work items are all `OAG`-prefixed (`DEFECT-OAG-nnn`, `OI-OAG-*`), so its
  // experiment ids read `EXP-OAG-nnn` while its `routed` cells spell the project out in full.
  // Both spellings name the SAME project. Before this, `projectOf` returned 'OAG' for the
  // id-namespaced rows and 'OagEventSource' for the routed-cell rows, so the per-project cap of
  // 8 was silently a cap of 16 — C4 defeated not by an argument but by an alias. That is the
  // same shape as every other finding in this registry: a control that exists and does not fire.
  // Five rows carrying the short id token, four carrying the long name in `routed` (frozen
  // legacy ids, so C3 stays silent and only C4 is under test).
  const idRows = Array.from({ length: 5 }, (_, i) => `| EXP-OAG-${String(i + 1).padStart(3, '0')} | v145 | active |`);
  const legacy = ['EXP-127', 'EXP-128', 'EXP-129', 'EXP-131'];
  const routedRows = legacy.map((id) => `| ${id} | v145 (OagEventSource retro) | active |`);
  const exp = ['# Experiment registry', '', '| id | routed | status |', '|----|--------|--------|',
    ...idRows, ...routedRows, ''].join('\n');
  const { violations, info } = lint.lint(fixture(CLEAN_PROC, exp));

  // 5 + 4 = 9 rows for one project, against the cap of 8.
  assert.strictEqual(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /^C4 OagEventSource has 9 active rows against the per-project hard cap of 8/);

  // And it must be reported under ONE canonical name, never split across two INFO lines.
  assert.strictEqual(info.filter((l) => /^OAG:/.test(l)).length, 0, info.join('\n'));
});
