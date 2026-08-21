'use strict';
/**
 * sequencer-guard.test.js — OI-ABANDONED-SEQUENCER-STATE-ARMS-A-56-COMMIT-DESTRUCTION.
 *
 * THE INCIDENT THESE PIN. `.git/sequencer` sat in the SHARED `work/OagEventSource`
 * tree for six hours holding a two-step revert todo with `head=b55d15e0`. That
 * saved head was FIFTY-SIX commits behind HEAD — the whole output of seven agents
 * in one session — and `git revert --abort` rewinds to it. `git status
 * --porcelain` reported nothing, so every cleanliness check in this system passed
 * with it armed.
 *
 * EVERY CLAIM HERE IS PLANTED AND MEASURED, NEVER AUTHORED. The states are made by
 * driving REAL git into REAL conflicts in throwaway repos; the commit counts are
 * read back from real `rev-list`; and the destruction claims run BOTH ARMS — the
 * natural verb and the safe one — so what `--abort` does is observed, not asserted
 * from folklore. That matters here because the folklore is WRONG in an important
 * way: git's `abort-safety` refuses to rewind while HEAD has moved, so a stale
 * sequencer is not armed at that instant — it is ONE `--continue` from armed, and
 * `--continue` is the more natural move on a stuck operation. AC-SEQ.4 measures
 * exactly that path and watches the commits die.
 *
 * Acceptance criteria under test:
 *   AC-SEQ.1  the check DETECTS sequencer / REVERT_HEAD / CHERRY_PICK_HEAD /
 *             MERGE_HEAD / a rebase dir in ANY tracked repo — parent AND the
 *             nested project repo — and reports HOW MANY COMMITS `--abort` would
 *             discard. The count is the whole point.
 *   AC-SEQ.2  severity: commits at stake, or residue we cannot measure, or
 *             abandoned residue => BLOCK; a fresh operation with nothing at stake
 *             => ADVISORY. (Its loop-gate wiring is pinned in
 *             .claude/skills/work-items/scripts/test_work_items.py.)
 *   AC-SEQ.4  non-vacuity: a planted sequencer/rebase is watched DESTROYING the
 *             commits the check counted, and `--quit` is watched not destroying
 *             them.
 *
 * No network, no credentials, and nothing outside a temp dir is ever touched — in
 * particular NO test arms state in the real shared tree, which is the hazard
 * itself.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('./sequencer-guard.js');

const TOOL = path.join(__dirname, 'sequencer-guard.js');

// --- harness -----------------------------------------------------------------

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function gitTry(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `seqguard-${label}-`));
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main', '.']);
  git(dir, ['config', 'user.email', 'a@b.test']);
  git(dir, ['config', 'user.name', 'A']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function write(repo, rel, text) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

function commit(repo, msg) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', msg]);
  return git(repo, ['rev-parse', 'HEAD']);
}

/**
 * A commit made the way THIS SYSTEM makes them on a shared tree —
 * isolated-commit.js: `commit-tree` + a ref compare-and-swap. Critically it does
 * NOT go through `git commit`, so it never calls git's `remove_branch_state()`.
 * That is precisely why the founding sequencer survived 56 commits: `git commit`
 * would have cleared it on the first one.
 */
function isolatedCommit(repo, msg) {
  // from the INDEX, exactly as isolated-commit.js does (it stages into a private
  // index and commit-trees that), so the working tree is left CLEAN — which is
  // what makes the invisibility claim testable.
  const tree = git(repo, ['write-tree']);
  const parent = git(repo, ['rev-parse', 'HEAD']);
  const sha = git(repo, ['commit-tree', tree, '-p', parent, '-m', msg]);
  const branch = git(repo, ['symbolic-ref', '--short', 'HEAD']);
  git(repo, ['update-ref', `refs/heads/${branch}`, sha]);
  return sha;
}

/**
 * Plant a REAL stopped revert sequencer, then let `nAfter` commits land on top of
 * it the way agents actually commit here. Returns the saved head and the shas
 * that a rewind to it would make unreachable.
 */
