'use strict';
/**
 * impacted-tests.test.js — IMP-007 self-tests (the "protection" clause).
 *
 * Proves the three behaviours required by the done-condition, with no network
 * and no credentials, using node's built-in runner:
 *   (a) a changed node that HAS a covering @covers spec is listed as IMPACTED;
 *   (b) a changed node with NO covering spec is flagged UNCOVERED (warning);
 *   (c) exit codes: 0 when all changed nodes are covered (or no changes),
 *       2 when there is >=1 uncovered changed node.
 *
 * Strategy: unit-test the pure parsers against literal .mmd / spec strings, then
 * integration-test the full git-diff + working-tree + grep path against a
 * throwaway git repo built in a temp dir (so the real fixtures need no nested
 * .git). All paths absolute.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tool = require('./impacted-tests.js');

// --- pure: changed-node extraction from .mmd text ----------------------------

test('extractChangedNodes: :::changed inline mark', () => {
  const text = [
    'flowchart TD',
    '  alpha["alpha label"]:::changed',
    '  beta["beta label"]:::stable',
  ].join('\n');
  assert.deepEqual(tool.extractMarkedNodes(text).sort(), ['alpha']);
});

test('extractChangedNodes: slice-scoped ::: marks (sNNNchanged, camelCase) count, stable/delivered/store do not', () => {
  const text = [
    '  portCodeReservation["x"]:::s005h3changed',
    '  domainAuthorize["y"]:::s007aChanged',
    '  spaJoinRoute["z"]:::stable',
    '  conn["c"]:::delivered',
    '  games["g"]:::store',
  ].join('\n');
  assert.deepEqual(tool.extractMarkedNodes(text).sort(), ['domainAuthorize', 'portCodeReservation']);
});

test('extractChangedNodes: comma-list `class A,B,C changed;` statement', () => {
  const text = '  class wsfn,conn,games changed;';
  assert.deepEqual(tool.extractMarkedNodes(text).sort(), ['conn', 'games', 'wsfn']);
});

test('extractChangedNodes: a `class A,B stable;` statement is NOT a change mark', () => {
  const text = '  class wsfn,conn stable;';
  assert.deepEqual(tool.extractMarkedNodes(text), []);
});

// --- pure: node ids from added/removed diff lines -----------------------------

test('extractNodesFromDiffLines: picks node ids declared on +/- lines', () => {
  const diff = [
    '+  newNode["new label"]:::s005h3changed',
    '-  goneNode["gone"]',
    ' context["unchanged"]:::stable',
    '+  classDef s005h3changed fill:#fff;',
  ].join('\n');
  assert.deepEqual(tool.extractNodesFromDiffLines(diff).sort(), ['goneNode', 'newNode']);
});

test('extractNodesFromDiffLines: a node newly given a :::changed mark in-window (no shape bracket) is picked up', () => {
  // The node was DECLARED in a prior commit; this window only re-touches its line
  // to add the inline mark — so it must be detected via the inline-mark form too,
  // not only via a `id[shape]` declaration on the + line.
  const diff = [
    '-  existingNode["x"]:::stable',
    '+  existingNode["x"]:::s009changed',
    ' context["c"]:::stable',
  ].join('\n');
  assert.deepEqual(tool.extractNodesFromDiffLines(diff).sort(), ['existingNode']);
});

test('extractNodesFromDiffLines: a node whose EDGE was added in-window is picked up by endpoint', () => {
  const diff = [
    '+  sourceNode -->|"label"| targetNode',
  ].join('\n');
  assert.deepEqual(tool.extractNodesFromDiffLines(diff).sort(), ['sourceNode', 'targetNode']);
});

test('extractNodesFromDiffLines: a `class A,B changed;` statement added in-window picks up its nodes', () => {
  const diff = [
    '+  class wsfn,conn changed;',
  ].join('\n');
  assert.deepEqual(tool.extractNodesFromDiffLines(diff).sort(), ['conn', 'wsfn']);
});

test('extractNodesFromDiffLines: a recolour-only classDef line (no node id) contributes nothing', () => {
  // The OI-42 root cause: at delivery a `classDef sNNNchanged fill:#green` line is
  // edited (recolour), but it carries NO node id, so it must not add any node.
  const diff = [
    '-  classDef s009changed fill:#fde8e8,stroke:#c62828;',
    '+  classDef s009changed fill:#e8f4e8,stroke:#2e7d32;',
  ].join('\n');
  assert.deepEqual(tool.extractNodesFromDiffLines(diff).sort(), []);
});

// --- pure: @covers tag -> node-id set -----------------------------------------

test('parseCoversTags: comma list, strips trailing (annotation), maps to file', () => {
  const spec = [
    '// @covers adapter-local-store, adapter-local-relay (class-deps.mmd)',
    '// @covers gamesCreateHandler, portCodeReservation (class-deps.mmd s005-h3)',
  ].join('\n');
  const map = tool.parseCoversTags(spec, '/some/spec.ts');
  assert.equal(map.get('adapter-local-store')?.has('/some/spec.ts'), true);
  assert.equal(map.get('portCodeReservation')?.has('/some/spec.ts'), true);
  assert.equal(map.get('gamesCreateHandler')?.has('/some/spec.ts'), true);
  assert.equal(map.has('class-deps.mmd'), false); // annotation not treated as a node
});

// --- integration: full run() against a throwaway git repo --------------------

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function buildRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'imp007-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  const depDir = path.join(repo, 'work', 'projX', 'architecture', 'dependencies');
  const specDir = path.join(repo, 'work', 'projX', 'src', 'specs');
  fs.mkdirSync(depDir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  // PRIOR-SLICE baseline (committed BEFORE the SINCE window): carries a stale
  // `:::s000changed` mark on staleNode. This is the OI-42 trap — the class name
  // still contains "changed" forever, so a full-file scan would wrongly report it.
  fs.writeFileSync(path.join(depDir, 'class-deps.mmd'),
    'flowchart TD\n' +
    '  existing["existing"]:::stable\n' +
    '  staleNode["stale prior-slice node"]:::s000changed\n');
  // a spec that covers the node we WILL add (coveredNode) + one covering staleNode
  // (so if staleNode leaked through it would show up as IMPACTED, not just be
  // silently dropped as uncovered).
  fs.writeFileSync(path.join(specDir, 'covered.spec.ts'),
    '// @covers coveredNode (class-deps.mmd)\n// @covers staleNode\nit("x", () => {});\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'prior slice (stale mark committed here)']);
  const sinceSha = git(repo, ['rev-parse', 'HEAD']).trim();
  // IN-WINDOW change: add two changed nodes coveredNode (has spec) + uncoveredNode
  // (no spec). staleNode's line is UNTOUCHED — its mark predates the window.
  fs.writeFileSync(path.join(depDir, 'class-deps.mmd'),
    'flowchart TD\n' +
    '  existing["existing"]:::stable\n' +
    '  staleNode["stale prior-slice node"]:::s000changed\n' +
    '  coveredNode["covered"]:::s001changed\n' +
    '  uncoveredNode["uncovered"]:::s001changed\n');
  // do NOT commit — exercise working-tree diff detection + committed diff together.
  return { repo, sinceSha };
}

test('run(): (a) impacted spec listed, (b) uncovered node flagged, (c) exit 2', () => {
  const { repo, sinceSha } = buildRepo();
  const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
  // (a) coveredNode -> covered.spec.ts in impacted list
  const covered = res.impacted.find((r) => r.node === 'coveredNode');
  assert.ok(covered, 'coveredNode should be impacted');
  assert.ok(covered.specs.some((s) => s.endsWith('covered.spec.ts')));
  // (b) uncoveredNode flagged
  assert.ok(res.uncovered.includes('uncoveredNode'), 'uncoveredNode should be flagged');
  // (c) nonzero advisory exit
  assert.equal(res.exitCode, 2);
  // (d) OI-42: a stale `changed`-named mark committed BEFORE the window must NOT
  // be reported — its line is in neither the committed-since nor the working-tree
  // diff, so a diff-sourced changed-set drops it.
  assert.ok(!res.changedNodes.includes('staleNode'),
    'staleNode (stale prior-slice mark, not in SINCE window) must NOT be reported');
  assert.ok(!res.impacted.some((r) => r.node === 'staleNode'));
  assert.ok(!res.uncovered.includes('staleNode'));
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run(): OI-42 — a node given a :::changed mark in a COMMITTED in-window edit is reported', () => {
  const { repo, sinceSha } = buildRepo();
  const depFile = path.join(repo, 'work', 'projX', 'architecture', 'dependencies', 'class-deps.mmd');
  // commit the in-window working-tree change, then make a further committed edit
  // that re-marks the previously-stable `existing` node as changed in-window.
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 's001 in-window node adds']);
  fs.writeFileSync(depFile,
    'flowchart TD\n' +
    '  existing["existing"]:::s001changed\n' +
    '  staleNode["stale prior-slice node"]:::s000changed\n' +
    '  coveredNode["covered"]:::s001changed\n' +
    '  uncoveredNode["uncovered"]:::s001changed\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 's001 re-mark existing node changed in-window']);
  const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
  assert.ok(res.changedNodes.includes('existing'),
    'existing was re-marked changed within the window -> reported');
  assert.ok(!res.changedNodes.includes('staleNode'),
    'staleNode mark predates the window -> not reported');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run(): exit 0 when every changed node is covered', () => {
  const { repo, sinceSha } = buildRepo();
  // add a spec covering uncoveredNode too -> now all covered.
  fs.writeFileSync(path.join(repo, 'work', 'projX', 'src', 'specs', 'extra.spec.ts'),
    '// @covers uncoveredNode\nit("y", () => {});\n');
  const res = tool.run({ root: repo, project: 'projX', since: sinceSha });
  assert.equal(res.uncovered.length, 0);
  assert.equal(res.exitCode, 0);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run(): exit 0 when there are no changed nodes', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'imp007-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  const depDir = path.join(repo, 'work', 'projX', 'architecture', 'dependencies');
  fs.mkdirSync(depDir, { recursive: true });
  fs.writeFileSync(path.join(depDir, 'class-deps.mmd'), 'flowchart TD\n  a["a"]:::stable\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'base']);
  const since = git(repo, ['rev-parse', 'HEAD']).trim();
  const res = tool.run({ root: repo, project: 'projX', since });
  assert.equal(res.changedNodes.length, 0);
  assert.equal(res.exitCode, 0);
  fs.rmSync(repo, { recursive: true, force: true });
});
