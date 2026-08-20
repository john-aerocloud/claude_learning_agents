#!/usr/bin/env node
'use strict';
/**
 * worktree-guard.js — DEFECT-OAG-076.
 *
 * TWO LANES, AND A DISPATCH MUST KNOW WHICH ONE ITS ITEM IS IN.
 *
 *   lane          in a parent-repo worktree?   how it commits
 *   ------------  ---------------------------  ------------------------------------
 *   parent-repo   YES (.claude/, process/,     commit in the worktree — correct and
 *                 Makefile, CLAUDE.md)         safe (DEFECT-OAG-058 shipped this way)
 *   project-repo  NO  (work/<project>/** is    edit at the real shared path; commit
 *                 gitignored by the parent)    via .claude/tools/isolated-commit.js
 *
 * WHY THIS EXISTS. `DEFECT-OAG-072` was delivered complete and then destroyed:
 * `git cat-file -t fb080d9` => `fatal: Not a valid object name`. An engineer was
 * dispatched with `isolation: worktree` onto a PROJECT-REPO item. Because v50
 * gives each project its own nested repo and the parent gitignores every
 * `work/<project>` directory, it did not contain the thing being edited. With
 * no project repo and
 * no legal way to commit, the agent did the only thing left — cloned the project
 * repo INSIDE its worktree and committed there — and the auto-clean took the
 * clone's objects with it. Nothing warned: the cleanup is documented safe
 * because it removes an UNCHANGED worktree, and this one WAS changed, inside a
 * nested clone the check does not model.
 *
 * The irony is exact and worth keeping: the correct tool for the problem
 * worktree isolation was reached for (`isolated-commit.js`, DEFECT-OAG-058's
 * private index + declared-subset assertion + compare-and-swap) had already
 * landed THREE HOURS EARLIER. Worktree isolation was never needed for
 * project-repo work.
 *
 * TWO CAPABILITIES, one before the dispatch and one before any deletion:
 *
 *   dispatch-check  refuse `isolation: worktree` for a project-repo item, BEFORE
 *                   the agent is launched. The lane is DECLARED on the item
 *                   (`lane: parent-repo|project-repo`); an undeclared or
 *                   unrecognised lane fails CLOSED, because an unclassified item
 *                   is not a classified-safe one.
 *
 *   scan            refuse to delete a directory that holds a nested repo whose
 *                   commits exist NOWHERE ELSE. This is the load-bearing limb —
 *                   the last line of defence, and the one that was missing. The
 *                   test is not "is the worktree changed" (the check that lied)
 *                   but the honest one: DOES THIS COMMIT SURVIVE THE DELETION?
 *                   A commit survives iff its object exists in some other repo
 *                   on disk, or it is reachable from a remote-tracking ref (so
 *                   it is on a remote). Everything else is at risk, including a
 *                   repo with no remotes at all — no remote means no evidence,
 *                   and the fail-safe direction is CLOSED.
 *
 * Pure git + filesystem. NO network, NO credentials.
 *
 * Usage:
 *   node .claude/tools/worktree-guard.js dispatch-check --item <ID> [--project P]
 *        [--isolation worktree|none] [--repo-root R] [--json]
 *   node .claude/tools/worktree-guard.js scan <dir> [--rescue-to DIR] [--json]
 *   node .claude/tools/worktree-guard.js scan-all [--repo-root R] [--rescue-to DIR] [--json]
 *
 * Exit: 0 = safe/permitted | 2 = REFUSED (loud) | 1 = usage/internal error.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT_DEFAULT = path.resolve(__dirname, '..', '..');

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.nuxt',
  '.cache', '__pycache__', '.terraform', '.pytest_cache', 'coverage', '.turbo',
  '.sst', 'cdk.out', '.mypy_cache', '.gradle', 'vendor',
]);
const MAX_DEPTH = 8;

// --- git plumbing -------------------------------------------------------------

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// --- lane classification (dispatch-check) -------------------------------------

const LANES = new Set(['parent-repo', 'project-repo']);
const DERIVED_MARKER = /^#\s*---.*DERIVED/im;

/**
 * Read the AUTHORED frontmatter's `lane:`. Anything below the DERIVED marker is
 * machine-rendered and may not speak for the author.
 * @returns {{lane: string|null, declared: boolean, raw: string|null}}
 */
