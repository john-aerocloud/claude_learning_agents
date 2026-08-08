'use strict';
/**
 * worktree-guard.test.js — DEFECT-OAG-076 self-tests.
 *
 * THE LOSS THIS PINS. `DEFECT-OAG-072` was delivered complete (11 files, 3096
 * tests green, three mutation demonstrations, live `gh` verification) and then
 * DESTROYED: `git cat-file -t fb080d9` => `fatal: Not a valid object name`.
 * The mechanism is structural, not a slip — v50 gives each project its OWN
 * nested git repo and the PARENT gitignores every `work/<project>` directory,
 * so a parent-repo worktree NEVER CONTAINS it. An agent dispatched with
 * `isolation: worktree` onto a PROJECT-REPO item finds no project repo and no
 * legal way to commit, so it clones the project repo INSIDE its worktree and
 * commits there — locally reasonable, globally fatal, because the clone carries
 * its own `.git` and the auto-clean takes the objects with it. The cleanup is
 * documented safe because it removes an UNCHANGED worktree; this one WAS
 * changed, inside a nested clone the check does not model.
 *
 * Every test is DIFFERENTIAL where a control can be observed failing: the
 * fb080d9 case runs BOTH arms — guarded (refused, commit survives) and raw
 * `git worktree remove --force` (the sha becomes unresolvable, exactly as it did
 * in life). A control that cannot be watched failing tells you nothing.
 *
 * Acceptance criteria under test (DEFECT-OAG-076):
 *   AC-DEFECT-OAG-076.1  dispatching a PROJECT-REPO item with worktree isolation
 *                        is REFUSED, not silently permitted; an undeclared lane
 *                        fails CLOSED; a PARENT-REPO item is permitted (the
 *                        differential arm — the check is not a blanket refusal).
 *   AC-DEFECT-OAG-076.2  worktree cleanup REFUSES to destroy a worktree holding
 *                        a nested repo whose commits exist nowhere else, or that
 *                        is dirty; it permits one whose commits are already in a
 *                        surviving repo (the differential arm).
 *   AC-DEFECT-OAG-076.3  non-vacuity: the EXACT fb080d9 scenario — clone the
 *                        project repo into a worktree, commit there, trigger
 *                        cleanup — is reproduced end-to-end through the REAL
 *                        `.claude/scripts/worktree` and is REFUSED; the
 *                        unguarded arm demonstrates the destruction it prevents.
 *   AC-DEFECT-OAG-076.4  agent guidance states the two lanes explicitly.
 *
 * No network, no credentials: every case builds throwaway git repos in a temp
 * dir and drives real git and the real committed scripts.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('./worktree-guard.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOOL_PATH = path.join(__dirname, 'worktree-guard.js');
const WORKTREE_SCRIPT = path.join(REPO_ROOT, '.claude', 'scripts', 'worktree');

// --- harness -----------------------------------------------------------------

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function gitTry(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, ['config', 'user.email', 'agent@example.test']);
  git(dir, ['config', 'user.name', 'Agent']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * The REAL topology in miniature: a parent (agent-system) repo that gitignores
 * `/work/*​/`, holding a project's OWN nested git repo at work/<proj>.
 */
function makeParentTopology(proj = 'DemoProject') {
  const root = tmp('oag076-');
  const parent = initRepo(path.join(root, 'parent'));
  write(parent, '.gitignore', '/work/*/\nnode_modules/\n');
  write(parent, 'CLAUDE.md', 'agent system\n');
  write(parent, '.claude/agents/engineer.md', 'engineer\n');
  git(parent, ['add', '-A']);
  git(parent, ['commit', '-q', '-m', 'base']);

  const projRepo = initRepo(path.join(parent, 'work', proj));
  write(projRepo, 'src/app.ts', 'export const a = 1;\n');
  write(projRepo, `items/active/DEFECT-${proj}-001.md`, 'base\n');
  git(projRepo, ['add', '-A']);
  git(projRepo, ['commit', '-q', '-m', 'project base']);
  return { root, parent, projRepo, proj };
}

function addWorktree(parent, name, branch) {
  const wt = path.join(path.dirname(parent), name);
  execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', wt, '-b', branch, 'main']);
  return wt;
}

