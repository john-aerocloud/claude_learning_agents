'use strict';
/**
 * isolated-commit.test.js — DEFECT-OAG-058 self-tests.
 *
 * Every test is DIFFERENTIAL: it runs the SAME scenario twice, once through the
 * naive/pre-fix form (control DISABLED) and once through the tool (control
 * ENABLED), and asserts they DISAGREE. A control that cannot be observed failing
 * tells you nothing (DEFECT-OAG-068 / DEFECT-OAG-073), so the disabled arm is
 * part of the assertion, not commentary.
 *
 * Acceptance criteria under test (DEFECT-OAG-058, limb 1 as REWRITTEN by the
 * 2026-08-06 amendment — the remedy is the PRIVATE INDEX, not `git commit --`):
 *   AC-DEFECT-OAG-058.1  a foreign file STAGED in the shared index does not ride
 *                        along; the naive arm proves it does.
 *   AC-DEFECT-OAG-058.2  the shared index is not read and not mutated while the
 *                        tree is built; the foreign file is still staged and
 *                        uncommitted afterwards (item limb 3).
 *   AC-DEFECT-OAG-058.3  a concurrent agent's IN-FLIGHT WORKING-TREE edit to a
 *                        file I did not declare is not swept; the
 *                        `git commit -- <pathspec>` arm proves that it is (the
 *                        33-line sweep the 061 engineer observed).
 *   AC-DEFECT-OAG-058.4  the declared-subset assertion fires and ABORTS (no
 *                        commit, HEAD unmoved) when the pathspec expands outside
 *                        the literal declared set.
 *   AC-DEFECT-OAG-058.5  nothing to commit for the declared paths => refusal,
 *                        never an empty commit; a path silently .gitignore'd is
 *                        named as such (the DEF-ROC-001 false-green).
 *   AC-DEFECT-OAG-058.6  a concurrent branch move between tree-build and
 *                        ref-update is compare-and-swapped, not lost.
 *   AC-DEFECT-OAG-058.7  the shared index is resynced for MY paths only, so a
 *                        later whole-index commit by another agent cannot revert
 *                        my file; --no-sync-index proves the revert is real.
 *   AC-DEFECT-OAG-058.8  detached HEAD is refused rather than guessed at.
 *
 * No network, no credentials: every case builds a throwaway git repo in a temp
 * dir and drives real git.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tool = require('./isolated-commit.js');

const TOOL_PATH = path.join(__dirname, 'isolated-commit.js');

// --- harness -----------------------------------------------------------------

function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
  }).trim();
}

function write(repo, rel, text) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

/** A repo standing in for the shared trunk worktree five agents share. */
function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oag058-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, ['config', 'user.email', 'agent@example.test']);
  git(repo, ['config', 'user.name', 'Agent']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  write(repo, 'items/ITEM-1.md', 'base\n');
  write(repo, 'src/mine.ts', 'export const mine = 1;\n');
  write(repo, 'src/theirs.ts', 'export const theirs = 1;\n');
  write(repo, 'README.md', 'base\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

/** Files touched by the tip commit, relative to its parent. */
function filesInHead(repo) {
  const out = git(repo, ['diff-tree', '-r', '--no-commit-id', '--name-only', 'HEAD']);
  return out ? out.split('\n').sort() : [];
}

function stagedFiles(repo) {
  const out = git(repo, ['diff', '--cached', '--name-only']);
  return out ? out.split('\n').sort() : [];
}

function indexBytes(repo) {
  return fs.readFileSync(path.join(repo, '.git', 'index'));
}

function runCli(repo, args) {
  return spawnSync(process.execPath, [TOOL_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/**
 * The exact shape of b477f08: another agent has already staged its own file in
 * the SHARED index when I stage mine and commit.
 */
function dirtyTheSharedIndexWithAForeignStagedFile(repo) {
  write(repo, 'src/foreign.ts', 'export const foreign = "another agent, mid-task";\n');
  git(repo, ['add', '--', 'src/foreign.ts']); // the other agent's `git add`
}

// --- AC-DEFECT-OAG-058.1 / .2 -----------------------------------------------

test('AC-DEFECT-OAG-058.1 CONTROL DISABLED: path-scoped `git add` + plain commit PUBLISHES the foreign staged file (reproduces b477f08)', () => {
  const repo = makeRepo();
  dirtyTheSharedIndexWithAForeignStagedFile(repo);

  write(repo, 'items/ITEM-1.md', 'my edit\n');
  git(repo, ['add', '--', 'items/']); // correctly path-scoped, as b477f08 was
  git(repo, ['commit', '-q', '-m', 'state: my item edit']); // …but commit takes the whole index

  assert.deepEqual(
    filesInHead(repo),
    ['items/ITEM-1.md', 'src/foreign.ts'],
    'the pre-fix form must be observed publishing the foreign file — if this passes with only my file, the defect is not being reproduced and the enabled arm proves nothing',
  );
});

test('AC-DEFECT-OAG-058.1 CONTROL ENABLED: the isolated commit contains ONLY the declared paths', () => {
  const repo = makeRepo();
  dirtyTheSharedIndexWithAForeignStagedFile(repo);
  write(repo, 'items/ITEM-1.md', 'my edit\n');

  const res = runCli(repo, ['--repo', repo, '--message', 'state: my item edit', '--', 'items/']);
  assert.equal(res.status, 0, res.stderr);

  assert.deepEqual(filesInHead(repo), ['items/ITEM-1.md']);
  assert.equal(git(repo, ['log', '-1', '--pretty=%s']), 'state: my item edit');
});

test('AC-DEFECT-OAG-058.2 the foreign file is STILL STAGED and uncommitted afterwards; the shared index is untouched by the tree build', () => {
  const repo = makeRepo();
  dirtyTheSharedIndexWithAForeignStagedFile(repo);
  write(repo, 'items/ITEM-1.md', 'my edit\n');

  const before = indexBytes(repo);
  const res = tool.isolatedCommit({
    repo,
    message: 'state: my item edit',
    paths: ['items/'],
    syncIndex: false, // isolate this assertion to the tree-build phase
  });
  assert.ok(res.sha);

  assert.deepEqual(indexBytes(repo), before, 'the shared index must not be read into, or written by, the tree build');
  assert.ok(
    stagedFiles(repo).includes('src/foreign.ts'),
    'the other agent must still find its work staged and uncommitted',
  );
  assert.ok(!filesInHead(repo).includes('src/foreign.ts'));
});

// --- AC-DEFECT-OAG-058.3 — the working-tree race the 2026-08-06 amendment found

test('AC-DEFECT-OAG-058.3 CONTROL DISABLED: `git commit -- <dir pathspec>` sweeps a concurrent agent\'s in-flight working-tree edit', () => {
  const repo = makeRepo();
  write(repo, 'src/mine.ts', 'export const mine = 2;\n');
  write(repo, 'src/theirs.ts', 'export const theirs = 2; // 33 lines of their in-flight work\n');

  git(repo, ['commit', '-q', '-m', 'my change', '--', 'src']);

  assert.deepEqual(
    filesInHead(repo),
    ['src/mine.ts', 'src/theirs.ts'],
    'the prescribed remedy must be observed failing: it commits from the WORKING TREE, so a concurrent edit under the same pathspec rides along',
  );
});

test('AC-DEFECT-OAG-058.3 CONTROL ENABLED: only the declared file is committed; the concurrent edit stays in the working tree', () => {
  const repo = makeRepo();
  write(repo, 'src/mine.ts', 'export const mine = 2;\n');
  write(repo, 'src/theirs.ts', 'export const theirs = 2; // 33 lines of their in-flight work\n');

  const res = runCli(repo, ['--repo', repo, '--message', 'my change', '--', 'src/mine.ts']);
  assert.equal(res.status, 0, res.stderr);

  assert.deepEqual(filesInHead(repo), ['src/mine.ts']);
  assert.equal(
    fs.readFileSync(path.join(repo, 'src/theirs.ts'), 'utf8'),
    'export const theirs = 2; // 33 lines of their in-flight work\n',
    'their working-tree edit must survive untouched',
  );
  assert.ok(git(repo, ['status', '--porcelain', '--', 'src/theirs.ts']).length > 0, 'and remain uncommitted');
});

// --- AC-DEFECT-OAG-058.4 — the declared-subset assertion --------------------

test('AC-DEFECT-OAG-058.4 the subset assertion FIRES: a pathspec expanding outside the literal declared set aborts, HEAD unmoved, no commit', () => {
  const repo = makeRepo();
  write(repo, 'src/mine.ts', 'export const mine = 3;\n');
  write(repo, 'src/theirs.ts', 'export const theirs = 3;\n');
  const head = git(repo, ['rev-parse', 'HEAD']);

  const res = runCli(repo, ['--repo', repo, '--message', 'my change', '--', 'src/*.ts']);

  assert.equal(res.status, 3, `expected the subset guard to abort with 3, got ${res.status}: ${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /src\/theirs\.ts/, 'the guard must NAME the paths that escaped the declared set');
  assert.equal(git(repo, ['rev-parse', 'HEAD']), head, 'nothing may be committed when the guard fires');
});

test('AC-DEFECT-OAG-058.4 NON-VACUITY: the same shape with a literal declared path does NOT fire', () => {
  const repo = makeRepo();
  write(repo, 'src/mine.ts', 'export const mine = 3;\n');
  write(repo, 'src/theirs.ts', 'export const theirs = 3;\n');

  const res = runCli(repo, ['--repo', repo, '--message', 'my change', '--', 'src/mine.ts']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(filesInHead(repo), ['src/mine.ts']);
});

test('AC-DEFECT-OAG-058.4 the subset predicate discriminates (pure)', () => {
  assert.deepEqual(tool.pathsOutsideDeclared(['items/A.md', 'items/sub/B.md'], ['items']), []);
  assert.deepEqual(tool.pathsOutsideDeclared(['items/A.md', 'src/x.ts'], ['items']), ['src/x.ts']);
  assert.deepEqual(tool.pathsOutsideDeclared(['itemsX/A.md'], ['items']), ['itemsX/A.md'], 'prefix match must respect the directory boundary');
  assert.deepEqual(tool.pathsOutsideDeclared(['src/mine.ts'], ['./src/mine.ts']), []);
});

// --- AC-DEFECT-OAG-058.5 — never an empty commit ----------------------------

test('AC-DEFECT-OAG-058.5 nothing to commit for the declared paths => refusal, not an empty commit', () => {
  const repo = makeRepo();
  const head = git(repo, ['rev-parse', 'HEAD']);
  dirtyTheSharedIndexWithAForeignStagedFile(repo); // only the OTHER agent has work

  const res = runCli(repo, ['--repo', repo, '--message', 'nothing of mine', '--', 'items/']);

  assert.equal(res.status, 4, `${res.stdout}${res.stderr}`);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), head);
});

test('AC-DEFECT-OAG-058.5 a declared path silently swallowed by .gitignore is NAMED (the DEF-ROC-001 false-green)', () => {
  const repo = makeRepo();
  write(repo, '.gitignore', 'secrets/\n');
  git(repo, ['add', '--', '.gitignore']);
  git(repo, ['commit', '-q', '-m', 'ignore']);
  write(repo, 'src/secrets/key-store.ts', 'export const k = 1;\n');

  const res = runCli(repo, ['--repo', repo, '--message', 'add key store', '--', 'src/secrets/key-store.ts']);

  assert.equal(res.status, 4);
  assert.match(res.stderr, /gitignore/i, 'the refusal must say WHY the path contributed nothing');
  assert.match(res.stderr, /src\/secrets\/key-store\.ts/);
});

// --- AC-DEFECT-OAG-058.6 — compare-and-swap on the branch ref ----------------

test('AC-DEFECT-OAG-058.6 a concurrent commit landing between tree-build and ref-update is not lost', () => {
  const repo = makeRepo();
  write(repo, 'items/ITEM-1.md', 'my edit\n');

  const res = tool.isolatedCommit({
    repo,
    message: 'my item edit',
    paths: ['items/'],
    hooks: {
      // another agent commits while we hold our tree
      beforeUpdateRef: once(() => {
        write(repo, 'README.md', 'their concurrent edit\n');
        git(repo, ['commit', '-q', '-m', 'their concurrent commit', '--', 'README.md']);
      }),
    },
  });

  assert.ok(res.sha);
  assert.equal(res.attempts, 2, 'the first ref-update must be REJECTED by the compare-and-swap and retried');
  assert.deepEqual(filesInHead(repo), ['items/ITEM-1.md']);
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'their concurrent edit\n');
  assert.equal(
    git(repo, ['show', 'HEAD~1:README.md']),
    'their concurrent edit',
    'their commit must still be an ancestor — no lost update',
  );
});

function once(fn) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

// --- AC-DEFECT-OAG-058.7 — resync the shared index for MY paths only --------

test('AC-DEFECT-OAG-058.7 CONTROL DISABLED (--no-sync-index): a later whole-index commit by another agent REVERTS my committed file', () => {
  const repo = makeRepo();
  write(repo, 'src/mine.ts', 'export const mine = 99;\n');

  tool.isolatedCommit({ repo, message: 'my change', paths: ['src/mine.ts'], syncIndex: false });

  // the other agent, working normally, commits the whole (now stale) index
  write(repo, 'src/theirs.ts', 'export const theirs = 5;\n');
  git(repo, ['add', '--', 'src/theirs.ts']);
  git(repo, ['commit', '-q', '-m', 'their change']);

  assert.equal(
    git(repo, ['show', 'HEAD:src/mine.ts']),
    'export const mine = 1;',
    'a stale shared-index entry must be observed silently REVERTING my commit — otherwise the resync is not protecting anything',
  );
});

test('AC-DEFECT-OAG-058.7 CONTROL ENABLED: the shared index is resynced for my paths, so the later whole-index commit cannot revert me', () => {
  const repo = makeRepo();
  dirtyTheSharedIndexWithAForeignStagedFile(repo);
  write(repo, 'src/mine.ts', 'export const mine = 99;\n');

  tool.isolatedCommit({ repo, message: 'my change', paths: ['src/mine.ts'] });

  assert.ok(
    stagedFiles(repo).includes('src/foreign.ts'),
    'the resync must touch MY paths only — the other agent keeps its staged work',
  );

  write(repo, 'src/theirs.ts', 'export const theirs = 5;\n');
  git(repo, ['add', '--', 'src/theirs.ts']);
  git(repo, ['commit', '-q', '-m', 'their change']);

  assert.equal(git(repo, ['show', 'HEAD:src/mine.ts']), 'export const mine = 99;');
});

// --- AC-DEFECT-OAG-058.8 — preconditions ------------------------------------

test('AC-DEFECT-OAG-058.8 a detached HEAD is refused, not guessed at', () => {
  const repo = makeRepo();
  git(repo, ['checkout', '-q', '--detach']);
  write(repo, 'items/ITEM-1.md', 'my edit\n');

  const res = runCli(repo, ['--repo', repo, '--message', 'my item edit', '--', 'items/']);
  assert.equal(res.status, 2, `${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /detached/i);
});

test('AC-DEFECT-OAG-058.8 a path escaping the repo, an absolute path, and pathspec magic are all refused', () => {
  const repo = makeRepo();
  for (const bad of ['../elsewhere', path.join(repo, 'items'), ':/', ':(exclude)src']) {
    const res = runCli(repo, ['--repo', repo, '--message', 'm', '--', bad]);
    assert.equal(res.status, 2, `expected refusal for ${bad}, got ${res.status}`);
  }
});

test('AC-DEFECT-OAG-058.8 no declared paths and no message are refused', () => {
  const repo = makeRepo();
  assert.equal(runCli(repo, ['--repo', repo, '--message', 'm']).status, 2);
  assert.equal(runCli(repo, ['--repo', repo, '--', 'items/']).status, 2);
});

// --- AC-DEFECT-OAG-058.9 — the wiring (item limb 2, and DEFECT-OAG-056's lesson)
//
// A mechanism no agent is routed to is not a fix, it is a file. These assert the
// process layer actually points at it — and, crucially, that the DISCREDITED
// `git commit -- <pathspec>` form is nowhere left standing as the remedy.

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * EVERY agent file is enumerated, with its commit decision. A file that commits
 * must route to the tool. A NEW agent file fails this gate until it declares —
 * an omitted lane is exactly how DEFECT-OAG-043 happened.
 */
const AGENT_COMMIT_LANES = {
  'engineer.md': 'commits',
  'tester.md': 'commits',
  'documenter.md': 'commits',
  'cicd.md': 'commits',
  'orchestrator.md': 'commits',
  'flow-manager.md': 'commits',
  'product.md': 'commits',
  'solution-architect.md': 'commits',
  'ui-designer.md': 'commits',
  'discovery.md': 'commits',
  'linear.md': 'does-not-commit',
  'jira.md': 'does-not-commit',
};

test('AC-DEFECT-OAG-058.9 every agent file declares a commit lane (an undeclared lane is how the control gets omitted)', () => {
  const onDisk = fs.readdirSync(path.join(REPO_ROOT, '.claude', 'agents')).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(onDisk, Object.keys(AGENT_COMMIT_LANES).sort());
});

test('AC-DEFECT-OAG-058.9 every committing agent routes to the isolated-commit tool', () => {
  const missing = [];
  for (const [file, lane] of Object.entries(AGENT_COMMIT_LANES)) {
    if (lane !== 'commits') continue;
    const text = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'agents', file), 'utf8');
    if (!text.includes('isolated-commit')) missing.push(file);
  }
  assert.deepEqual(missing, [], 'these agents commit but are not routed to the private-index tool');
});

test('AC-DEFECT-OAG-058.9 the discredited `git commit -- <pathspec>` form is never left standing as the remedy', () => {
  const files = [
    ...fs
      .readdirSync(path.join(REPO_ROOT, '.claude', 'agents'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(REPO_ROOT, '.claude', 'agents', f)),
    path.join(REPO_ROOT, 'process', 'process-current.md'),
  ];
  const offenders = [];
  for (const abs of files) {
    // paragraph-scoped: the correction must travel with the form, but may be a
    // sentence away rather than on the same physical line.
    for (const para of fs.readFileSync(abs, 'utf8').split(/\n\s*\n/)) {
      if (!/git commit\s+--(?!\S)/.test(para)) continue;
      if (/isolated-commit|DEFECT-OAG-058/.test(para)) continue;
      offenders.push(`${path.relative(REPO_ROOT, abs)}: ${para.trim().slice(0, 160)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'this form commits from the WORKING TREE and sweeps a concurrent agent\'s mid-edit save — it may only appear alongside its correction',
  );
});

test('AC-DEFECT-OAG-058.9 the root Makefile exposes the tool as a parameterised, PHONY target', () => {
  const mk = fs.readFileSync(path.join(REPO_ROOT, 'Makefile'), 'utf8');
  assert.match(mk, /^commit-isolated:/m, 'no `commit-isolated` target');
  assert.match(mk, /node \.claude\/tools\/isolated-commit\.js/, 'the target must invoke the tool');
  assert.match(mk, /^\.PHONY:.*\bcommit-isolated\b/m, '`commit-isolated` must be declared PHONY');
});
