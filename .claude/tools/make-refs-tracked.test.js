'use strict';
/**
 * make-refs-tracked.test.js — OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS self-tests.
 *
 * THE HARM THIS PINS. A blanket ignore on `src/app/scripts/*.mjs` in the
 * OagEventSource repo has SILENTLY SWALLOWED A COMMITTED TOOL SIX TIMES. The
 * `.gitignore`'s own negation list is the evidence — it is a record of the trap
 * firing, written by the people it caught. The most recent was DEFECT-OAG-070's
 * `capture-ddb-stream-records.mjs`: the tool that produces the real AWS-shaped
 * fixture the whole fix depends on. `git add` dropped it without a word.
 *
 * The failure mode is FALSE GREEN, and it is the DEF-ROC-001 / v89 shape exactly:
 * the suite passes locally against a file nobody else has, the make target that runs
 * it is on trunk, and the file it runs is not. Nothing goes red. The next person to
 * run the target does not have the target's input.
 *
 * WHY A CHECK AND NOT A SEVENTH NEGATION LINE. A rule that must be exempted every
 * time it is used is not a rule, it is a trap with a maintenance burden — and each
 * negation makes the next occurrence MORE likely, because the pattern starts to look
 * deliberately curated rather than broken. Re-shaping the ignore fixes the six that
 * happened; this check is the general form, and it does not care which directory or
 * which ignore rule caused the omission.
 *
 * Acceptance criteria under test (OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS):
 *   AC-GI.3  a check that FAILS when a file referenced by a committed `make` target
 *            is not tracked. Per §17e the acceptance is the check OBSERVED FAILING.
 *            Sub-limbs, each a way the check could be useless:
 *              .3a  it reports an untracked-but-present referenced tool  (the defect)
 *              .3b  it does NOT report a generated artifact that a committed
 *                   generator regenerates (the exemption is DERIVED from the
 *                   `--outfile=` declarations, never a hand-kept list — a hand-kept
 *                   list is the negation list again)
 *              .3c  it reports a DANGLING reference: a target whose file is not there
 *                   at all. Same false-green shape from the other direction — the
 *                   target survived a retirement, the file did not.
 *              .3d  it does not flood: an UNCOMMITTED makefile is not a committed
 *                   make target and is not scanned; globs, prose inside an `echo`,
 *                   and workspace-relative paths are not findings.
 *              .3e  it would have caught the REAL six. Driven against the REAL
 *                   committed Makefile with the REAL tracked set, perturbed only in
 *                   the way reality perturbed it (the path absent from the index).
 *
 * PROVENANCE OF THE INPUTS (v125 §17d limb 2 — never author the precondition).
 * The load-bearing case, AC-GI.3e, does not author a Makefile. It reads the REAL
 * committed `work/OagEventSource/Makefile` and the REAL `git ls-files` set, and
 * removes ONE path from the tracked set — which is precisely and only what happened
 * six times: the file on disk, the target on trunk, the path absent from the index.
 * The synthetic makefiles in the parser cases are legitimate: their subject is GNU
 * make syntax, which we own and which is not a wire.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tool = require('./make-refs-tracked.js');
const TOOL = path.join(__dirname, 'make-refs-tracked.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OAG = path.join(REPO_ROOT, 'work', 'OagEventSource');

/** A tiny in-memory world: makefiles, package.json scripts, a tracked set, a disk. */
function world({
  makefiles = {}, packageJsons = {}, tracked = [], onDisk = [],
  nestedRepoTracked = () => null,     // null = no nested repo owns this path
  foreignTerritory = () => false,     // another repo's ground, not checked out here
} = {}) {
  const disk = new Set([...onDisk, ...tracked]);
  return {
    makefiles: Object.entries(makefiles).map(([p, text]) => ({ path: p, text })),
    packageJsons: Object.entries(packageJsons).map(([p, json]) => ({ path: p, json })),
    tracked: new Set(tracked),
    exists: (p) => disk.has(p),
    nestedRepoTracked,
    foreignTerritory,
  };
}