/** Write a work-item file with (or without) a declared lane. */
function writeItem(parent, proj, id, lane, { dir = 'active' } = {}) {
  const laneLine = lane === undefined ? '' : `lane: ${lane}\n`;
  write(parent, `work/${proj}/items/${dir}/${id}.md`,
    `---\nid: ${id}\ntype: defect\ntitle: a thing\n${laneLine}value: 10\ncost: 2\n` +
    `events:\n  - {ts: "2026-08-08T00:00:00Z", event: reported, agent: orchestrator}\n---\n\n## Body\n`);
}

function runTool(args, opts = {}) {
  return spawnSync(process.execPath, [TOOL_PATH, ...args],
    { encoding: 'utf8', cwd: opts.cwd || REPO_ROOT });
}

function runWorktreeScript(args, cwd) {
  return spawnSync('sh', [WORKTREE_SCRIPT, ...args], { encoding: 'utf8', cwd });
}

// =============================================================================
// AC-DEFECT-OAG-076.1 — the dispatch is refused BEFORE the agent is launched
// =============================================================================

test('AC-DEFECT-OAG-076.1 a PROJECT-REPO item dispatched with worktree isolation is REFUSED, and the refusal names the tool that was always the right answer',
  () => {
    const { parent, proj } = makeParentTopology();
    writeItem(parent, proj, 'DEFECT-X-072', 'project-repo');

    const r = runTool(['dispatch-check', '--item', 'DEFECT-X-072', '--project', proj,
      '--isolation', 'worktree', '--repo-root', parent]);

    assert.equal(r.status, 2, 'a project-repo item + worktree isolation must be REFUSED');
    const out = r.stdout + r.stderr;
    assert.match(out, /REFUS/i);
    assert.match(out, /DEFECT-X-072/);
    assert.match(out, /project-repo/);
    assert.match(out, /isolated-commit\.js/, 'the refusal must name the correct mechanism');
  });

test('AC-DEFECT-OAG-076.1 the differential arm: the SAME check PERMITS a PARENT-REPO item with worktree isolation — it is a lane discriminator, not a blanket refusal',
  () => {
    const { parent, proj } = makeParentTopology();
    writeItem(parent, proj, 'DEFECT-X-058', 'parent-repo');
    writeItem(parent, proj, 'DEFECT-X-072', 'project-repo');

    const permitted = runTool(['dispatch-check', '--item', 'DEFECT-X-058', '--project', proj,
      '--isolation', 'worktree', '--repo-root', parent]);
    const refused = runTool(['dispatch-check', '--item', 'DEFECT-X-072', '--project', proj,
      '--isolation', 'worktree', '--repo-root', parent]);

    assert.equal(permitted.status, 0, 'parent-repo + worktree is correct and safe (DEFECT-OAG-058 shipped exactly this way)');
    assert.equal(refused.status, 2);
    assert.notEqual(permitted.status, refused.status, 'the two lanes must DISAGREE');
    assert.match(permitted.stdout, /parent-repo/);
  });

test('AC-DEFECT-OAG-076.1 an UNDECLARED lane fails CLOSED — an unclassified item may not take worktree isolation',
  () => {
    const { parent, proj } = makeParentTopology();
    writeItem(parent, proj, 'DEFECT-X-099', undefined);

    const r = runTool(['dispatch-check', '--item', 'DEFECT-X-099', '--project', proj,
      '--isolation', 'worktree', '--repo-root', parent]);

    assert.equal(r.status, 2, 'no declared lane => refuse (the fail-safe direction is CLOSED)');
    assert.match(r.stdout + r.stderr, /lane/i);
    assert.match(r.stdout + r.stderr, /undeclared|not declared|absent/i);
  });

test('AC-DEFECT-OAG-076.1 an item that cannot be found at all is REFUSED, never assumed safe',
  () => {
    const { parent, proj } = makeParentTopology();
    const r = runTool(['dispatch-check', '--item', 'DEFECT-X-404', '--project', proj,
      '--isolation', 'worktree', '--repo-root', parent]);
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /DEFECT-X-404/);
  });