function plantStaleSequencer(repo, { nAfter = 5 } = {}) {
  initRepo(repo);
  write(repo, 'f.txt', 'A\n');
  write(repo, 'g.txt', 'A\n');
  write(repo, 'o.txt', 'x\n');
  commit(repo, 'c1');
  write(repo, 'f.txt', 'B\n');
  const cF = commit(repo, 'cF');
  write(repo, 'g.txt', 'B\n');
  const cG = commit(repo, 'cG');
  write(repo, 'o.txt', 'x\ny\n');
  const cO = commit(repo, 'cO');
  write(repo, 'f.txt', 'C\n');
  write(repo, 'g.txt', 'C\n');
  commit(repo, 'cBoth');
  // cO reverts cleanly; cF then CONFLICTS (f.txt has moved on) and the sequencer
  // stops with cG still on the todo — the two-step residue shape of the incident.
  const r = gitTry(repo, ['revert', '--no-edit', cO, cF, cG]);
  assert.notEqual(r.status, 0, 'the revert was meant to stop on a conflict');
  const seqDir = path.join(repo, '.git', 'sequencer');
  assert.ok(fs.existsSync(seqDir), 'no sequencer planted');
  const savedHead = fs.readFileSync(path.join(seqDir, 'head'), 'utf8').trim();
  // tidy the tree WITHOUT `git reset`, which would clear the state we are pinning
  git(repo, ['checkout', '-q', 'HEAD', '--', 'f.txt']);
  const after = [];
  for (let i = 1; i <= nAfter; i += 1) {
    write(repo, `agent${i}.txt`, `work ${i}\n`);
    git(repo, ['add', '--', `agent${i}.txt`]);
    after.push(isolatedCommit(repo, `agent commit ${i}`));
  }
  return { savedHead, after, seqDir };
}

/** Plant a REAL stopped rebase whose branch then gains commits. */
function plantStaleRebase(repo, { nAfter = 3 } = {}) {
  initRepo(repo);
  write(repo, 'f.txt', 'A\n');
  commit(repo, 'base');
  git(repo, ['checkout', '-q', '-b', 'topic']);
  write(repo, 'f.txt', 'T\n');
  commit(repo, 'topic-change');
  git(repo, ['checkout', '-q', 'main']);
  write(repo, 'f.txt', 'M\n');
  commit(repo, 'main-change');
  git(repo, ['checkout', '-q', 'topic']);
  const r = gitTry(repo, ['rebase', 'main']);
  assert.notEqual(r.status, 0, 'the rebase was meant to stop on a conflict');
  const dir = path.join(repo, '.git', 'rebase-merge');
  assert.ok(fs.existsSync(dir), 'no rebase state planted');
  const savedHead = fs.readFileSync(path.join(dir, 'orig-head'), 'utf8').trim();
  const after = [];
  for (let i = 1; i <= nAfter; i += 1) {
    const tree = git(repo, ['rev-parse', 'refs/heads/topic^{tree}']);
    const sha = git(repo, ['commit-tree', tree, '-p', 'refs/heads/topic',
      '-m', `agent commit ${i}`]);
    git(repo, ['update-ref', 'refs/heads/topic', sha]);
    after.push(sha);
  }
  return { savedHead, after, dir };
}

/** The real two-repo topology: a parent that gitignores its nested project repo. */
function parentTopology(root) {
  const parent = initRepo(path.join(root, 'parent'));
  write(parent, '.gitignore', '/work/*/\n');
  write(parent, 'CLAUDE.md', 'agent system\n');
  commit(parent, 'base');
  const proj = path.join(parent, 'work', 'DemoProject');
  return { parent, proj };
}