const kinds = (r) => r.findings.map((f) => `${f.kind}:${f.ref}`).sort();

// --- AC-GI.3a — the defect itself ------------------------------------------
test('AC-GI.3a a referenced tool that is on disk but NOT tracked is a finding', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'capture:\n\tnode src/app/scripts/capture-ddb-stream-records.mjs\n' },
    tracked: ['Makefile'],
    onDisk: ['src/app/scripts/capture-ddb-stream-records.mjs'],
  }));
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(kinds(r), ['untracked:src/app/scripts/capture-ddb-stream-records.mjs']);
  const f = r.findings[0];
  assert.equal(f.makefile, 'Makefile');
  assert.equal(f.line, 2, 'the finding must point at the referencing line');
});

test('AC-GI.3a the same reference, tracked, is not a finding', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'capture:\n\tnode src/app/scripts/capture-ddb-stream-records.mjs\n' },
    tracked: ['Makefile', 'src/app/scripts/capture-ddb-stream-records.mjs'],
  }));
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual(r.findings, []);
  assert.equal(r.counts.tracked, 1, 'it must have actually looked at the reference');
});

test('AC-GI.3a variables are expanded, or the reference is never seen at all', () => {
  // Every one of the six real instances is referenced through $(APP), so a checker
  // that cannot expand a make variable would have caught none of them.
  const r = tool.analyse(world({
    makefiles: {
      Makefile: 'APP := src/app\nseed:\n\t$(if $(NODE_BIN),$(NODE_BIN)/node,node) $(APP)/scripts/seed.mjs\n',
    },
    tracked: ['Makefile'],
    onDisk: ['src/app/scripts/seed.mjs'],
  }));
  assert.deepEqual(kinds(r), ['untracked:src/app/scripts/seed.mjs']);
});

// --- AC-GI.3b — the exemption, and that it is DERIVED ----------------------
test('AC-GI.3b a generated artifact declared by a committed generator is exempt', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'run:\n\tnode src/app/build/backfill.mjs\n' },
    packageJsons: {
      'src/app/package.json': { scripts: { 'bundle:backfill': 'esbuild src/service/backfill.ts --bundle --outfile=build/backfill.mjs' } },
    },
    tracked: ['Makefile', 'src/app/package.json', 'src/app/src/service/backfill.ts'],
    onDisk: ['src/app/build/backfill.mjs'],
  }));
  assert.equal(r.verdict, 'PASS', 'an artifact a committed generator regenerates is not a lost tool');
  assert.equal(r.counts.generated, 1);
});

test('AC-GI.3b a Makefile --outfile= declaration exempts too', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'b:\n\tesbuild a.ts --outfile=out/a.mjs\nrun:\n\tnode out/a.mjs\n' },
    tracked: ['Makefile', 'a.ts'],
    onDisk: ['out/a.mjs'],
  }));
  assert.equal(r.verdict, 'PASS');
});

test('AC-GI.3b the exemption is not a licence: an UNDECLARED artifact is still a finding', () => {
  // This is the whole reason the exemption is derived from --outfile= rather than
  // from a directory name. `build/` looking like a build dir must exempt nothing:
  // the sixth firing would have been excused by a directory-name rule.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'run:\n\tnode src/app/build/mystery.mjs\n' },
    tracked: ['Makefile'],
    onDisk: ['src/app/build/mystery.mjs'],
  }));
  assert.deepEqual(kinds(r), ['untracked:src/app/build/mystery.mjs']);
});

// --- AC-GI.3c — the dangling reference ------------------------------------
test('AC-GI.3c a target whose file is not on disk at all is a dangling finding', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'sync:\n\tpython3 scripts/sync-linear.py --dry-run\n' },
    tracked: ['Makefile'],
  }));
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(kinds(r), ['dangling:scripts/sync-linear.py']);
});