function classifyLane(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(text || '');
  let region = fm ? fm[1] : (text || '');
  const marker = DERIVED_MARKER.exec(region);
  if (marker) region = region.slice(0, marker.index);
  const m = /^lane:[ \t]*(.+?)[ \t]*$/m.exec(region);
  if (!m) return { lane: null, declared: false, raw: null };
  const raw = m[1].replace(/^["']|["']$/g, '').trim();
  return { lane: LANES.has(raw) ? raw : null, declared: true, raw };
}

function findItemFile(repoRoot, project, id) {
  for (const dir of ['active', 'done']) {
    const p = path.join(repoRoot, 'work', project, 'items', dir, `${id}.md`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function activeProject(repoRoot) {
  try {
    return fs.readFileSync(path.join(repoRoot, 'work', 'ACTIVE'), 'utf8').trim();
  } catch { return null; }
}

const LANE_TABLE = [
  '  lane          in the worktree?   how it commits',
  '  ------------  -----------------  ---------------------------------------------',
  '  parent-repo   YES                commit in the worktree — correct and safe',
  '                (.claude/ process/ Makefile CLAUDE.md)',
  '  project-repo  NO                 edit at the REAL shared path; commit via',
  '                (work/<project>/** is gitignored by the parent, so it is',
  '                 NEVER in the worktree)   .claude/tools/isolated-commit.js',
  '                                          (make commit-isolated REPO=… PATHS=…)',
].join('\n');

/**
 * @returns {{permitted: boolean, lane: string|null, reason: string, message: string}}
 */
function dispatchCheck({ repoRoot, project, id, isolation }) {
  const wants = /^(worktree|wt|true|yes|1)$/i.test(String(isolation || ''));
  const file = findItemFile(repoRoot, project, id);
  const head = `dispatch-check[${project}/${id}] isolation=${isolation}`;

  if (!file) {
    return {
      permitted: false, lane: null, reason: 'item-not-found',
      message: `${head}\nREFUSED — no item file for ${id} under work/${project}/items/{active,done}/.\n` +
        `An unclassifiable item is not a safe one; the fail-safe direction is CLOSED.\n${LANE_TABLE}`,
    };
  }

  const { lane, declared, raw } = classifyLane(fs.readFileSync(file, 'utf8'));

  if (!wants) {
    const how = lane === 'parent-repo'
      ? 'commit in the shared tree as normal'
      : 'edit at the real shared path and commit via `make commit-isolated` (.claude/tools/isolated-commit.js)';
    return {
      permitted: true, lane, reason: 'no-worktree-isolation',
      message: `${head}\nOK — no worktree isolation requested. Lane: ${lane || 'undeclared'}.\n` +
        `Commit mechanism for this lane: ${how}.\n` +
        `Reminder: `.concat('isolated-commit.js is the remedy for the shared index (DEFECT-OAG-058), ',
          'not a worktree.'),
    };
  }

  if (!declared) {
    return {
      permitted: false, lane: null, reason: 'lane-undeclared',
      message: `${head}\nREFUSED — the item declares no lane (\`lane:\` is absent / undeclared in ${path.relative(repoRoot, file)}).\n` +
        `A dispatch must know which lane its item is in BEFORE choosing isolation (DEFECT-OAG-076).\n` +
        `Add \`lane: parent-repo\` or \`lane: project-repo\` to the item's authored frontmatter.\n${LANE_TABLE}`,
    };
  }
  if (!lane) {
    return {
      permitted: false, lane: null, reason: 'lane-unrecognised',
      message: `${head}\nREFUSED — unrecognised lane \`${raw}\`. Expected exactly one of: parent-repo, project-repo.\n` +
        `An unrecognised lane is refused rather than guessed at.\n${LANE_TABLE}`,
    };
  }
  if (lane === 'project-repo') {
    return {
      permitted: false, lane, reason: 'project-repo-with-worktree-isolation',
      message: `${head}\nREFUSED — ${id} is a project-repo item and MUST NOT take worktree isolation.\n` +
        `\n  work/${project}/** is gitignored by the parent, so a parent-repo worktree NEVER\n` +
        `  CONTAINS IT. The agent will find no project repo and no legal way to commit; the\n` +
        `  only move left is to clone the project repo inside its worktree and commit there,\n` +
        `  and the auto-clean then takes those objects with it. That is exactly how\n` +
        `  DEFECT-OAG-072 was destroyed (git cat-file -t fb080d9 => Not a valid object name).\n` +
        `\nDO INSTEAD: dispatch WITHOUT worktree isolation; the agent edits at the real shared\n` +
        `path and commits with .claude/tools/isolated-commit.js (make commit-isolated REPO=… PATHS=…),\n` +
        `which gives it a PRIVATE INDEX — the actual remedy for the shared-index hazard, landed\n` +
        `as DEFECT-OAG-058 three hours before the loss.\n${LANE_TABLE}`,
    };
  }
  return {
    permitted: true, lane, reason: 'parent-repo',
    message: `${head}\nOK — ${id} is a parent-repo item: .claude/ process/ Makefile CLAUDE.md ARE in the\n` +
      `worktree, so committing there is correct and safe (DEFECT-OAG-058 delivered exactly that way).\n` +
      `Still brief the escape route: name the remote, and quote a durable ref before returning.\n` +
      `Note: nothing under work/<project>/ is present in this worktree — if the item turns out to\n` +
      `need it, STOP and re-dispatch without isolation rather than cloning it in.`,
  };
}

// --- nested-repo discovery (scan) ---------------------------------------------

/** Resolve `<dir>/.git`. @returns {null|{kind:'dir'|'link', gitdir:string}} */
function gitLinkOf(dir) {
  const dot = path.join(dir, '.git');
  let st;
  try { st = fs.lstatSync(dot); } catch { return null; }
  if (st.isDirectory()) return { kind: 'dir', gitdir: dot };
  if (st.isFile()) {
    const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dot, 'utf8'));
    if (!m) return null;
    const target = path.resolve(dir, m[1].trim());
    return { kind: 'link', gitdir: target };
  }
  return null;
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Every repo physically under `root` whose OBJECT STORE is also under `root` —
 * i.e. every repo whose commits die with the directory. A linked worktree whose
 * gitdir resolves outside `root` is not one: its objects live in a repo that
 * survives.
 */
function findNestedRepos(root, { maxDepth = MAX_DEPTH } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    const link = gitLinkOf(dir);
    if (link) {
      if (isInside(link.gitdir, root)) found.push({ dir, kind: link.kind, gitdir: link.gitdir });
      // Never descend into a NESTED repo (its contents ride with it) — but the
      // root is always descended: the doomed directory is itself usually a
      // linked worktree, and the nested clone that kills us lives INSIDE it.
      if (depth > 0) return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.resolve(root), 0);
  return found;
}

/** Repos on disk that could vouch for a commit: this repo's LOCAL-path remotes. */
function survivingWitnesses(repo, extraRefs = []) {
  const witnesses = [];
  const r = git(repo, ['remote', '-v']);
  if (r.ok) {
    for (const line of r.out.split('\n').filter(Boolean)) {
      const url = (line.split(/\s+/)[1] || '').replace(/^file:\/\//, '');
      if (!url) continue;
      const abs = path.isAbsolute(url) ? url : path.resolve(repo, url);
      if (fs.existsSync(abs) && gitLinkOf(abs)) witnesses.push(abs);
      else if (fs.existsSync(path.join(abs, 'objects'))) witnesses.push(abs); // bare
    }
  }
  for (const e of extraRefs) if (fs.existsSync(e)) witnesses.push(e);
  return [...new Set(witnesses)];
}

/**
 * Does this repo hold work that the deletion of its directory would destroy?
 *   dirty  — uncommitted changes (lost just as finally as a commit)
 *   atRisk — commits not on any remote-tracking ref AND not present in any
 *            surviving repo on disk.
 */
function assessRepo(repo, { references = [], witnessRoot = null } = {}) {
  const dirtyR = git(repo, ['status', '--porcelain']);
  const dirty = dirtyR.ok ? dirtyR.out.split('\n').filter(Boolean) : [];

  const headR = git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const revArgs = ['rev-list', '--all'];
  if (headR.ok && headR.out) revArgs.push(headR.out);
  revArgs.push('--not', '--remotes');
  const localR = git(repo, revArgs);
  const localOnly = localR.ok ? localR.out.split('\n').filter(Boolean) : [];

  // A witness must SURVIVE the deletion: a repo inside the doomed root cannot vouch.
  const witnesses = survivingWitnesses(repo, references)
    .filter((w) => !(witnessRoot && isInside(w, witnessRoot)));

  const atRisk = [];
  for (const sha of localOnly) {
    const survives = witnesses.some((w) => git(w, ['cat-file', '-e', `${sha}^{commit}`]).ok);
    if (survives) continue;
    const subj = git(repo, ['log', '-1', '--format=%s', sha]);
    atRisk.push({ sha, short: sha.slice(0, 9), subject: subj.ok ? subj.out : '' });
  }
  return {
    repo, dirty, atRisk, witnesses,
    remotes: git(repo, ['remote']).out.split('\n').filter(Boolean),
    unsafe: dirty.length > 0 || atRisk.length > 0,
  };
}

function writeRescueBundle(repo, rescueDir, root) {
  fs.mkdirSync(rescueDir, { recursive: true });
  const rel = path.relative(root, repo) || path.basename(repo);
  const name = `${rel.replace(/[^A-Za-z0-9._-]+/g, '_')}-${Date.now()}.bundle`;
  const out = path.join(rescueDir, name);
  const r = git(repo, ['bundle', 'create', out, '--all']);
  return r.ok ? out : null;
}

/**
 * @param {string} root
 * @param {{rescueTo?:string|null, references?:string[], accounted?:string[]}} opts
 *   `accounted` — repo paths (relative to root) the CALLER has already accounted
 *   for, e.g. an instance worktree's own `work/<project>` repo, which the
 *   lifecycle PARKS rather than deletes. Excluded from the verdict so the sweep
 *   does not cry wolf about ordinary unpushed project work; an UNACCOUNTED
 *   nested repo beside it is still reported.
 * @returns {{safe:boolean, root:string, repos:Array, rescued:Array, message:string}}
 */
function scan(root, { rescueTo = null, references = [], accounted = [] } = {}) {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs)) {
    return { safe: false, root: abs, repos: [], rescued: [], message: `REFUSED — no such directory: ${abs}` };
  }
  const acc = new Set(accounted.map((a) => path.resolve(abs, a)));
  const nested = findNestedRepos(abs);
  const repos = nested.map((n) => ({
    ...n,
    ...assessRepo(n.dir, { references, witnessRoot: abs }),
    accounted: acc.has(path.resolve(n.dir)),
  }));
  for (const r of repos) if (r.accounted) r.unsafe = false;
  const unsafe = repos.filter((r) => r.unsafe);
  const rescued = [];

  if (unsafe.length === 0) {
    return {
      safe: true, root: abs, repos, rescued,
      message: `worktree-guard: SAFE to remove ${abs} — ${repos.length} nested repo(s) inspected, ` +
        `none holds work that would die with the directory.`,
    };
  }

  const lines = [
    `worktree-guard: REFUSED to destroy ${abs}`,
    '',
    'This directory holds work that exists NOWHERE ELSE. Deleting it is the exact',
    'mechanism that destroyed DEFECT-OAG-072 (git cat-file -t fb080d9 => fatal: Not a',
    'valid object name). The "unchanged worktree" check cannot see inside a nested repo.',
    '',
  ];
  for (const r of unsafe) {
    if (rescueTo) {
      const b = writeRescueBundle(r.dir, rescueTo, abs);
      if (b) rescued.push({ repo: r.dir, bundle: b });
    }
    lines.push(`  nested repo: ${path.relative(abs, r.dir) || '.'}   (${r.dir})`);
    lines.push(`    remotes: ${r.remotes.join(', ') || 'NONE — nothing can vouch for its commits'}`);
    if (r.dirty.length) {
      lines.push(`    ${r.dirty.length} UNCOMMITTED change(s) — dirty:`);
      for (const d of r.dirty.slice(0, 20)) lines.push(`      ${d}`);
    }
    if (r.atRisk.length) {
      lines.push(`    ${r.atRisk.length} commit(s) AT RISK (present in no surviving repo):`);
      for (const c of r.atRisk.slice(0, 20)) lines.push(`      ${c.short}  ${c.subject}`);
      if (r.atRisk.length > 20) lines.push(`      … and ${r.atRisk.length - 20} more`);
    }
    const b = rescued.find((x) => x.repo === r.dir);
    if (b) lines.push(`    RESCUE BUNDLE WRITTEN: ${b.bundle}`);
    lines.push('');
  }
  lines.push('MAKE THE WORK DURABLE FIRST, then re-run:');
  lines.push('  git -C <nested repo> push <the LOCAL shared repo> HEAD:refs/heads/<a name>');
  lines.push('  git -C <nested repo> bundle create <scratchpad>/rescue.bundle --all   # if no remote');
  lines.push('');
  lines.push('AND FIX THE CAUSE — a project-repo item must never take worktree isolation:');
  lines.push(LANE_TABLE);
  return { safe: false, root: abs, repos, rescued, message: lines.join('\n') };
}

/** Every registered worktree of the repo at `repoRoot`, plus every dir under .claude/worktrees. */
function registeredWorktrees(repoRoot) {
  const r = git(repoRoot, ['worktree', 'list', '--porcelain']);
  const out = [];
  if (r.ok) {
    for (const line of r.out.split('\n')) {
      const m = /^worktree (.+)$/.exec(line);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

/** An instance worktree's own project repo is PARKED by `worktree remove`, not deleted. */
function accountedFor(worktree) {
  const b = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const m = b.ok && /^instance\/(.+)$/.exec(b.out);
  return m ? [path.join('work', m[1])] : [];
}

// git reports canonical paths (/private/var/…) where node resolves the symlink
// form (/var/…); compare realpaths or the main tree scans itself.
function canon(p) {
  try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); }
}

/** The INTEGRATION tree — the worktree checked out on refs/heads/main. */
function integrationTree(from) {
  const r = git(from, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return null;
  let cur = null;
  for (const line of r.out.split('\n')) {
    const w = /^worktree (.+)$/.exec(line);
    if (w) cur = w[1];
    if (line.trim() === 'branch refs/heads/main' && cur) return cur;
  }
  return null;
}

/**
 * Sweep every directory a cleanup could plausibly delete. The INTEGRATION tree
 * is NOT one of them — it is never removed, and the project repos PARKED in it
 * are permanent residents, so scanning it whole would cry wolf about ordinary
 * unpushed project work. What IS doomed inside it are the agent worktrees under
 * `.claude/worktrees/`, including any left UNREGISTERED by a failed removal.
 */
function scanAll(repoRoot, opts = {}) {
  const here = canon(repoRoot);
  const mainTree = integrationTree(here);
  const mainCanon = mainTree ? canon(mainTree) : null;
  const targets = registeredWorktrees(here).filter((w) => canon(w) !== mainCanon);
  for (const base of [here, mainCanon].filter(Boolean)) {
    const agentDir = path.join(base, '.claude', 'worktrees');
    if (!fs.existsSync(agentDir)) continue;
    for (const e of fs.readdirSync(agentDir, { withFileTypes: true })) {
      if (e.isDirectory()) targets.push(path.join(agentDir, e.name));
    }
  }
  const results = [...new Set(targets.map(canon))]
    .filter((t) => fs.existsSync(t))
    .map((t) => scan(t, { ...opts, accounted: [...(opts.accounted || []), ...accountedFor(t)] }));
  const unsafe = results.filter((r) => !r.safe);
  return {
    safe: unsafe.length === 0,
    results,
    message: unsafe.length === 0
      ? `worktree-guard: ${results.length} worktree(s) inspected — none holds unrecoverable work.`
      : unsafe.map((r) => r.message).join('\n\n'),
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      if (k === 'json') a.json = true;
      else { a[k] = argv[i + 1]; i += 1; }
    } else a._.push(t);
  }
  return a;
}

function main(argv) {
  const sub = argv[0];
  const a = parseArgs(argv.slice(1));
  const repoRoot = path.resolve(a['repo-root'] || REPO_ROOT_DEFAULT);

  if (sub === 'dispatch-check') {
    const project = a.project || activeProject(repoRoot);
    const id = a.item || a.id;
    if (!id || !project) {
      process.stderr.write('usage: worktree-guard dispatch-check --item <ID> [--project P] [--isolation worktree|none]\n');
      return 1;
    }
    const res = dispatchCheck({ repoRoot, project, id, isolation: a.isolation || 'worktree' });
    process.stdout.write((a.json ? JSON.stringify(res, null, 2) : res.message) + '\n');
    return res.permitted ? 0 : 2;
  }

  if (sub === 'scan' || sub === 'scan-all') {
    const opts = {
      rescueTo: a['rescue-to'] || null,
      references: (a.reference ? [a.reference] : []),
    };
    const res = sub === 'scan'
      ? scan(a._[0] || a.dir || process.cwd(), opts)
      : scanAll(repoRoot, opts);
    process.stdout.write((a.json ? JSON.stringify(res, null, 2) : res.message) + '\n');
    return res.safe ? 0 : 2;
  }

  process.stderr.write(
    'usage: worktree-guard {dispatch-check|scan|scan-all} …\n' +
    '  dispatch-check --item <ID> [--project P] [--isolation worktree|none]\n' +
    '  scan <dir> [--rescue-to DIR]\n' +
    '  scan-all [--repo-root R] [--rescue-to DIR]\n');
  return 1;
}

module.exports = {
  classifyLane, dispatchCheck, findItemFile, findNestedRepos, assessRepo,
  scan, scanAll, registeredWorktrees, accountedFor, LANE_TABLE,
};

if (require.main === module) {
  // AC-DEFECT-OAG-076.5 — do NOT `process.exit()` here. A large `--json` payload
  // written to a PIPE is TRUNCATED at the 64 KiB pipe buffer, because
  // `process.stdout.write` is asynchronous on a pipe and `process.exit()` does not
  // wait for it to drain. This is not hypothetical: on 2026-08-19 `scan-all --json`
  // crossed 64 KiB (it lists every at-risk commit, so it grows with history), its
  // JSON stopped parsing mid-string at byte 65536, and `loop-gate` reported the
  // guard as NOT ESTABLISHED. An unrunnable guard is not a clean guard (process
  // 17e), and this is the check that stands between a finished agent's commits and
  // DEFECT-OAG-072's fate. Setting `exitCode` preserves the status while letting
  // node flush stdout and exit on its own.
  process.exitCode = main(process.argv.slice(2));
}
