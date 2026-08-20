#!/usr/bin/env node
'use strict';
/**
 * impacted-tests-junk-node-ids.test.js — OI-IMPACTED-TESTS-JUNK-NODE-IDS.
 *
 * The finding: `make impacted-tests` sourced node IDENTITY from a regex swept
 * over raw diff lines, so ordinary English words lifted out of mermaid LABEL
 * PROSE were emitted as graph nodes and landed in the UNCOVERED list. Measured
 * on the real corpus: `THE`, `an`, `code`, `resolve`, `delta-072`, `BUY`,
 * `which`, `reason`, `group`. The mechanism was `EDGE_RE` matching an ASCII
 * ` -- ` used as an English dash INSIDE a quoted label, plus an edge-label
 * `|"...|..."|` containing a literal pipe, which let the regex walk past the
 * label and read the next prose word as the edge's target.
 *
 * Why it mattered more than the wrong number: every agent that ran the tool had
 * to hand-discount its output before believing it, and three did so on
 * 2026-08-19. A control whose output must be manually filtered is one that gets
 * ignored.
 *
 * The fixture is a CAPTURE, not an authored input:
 * fixtures/impacted-tests/junk-node-ids-capture.mmd holds six real statements
 * lifted byte-for-byte from work/OagEventSource/architecture/dependencies at a
 * recorded sha, each annotated with the junk pair the loose parse emitted from
 * it. Nothing in those lines was edited to make the fault appear.
 *
 * delta-074 R12 ("no control is verified by text-slicing an artifact whose
 * layout it does not own") is why the fix is a structural parse: node IDENTITY
 * now comes from parseMermaidStructure(), which walks the WHOLE file skipping
 * label bodies, comments and edge labels, and the diff is used only to SELECT
 * from that declared inventory — never as a source of identity.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tool = require('./impacted-tests.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CAPTURE = path.join(__dirname, 'fixtures', 'impacted-tests', 'junk-node-ids-capture.mmd');
const captureText = fs.readFileSync(CAPTURE, 'utf8');

// The words the loose parse emitted from the captured lines. They are the
// FIXTURE (an observation), never a denylist in the tool — see AC-JUNK.4.
const JUNK_FROM_CAPTURE = ['an', 'THE', 'resolve', 'reason', 'which', 'BUY'];
// Real declared nodes on those very same captured lines — the fix must keep them.
const REAL_FROM_CAPTURE = [
  'account-id-resolver', 'STATICDS', 'REFENRICH', 'SCOPEGATE',
  'INGESTMETRICFILTERS', 'AIRPORTIDENT',
];

// ---------------------------------------------------------------------------
// AC-JUNK.1 — only declared node ids are accepted; label prose is never a node
// ---------------------------------------------------------------------------

test('AC-JUNK.1: parseMermaidStructure over the real capture declares the six real nodes and NOTHING from inside their labels', () => {
  const { declared } = tool.parseMermaidStructure(captureText);
  for (const id of REAL_FROM_CAPTURE) {
    assert.ok(declared.has(id), `real declared node ${id} must survive the structural parse`);
  }
  for (const junk of JUNK_FROM_CAPTURE) {
    assert.ok(!declared.has(junk),
      `${junk} is label prose on a real captured line — it must never be a declared node`);
  }
});

test('AC-JUNK.1: extractAllNodeIds — the node-id INVENTORY itself is structural, so gating on it is a real fix and not a plain intersection with a polluted set', () => {
  // This is the case that was RED on content (not on a missing symbol) before the
  // fix: the pre-fix per-line regex inventory over this capture contained `an`,
  // `THE`, `resolve`, `reason`, `which`, `BUY` — measured on the real corpus it
  // held all nine junk words among 791 "ids". Intersecting a diff-sourced
  // candidate set with THAT inventory would have filtered nothing.
  const all = tool.extractAllNodeIds(captureText);
  for (const junk of JUNK_FROM_CAPTURE) {
    assert.ok(!all.has(junk), `${junk} must not be in the node-id inventory`);
  }
  for (const id of REAL_FROM_CAPTURE) {
    assert.ok(all.has(id), `${id} must be in the node-id inventory`);
  }
});

test('AC-JUNK.1: a quoted edge label containing a literal | does not leak the following prose word as the edge target (data-flow.mmd:593, real capture)', () => {
  const { declared } = tool.parseMermaidStructure(captureText);
  // The real line is `SCOPEGATE -.->|"drop + fail-safe signals: ... | reason no-genesis ..."|`
  // The old regex's `\|[^|]*\|` stopped at the pipe INSIDE the quoted label and
  // read `reason` as the target node.
  assert.ok(declared.has('SCOPEGATE'), 'the real source endpoint is still read');
  assert.ok(!declared.has('reason'), '`reason` is label prose after an in-label pipe');
});

test('AC-JUNK.1: an English dash `--` inside a label is not an edge (class-deps.mmd:3724 / data-flow.mmd:507,509,622 — real captures)', () => {
  const { declared } = tool.parseMermaidStructure(captureText);
  for (const junk of ['an', 'THE', 'resolve', 'BUY']) {
    assert.ok(!declared.has(junk), `${junk} came from an in-label ASCII dash`);
  }
  // `delta-072` is a hyphenated word in label prose here, NOT a node: proof the
  // identifier tokeniser reads single-hyphen ids without ever reading in-label text.
  assert.ok(!declared.has('delta-072'), '`delta-072` is a delta reference in label prose');
});

// ---------------------------------------------------------------------------
// AC-JUNK.2 — the pin: no emitted id is anything but a declared node,
// WITH a witness that the rejection actually fired on real content
// ---------------------------------------------------------------------------

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

// Seed a throwaway repo whose in-window change IS the real capture, so the run
// sees exactly the diff lines that produced the junk on the real corpus.
function buildCaptureRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'junknode-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  const depDir = path.join(repo, 'work', 'projX', 'architecture', 'dependencies');
  const specDir = path.join(repo, 'work', 'projX', 'src', 'specs');
  fs.mkdirSync(depDir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(depDir, 'class-deps.mmd'), 'flowchart TD\n  seed["seed"]\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'baseline']);
  const sinceSha = git(repo, ['rev-parse', 'HEAD']).trim();
  // in-window: append the captured statements verbatim
  fs.writeFileSync(path.join(depDir, 'class-deps.mmd'),
    'flowchart TD\n  seed["seed"]\n' + captureText.replace(/^flowchart TD\n/m, ''));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'in-window: real captured statements']);
  return { repo, sinceSha };
}

test('AC-JUNK.2: every emitted changed node is a DECLARED node (the pin) — real capture as the in-window diff', () => {
  const { repo, sinceSha } = buildCaptureRepo();
  try {
    const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
    const declared = res.declaredNodes;
    assert.ok(declared instanceof Set, 'run() must expose the declared-node inventory it gated on');
    const notDeclared = res.changedNodes.filter((n) => !declared.has(n));
    assert.deepEqual(notDeclared, [],
      'no emitted changed node may be absent from the declared-node inventory');
    // and specifically none of the measured junk words
    for (const junk of JUNK_FROM_CAPTURE) {
      assert.ok(!res.changedNodes.includes(junk), `${junk} must not be emitted`);
      assert.ok(!res.uncovered.includes(junk), `${junk} must not inflate the uncovered list`);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC-JUNK.2: the rejection is WITNESSED — the real junk tokens appear in the tool\'s rejected list, so the pin cannot pass vacuously on clean input', () => {
  const { repo, sinceSha } = buildCaptureRepo();
  try {
    const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
    assert.ok(Array.isArray(res.rejected), 'run() must report what it rejected');
    for (const junk of JUNK_FROM_CAPTURE) {
      assert.ok(res.rejected.includes(junk),
        `${junk} must be REPORTED as a rejected candidate — a silent drop is indistinguishable ` +
        'from an input that never contained it');
    }
    // and the real nodes on those same lines came through
    for (const id of REAL_FROM_CAPTURE) {
      assert.ok(res.changedNodes.includes(id), `real node ${id} must still be reported as changed`);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC-JUNK.2: formatReport SHOWS the rejected-candidate count, so a reader can see the parse discarding rather than infer it', () => {
  const { repo, sinceSha } = buildCaptureRepo();
  try {
    const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
    const out = tool.formatReport(res, { project: 'projX', since: sinceSha, root: repo });
    assert.match(out, /rejected/i, 'the report must state that candidates were rejected');
    assert.match(out, new RegExp(String(res.rejected.length)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-JUNK.4 — NOT a stop-word list: the rule is structural, so a node
// legitimately NAMED one of those words is reported normally
// ---------------------------------------------------------------------------

test('AC-JUNK.4: a node genuinely DECLARED as `code` / `the` / `BUY` is reported — the filter is the declared inventory, not a word list', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'junknode-ok-'));
  try {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 't@t']);
    git(repo, ['config', 'user.name', 't']);
    const depDir = path.join(repo, 'work', 'projY', 'architecture', 'dependencies');
    fs.mkdirSync(depDir, { recursive: true });
    fs.writeFileSync(path.join(depDir, 'class-deps.mmd'), 'flowchart TD\n  seed["seed"]\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'baseline']);
    const sinceSha = git(repo, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(depDir, 'class-deps.mmd'),
      'flowchart TD\n  seed["seed"]\n'
      + '  code["a module that really is called code"]:::s001changed\n'
      + '  the["and one really called the"]:::s001changed\n'
      + '  BUY["and one really called BUY"]:::s001changed\n'
      + '  code --> BUY\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'nodes legitimately named after English words']);
    const res = tool.run({ root: repo, project: 'projY', since: sinceSha });
    for (const id of ['code', 'the', 'BUY']) {
      assert.ok(res.changedNodes.includes(id),
        `${id} is a DECLARED node here — a stop-word list would wrongly swallow it`);
    }
    assert.deepEqual(res.rejected, [], 'nothing to reject: every candidate is declared');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC-JUNK.4: a node whose DECLARATION is REMOVED in-window is still reported — the inventory spans the SINCE revision, so the gate cannot swallow a deletion', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'junknode-del-'));
  try {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 't@t']);
    git(repo, ['config', 'user.name', 't']);
    const depDir = path.join(repo, 'work', 'projZ', 'architecture', 'dependencies');
    fs.mkdirSync(depDir, { recursive: true });
    fs.writeFileSync(path.join(depDir, 'class-deps.mmd'),
      'flowchart TD\n  keep["keep"]\n  goingAway["about to be deleted"]\n  keep --> goingAway\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'baseline with goingAway']);
    const sinceSha = git(repo, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(depDir, 'class-deps.mmd'), 'flowchart TD\n  keep["keep"]\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'remove goingAway']);
    const res = tool.run({ root: repo, project: 'projZ', since: sinceSha });
    assert.ok(res.changedNodes.includes('goingAway'),
      'a removed node must still be reported — it was declared at the SINCE revision');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC-JUNK.1: a node added AND removed INSIDE the window is dropped — a stated consequence of a three-revision inventory, not an accident', () => {
  // The inventory spans the working tree, HEAD and the SINCE revision — the three
  // states a reader can actually open. A node that appeared and vanished between
  // them exists in none of them, so it is not reported. That is deliberate and it
  // matches what the diff already did: `git diff since..HEAD` is a TWO-POINT diff,
  // so an add-then-remove never reaches the candidate set in the first place. The
  // three-revision inventory therefore removes no signal the tool ever had; pinned
  // so the next reader finds a DECISION here rather than inferring a bug.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'junknode-mid-'));
  try {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 't@t']);
    git(repo, ['config', 'user.name', 't']);
    const depFile = path.join(repo, 'work', 'projM', 'architecture', 'dependencies', 'class-deps.mmd');
    fs.mkdirSync(path.dirname(depFile), { recursive: true });
    fs.writeFileSync(depFile, 'flowchart TD\n  keep["keep"]\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'baseline']);
    const sinceSha = git(repo, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(depFile, 'flowchart TD\n  keep["keep"]\n  ephemeral["here and gone"]\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'add ephemeral']);
    fs.writeFileSync(depFile, 'flowchart TD\n  keep["keep"]:::s001changed\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'remove ephemeral']);
    const res = tool.run({ root: repo, project: 'projM', since: sinceSha });
    assert.ok(res.changedNodes.includes('keep'), 'the surviving node is still reported');
    assert.ok(!res.changedNodes.includes('ephemeral'));
    assert.ok(!res.rejected.includes('ephemeral'),
      'it is not even a CANDIDATE: the two-point diff never offers it, so the structural '
      + 'gate removes nothing here — this is not a regression the gate introduced');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AS COMPOSED — the same two claims against the REAL corpus, not a fixture
// ---------------------------------------------------------------------------

const LIVE_DEPS = path.join(REPO_ROOT, 'work', 'OagEventSource', 'architecture', 'dependencies');
const liveAbsent = !fs.existsSync(LIVE_DEPS);
const liveSkip = liveAbsent
  ? 'work/OagEventSource is a separate gitignored repo and is not present in this checkout'
  : false;

test('AC-JUNK.1 (as composed): the real corpus\'s declared inventory contains no in-label prose', { skip: liveSkip }, () => {
  const declared = new Set();
  for (const f of fs.readdirSync(LIVE_DEPS).filter((f) => f.endsWith('.mmd'))) {
    for (const id of tool.parseMermaidStructure(fs.readFileSync(path.join(LIVE_DEPS, f), 'utf8')).declared) {
      declared.add(id);
    }
  }
  assert.ok(declared.size > 100, `the real corpus must still yield a real inventory (got ${declared.size})`);
  for (const junk of ['THE', 'an', 'code', 'resolve', 'delta-072', 'BUY', 'which', 'reason', 'group']) {
    assert.ok(!declared.has(junk), `${junk} must not be in the real corpus's declared inventory`);
  }
});

test('AC-JUNK.5 (as composed): PILOT_CONSUMER resolves to a covering spec — it was behaviourally covered all along and missing only the literal tag', { skip: liveSkip }, () => {
  const spec = path.join(REPO_ROOT, 'work', 'OagEventSource', 'src', 'app', 'tests',
    'aerobus-pilot-fanout-retired-uc-xe1.test.ts');
  assert.ok(fs.existsSync(spec), 'the covering spec must exist');
  assert.match(fs.readFileSync(spec, 'utf8'), /@covers[^\n]*\bPILOT_CONSUMER\b/,
    'the spec that covers PILOT_CONSUMER must declare it, or the node reads as an uncovered hole');
});
