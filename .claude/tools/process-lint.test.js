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

// ---------------------------------------------------------------------------
// C5 — ORPHAN DECLARATIONS IN queues/policy.csv (DEF-ROC-119)
//
// THE HARM. `deploy,wip_limit,1` sat in every project's policy.csv and in the
// _TEMPLATE every new project is seeded from. NO state maps to a `deploy` queue —
// the queue_map codomain is intake/ready/wip/waiting/rework/null — so the queue can
// never have a member, loop-gate check 3 iterates the queues items are actually IN,
// and the declared serialisation was unenforceable BY CONSTRUCTION. It read as a
// control for months. The same day, three live `wip.*` knobs cited `EXP-ROC-005`,
// which exists in neither the registry nor the archive: the limit in force had never
// been scoreable either. Two orphan-declaration defects, one class — hence a
// generalised check rather than two point repairs (AC-119-4).
//
//   AC-L.10   a policy.csv queue that NO state maps to is caught, naming the queue.
//   AC-L.11   a policy.csv `experiment` cell naming an id in neither the registry nor
//            the archive is caught.
//   AC-L.12  an ARCHIVED experiment is a REAL experiment — citing one passes. (Most
//            live knobs cite archived rows; failing them would make C5 unusable and
//            it would be switched off, which is how a gate dies.)
//   AC-L.13  `_global` is a reserved pseudo-queue read by work-items.py, not an orphan.
//   AC-L.14  NON-VACUITY: the queue codomain is READ FROM state-graphs.json, not
//            hardcoded — a fixture whose map DOES admit the queue passes the same
//            declaration that fails against a map that does not.
//   AC-L.15  NON-VACUITY: run against the REAL repo, C5 actually scans policy files
//            (a check that found nothing to check is not the same as clean).

const CLEAN_GRAPHS = JSON.stringify({
  queue_map: {
    registered: 'intake', ready: 'ready', building: 'wip',
    reworking: 'rework', blocked: 'waiting', done: null,
  },
});

const CLEAN_ARCHIVE = [
  '# Archived experiments',
  '',
  '| EXP-022 | v60 (OagEventSource) | adopted |',
  '| EXP-123 | v126 (2026-08-01, OagEventSource) | adopted |',
  '| EXP-ROC-007 | v153 (2026-08-26, ROC) | killed |',
  '',
].join('\n');

const POLICY_HEADER =
  'queue,param,value,unit,owner,target_metric,last_tuned,experiment';

/** A fixture root carrying process files, a queue map, an archive and policy.csv files. */
function policyFixture(policies, opts = {}) {
  const dir = fixture(opts.proc || CLEAN_PROC, opts.exp || CLEAN_EXP);
  fs.mkdirSync(path.join(dir, 'process', 'machinery'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'process', 'machinery', 'state-graphs.json'),
    opts.graphs || CLEAN_GRAPHS);
  fs.writeFileSync(path.join(dir, 'process', 'experiments-archive.md'),
    opts.archive === undefined ? CLEAN_ARCHIVE : opts.archive);
  for (const [project, rows] of Object.entries(policies)) {
    const qdir = path.join(dir, 'work', project, 'queues');
    fs.mkdirSync(qdir, { recursive: true });
    fs.writeFileSync(path.join(qdir, 'policy.csv'),
      [POLICY_HEADER, ...rows].join('\n') + '\n');
  }
  return dir;
}

const OK_ROWS = [
  'ready,kind,wip,kind,flow-manager,gross-lead-time,2026-08-25,EXP-123',
  'ready,wip_limit,4,count,flow-manager,gross-lead-time,<created>,EXP-022',
];

test('AC-L.10 a policy.csv queue that NO state maps to is caught', () => {
  const dir = policyFixture({
    ROC: [...OK_ROWS,
      'deploy,wip_limit,1,count,cicd,gross-lead-time,<created>,EXP-022'],
  });
  const { violations } = lint.lint(dir);
  const c5 = violations.filter((v) => v.startsWith('C5 '));
  assert.strictEqual(c5.length, 1, violations.join('\n'));
  assert.match(c5[0], /deploy/);
  assert.match(c5[0], /no state maps to it/i);
  // The remedy must be stated: a blocking control that does not say what to do is
  // the shape this whole item is about.
  assert.match(c5[0], /Remedy/);
});

test('AC-L.11 a policy.csv knob citing an experiment that exists NOWHERE is caught', () => {
  const dir = policyFixture({
    ROC: [...OK_ROWS,
      'ready,min_items,2,count,flow-manager,throughput,<created>,EXP-ROC-005'],
  });
  const { violations } = lint.lint(dir);
  const c5 = violations.filter((v) => v.startsWith('C5 '));
  assert.strictEqual(c5.length, 1, violations.join('\n'));
  assert.match(c5[0], /EXP-ROC-005/);
  assert.match(c5[0], /never been scoreable|no row/i);
});

test('AC-L.12 an ARCHIVED experiment is real — citing one passes', () => {
  // EXP-022 and EXP-ROC-007 live only in the archive; both are cited by live knobs.
  const dir = policyFixture({
    ROC: [...OK_ROWS,
      'wip,wip_limit,8,count,flow-manager,gross-lead-time,2026-08-26,EXP-ROC-007'],
  }, { graphs: JSON.stringify({ queue_map: { building: 'wip', ready: 'ready' } }) });
  const { violations } = lint.lint(dir);
  assert.deepStrictEqual(violations.filter((v) => v.startsWith('C5 ')), []);
});