function runTool(args) {
  const r = spawnSync('node', [TOOL, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function statesOf(report, dir) {
  const real = fs.realpathSync(dir);
  const repo = report.repos.find((x) => x.dir === real || x.dir === dir);
  return repo ? repo.states : [];
}

// --- AC-SEQ.1 — detection, in BOTH repos, WITH THE COUNT ----------------------

test('AC-SEQ.1 a clean tree yields no state at all (the differential arm — the '
  + 'check is not a blanket alarm)', () => {
  const root = tmpdir('clean');
  const { parent, proj } = parentTopology(root);
  initRepo(proj);
  write(proj, 'src/a.ts', 'a\n');
  commit(proj, 'project base');

  const rep = guard.scan(parent, { repoRoot: parent });
  assert.equal(rep.verdict, 'CLEAN');
  assert.equal(rep.repos.length, 0);
  assert.ok(rep.treesScanned >= 2, `both repos must be swept: ${rep.treesScanned}`);
});

test('AC-SEQ.1 a stale sequencer is detected and the count of commits `--abort` '
  + 'would discard is EXACT', () => {
  const root = tmpdir('seq');
  const repo = path.join(root, 'r');
  const { savedHead, after } = plantStaleSequencer(repo, { nAfter: 5 });

  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 0 });
  const states = statesOf(rep, repo);
  const seq = states.find((s) => s.kind === 'sequencer');
  assert.ok(seq, `no sequencer state found: ${JSON.stringify(states)}`);
  assert.equal(seq.verb, 'revert');
  assert.equal(seq.savedHead, savedHead);
  // 5 agent commits + the one revert the sequencer already committed = 6
  const truth = Number(git(repo, ['rev-list', '--count', `${savedHead}..HEAD`]));
  assert.equal(seq.discard, truth);
  assert.equal(seq.discard, after.length + 1);
  assert.ok(rep.message.includes(`COMMITS \`--abort\` WOULD DISCARD: ${truth}`),
    `the count must be in the human report:\n${rep.message}`);
});

test('AC-SEQ.1 the state is INVISIBLE to `git status --porcelain` — the reason '
  + 'every existing cleanliness check passes with it armed', () => {
  const root = tmpdir('invisible');
  const repo = path.join(root, 'r');
  plantStaleSequencer(repo, { nAfter: 2 });

  // asserted, not claimed: the silence of the check everything else relies on
  assert.equal(git(repo, ['status', '--porcelain']), '');
  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 0 });
  assert.equal(rep.verdict, 'BLOCK');
  assert.equal(statesOf(rep, repo)[0].kind, 'sequencer');
});

test('AC-SEQ.1 state in the NESTED project repo is found even though the parent '
  + 'is spotless (the incident was in the nested one)', () => {
  const root = tmpdir('nested');
  const { parent, proj } = parentTopology(root);
  const { savedHead } = plantStaleSequencer(proj, { nAfter: 4 });

  const rep = guard.scan(parent, { repoRoot: parent, graceMin: 0 });
  assert.equal(rep.verdict, 'BLOCK');
  const states = statesOf(rep, proj);
  assert.equal(states.length, 1, `expected the nested repo's state: ${
    JSON.stringify(rep.repos.map((r) => r.dir))}`);
  assert.equal(states[0].discard,
    Number(git(proj, ['rev-list', '--count', `${savedHead}..HEAD`])));
  // and the parent itself contributed nothing
  assert.equal(statesOf(rep, parent).length, 0);
});

test('AC-SEQ.1 a rebase dir is detected and counted against the BRANCH it '
  + 'restores, not against the detached HEAD', () => {
  const root = tmpdir('rebase');
  const repo = path.join(root, 'r');
  const { savedHead, after } = plantStaleRebase(repo, { nAfter: 3 });

  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 0 });
  const st = statesOf(rep, repo).find((s) => s.kind === 'rebase-merge');
  assert.ok(st, `no rebase state: ${JSON.stringify(statesOf(rep, repo))}`);
  assert.equal(st.verb, 'rebase');
  assert.equal(st.savedHead, savedHead);
  assert.equal(st.tipRef, 'refs/heads/topic');
  assert.equal(st.discard,
    Number(git(repo, ['rev-list', '--count', `${savedHead}..refs/heads/topic`])));
  // exactly the commits that landed on the branch while the rebase sat stopped:
  // during a rebase HEAD is detached and refs/heads/topic stays at orig-head, so
  // every one of them is at stake.
  assert.equal(st.discard, after.length);
  assert.equal(st.armedNow, true, 'rebase --abort has no abort-safety check');
});