test('AC-GI.3c the two kinds are counted separately, because they earn different severities', () => {
  // The loop-gate wiring KEYS ON THESE COUNTS to decide block-vs-advisory (§F8a — a
  // gate blocks only on harm that stopping relieves). An `untracked` file still
  // exists on someone's disk, so stopping the line is exactly the remedy and it must
  // BLOCK. A `dangling` file is already gone; stopping recovers nothing, so it is
  // advisory. A field a gate keys on and no test pins is the false green again.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'a:\n\tnode scripts/here.mjs\nb:\n\tnode scripts/nowhere.mjs\n' },
    tracked: ['Makefile'],
    onDisk: ['scripts/here.mjs'],
  }));
  assert.equal(r.counts.untracked, 1);
  assert.equal(r.counts.dangling, 1);
  assert.deepEqual(kinds(r), ['dangling:scripts/nowhere.mjs', 'untracked:scripts/here.mjs']);
});

test('AC-GI.3d the cost of the prose guard is a BARE-WORD dangling ref, and it is stated', () => {
  // The guard that stops `dora.py` inside `echo "… dora.py check-drift …"` being a
  // finding is "a token with no path separator must exist somewhere to count". Its
  // price: a dangling reference written as a bare word is invisible. This pins the
  // price rather than leaving it in a comment, so the day it matters it is a known
  // trade-off and not a surprise. Every real reference in the repo this was written
  // for carries a separator (`$(APP)/scripts/…`, `scripts/…`), which is why the
  // trade-off is worth taking.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\tnode gone.mjs\n' },
    tracked: ['Makefile'],
  }));
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.counts.refs, 0, 'a bare word that exists nowhere is treated as prose');
});

// --- AC-GI.3d — it must not flood -----------------------------------------
test('AC-GI.3d an UNCOMMITTED makefile is not a committed make target, so it is not scanned', () => {
  // Makefile.orig has sat untracked in this repo for a long time. A checker that
  // scanned it would report findings from a file that runs nothing.
  const r = tool.analyse(world({
    makefiles: { 'Makefile.orig': 'x:\n\tnode gone.mjs\n' },
    tracked: [],
  }));
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.counts.makefilesScanned, 0);
});

test('AC-GI.3d globs, and prose inside an echo, are not references', () => {
  const r = tool.analyse(world({
    makefiles: {
      Makefile: [
        'a:',
        "\t@for f in $$(find infra/assets -name '*.mjs'); do echo $$f; done",
        '\t@echo "ledger-drift: dora.py check-drift sub-command not available"',
        '',
      ].join('\n'),
    },
    tracked: ['Makefile'],
  }));
  assert.equal(r.verdict, 'PASS', kinds(r).join(', '));
});

test('AC-GI.3d a path relative to a workspace the recipe enters is resolved there', () => {
  const r = tool.analyse(world({
    makefiles: {
      Makefile: 'APP := src/app\nspec:\n\tnode -e "process.chdir(\'$(APP)\'); run(\'vitest.integration.config.ts\')"\n',
    },
    tracked: ['Makefile', 'src/app/vitest.integration.config.ts'],
  }));
  assert.equal(r.verdict, 'PASS', kinds(r).join(', '));
});

test('AC-GI.3d a COMPUTED make function is UNRESOLVED, never collapsed to its arguments', () => {
  // FOUND BY SELF-APPLICATION, and it was a real bug in this tool. An earlier version
  // collapsed any `$(fn args)` to its comma-separated ARGUMENTS. For `$(if a,b,c)` that
  // is sound — the arguments are the literal alternatives. For `$(shell …)` it is
  // nonsense: `PROJECT ?= $(shell cat work/ACTIVE 2>/dev/null)` collapsed into the path,
  // and the tool reported a finding for the invented file
  // `2>/dev/null/scripts/board-stream-skeleton.js`. Seven of those in one run.
  //
  // A function whose value is COMPUTED cannot be known offline, so it must poison the
  // reference and drop it. Inventing a path is worse than missing one: a checker that
  // reports files nobody wrote is a checker people switch off, and this whole item
  // exists because a control became something to be worked around.
  const vars = tool.parseMakeVars('PROJECT ?= $(shell cat work/ACTIVE 2>/dev/null)\n');
  const refs = tool.refsInLine('\tnode work/$(PROJECT)/scripts/board-stream-skeleton.js',
    vars, [''], () => false);
  assert.deepEqual(refs, [], 'a computed path must yield NO reference, not an invented one');
});