test('AC-DEFECT-OAG-076.1 an unrecognised lane VALUE is refused rather than guessed at',
  () => {
    const { parent, proj } = makeParentTopology();
    writeItem(parent, proj, 'DEFECT-X-100', 'both');
    const r = runTool(['dispatch-check', '--item', 'DEFECT-X-100', '--project', proj,
      '--isolation', 'worktree', '--repo-root', parent]);
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /both/);
  });

test('AC-DEFECT-OAG-076.1 with NO worktree isolation a project-repo item is permitted, and the brief it prints states the commit mechanism for that lane',
  () => {
    const { parent, proj } = makeParentTopology();
    writeItem(parent, proj, 'DEFECT-X-072', 'project-repo');
    const r = runTool(['dispatch-check', '--item', 'DEFECT-X-072', '--project', proj,
      '--isolation', 'none', '--repo-root', parent]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /isolated-commit\.js|commit-isolated/);
  });

test('AC-DEFECT-OAG-076.1 an item in items/done is classified too — the lane does not depend on where the item sits',
  () => {
    const { parent, proj } = makeParentTopology();
    writeItem(parent, proj, 'DEFECT-X-072', 'project-repo', { dir: 'done' });
    const r = runTool(['dispatch-check', '--item', 'DEFECT-X-072', '--project', proj,
      '--isolation', 'worktree', '--repo-root', parent]);
    assert.equal(r.status, 2);
  });

// =============================================================================
// AC-DEFECT-OAG-076.2 — cleanup refuses to destroy commits that exist nowhere else
// =============================================================================

test('AC-DEFECT-OAG-076.2 a nested repo holding a commit that exists NOWHERE ELSE makes the scan REFUSE, and the refusal quotes the sha',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    execFileSync('git', ['clone', '-q', projRepo, path.join(wt, 'work', proj)]);
    const clone = path.join(wt, 'work', proj);
    git(clone, ['config', 'user.email', 'agent@example.test']);
    git(clone, ['config', 'user.name', 'Agent']);
    write(clone, 'src/new.ts', 'export const b = 2;\n');
    git(clone, ['add', '-A']);
    git(clone, ['commit', '-q', '-m', 'the work that got destroyed']);
    const sha = git(clone, ['rev-parse', 'HEAD']);

    const r = runTool(['scan', wt]);
    assert.equal(r.status, 2, 'a commit that exists only inside the doomed directory must block cleanup');
    const out = r.stdout + r.stderr;
    assert.match(out, new RegExp(sha.slice(0, 9)));
    assert.match(out, /REFUS/i);
    assert.match(out, /work[/\\]DemoProject/);
  });

test('AC-DEFECT-OAG-076.2 the differential arm: once that same commit ALSO exists in the surviving shared repo, the scan PERMITS the cleanup',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    const clone = path.join(wt, 'work', proj);
    execFileSync('git', ['clone', '-q', projRepo, clone]);
    git(clone, ['config', 'user.email', 'agent@example.test']);
    git(clone, ['config', 'user.name', 'Agent']);
    write(clone, 'src/new.ts', 'export const b = 2;\n');
    git(clone, ['add', '-A']);
    git(clone, ['commit', '-q', '-m', 'work']);

    const before = runTool(['scan', wt]);
    assert.equal(before.status, 2, 'control: at-risk before the work is made durable');

    // make it durable, exactly as the escape route prescribes
    git(projRepo, ['config', 'receive.denyCurrentBranch', 'ignore']);
    git(clone, ['push', '-q', 'origin', 'HEAD:refs/heads/incoming']);

    const after = runTool(['scan', wt]);
    assert.equal(after.status, 0, 'a commit that survives elsewhere is not at risk');
    assert.notEqual(before.status, after.status, 'the guard must be able to say YES as well as NO');
  });

test('AC-DEFECT-OAG-076.2 UNCOMMITTED work in a nested repo also refuses the cleanup — deletion loses it just as finally',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    const clone = path.join(wt, 'work', proj);
    execFileSync('git', ['clone', '-q', projRepo, clone]);
    write(clone, 'src/uncommitted.ts', 'export const c = 3;\n');

    const r = runTool(['scan', wt]);
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /uncommitted|dirty/i);
    assert.match(r.stdout + r.stderr, /src[/\\]uncommitted\.ts/);
  });