test('AC-SEQ.1 a conflicted MERGE is detected with ZERO commits at stake — the '
  + 'count distinguishes it from the destructive shapes', () => {
  const root = tmpdir('merge');
  const repo = initRepo(path.join(root, 'r'));
  write(repo, 'f.txt', 'A\n');
  commit(repo, 'base');
  git(repo, ['checkout', '-q', '-b', 'topic']);
  write(repo, 'f.txt', 'T\n');
  commit(repo, 't');
  git(repo, ['checkout', '-q', 'main']);
  write(repo, 'f.txt', 'M\n');
  const head = commit(repo, 'm');
  assert.notEqual(gitTry(repo, ['merge', 'topic']).status, 0);

  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 60 });
  const st = statesOf(rep, repo).find((s) => s.kind === 'MERGE_HEAD');
  assert.ok(st, `no merge state: ${JSON.stringify(statesOf(rep, repo))}`);
  assert.equal(st.discard, 0);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), head, 'HEAD does not move in a merge');
});

test('AC-SEQ.1 a lone REVERT_HEAD (single pick, no sequencer dir) is detected '
  + 'with zero commits at stake', () => {
  const root = tmpdir('single');
  const repo = initRepo(path.join(root, 'r'));
  write(repo, 'f.txt', 'A\n');
  commit(repo, 'c1');
  write(repo, 'f.txt', 'B\n');
  commit(repo, 'c2');
  write(repo, 'f.txt', 'C\n');
  commit(repo, 'c3');
  assert.notEqual(gitTry(repo, ['revert', '--no-edit', 'HEAD~1']).status, 0);
  assert.ok(!fs.existsSync(path.join(repo, '.git', 'sequencer')),
    'a single pick writes no sequencer dir — that is why this shape needs its own limb');

  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 60 });
  const st = statesOf(rep, repo).find((s) => s.kind === 'REVERT_HEAD');
  assert.ok(st, `no single-pick state: ${JSON.stringify(statesOf(rep, repo))}`);
  assert.equal(st.discard, 0);
  assert.equal(st.verb, 'revert');
});

test('AC-SEQ.1 the CLI reports the count on stdout and exits 2 on an armed state',
  () => {
    const root = tmpdir('cli');
    const repo = path.join(root, 'r');
    const { savedHead } = plantStaleSequencer(repo, { nAfter: 3 });
    const truth = Number(git(repo, ['rev-list', '--count', `${savedHead}..HEAD`]));

    const r = runTool(['scan', repo, '--repo-root', repo, '--grace-min', '0']);
    assert.equal(r.code, 2, r.out + r.err);
    assert.ok(r.out.includes(`COMMITS \`--abort\` WOULD DISCARD: ${truth}`), r.out);
    assert.ok(r.out.includes('revert --quit'), 'the remedy must name --quit');

    const j = runTool(['scan', repo, '--repo-root', repo, '--grace-min', '0', '--json']);
    const rep = JSON.parse(j.out);
    assert.equal(rep.verdict, 'BLOCK');
    assert.equal(rep.worstDiscard, truth);
  });

test('AC-SEQ.1 the scan MUTATES NOTHING — a detector that could destroy what it '
  + 'detects is not a detector', () => {
  const root = tmpdir('readonly');
  const repo = path.join(root, 'r');
  plantStaleSequencer(repo, { nAfter: 3 });
  const before = git(repo, ['rev-parse', 'HEAD']);

  guard.scan(repo, { repoRoot: repo, graceMin: 0 });
  runTool(['scan', repo, '--repo-root', repo]);

  assert.equal(git(repo, ['rev-parse', 'HEAD']), before);
  assert.ok(fs.existsSync(path.join(repo, '.git', 'sequencer')),
    'the state must still be there for a human to inspect before clearing it');
});