test('AC-GI.3d $(if …) still collapses, because its arguments are literal alternatives', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\t$(if $(NODE_BIN),$(NODE_BIN)/node,node) scripts/t.mjs\n' },
    tracked: ['Makefile'],
    onDisk: ['scripts/t.mjs'],
  }));
  assert.deepEqual(kinds(r), ['untracked:scripts/t.mjs']);
});

test('AC-GI.3d an absolute path and a path outside the repo are out of scope', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\t/usr/local/bin/node /etc/thing.mjs\n\tpython3 ../../.claude/tools/other.py\n' },
    tracked: ['Makefile'],
  }));
  assert.equal(r.verdict, 'PASS', kinds(r).join(', '));
});

// --- AC-GI.3d — another repo's territory is not this repo's to track -------
// Also found by self-application. The PARENT repo's Makefile is a multi-project
// orchestrator: it runs files that live inside `work/<project>/`, each its own nested
// git repo which the parent deliberately gitignores. Four findings came from asking
// the parent "do you track this?" — the wrong question. One of them
// (work/OagEventSource/src/fids-app/playwright.uc-es3.config.ts) IS tracked, in its
// OWN repo; the others belong to projects not checked out on this machine, so their
// absence says nothing about trunk.
//
// THE DISCRIMINATOR IS REPO OWNERSHIP, NOT THE IGNORE RULE. Using "the repo ignores
// it" as the excuse would excuse the FOUNDING DEFECT — src/app/scripts/*.mjs was
// ignored, and that is the whole point. So territory requires BOTH that the directory
// is ignored as a whole AND that the scanned repo tracks nothing beneath it.

test('AC-GI.3d a path inside a NESTED repo is judged by THAT repo, not the scanned one', () => {
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\tnode work/proj/scripts/t.mjs\n' },
    tracked: ['Makefile'],
    onDisk: ['work/proj/scripts/t.mjs'],
    nestedRepoTracked: () => true,             // the owning repo has it on ITS trunk
  }));
  assert.equal(r.verdict, 'PASS', kinds(r).join(', '));
  assert.equal(r.counts.foreign, 1);
});

test('AC-GI.3d a nested repo that does NOT track it is still a finding', () => {
  // Delegating ownership must not become a way to disappear. If the owning repo has
  // not committed it either, the file is still on one machine only.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\tnode work/proj/scripts/t.mjs\n' },
    tracked: ['Makefile'],
    onDisk: ['work/proj/scripts/t.mjs'],
    nestedRepoTracked: () => false,
  }));
  assert.deepEqual(kinds(r), ['untracked:work/proj/scripts/t.mjs']);
});

test('AC-GI.3d another repo\'s territory that is NOT checked out is skipped, not dangling', () => {
  // `make browser-observatory-real-data` names a file in work/observatory, a project
  // not present on this machine. Whether a sibling project is checked out is
  // machine-local, so its absence carries NO information about trunk.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\tnode work/absent/e2e/s005.spec.js\n' },
    tracked: ['Makefile'],
    foreignTerritory: () => true,
  }));
  assert.equal(r.verdict, 'PASS', kinds(r).join(', '));
  assert.equal(r.counts.foreign, 1);
});