test('AC-DEFECT-OAG-076.2 a nested repo with NO remote at all is at risk by construction — nothing can vouch for its commits',
  () => {
    const { parent } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    const orphan = initRepo(path.join(wt, 'scratch', 'orphan-repo'));
    write(orphan, 'a.txt', 'a\n');
    git(orphan, ['add', '-A']);
    git(orphan, ['commit', '-q', '-m', 'orphan work']);

    const r = runTool(['scan', wt]);
    assert.equal(r.status, 2, 'no remote => no evidence of survival => refuse');
    assert.match(r.stdout + r.stderr, /orphan-repo/);
  });

test('AC-DEFECT-OAG-076.2 a worktree with no nested repo at all scans clean — the guard does not stand in the way of ordinary cleanup',
  () => {
    const { parent } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    write(wt, 'process/notes.md', 'parent-repo work, committed on the branch\n');
    git(wt, ['add', 'process/notes.md']);
    git(wt, ['commit', '-q', '-m', 'parent-repo work']);

    const r = runTool(['scan', wt]);
    assert.equal(r.status, 0, 'parent-repo commits live in the SHARED object store and survive removal');
  });

test('AC-DEFECT-OAG-076.2 --rescue-to writes a real recoverable bundle of the at-risk commits BEFORE refusing',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    const clone = path.join(wt, 'work', proj);
    execFileSync('git', ['clone', '-q', projRepo, clone]);
    git(clone, ['config', 'user.email', 'agent@example.test']);
    git(clone, ['config', 'user.name', 'Agent']);
    write(clone, 'src/new.ts', 'export const b = 2;\n');
    git(clone, ['add', '-A']);
    git(clone, ['commit', '-q', '-m', 'the work']);
    const sha = git(clone, ['rev-parse', 'HEAD']);

    const rescue = tmp('oag076-rescue-');
    const r = runTool(['scan', wt, '--rescue-to', rescue]);
    assert.equal(r.status, 2, 'a rescue is not an excuse to proceed');

    const bundles = fs.readdirSync(rescue).filter((f) => f.endsWith('.bundle'));
    assert.equal(bundles.length, 1, 'one bundle per at-risk repo');
    const bundle = path.join(rescue, bundles[0]);

    // the bundle is not a placebo: it really restores the destroyed commit
    execFileSync('git', ['-C', parent, 'worktree', 'remove', '--force', wt]);
    assert.notEqual(gitTry(projRepo, ['cat-file', '-t', sha]).status, 0,
      'control: the commit is gone from every surviving repo');
    const restored = initRepo(path.join(tmp('oag076-restore-'), 'r'));
    execFileSync('git', ['-C', restored, 'fetch', '-q', bundle, '+refs/*:refs/recovered/*']);
    assert.equal(gitTry(restored, ['cat-file', '-t', sha]).status, 0,
      'the bundle recovers the exact commit the deletion destroyed');
  });

test('AC-DEFECT-OAG-076.2 a nested linked WORKTREE (gitdir pointer to a repo outside the doomed dir) is NOT flagged — its objects live elsewhere',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    // a linked worktree of the SHARED project repo, physically inside the agent worktree
    execFileSync('git', ['-C', projRepo, 'worktree', 'add', '-q',
      path.join(wt, 'work', proj), '-b', 'proj-side-branch']);

    const r = runTool(['scan', wt]);
    assert.equal(r.status, 0, 'objects live in the surviving project repo; removal loses nothing');
  });

test('AC-DEFECT-OAG-076.2 node_modules is not walked — the guard must be cheap enough to run on every cleanup',
  () => {
    const { parent } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    const buried = initRepo(path.join(wt, 'node_modules', 'some-dep'));
    write(buried, 'a.txt', 'a\n');
    git(buried, ['add', '-A']);
    git(buried, ['commit', '-q', '-m', 'vendored']);
    const r = runTool(['scan', wt]);
    assert.equal(r.status, 0);
  });

// =============================================================================
// AC-DEFECT-OAG-076.3 — non-vacuity: the exact fb080d9 scenario, both arms
// =============================================================================

test('AC-DEFECT-OAG-076.3 the mechanism itself: a parent-repo worktree does NOT contain work/<project> — which is why the agent cloned',
  () => {
    const { parent, proj } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-1');
    assert.equal(fs.existsSync(path.join(parent, 'work', proj)), true);
    assert.equal(fs.existsSync(path.join(wt, 'work', proj)), false,
      'work/<project> is gitignored by the parent, so it is never in the worktree');
  });