// --- AC-SEQ.2 — severity ------------------------------------------------------

test('AC-SEQ.2 commits at stake => BLOCK, even while the state is fresh', () => {
  const root = tmpdir('sev-block');
  const repo = path.join(root, 'r');
  plantStaleSequencer(repo, { nAfter: 4 });
  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 600 });
  assert.equal(rep.verdict, 'BLOCK');
  assert.equal(statesOf(rep, repo)[0].stale, false);
  assert.ok(rep.worstDiscard > 0);
});

test('AC-SEQ.2 nothing at stake AND fresh => ADVISORY (a live conflict someone is '
  + 'resolving right now is not a reason to stop the line)', () => {
  const root = tmpdir('sev-adv');
  const repo = initRepo(path.join(root, 'r'));
  write(repo, 'f.txt', 'A\n');
  commit(repo, 'c1');
  write(repo, 'f.txt', 'B\n');
  commit(repo, 'c2');
  write(repo, 'f.txt', 'C\n');
  commit(repo, 'c3');
  assert.notEqual(gitTry(repo, ['revert', '--no-edit', 'HEAD~1']).status, 0);

  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 600 });
  assert.equal(rep.verdict, 'ADVISORY');
  assert.equal(rep.worstDiscard, 0);
  const r = runTool(['scan', repo, '--repo-root', repo, '--grace-min', '600']);
  assert.equal(r.code, 0, 'an advisory must not fail the command');
});

test('AC-SEQ.2 the SAME state goes to BLOCK once it is abandoned past the grace '
  + 'window — because the count grows with every isolated commit', () => {
  const root = tmpdir('sev-stale');
  const repo = initRepo(path.join(root, 'r'));
  write(repo, 'f.txt', 'A\n');
  commit(repo, 'c1');
  write(repo, 'f.txt', 'B\n');
  commit(repo, 'c2');
  write(repo, 'f.txt', 'C\n');
  commit(repo, 'c3');
  assert.notEqual(gitTry(repo, ['revert', '--no-edit', 'HEAD~1']).status, 0);

  assert.equal(guard.scan(repo, { repoRoot: repo, graceMin: 600 }).verdict, 'ADVISORY');
  assert.equal(guard.scan(repo, { repoRoot: repo, graceMin: 0 }).verdict, 'BLOCK');
});

test('AC-SEQ.2 a state whose saved head cannot be resolved fails CLOSED, never '
  + 'clean', () => {
  const root = tmpdir('sev-closed');
  const repo = path.join(root, 'r');
  plantStaleSequencer(repo, { nAfter: 2 });
  // the shape of a corrupted / hand-edited state: a head we cannot resolve
  fs.writeFileSync(path.join(repo, '.git', 'sequencer', 'head'),
    'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');

  const rep = guard.scan(repo, { repoRoot: repo, graceMin: 600 });
  assert.equal(rep.verdict, 'BLOCK');
  assert.equal(statesOf(rep, repo)[0].discard, null);
  assert.equal(rep.unmeasured, 1);
  assert.ok(rep.message.includes('NOT ESTABLISHED'), rep.message);
});

// --- AC-SEQ.4 — non-vacuity: watch the commits die ---------------------------