test('AC-GI.3d one spurious candidate must not poison a territory verdict', () => {
  // A REAL false positive this produced. A reference is tried against several candidate
  // base dirs (every --prefix/-C/chdir the makefile uses), so one candidate can land
  // inside an UNRELATED nested repo which of course does not track it. Taking the first
  // non-null ownership answer let that `false` override a later candidate that was
  // plainly another project's territory, and the reference was reported dangling.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\tnpm --prefix other/pkg run t -- work/absent/e2e/s005.spec.js\n' },
    tracked: ['Makefile'],
    // the `other/pkg/work/absent/...` candidate lands in a nested repo that lacks it…
    nestedRepoTracked: (p) => (p.startsWith('other/pkg/') ? false : null),
    // …while the real candidate is another project's ground
    foreignTerritory: (p) => p.startsWith('work/absent/'),
  }));
  assert.equal(r.verdict, 'PASS', kinds(r).join(', '));
  assert.equal(r.counts.foreign, 1);
});

test('AC-GI.3d a file PRESENT in the scanned repo outranks any foreign candidate', () => {
  // THE VACUITY THIS TOOL ALMOST SHIPPED WITH, found by running it on its own repo.
  // A reference is tried against every --prefix/-C/chdir base dir, so `.claude/tools/x.js`
  // also generates a candidate like `work/<project>/src/app/.claude/tools/x.js` — which
  // lands in ignored, foreign ground. With territory checked before presence, that
  // spurious candidate EXONERATED the real one: deleting this very tool from the index
  // produced NO finding. The check was blind to its own disappearance.
  //
  // Presence in the scanned repo is the strongest evidence available and must be
  // consulted first: a file that is right there, untracked, is the defect.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\tnpm --prefix work/proj/app run t\n\tnode .claude/tools/x.js\n' },
    tracked: ['Makefile'],
    onDisk: ['.claude/tools/x.js'],
    foreignTerritory: (p) => p.startsWith('work/proj/'),
  }));
  assert.deepEqual(kinds(r), ['untracked:.claude/tools/x.js']);
});

test('AC-GI.3d territory can NEVER excuse the founding defect', () => {
  // THE GUARD THAT MATTERS. src/app/scripts was ignored by a blanket rule and holds
  // tracked files. If "the repo ignores it" alone conferred territory, this tool would
  // have excused all six firings — so territory requires that the scanned repo track
  // NOTHING beneath the directory, which is false here and must stay a finding.
  const r = tool.analyse(world({
    makefiles: { Makefile: 'x:\n\tnode src/app/scripts/swallowed.mjs\n' },
    tracked: ['Makefile', 'src/app/scripts/already-committed.mjs'],
    onDisk: ['src/app/scripts/swallowed.mjs'],
  }));
  assert.deepEqual(kinds(r), ['untracked:src/app/scripts/swallowed.mjs']);
});

// --- AC-GI.3e — it would have caught the REAL six -------------------------
// Driven against the REAL committed Makefile and the REAL tracked set. Nothing here
// is authored: the only perturbation is removing one path from the index view, which
// is exactly and only what happened on each of the six firings.
const REAL_SWALLOWED = [
  'src/app/scripts/seed-event-store.mjs',
  'src/app/scripts/event-store-distribution.mjs',
  'src/app/scripts/probe-transact-append.mjs',
  'src/app/scripts/capture-ddb-stream-records.mjs',
  'src/app/scripts/ddb-local-marker.mjs',
  'src/app/scripts/capture-lambda-runtime-sdk-exports.mjs',
];

function realWorld() {
  return tool.collectRepo(OAG);
}

test('AC-GI.3e the REAL repo, unperturbed, is clean', () => {
  const r = tool.analyse(realWorld());
  assert.equal(r.verdict, 'PASS',
    'expected no findings; got:\n  ' + r.findings.map((f) => f.message).join('\n  '));
});

for (const swallowed of REAL_SWALLOWED) {
  test(`AC-GI.3e the check reports the REAL swallowed tool ${path.basename(swallowed)}`, () => {
    const w = realWorld();
    assert.ok(w.tracked.has(swallowed), `${swallowed} must really be tracked for this to be a perturbation`);
    w.tracked.delete(swallowed);                  // the index view, exactly as it was
    const r = tool.analyse(w);
    assert.equal(r.verdict, 'FAIL');
    assert.deepEqual(kinds(r), [`untracked:${swallowed}`]);
  });
}