test('AC-L.13 `_global` is a reserved pseudo-queue, not an orphan', () => {
  const dir = policyFixture({
    ROC: [...OK_ROWS,
      '_global,max_backlog_age_days,7,days,flow-manager,gross-lead-time,<created>,EXP-123'],
  });
  const { violations } = lint.lint(dir);
  assert.deepStrictEqual(violations.filter((v) => v.startsWith('C5 ')), []);
});

test('AC-L.14 NON-VACUITY the queue codomain is read from state-graphs.json, not hardcoded', () => {
  const rows = [...OK_ROWS,
    'deploy,wip_limit,1,count,cicd,gross-lead-time,<created>,EXP-022'];
  // Same declaration, two maps. It is an orphan against the real map and NOT an
  // orphan against a map that gives `deploy` a state — so the verdict comes from
  // the map, which is the only thing that makes C5 a check rather than a denylist.
  const admits = policyFixture({ ROC: rows }, {
    graphs: JSON.stringify({
      queue_map: { registered: 'intake', ready: 'ready', building: 'wip',
        deploying: 'deploy', reworking: 'rework', blocked: 'waiting', done: null },
    }),
  });
  assert.deepStrictEqual(lint.lint(admits).violations.filter((v) => v.startsWith('C5 ')), []);
  const denies = policyFixture({ ROC: rows });
  assert.strictEqual(lint.lint(denies).violations.filter((v) => v.startsWith('C5 ')).length, 1);
});

test('AC-L.15 NON-VACUITY C5 scans real policy files in the real repo', () => {
  // The floor is ONE, not two, and the reason is the DEF-ROC-213 class: every
  // `work/<project>/` is a gitignored nested repo (v50), so a CI checkout contains
  // NONE of them. Only `work/_TEMPLATE/queues/policy.csv` is tracked — and it is the
  // file that matters most anyway, being what every new project is seeded from. An
  // assertion of >= 2 passes on a developer's machine and fails in CI for a reason
  // that has nothing to do with the code, which is a false red; >= 1 still proves the
  // scan is real, because zero is the vacuous answer this pins against.
  const root = path.resolve(__dirname, '..', '..');
  const { info } = lint.lint(root);
  const scanned = info.find((i) => /^C5 scanned /.test(i));
  assert.ok(scanned, `no C5 scan line in info: ${info.join(' | ')}`);
  const n = Number(/^C5 scanned (\d+) /.exec(scanned)[1]);
  assert.ok(n >= 1, `C5 scanned ${n} policy file(s) — a check with nothing to check is not clean`);
  assert.ok(fs.existsSync(path.join(root, 'work', '_TEMPLATE', 'queues', 'policy.csv')),
    'work/_TEMPLATE/queues/policy.csv is TRACKED and must be in every checkout — it is '
    + 'the seed every new project inherits, so an orphan there propagates');
});

test('AC-L.16 a RETIRED archive entry still declares its id — two real forms', () => {
  // The archive holds live-format rows AND retirement entries, and a retired row is
  // re-quoted INDENTED under a bullet. EXP-022 (the uniform-queue buffer model, KILLED
  // at v82) exists ONLY in those two forms, and is cited by live knobs in every
  // policy.csv. Reading only `^| EXP-... |` calls it "exists nowhere", which is a FALSE
  // violation about the most-cited id in the file — and a gate that lies about its
  // flagship case is one nobody believes.
  const archive = [
    '# Archived experiments',
    '',
    '- **EXP-022 — KILLED — no measurable effect / never validated.** superseded by v82.',
    '  - Original row: | EXP-022 | v40 (2026-06-08) | process §F2 + queues/policy.csv | ... |',
    '',
    '| EXP-123 | v126 (2026-08-01, OagEventSource) | adopted |',
    '',
  ].join('\n');
  const dir = policyFixture({ ROC: OK_ROWS }, { archive });
  assert.deepStrictEqual(lint.lint(dir).violations.filter((v) => v.startsWith('C5 ')), []);
});

test('AC-L.17 NON-VACUITY a bare PROSE MENTION does not declare an id', () => {
  // EXP-ROC-005 is mentioned inside EXP-ROC-007's and EXP-ROC-008's archived rows, so
  // "any EXP- token anywhere in the archive" would pass the exact id this check was
  // built to catch. The declaration must be STRUCTURAL — a row, or a retirement entry.
  const archive = [
    '# Archived experiments',
    '',
    '| EXP-022 | v40 | killed |',
    '| EXP-123 | v126 | adopted |',
    '| EXP-ROC-007 | v153 (ROC) | killed — supersedes EXP-ROC-005, whose number it inherited |',
    '',
  ].join('\n');
  const dir = policyFixture({
    ROC: [...OK_ROWS,
      'wip,wip_limit,5,count,flow-manager,gross-lead-time,<created>,EXP-ROC-005'],
  }, { archive, graphs: JSON.stringify({ queue_map: { building: 'wip', ready: 'ready' } }) });
  const c5 = lint.lint(dir).violations.filter((v) => v.startsWith('C5 '));
  assert.strictEqual(c5.length, 1, c5.join('\n'));
  assert.match(c5[0], /EXP-ROC-005/);
});