test('AC-SEQ.4 NON-VACUITY, both arms: the counted commits are DESTROYED by the '
  + 'natural verbs (`--continue` then `--abort`) and SURVIVE `--quit`', () => {
  const root = tmpdir('nonvacuity');
  const src = path.join(root, 'src');
  const { savedHead, after } = plantStaleSequencer(src, { nAfter: 5 });

  // what the check says is at stake, BEFORE anything is done to the repo
  const rep = guard.scan(src, { repoRoot: src, graceMin: 0 });
  const reported = statesOf(rep, src)[0].discard;
  assert.equal(reported, after.length + 1);

  // ---- arm 1: --abort ALONE. git's abort-safety refuses to rewind a moved HEAD,
  // so this arm is NOT the destructive one — recorded because the folklore says
  // otherwise and the tool's message depends on the distinction being true.
  const armAbort = path.join(root, 'arm-abort');
  fs.cpSync(src, armAbort, { recursive: true });
  const rAbort = gitTry(armAbort, ['revert', '--abort']);
  assert.match(rAbort.stderr, /moved HEAD/);
  assert.equal(Number(git(armAbort, ['rev-list', '--count', `${savedHead}..HEAD`])),
    reported, 'a bare --abort on a moved HEAD does not rewind');

  // ---- arm 2: --continue THEN --abort. `--continue` rewrites abort-safety to the
  // CURRENT head and re-arms the rewind. This is the destruction, measured.
  const armCont = path.join(root, 'arm-continue');
  fs.cpSync(src, armCont, { recursive: true });
  fs.writeFileSync(path.join(armCont, 'f.txt'), 'RESOLVED\n');
  git(armCont, ['add', '--', 'f.txt']);
  const cont = gitTry(armCont, ['-c', 'core.editor=true', 'revert', '--continue']);
  assert.ok(fs.existsSync(path.join(armCont, '.git', 'sequencer')),
    `the sequencer must still be armed after --continue: ${cont.stderr}`);
  gitTry(armCont, ['revert', '--abort']);
  assert.equal(git(armCont, ['rev-parse', 'HEAD']), savedHead,
    'HEAD was rewound to the six-hour-stale saved head');
  assert.equal(Number(git(armCont, ['rev-list', '--count', `${savedHead}..HEAD`])), 0);
  for (const sha of after) {
    const reach = gitTry(armCont, ['merge-base', '--is-ancestor', sha, 'HEAD']);
    assert.notEqual(reach.status, 0,
      `agent commit ${sha.slice(0, 9)} is still reachable — the destruction did not happen`);
  }

  // ---- arm 3: --quit. The safe verb: state cleared, HEAD and every commit intact.
  const armQuit = path.join(root, 'arm-quit');
  fs.cpSync(src, armQuit, { recursive: true });
  const headBefore = git(armQuit, ['rev-parse', 'HEAD']);
  const q = gitTry(armQuit, ['revert', '--quit']);
  assert.equal(q.status, 0, q.stderr);
  assert.equal(git(armQuit, ['rev-parse', 'HEAD']), headBefore);
  assert.ok(!fs.existsSync(path.join(armQuit, '.git', 'sequencer')),
    '--quit must clear the state');
  for (const sha of after) {
    assert.equal(gitTry(armQuit, ['merge-base', '--is-ancestor', sha, 'HEAD']).status, 0,
      `--quit lost ${sha.slice(0, 9)}`);
  }
  // and the guard now reports the tree clean, so the remedy is verifiable
  assert.equal(guard.scan(armQuit, { repoRoot: armQuit, graceMin: 0 }).verdict, 'CLEAN');
});

test('AC-SEQ.4 NON-VACUITY, rebase: `rebase --abort` destroys the counted commits '
  + 'with NO safety check at all', () => {
  const root = tmpdir('nonvacuity-rebase');
  const src = path.join(root, 'src');
  const { savedHead, after } = plantStaleRebase(src, { nAfter: 3 });

  const rep = guard.scan(src, { repoRoot: src, graceMin: 0 });
  const reported = statesOf(rep, src).find((s) => s.kind === 'rebase-merge').discard;
  assert.equal(reported, after.length);

  const arm = path.join(root, 'arm-abort');
  fs.cpSync(src, arm, { recursive: true });
  assert.equal(gitTry(arm, ['rebase', '--abort']).status, 0);
  assert.equal(git(arm, ['rev-parse', 'refs/heads/topic']), savedHead,
    'the branch was reset to orig-head unconditionally');
  for (const sha of after) {
    assert.notEqual(
      gitTry(arm, ['merge-base', '--is-ancestor', sha, 'refs/heads/topic']).status, 0,
      `${sha.slice(0, 9)} survived — the destruction did not happen`);
  }
});