test('AC-DEFECT-OAG-076.3 fb080d9 REPRODUCED and REFUSED through the REAL .claude/scripts/worktree cleanup; the unguarded arm shows the destruction it prevents',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-a98a505b');

    // the agent finds no project repo, so it clones one INSIDE its worktree ...
    const clone = path.join(wt, 'work', proj);
    execFileSync('git', ['clone', '-q', projRepo, clone]);
    git(clone, ['config', 'user.email', 'agent@example.test']);
    git(clone, ['config', 'user.name', 'Agent']);
    // ... and delivers the whole item there
    write(clone, 'src/delivered.ts', 'export const delivered = true;\n');
    write(clone, 'src/delivered.test.ts', 'test\n');
    git(clone, ['add', '-A']);
    git(clone, ['commit', '-q', '-m', 'DEFECT-OAG-072: 11 files, 3096 tests green']);
    const sha = git(clone, ['rev-parse', 'HEAD']);
    assert.notEqual(gitTry(projRepo, ['cat-file', '-t', sha]).status, 0,
      'the commit exists ONLY inside the worktree — this is the whole hazard');

    // GUARDED ARM: trigger the cleanup ⇒ REFUSED
    const reap = runWorktreeScript(['reap', wt], parent);
    assert.equal(reap.status, 2, 'cleanup must REFUSE');
    const out = reap.stdout + reap.stderr;
    assert.match(out, /REFUS/i);
    assert.match(out, new RegExp(sha.slice(0, 9)));
    assert.equal(fs.existsSync(clone), true, 'the worktree is still there');
    assert.equal(gitTry(clone, ['cat-file', '-t', sha]).status, 0, 'the work is still there');

    // UNGUARDED ARM: what actually happened on 2026-08-08
    execFileSync('git', ['-C', parent, 'worktree', 'remove', '--force', wt]);
    assert.equal(fs.existsSync(clone), false);
    const gone = gitTry(projRepo, ['cat-file', '-t', sha]);
    assert.notEqual(gone.status, 0);
    assert.match(gone.stderr, /Not a valid object name|could not get object info|bad file/i,
      'the exact fatal that DEFECT-OAG-072 left behind');
  });

test('AC-DEFECT-OAG-076.3 the real cleanup still REMOVES a worktree that holds nothing at risk — the guard is a discriminator, not a lock',
  () => {
    const { parent } = makeParentTopology();
    const wt = addWorktree(parent, 'agent-wt', 'worktree-agent-clean');
    write(wt, 'process/notes.md', 'parent-repo work\n');
    git(wt, ['add', 'process/notes.md']);
    git(wt, ['commit', '-q', '-m', 'parent-repo work committed on the branch']);

    const reap = runWorktreeScript(['reap', wt], parent);
    assert.equal(reap.status, 0, `cleanup should proceed: ${reap.stdout}${reap.stderr}`);
    assert.equal(fs.existsSync(wt), false, 'the clean worktree is removed');
  });

test('AC-DEFECT-OAG-076.3 `worktree remove` (the project lifecycle path) refuses too when an unaccounted nested repo would be destroyed',
  () => {
    const { parent, proj } = makeParentTopology();
    // the project repo is parked in the integration tree; the instance worktree
    // additionally holds a stray clone an agent left behind.
    const wt = path.join(path.dirname(parent), `${proj}-worktree`);
    execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', wt, '-b', `instance/${proj}`, 'main']);
    const stray = initRepo(path.join(wt, 'scratch', 'stray-clone'));
    write(stray, 'a.txt', 'a\n');
    git(stray, ['add', '-A']);
    git(stray, ['commit', '-q', '-m', 'stray work']);

    const r = runWorktreeScript(['remove', proj], parent);
    assert.equal(r.status, 2, `remove must refuse: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /stray-clone/);
    assert.equal(fs.existsSync(wt), true);
  });

test('AC-DEFECT-OAG-076.3 `reap --all` sweeps the agent-worktree directory and reports every worktree at risk',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const agentDir = path.join(parent, '.claude', 'worktrees');
    fs.mkdirSync(agentDir, { recursive: true });
    const wtA = path.join(agentDir, 'agent-aaa');
    const wtB = path.join(agentDir, 'agent-bbb');
    execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', wtA, '-b', 'worktree-agent-aaa', 'main']);
    execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', wtB, '-b', 'worktree-agent-bbb', 'main']);
    const clone = path.join(wtB, 'work', proj);
    execFileSync('git', ['clone', '-q', projRepo, clone]);
    git(clone, ['config', 'user.email', 'agent@example.test']);
    git(clone, ['config', 'user.name', 'Agent']);
    write(clone, 'src/new.ts', 'x\n');
    git(clone, ['add', '-A']);
    git(clone, ['commit', '-q', '-m', 'at risk']);

    const r = runWorktreeScript(['reap', '--all'], parent);
    assert.equal(r.status, 2, `sweep must report the at-risk worktree: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /agent-bbb/);
    assert.equal(fs.existsSync(wtB), true, 'the at-risk worktree is left alone');
    assert.equal(fs.existsSync(wtA), false, 'the clean one is still reaped');
  });