// --- the CLI contract the wiring depends on -------------------------------
test('AC-GI.3 the CLI exits non-zero on a finding and 0 when clean, and speaks JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'Makefile'), 'x:\n\tnode tool.mjs\n');
  fs.writeFileSync(path.join(dir, 'tool.mjs'), '// a committed tool\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.mjs\n');
  execFileSync('git', ['-C', dir, 'add', 'Makefile', '.gitignore']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'wip']);

  const red = spawnSync('node', [TOOL, '--repo', dir, '--json'], { encoding: 'utf8' });
  assert.notEqual(red.status, 0, 'a swallowed tool must make the check exit non-zero');
  const report = JSON.parse(red.stdout);
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(report.findings.map((f) => f.ref), ['tool.mjs']);
  assert.match(red.stderr + red.stdout, /tool\.mjs/);

  execFileSync('git', ['-C', dir, 'add', '-f', 'tool.mjs']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'track it']);
  const green = spawnSync('node', [TOOL, '--repo', dir, '--json'], { encoding: 'utf8' });
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.equal(JSON.parse(green.stdout).verdict, 'PASS');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC-GI.3 --project resolves the project repo, so the loop-gate wiring needs no path', () => {
  const r = spawnSync('node', [TOOL, '--project', 'OagEventSource', '--repo-root', REPO_ROOT, '--json'],
    { encoding: 'utf8' });
  const report = JSON.parse(r.stdout);
  assert.equal(report.repo, path.join('work', 'OagEventSource'));
  assert.equal(report.verdict, 'PASS', r.stdout);
  assert.equal(r.status, 0);
});


// --- v154 §F5e: a guarded existence test is not an invocation (DEF-ROC-115) -----
//
// `quarantine-gate` blocked the ROC loop with "a COMMITTED MAKE TARGET RUNS
// src/app/local/probe-real-bus-send.ts and it is NOT ON TRUNK". It does not run it — it
// asks whether it is there, in an `if [ -f … ]` guard written precisely BECAUSE that path
// is the DEF-ROC-076 quarantined artefact, absent in every fresh checkout by contract.
//
// NON-VACUITY: the first two cases FAIL against the pre-v154 extractor (they were the
// live false positive); the third and fourth must keep passing, or the exemption is too
// wide and the checker stops finding the thing it exists for.
test('v154: a path that is only the operand of `[ -f ]` is not reported as run', () => {
  const refs = tool.refsInLine('\t@if [ -f src/app/local/probe-real-bus-send.ts ]; then echo yes; fi',
    {}, [''], () => false);
  assert.deepEqual(refs, []);
});

test('v154: `test -f` and `[[ -e ]]` forms are exempt too', () => {
  assert.deepEqual(tool.refsInLine('\t@test -f scripts/evidence.mjs && echo present', {}, [''], () => false), []);
  assert.deepEqual(tool.refsInLine('\t@if [[ -e scripts/evidence.mjs ]]; then :; fi', {}, [''], () => false), []);
});

test('v154: a path that is TESTED and then RUN is still reported — the exemption is narrow', () => {
  const refs = tool.refsInLine('\t@[ -f scripts/run.mjs ] && node scripts/run.mjs', {}, [''], () => false);
  // refsInLine does not dedupe (pre-existing; callers do), so the path appears once per
  // occurrence. What matters is that it is REPORTED AT ALL despite also being tested.
  assert.ok(refs.includes('scripts/run.mjs'),
    `a path that is tested AND run must still be reported, got ${JSON.stringify(refs)}`);
});

test('v154: an ordinary invocation is unaffected', () => {
  const refs = tool.refsInLine('\t@node scripts/tier-determinism.mjs --limit 30', {}, [''], () => false);
  assert.deepEqual(refs, ['scripts/tier-determinism.mjs']);
});
