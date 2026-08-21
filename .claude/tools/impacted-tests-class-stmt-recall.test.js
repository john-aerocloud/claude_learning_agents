'use strict';
/**
 * impacted-tests-class-stmt-recall.test.js
 *   OI-IMPACTED-TESTS-CANNOT-SEE-190-OF-192-CHANGE-MARKS
 *
 * THE FAULT. `CLASS_STMT_RE` was `/(?:^|\s)class\s+([A-Za-z0-9_,\s-]+?)\s+([A-Za-z0-9_]+)\s*;/g`
 * — the trailing SEMICOLON was REQUIRED, and this repo's house mermaid style omits
 * it. Measured on the real committed corpus at 3abb56d0 (4 diagrams under
 * work/OagEventSource/architecture/dependencies/):
 *
 *     genuine `class …` statements                169
 *     of those, CHANGE marks (`…changed` class)   166
 *     carrying a trailing `;`                       6
 *     SEEN by the old regex                         6   (3.6% recall)
 *     INVISIBLE                                   163
 *     distinct nodes marked                        270  (old regex saw 16)
 *
 * A `class X …changed` mark has NO consumer but this tool, so 163 statements /
 * 254 nodes were being written into a void. The measured consequence is on the
 * record: commit d92f5dd8 changed the graph ONLY by adding
 * `class declared-corpus-absences oiReachChanged` (everything else it added was a
 * `%%` comment) and the tool extracted ZERO candidate nodes from its diff — a
 * false CLEAN over a control whose behaviour had changed. The next commit,
 * f059f0e2, worked around it BY HAND by adding a `;` to that one line.
 *
 * WHY THE EXISTING SUITE NEVER CAUGHT IT: every `class` case in
 * impacted-tests.test.js was written `class wsfn,conn changed;` — with the
 * semicolon. The test encoded the same assumption as the code, so red→green only
 * ever proved the code agreed with itself. The corpus test below is therefore
 * measured against the REAL committed diagrams, not a hand-written line.
 *
 * THE FIX. `CLASS_STMT_RE` is deleted. A `class` statement's node ids now come
 * from parseMermaidStructure() — the same structural tokeniser that supplies node
 * IDENTITY everywhere else (statements terminate at `\n` OR `;`, comments and
 * bracket-balanced/quoted labels are skipped) — so the semicolon is irrelevant
 * and nothing new over-matches. `run()` additionally REPORTS any class statement
 * on a diff line it could not read a node out of, so a future unread form is
 * visible rather than silent (AC-CSR.2).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tool = require('./impacted-tests.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CORPUS_DIR = path.join(REPO_ROOT, 'work', 'OagEventSource', 'architecture', 'dependencies');

// The REAL committed corpus — harvested, never authored. Absent (a checkout with
// no project repo) the corpus cases skip rather than false-pass, and say so.
function corpusFiles() {
  if (!fs.existsSync(CORPUS_DIR)) return [];
  return fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.mmd'))
    .map((f) => path.join(CORPUS_DIR, f)).sort();
}

// Ground truth, read from the file's own STRUCTURE and cross-checked two ways:
// tokeniseMermaid() says which statements are `class` statements; a line-anchored
// scan says which LINES are. The two counts must agree, or the ground truth
// itself is unsound and the test says so instead of measuring the wrong thing.
function classStatementLines(text) {
  const structural = tool.tokeniseMermaid(text)
    .filter((s) => s[0] && s[0].t === 'id' && !s[0].shaped && s[0].v.toLowerCase() === 'class');
  const lines = text.split('\n').filter((l) => /^\s*class\s/.test(l));
  return { structural, lines };
}

// The node ids a `class A,B <cls>` statement NAMES (every id but the last), and
// whether its class is a change mark.
function statementIds(line) {
  const body = line.trim().replace(/;\s*$/, '');
  const parts = body.split(/\s+/);            // ['class', 'A,B', 'cls']
  const cls = parts[parts.length - 1];
  const ids = parts.slice(1, -1).join(' ').split(',').map((s) => s.trim()).filter(Boolean);
  return { ids, cls, changed: /changed/i.test(cls) };
}

// --- AC-CSR.2 — recall, ASSERTED against the real corpus, not assumed ---------

test('AC-CSR.2: every `class …changed` statement in the REAL committed .mmd corpus is recognised on a diff line (pre-fix: 6 of 166)', () => {
  const files = corpusFiles();
  assert.ok(files.length > 0, `no corpus at ${CORPUS_DIR} — this case must measure the REAL diagrams`);
  let statements = 0; let changedStatements = 0; let recognised = 0;
  const missed = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const { structural, lines } = classStatementLines(text);
    // ground-truth cross-check: structure and line-anchoring must agree
    assert.equal(lines.length, structural.length,
      `${path.basename(f)}: ${lines.length} class-statement LINES vs ${structural.length} `
      + 'structural class statements — the ground truth for this measurement is unsound, '
      + 'refine it before trusting the recall number');
    statements += structural.length;
    for (const line of lines) {
      const { ids, changed } = statementIds(line);
      if (!changed) continue;
      changedStatements++;
      // present the statement exactly as a unified-diff ADDED line, which is how
      // the tool actually meets it.
      const got = new Set(tool.extractNodesFromDiffLines(`+${line}`));
      if (ids.every((id) => got.has(id))) recognised++;
      else missed.push(`${path.basename(f)}: ${line.trim().slice(0, 90)}`);
    }
  }
  // the corpus is real and moves; these floors keep the measurement non-vacuous
  // (a corpus that lost its marks must not read as 100% recall of nothing).
  assert.ok(statements >= 100, `only ${statements} class statements found — measurement is vacuous`);
  assert.ok(changedStatements >= 100, `only ${changedStatements} change-marking statements found`);
  assert.equal(missed.length, 0,
    `${missed.length} of ${changedStatements} change-marking class statements are INVISIBLE to the `
    + `tool:\n  ${missed.slice(0, 8).join('\n  ')}`);
  assert.equal(recognised, changedStatements);
});

test('AC-CSR.2: every node named by a real class statement is in that diagram\'s structural `marked` set — nothing is swallowed by a label', () => {
  const files = corpusFiles();
  assert.ok(files.length > 0, `no corpus at ${CORPUS_DIR}`);
  let nodes = 0;
  const missed = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const marked = tool.parseMermaidStructure(text).marked;
    for (const line of classStatementLines(text).lines) {
      const { ids, changed } = statementIds(line);
      if (!changed) continue;
      for (const id of ids) {
        nodes++;
        if (!marked.has(id)) missed.push(`${path.basename(f)}: ${id}`);
      }
    }
  }
  assert.ok(nodes >= 200, `only ${nodes} marked nodes measured — vacuous`);
  assert.deepEqual(missed, [], `nodes named by a class statement but absent from the marked set: ${missed.join(', ')}`);
});

test('AC-CSR.2: the house style — a `class A,B <mark>` statement with NO trailing semicolon names its nodes (the corpus case above is the evidence; this is the shape)', () => {
  assert.deepEqual(tool.extractNodesFromDiffLines('+    class alpha,beta s075changed').sort(),
    ['alpha', 'beta']);
  assert.deepEqual(tool.extractMarkedNodes('    class alpha,beta s075changed').sort(),
    ['alpha', 'beta']);
});

test('AC-CSR.2: recall is not loosened into over-match — a non-`changed` class, a classDef recolour and a hyphenated id list stay exactly as before', () => {
  // a `stable`/`delivered` class names nodes but is NOT a change mark
  assert.deepEqual(tool.extractNodesFromDiffLines('+    class alpha,beta stable'), []);
  assert.deepEqual(tool.extractNodesFromDiffLines('+    class alpha delivered'), []);
  // a recolour-only classDef line carries no node id (the OI-42 root cause)
  assert.deepEqual(tool.extractNodesFromDiffLines('+    classDef s009changed fill:#e8f4e8;'), []);
  // hyphenated ids are ONE id each, not split on the hyphen
  assert.deepEqual(tool.extractNodesFromDiffLines('+    class declared-corpus-absences oiReachChanged').sort(),
    ['declared-corpus-absences']);
});

test('AC-CSR.2: recall does not depend on call order — the shared g-flagged regex hazard cannot make a repeated or interleaved call see less', () => {
  const stmt = '+    class alpha,beta s075changed';
  const inline = '+    gamma["g"]:::s075changed';
  const first = tool.extractNodesFromDiffLines(stmt).sort();
  // interleave the other call sites, then repeat: lastIndex state must not leak
  tool.extractNodesFromDiffLines(inline);
  tool.extractMarkedNodes('  class delta,epsilon s075changed');
  tool.parseMermaidStructure('flowchart TD\n  zeta["z"]:::s075changed\n  class zeta s075changed\n');
  assert.deepEqual(tool.extractNodesFromDiffLines(stmt).sort(), first);
  assert.deepEqual(tool.extractNodesFromDiffLines(`${stmt}\n${inline}`).sort(),
    ['alpha', 'beta', 'gamma']);
});

test('AC-CSR.2: a class statement a diff offers but the parser reads no node out of is REPORTED, never silently dropped', () => {
  // the AC-JUNK lesson applied to a false NEGATIVE: recall must be self-observed.
  const diff = '+    class     someChangedThing';   // non-breaking spaces: no id tokenises
  const unread = tool.unreadClassStatementLines(diff);
  assert.equal(unread.length, 1);
  assert.match(unread[0], /someChangedThing/);
  // and a statement that IS read is not reported
  assert.deepEqual(tool.unreadClassStatementLines('+    class alpha s075changed'), []);
  // it reaches the human-readable report
  const report = tool.formatReport(
    { changedNodes: [], impacted: [], uncovered: [], exitCode: 0, rejected: [], candidateCount: 0,
      unreadClassStatements: ['    class   someChangedThing'] },
    { project: 'p', since: 'abc', root: '/tmp' });
  assert.match(report, /UNREAD `class` STATEMENT/);
});

// --- AC-CSR.5 — a mark following a multi-line label --------------------------

// HARVESTED VERBATIM from work/OagEventSource/architecture/dependencies/class-deps.mmd
// lines 962-963 at 3abb56d0: a label that spans TWO physical lines and contains
// `->` arrows, an ASCII `-` and a `;` inside the quotes. The same-day structural
// rewrite (OI-IMPACTED-TESTS-JUNK-NODE-IDS) made label skipping cross newlines,
// so a mark AFTER such a label is the regression this case guards.
const REAL_MULTILINE_LABEL = [
  '    admin-config-read-handler["admin-config-read-handler<br/>PURE transport-agnostic core: extract session cookie -> verify (port) ->',
  '    evaluate claims (env+expiry) -> ONLY on valid session loadCurrent + serve read-only;<br/>GATE FIRST (401 never touches the store); no mint/no write edge by construction"]:::s043oa3changed',
].join('\n');

test('AC-CSR.5: a semicolon-less class mark FOLLOWING a real multi-line label is still recognised', () => {
  const text = ['flowchart TB', REAL_MULTILINE_LABEL,
    '    class admin-config-read-handler,admin-session-verify s043oa3changed', ''].join('\n');
  const { marked, declared } = tool.parseMermaidStructure(text);
  assert.ok(marked.has('admin-session-verify'),
    'the node named ONLY by the class statement after the multi-line label must be marked');
  assert.ok(declared.has('admin-session-verify'));
  assert.ok(marked.has('admin-config-read-handler'));
  assert.deepEqual(tool.extractNodesFromDiffLines(
    '+    class admin-config-read-handler,admin-session-verify s043oa3changed').sort(),
  ['admin-config-read-handler', 'admin-session-verify']);
});

// --- AC-CSR.3 — non-vacuity, end to end through run() ------------------------

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

// A throwaway repo whose ONLY in-window graph change is a house-style
// (semicolon-less) `class … changed` mark on a node that already existed and has
// NO @covers spec. This is the d92f5dd8 shape exactly.
function buildMarkOnlyRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-csr-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  const depDir = path.join(repo, 'work', 'projX', 'architecture', 'dependencies');
  const specDir = path.join(repo, 'work', 'projX', 'src', 'specs');
  fs.mkdirSync(depDir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  const mmd = path.join(depDir, 'class-deps.mmd');
  fs.writeFileSync(mmd,
    'flowchart TB\n'
    + '  gateNode["gateNode<br/>a control whose BEHAVIOUR changes in-window"]:::stable\n'
    + '  coveredNode["coveredNode"]:::stable\n'
    + '  classDef stable fill:#eee;\n');
  fs.writeFileSync(path.join(specDir, 'covered.spec.ts'),
    '// @covers coveredNode\nit("x", () => {});\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'baseline: both nodes declared, only coveredNode has a spec']);
  const sinceSha = git(repo, ['rev-parse', 'HEAD']).trim();
  // IN-WINDOW: the graph changes ONLY by gaining two house-style class marks —
  // no declaration edited, no edge added, no semicolon. Committed, so this is the
  // committed-window diff and not merely the working tree.
  fs.appendFileSync(mmd,
    '  classDef s099changed fill:#fde8e8,stroke:#c62828,stroke-width:3px;\n'
    + '  class gateNode s099changed\n'
    + '  class coveredNode s099changed\n');
  git(repo, ['commit', '-qm', 'in-window: mark both nodes changed, house style', '--', '.']);
  return { repo, sinceSha };
}

test('AC-CSR.3: a house-style mark on a node with NO @covers spec appears as an UNCOVERED changed node and exits 2 (pre-fix: no changed nodes, exit 0)', () => {
  const { repo, sinceSha } = buildMarkOnlyRepo();
  try {
    const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
    assert.ok(res.changedNodes.includes('gateNode'),
      `a mark-only in-window change must be seen; got changedNodes=${JSON.stringify(res.changedNodes)}`);
    assert.deepEqual(res.uncovered, ['gateNode']);
    assert.equal(res.exitCode, 2, 'an uncovered changed node is exit 2, not a false CLEAN');
    // the covered one resolves to its spec rather than inflating the warning
    assert.ok(res.impacted.some((r) => r.node === 'coveredNode'));
    // and no junk arrived with it (the AC-JUNK invariant still holds)
    assert.deepEqual(res.rejected, []);
    assert.match(tool.formatReport(res, { project: 'projX', since: sinceSha, root: repo }),
      /\[!\] gateNode/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC-CSR.3: the same mark on a node that DOES have a covering spec is IMPACTED, not uncovered — the fix does not simply make everything warn', () => {
  const { repo, sinceSha } = buildMarkOnlyRepo();
  try {
    const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
    const hit = res.impacted.find((r) => r.node === 'coveredNode');
    assert.ok(hit, 'coveredNode must resolve to its @covers spec');
    assert.ok(hit.specs.some((s) => s.endsWith('covered.spec.ts')));
    assert.ok(!res.uncovered.includes('coveredNode'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC-CSR.1: a mark committed BEFORE the window is still stale and still dropped — the fix widens recall, it does not defeat the diff-sourcing (OI-42)', () => {
  const { repo, sinceSha } = buildMarkOnlyRepo();
  try {
    // a THIRD commit, after which we take a LATER since: the earlier marks are now
    // out of window and must vanish from the report even though they are still in
    // the working tree, semicolon-less and readable.
    const mmd = path.join(repo, 'work', 'projX', 'architecture', 'dependencies', 'class-deps.mmd');
    fs.appendFileSync(mmd, '  %% an unrelated later commit that touches no node\n');
    git(repo, ['commit', '-qm', 'later: comment only', '--', '.']);
    const later = git(repo, ['rev-parse', 'HEAD']).trim();
    const res = tool.run({ root: repo, project: 'projX', since: later });
    assert.deepEqual(res.changedNodes, [], 'marks outside the window are stale and must not be reported');
    assert.equal(res.exitCode, 0);
    assert.notEqual(sinceSha, later);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