test('AC-DEFECT-OAG-076.2 the sweep does NOT cry wolf about an instance worktree\'s OWN project repo — the lifecycle parks that one — but still reports an UNACCOUNTED clone beside it',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    // the real topology: `worktree ensure` MOVES the project repo into its instance worktree
    const inst = path.join(path.dirname(parent), `${proj}-worktree`);
    execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', inst, '-b', `instance/${proj}`, 'main']);
    fs.mkdirSync(path.join(inst, 'work'), { recursive: true });
    fs.renameSync(projRepo, path.join(inst, 'work', proj));
    const moved = path.join(inst, 'work', proj);
    write(moved, 'src/local.ts', 'export const l = 1;\n');
    git(moved, ['add', '-A']);
    git(moved, ['commit', '-q', '-m', 'ordinary unpushed local work']);

    const accounted = guard.scanAll(parent);
    assert.equal(accounted.safe, true,
      `an ordinary instance worktree must not read as at-risk: ${accounted.message}`);

    // now an agent leaves a stray clone in the SAME tree — that IS unaccounted
    const stray = initRepo(path.join(inst, 'scratch', 'stray-clone'));
    write(stray, 'a.txt', 'a\n');
    git(stray, ['add', '-A']);
    git(stray, ['commit', '-q', '-m', 'stray']);
    const swept = guard.scanAll(parent);
    assert.equal(swept.safe, false, 'an unaccounted nested repo is still reported');
    assert.match(swept.message, /stray-clone/);
  });

test('AC-DEFECT-OAG-076.2 the sweep finds the AGENT worktrees even when run from a project worktree — they live under the INTEGRATION tree, not wherever you are standing',
  () => {
    const { parent, projRepo, proj } = makeParentTopology();
    const inst = path.join(path.dirname(parent), `${proj}-worktree`);
    execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', inst, '-b', `instance/${proj}`, 'main']);
    const agentWt = path.join(parent, '.claude', 'worktrees', 'agent-zzz');
    fs.mkdirSync(path.dirname(agentWt), { recursive: true });
    execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', agentWt, '-b', 'worktree-agent-zzz', 'main']);
    const clone = path.join(agentWt, 'work', proj);
    execFileSync('git', ['clone', '-q', projRepo, clone]);
    git(clone, ['config', 'user.email', 'a@b.test']);
    git(clone, ['config', 'user.name', 'A']);
    write(clone, 'x.ts', 'x\n');
    git(clone, ['add', '-A']);
    git(clone, ['commit', '-q', '-m', 'work at risk in an agent worktree']);

    // and an UNREGISTERED leftover beside it — a worktree whose registration was
    // pruned but whose directory (and its nested repo) is still on disk
    const orphanWt = path.join(parent, '.claude', 'worktrees', 'agent-orphan');
    const orphanRepo = initRepo(path.join(orphanWt, 'work', proj));
    write(orphanRepo, 'y.ts', 'y\n');
    git(orphanRepo, ['add', '-A']);
    git(orphanRepo, ['commit', '-q', '-m', 'work in an unregistered leftover']);

    // run the sweep from the PROJECT worktree, not the integration tree
    const res = guard.scanAll(inst);
    assert.equal(res.safe, false, `the agent worktrees must be swept from anywhere: ${res.message}`);
    assert.match(res.message, /agent-zzz/);
    assert.match(res.message, /agent-orphan/,
      'an unregistered leftover under the INTEGRATION tree must be swept too');
  });

// =============================================================================
// AC-DEFECT-OAG-076.4 — the guidance states the two lanes
// =============================================================================

const LANE_DOCS = [
  '.claude/agents/orchestrator.md',
  '.claude/agents/engineer.md',
  'CLAUDE.md',
  'process/process-current.md',
];

for (const rel of LANE_DOCS) {
  test(`AC-DEFECT-OAG-076.4 ${rel} states BOTH lanes explicitly — which one is in the worktree and how each commits`, () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.match(text, /DEFECT-OAG-076/, 'the ruling is traceable to the loss that produced it');
    assert.match(text, /parent-repo/i, 'lane 1 named');
    assert.match(text, /project-repo/i, 'lane 2 named');
    assert.match(text, /isolated-commit\.js|commit-isolated/,
      'the project-repo lane must name its commit mechanism');
    assert.match(text, /work\/<project>|work\/\$\{?project\}?|work\/<proj>/,
      'the guidance must say WHICH path is absent from the worktree');
  });
}

test('AC-DEFECT-OAG-076.4 the orchestrator is told to RUN the check, not merely to remember the rule', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, '.claude/agents/orchestrator.md'), 'utf8');
  assert.match(text, /make dispatch-check/, 'the rule must be mechanised into the dispatch flow');
});

test('AC-DEFECT-OAG-076.4 the mechanisation is reachable: the Makefile exposes both the dispatch check and the cleanup guard', () => {
  const mk = fs.readFileSync(path.join(REPO_ROOT, 'Makefile'), 'utf8');
  assert.match(mk, /^dispatch-check:/m);
  assert.match(mk, /^worktree-guard:/m);
  assert.match(mk, /worktree-guard\.js/);
});

test('AC-DEFECT-OAG-076.4 the cleanup script CALLS the guard rather than re-implementing its own idea of "unchanged"', () => {
  const text = fs.readFileSync(WORKTREE_SCRIPT, 'utf8');
  assert.match(text, /worktree-guard\.js/);
  assert.match(text, /reap\)/, 'the agent-worktree cleanup path exists in the script');
});

// =============================================================================
// module-level unit tests of the classifier and the assessor
// =============================================================================

test('AC-DEFECT-OAG-076.1 classifyLane reads the declared lane and reports an undeclared one as such (unit)', () => {
  assert.equal(guard.classifyLane('---\nid: X\nlane: parent-repo\n---\n').lane, 'parent-repo');
  assert.equal(guard.classifyLane('---\nid: X\nlane: project-repo\n---\n').lane, 'project-repo');
  const undeclared = guard.classifyLane('---\nid: X\n---\n');
  assert.equal(undeclared.lane, null);
  assert.equal(undeclared.declared, false);
});

test('AC-DEFECT-OAG-076.1 classifyLane ignores a `lane:` that appears BELOW the derived line — only the authored frontmatter counts (unit)', () => {
  const text = '---\nid: X\n# --- everything below this line is DERIVED\nderived:\n  lane: parent-repo\n---\n';
  assert.equal(guard.classifyLane(text).declared, false);
});

test('AC-DEFECT-OAG-076.2 assessRepo reports at-risk shas with their subjects so the refusal is actionable (unit)', () => {
  const { projRepo } = makeParentTopology();
  const clone = path.join(tmp('oag076-clone-'), 'c');
  execFileSync('git', ['clone', '-q', projRepo, clone]);
  git(clone, ['config', 'user.email', 'a@b.test']);
  git(clone, ['config', 'user.name', 'A']);
  write(clone, 'x.ts', 'x\n');
  git(clone, ['add', '-A']);
  git(clone, ['commit', '-q', '-m', 'a subject worth quoting']);

  const a = guard.assessRepo(clone);
  assert.equal(a.atRisk.length, 1);
  assert.match(a.atRisk[0].subject, /a subject worth quoting/);
  assert.equal(a.dirty.length, 0);
});
