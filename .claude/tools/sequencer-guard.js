#!/usr/bin/env node
'use strict';
/**
 * sequencer-guard.js — OI-ABANDONED-SEQUENCER-STATE-ARMS-A-56-COMMIT-DESTRUCTION.
 *
 * AN IN-PROGRESS GIT OPERATION LEFT ARMED IN A SHARED WORKING TREE IS A
 * DESTRUCTION WAITING FOR THE NATURAL VERB.
 *
 * WHAT HAPPENED. `.git/sequencer` sat in the shared `work/OagEventSource` tree
 * from 12:54 to 18:46 — six hours — holding a two-step revert todo for
 * `84ca5fa7` / `2f6a58bd` with `head=b55d15e0`. That saved head was six hours
 * stale: FIFTY-SIX commits had landed on top of it, the whole output of seven
 * agents in one session (2 resolved defects, 2 closed open-items, 6 registered
 * findings). The revert it described had already been completed by another route
 * (`a8bd0dee`, an ancestor of origin/main), so the state was residue describing
 * finished work — and the documented way out of a stuck revert, `git revert
 * --abort`, rewinds to that saved head.
 *
 * THREE PROPERTIES MAKE IT A MECHANISM RATHER THAN A NOTE:
 *   1. IT IS INVISIBLE. `git status --porcelain` says NOTHING about a sequencer
 *      dir, so every cleanliness check in this system — loop-gate, the
 *      fold-forward dirty-tree check — passes with it armed. (Pinned as an
 *      assertion, not a claim: sequencer-guard.test.js AC-SEQ.1.)
 *   2. THE WRONG VERB IS THE NATURAL ONE. `--abort` is what anyone reaches for;
 *      `--quit` (clear the state, leave HEAD and the tree alone) is obscure.
 *   3. THE BLAST RADIUS GROWS WITH CONCURRENCY. In a single-agent repo the saved
 *      head is minutes old and the general git advice is fine. Here it grows with
 *      every commit — and note WHY it grows unboundedly: the prescribed shared-tree
 *      commit mechanism (isolated-commit.js: `commit-tree` + a ref compare-and-swap)
 *      never touches branch state, so unlike `git commit` it does NOT clear the
 *      sequencer. The state can therefore sit armed across an arbitrary number of
 *      commits, which is exactly how the gap reached 56.
 *
 * WHAT `--abort` ACTUALLY DOES — MEASURED, NOT ASSUMED (git 2.50.1). This tool
 * reports the truth rather than the folklore, because the two differ:
 *
 *   sequencer (revert / cherry-pick)
 *       `--abort` calls `rollback_is_safe()` first: it rewinds to
 *       `sequencer/head` ONLY IF `sequencer/abort-safety` == HEAD. On a state
 *       whose HEAD has moved it prints "You seem to have moved HEAD. Not
 *       rewinding, check your HEAD!" and merely clears the state. So a stale
 *       sequencer is not armed AT THIS INSTANT — but it is ONE COMMAND from armed:
 *       a single `git revert --continue` lands its pick on the CURRENT head and
 *       REWRITES abort-safety to it, after which `--abort` rewinds to the stale
 *       `sequencer/head` and every commit since becomes unreachable. Demonstrated
 *       end to end, both arms, in sequencer-guard.test.js (AC-SEQ.4). `--continue`
 *       is the MORE natural move on a stuck revert than `--abort`, so this is the
 *       likely path, not the exotic one.
 *
 *   rebase (rebase-merge / rebase-apply)
 *       WORSE: there is NO safety check at all. `git rebase --abort` resets the
 *       branch named in `head-name` to `orig-head` unconditionally, destroying
 *       anything the branch gained meanwhile. Measured: 3 commits added to the
 *       rebasing branch, `--abort`, branch back to 2 commits.
 *
 *   MERGE_HEAD / a lone REVERT_HEAD or CHERRY_PICK_HEAD (single-pick, no sequencer)
 *       `--abort` does not rewind history (HEAD never moved), so ZERO commits are
 *       at stake — but the index and working-tree resolution work IS discarded.
 *       Reported, never blocked on while fresh: this is what an in-flight conflict
 *       someone is resolving right now looks like.
 *
 * SO THE NUMBER IS THE POINT. "State present" is ignorable and will be ignored;
 * "would make 56 commits unreachable" is not. Every finding carries the count.
 *
 * TWO REPOS, ALWAYS. v50 gives each project its OWN nested repo at
 * `work/<project>/`, gitignored by the parent — the incident was in the NESTED
 * one. A sweep that only looked at the parent would have seen nothing at all, so
 * this walks the parent, every registered/agent worktree, and every nested repo
 * inside each.
 *
 * Pure git + filesystem. NO network, NO credentials, and NOTHING IS EVER
 * MUTATED — it never runs `--abort`, `--quit`, `reset` or any writing verb. A
 * detector that could destroy what it detects is not a detector.
 *
 * Usage:
 *   node .claude/tools/sequencer-guard.js scan [dir] [--repo-root R]
 *        [--grace-min N] [--json]
 *
 * Exit: 0 = clean or advisory-only | 2 = BLOCK (commits at stake, or residue we
 *       could not measure — fails CLOSED) | 1 = usage error.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const wtg = require('./worktree-guard.js');

const REPO_ROOT_DEFAULT = path.resolve(__dirname, '..', '..');

/** How long an in-progress operation may plausibly be someone's live work. */
const DEFAULT_GRACE_MIN = 30;

/** ASCII unit separator: a %h/%s pair can never contain it. */
const SEP = '\x1f';

/** How many at-stake commits to name in the human report. */
const MAX_LISTED = 12;

// --- git plumbing -------------------------------------------------------------

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/**
 * Resolve a per-worktree git state path. `rev-parse --git-path` is the only
 * correct way: in a LINKED worktree the state lives in
 * `.git/worktrees/<name>/sequencer`, not in `.git/sequencer`, and hard-coding
 * `.git/…` would silently look at the wrong tree — the exact class of blindness
 * this tool exists to remove.
 */
function gitStatePath(repo, name) {
  const r = git(repo, ['rev-parse', '--git-path', name]);
  if (!r.ok || !r.out) return null;
  return path.isAbsolute(r.out) ? r.out : path.resolve(repo, r.out);
}

function readShaFile(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    return /^[0-9a-f]{7,64}$/i.test(raw) ? raw : null;
  } catch { return null; }
}

function readTextFile(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

/** Newest mtime at or under `p` (a state dir's freshness is its newest file). */
function newestMtimeMs(p) {
  let best = null;
  const visit = (q) => {
    let st;
    try { st = fs.statSync(q); } catch { return; }
    best = best === null ? st.mtimeMs : Math.max(best, st.mtimeMs);
    if (!st.isDirectory()) return;
    let entries;
    try { entries = fs.readdirSync(q); } catch { return; }
    for (const e of entries) visit(path.join(q, e));
  };
  visit(p);
  return best;
}

/**
 * Commits reachable from `tip` but NOT from `base` — i.e. exactly what a rewind
 * to `base` makes unreachable. `null` when it cannot be established (an
 * unresolvable saved head), which the caller must treat as CLOSED, never clean.
 */
function countBetween(repo, base, tip) {
  if (!base || !tip) return null;
  const r = git(repo, ['rev-list', '--count', `${base}..${tip}`]);
  if (!r.ok) return null;
  const n = Number.parseInt(r.out, 10);
  return Number.isFinite(n) ? n : null;
}

function listBetween(repo, base, tip, limit = MAX_LISTED) {
  if (!base || !tip) return [];
  const r = git(repo, ['log', `--format=%h${SEP}%s`, `${base}..${tip}`, `-n${limit}`]);
  if (!r.ok || !r.out) return [];
  return r.out.split('\n').filter(Boolean).map((l) => {
    const [short, subject] = l.split(SEP);
    return { short, subject: subject || '' };
  });
}

function headSha(repo) {
  const r = git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  return r.ok && r.out ? r.out : null;
}

function headRef(repo) {
  const r = git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return r.ok && r.out ? r.out : null;
}

// --- state assessment ---------------------------------------------------------

const QUIT_FOR = {
  revert: 'revert --quit',
  'cherry-pick': 'cherry-pick --quit',
  rebase: 'rebase --quit',
  merge: 'merge --quit',
};

/** Which verb owns a sequencer dir: its todo says, and the *_HEAD marker agrees. */
function sequencerVerb(seqDir, statePresent) {
  const todo = readTextFile(path.join(seqDir, 'todo')) || '';
  if (/^\s*revert\b/m.test(todo)) return 'revert';
  if (/^\s*(pick|cherry-pick)\b/m.test(todo)) return 'cherry-pick';
  if (statePresent.REVERT_HEAD) return 'revert';
  if (statePresent.CHERRY_PICK_HEAD) return 'cherry-pick';
  return 'revert';
}

/**
 * Every in-progress operation armed in the working tree at `repo`.
 * @returns {Array<object>} one entry per operation, each carrying its own count.
 */
function assessStates(repo, { nowMs = Date.now(), graceMin = DEFAULT_GRACE_MIN } = {}) {
  const graceMs = graceMin * 60_000;
  const p = {};
  for (const name of ['sequencer', 'rebase-merge', 'rebase-apply',
    'REVERT_HEAD', 'CHERRY_PICK_HEAD', 'MERGE_HEAD']) {
    const abs = gitStatePath(repo, name);
    p[name] = abs && fs.existsSync(abs) ? abs : null;
  }
  const tip = headSha(repo);
  const branch = headRef(repo);
  const states = [];

  const finish = (s) => {
    const mtime = s.statePath ? newestMtimeMs(s.statePath) : null;
    s.ageS = mtime === null ? null : Math.max(0, Math.round((nowMs - mtime) / 1000));
    // An unstattable state is treated as ABANDONED, not as fresh: we could not
    // establish that anyone is working it, and silence is not a pass (§17i).
    // `>=` deliberately: a grace of ZERO means "nothing is fresh", which is what
    // makes the stale/fresh boundary testable at all.
    s.stale = s.ageS === null ? true : s.ageS * 1000 >= graceMs;
    s.severity = (s.discard === null || s.discard > 0 || s.stale) ? 'block' : 'advisory';
    s.quit = QUIT_FOR[s.verb] || `${s.verb} --quit`;
    states.push(s);
  };

  // --- rebase: NO safety check at all (measured). Always armed. ---------------
  for (const kind of ['rebase-merge', 'rebase-apply']) {
    if (!p[kind]) continue;
    const dir = p[kind];
    const saved = readShaFile(path.join(dir, 'orig-head'))
      || readShaFile(path.join(dir, 'head'))
      || readShaFile(path.join(dir, 'abort-safety'));
    // HEAD is DETACHED during a rebase; `--abort` restores the branch named in
    // head-name, so the tip at stake is that BRANCH, not HEAD.
    const nameRef = readTextFile(path.join(dir, 'head-name'));
    let tipRef = nameRef || (branch ? `refs/heads/${branch}` : null);
    let tipSha = tip;
    if (tipRef) {
      const r = git(repo, ['rev-parse', '--verify', '--quiet', tipRef]);
      if (r.ok && r.out) tipSha = r.out;
      else tipRef = branch ? `refs/heads/${branch}` : 'HEAD';
    }
    finish({
      kind, verb: 'rebase', statePath: dir, savedHead: saved,
      tip: tipSha, tipRef: tipRef || 'HEAD (detached)',
      discard: countBetween(repo, saved, tipSha),
      atStake: listBetween(repo, saved, tipSha),
      armedNow: true,
      arming: 'ARMED NOW — `git rebase --abort` has NO abort-safety check: it resets '
        + `${tipRef || 'HEAD'} to orig-head unconditionally (measured, git 2.50.1).`,
    });
  }

  // --- sequencer (revert / cherry-pick): armed iff abort-safety == HEAD -------
  if (p.sequencer) {
    const dir = p.sequencer;
    const verb = sequencerVerb(dir, p);
    const saved = readShaFile(path.join(dir, 'head'));
    const safety = readShaFile(path.join(dir, 'abort-safety'));
    const armedNow = !!(safety && tip && safety === tip);
    finish({
      kind: 'sequencer', verb, statePath: dir, savedHead: saved,
      tip, tipRef: branch ? `refs/heads/${branch}` : 'HEAD (detached)',
      discard: countBetween(repo, saved, tip),
      atStake: listBetween(repo, saved, tip),
      todo: (readTextFile(path.join(dir, 'todo')) || '').split('\n').filter(Boolean),
      abortSafety: safety, armedNow,
      arming: armedNow
        ? `ARMED NOW — abort-safety == HEAD, so \`git ${verb} --abort\` rewinds to `
          + `${(saved || '?').slice(0, 9)} and every commit since becomes unreachable.`
        : 'NOT armed at this instant (abort-safety != HEAD, so `--abort` prints "You seem '
          + 'to have moved HEAD. Not rewinding") — but ONE `git ' + verb + ' --continue` '
          + 'rewrites abort-safety to the CURRENT head and re-arms the rewind, and '
          + '`--continue` is the MORE natural move on a stuck operation than `--abort`. '
          + 'Both arms are measured in sequencer-guard.test.js (AC-SEQ.4).',
    });
  }

  // --- a LONE *_HEAD marker (single pick, no sequencer dir) -------------------
  for (const [marker, verb] of [['REVERT_HEAD', 'revert'], ['CHERRY_PICK_HEAD', 'cherry-pick']]) {
    if (!p[marker] || p.sequencer) continue;
    finish({
      kind: marker, verb, statePath: p[marker], savedHead: tip,
      tip, tipRef: branch ? `refs/heads/${branch}` : 'HEAD (detached)',
      discard: 0, atStake: [], armedNow: false,
      arming: `no commits at stake — a single-pick \`${verb} --abort\` does not rewind `
        + '(measured); it discards the INDEX and the conflict resolution in the working '
        + 'tree, which is still someone\'s work.',
    });
  }

  if (p.MERGE_HEAD) {
    finish({
      kind: 'MERGE_HEAD', verb: 'merge', statePath: p.MERGE_HEAD, savedHead: tip,
      tip, tipRef: branch ? `refs/heads/${branch}` : 'HEAD (detached)',
      discard: 0, atStake: [], armedNow: false,
      arming: 'no commits at stake — HEAD never moved during a conflicted merge, so '
        + '`git merge --abort` resets to HEAD (measured); it discards the index and the '
        + 'conflict resolution in the working tree.',
    });
  }

  return states;
}

// --- sweep --------------------------------------------------------------------

/** Every working tree this system could plausibly hold state in. TWO REPOS, always. */
function candidateTrees(root, { repoRoot = null } = {}) {
  const abs = path.resolve(root);
  const trees = [abs];
  const base = repoRoot ? path.resolve(repoRoot) : abs;
  try {
    for (const w of wtg.registeredWorktrees(base)) trees.push(w);
  } catch { /* not a repo — the nested walk still applies */ }
  for (const holder of [abs, base]) {
    const agentDir = path.join(holder, '.claude', 'worktrees');
    if (!fs.existsSync(agentDir)) continue;
    try {
      for (const e of fs.readdirSync(agentDir, { withFileTypes: true })) {
        if (e.isDirectory()) trees.push(path.join(agentDir, e.name));
      }
    } catch { /* unreadable — nothing to add */ }
  }
  // NESTED repos: `work/<project>/` is its own repo, gitignored by the parent, and
  // is where the founding incident actually sat. DELEGATED to worktree-guard's
  // discovery so there is ONE definition of "a repo under here" (DRY).
  for (const t of [...trees]) {
    if (!fs.existsSync(t)) continue;
    try {
      for (const n of wtg.findNestedRepos(t)) trees.push(n.dir);
    } catch { /* unreadable subtree */ }
  }
  const seen = new Set();
  const out = [];
  for (const t of trees) {
    let real = path.resolve(t);
    try { real = fs.realpathSync(real); } catch { /* keep the resolved form */ }
    if (seen.has(real) || !fs.existsSync(real)) continue;
    // Only WORKING TREES have in-progress state; a bare repo cannot.
    if (!git(real, ['rev-parse', '--is-inside-work-tree']).ok) continue;
    seen.add(real);
    out.push(real);
  }
  return out;
}

function scan(root, { repoRoot = null, graceMin = DEFAULT_GRACE_MIN, nowMs = Date.now() } = {}) {
  const trees = candidateTrees(root, { repoRoot });
  const repos = [];
  for (const dir of trees) {
    const states = assessStates(dir, { nowMs, graceMin });
    if (states.length === 0) continue;
    const porcelain = git(dir, ['status', '--porcelain']);
    repos.push({
      dir,
      states,
      // THE INVISIBILITY, recorded on every finding: this is why no existing
      // cleanliness check sees any of it.
      porcelainLines: porcelain.ok ? porcelain.out.split('\n').filter(Boolean).length : null,
      severity: states.some((s) => s.severity === 'block') ? 'block' : 'advisory',
      worstDiscard: states.reduce(
        (m, s) => (s.discard === null ? m : Math.max(m, s.discard)), 0),
      unmeasured: states.filter((s) => s.discard === null).length,
    });
  }
  const blocking = repos.filter((r) => r.severity === 'block');
  const verdict = blocking.length ? 'BLOCK' : (repos.length ? 'ADVISORY' : 'CLEAN');
  const worstDiscard = repos.reduce((m, r) => Math.max(m, r.worstDiscard), 0);
  return {
    verdict,
    clean: verdict === 'CLEAN',
    root: path.resolve(root),
    graceMin,
    treesScanned: trees.length,
    repos,
    worstDiscard,
    unmeasured: repos.reduce((n, r) => n + r.unmeasured, 0),
    message: render({ verdict, trees, repos, worstDiscard, graceMin }),
  };
}

function render({ verdict, trees, repos, worstDiscard, graceMin }) {
  if (verdict === 'CLEAN') {
    return `sequencer-guard: CLEAN — ${trees.length} working tree(s) swept `
      + '(parent, worktrees and every nested project repo); no in-progress git '
      + 'operation is armed in any of them.';
  }
  const lines = [];
  lines.push(verdict === 'BLOCK'
    ? `sequencer-guard: ARMED IN-PROGRESS GIT STATE — up to ${worstDiscard} commit(s) at stake`
    : 'sequencer-guard: in-progress git state present (nothing at stake yet)');
  lines.push('');
  for (const r of repos) {
    lines.push(`  ${r.dir}`);
    lines.push(`    git status --porcelain reports ${r.porcelainLines === null ? 'UNKNOWN'
      : r.porcelainLines} line(s) — THIS STATE IS INVISIBLE TO IT, which is why every`);
    lines.push('      cleanliness check in this system passes with it armed.');
    for (const s of r.states) {
      const count = s.discard === null ? 'NOT ESTABLISHED' : String(s.discard);
      lines.push(`    ${s.kind} (${s.verb}), idle ${s.ageS === null ? 'UNKNOWN' : `${s.ageS}s`}`
        + `${s.stale ? ` — STALE (> ${graceMin}m)` : ' — fresh'}`);
      lines.push(`      saved head ${(s.savedHead || '?').slice(0, 9)} -> tip `
        + `${(s.tip || '?').slice(0, 9)} (${s.tipRef})`);
      lines.push(`      COMMITS \`--abort\` WOULD DISCARD: ${count}`);
      for (const c of s.atStake) lines.push(`        ${c.short}  ${c.subject}`);
      if (s.discard !== null && s.discard > s.atStake.length) {
        lines.push(`        … and ${s.discard - s.atStake.length} more`);
      }
      lines.push(`      ${s.arming}`);
      lines.push(`      REMEDY: git -C ${r.dir} ${s.quit}`);
      if (s.verb === 'rebase') {
        lines.push('        NOTE: `rebase --quit` clears the state but leaves HEAD DETACHED '
          + 'where the rebase stopped — a shared tree off trunk is its own hazard '
          + '(CLAUDE.md limit 3). A rebase belongs in a `git worktree`, never here.');
      }
    }
    lines.push('');
  }
  lines.push('NEVER `--abort` IN A SHARED TREE. `--quit` clears the state and leaves HEAD and');
  lines.push('the working tree exactly as they are; `--abort` rewinds to a saved head that in');
  lines.push('this system goes stale by design — the prescribed commit path');
  lines.push('(isolated-commit.js: commit-tree + ref CAS) never clears branch state, so the');
  lines.push('gap grows with every commit. It reached 56 commits / 6 hours once already.');
  lines.push('BEFORE CLEARING, establish what the state describes (the founding incident');
  lines.push('checked that `a8bd0dee` had already completed the revert and was an ancestor of');
  lines.push('origin/main) — then `--quit`, never `--abort`, and never `--continue` first.');
  return lines.join('\n');
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
  if (sub !== 'scan') {
    process.stderr.write(
      'usage: sequencer-guard scan [dir] [--repo-root R] [--grace-min N] [--json]\n'
      + '  Detects .git/sequencer, REVERT_HEAD, CHERRY_PICK_HEAD, MERGE_HEAD and\n'
      + '  rebase-merge/rebase-apply in the parent repo, every worktree and every\n'
      + '  nested project repo, and reports HOW MANY COMMITS `--abort` would discard.\n'
      + '  Read-only: it never runs a writing git verb.\n');
    return 1;
  }
  const a = parseArgs(argv.slice(1));
  const repoRoot = path.resolve(a['repo-root'] || REPO_ROOT_DEFAULT);
  const root = a._[0] ? path.resolve(a._[0]) : repoRoot;
  const graceMin = a['grace-min'] !== undefined
    ? Number.parseFloat(a['grace-min']) : DEFAULT_GRACE_MIN;
  const res = scan(root, {
    repoRoot,
    graceMin: Number.isFinite(graceMin) ? graceMin : DEFAULT_GRACE_MIN,
  });
  process.stdout.write((a.json ? JSON.stringify(res, null, 2) : res.message) + '\n');
  return res.verdict === 'BLOCK' ? 2 : 0;
}

module.exports = {
  assessStates, candidateTrees, scan, countBetween, gitStatePath,
  DEFAULT_GRACE_MIN,
};

if (require.main === module) {
  // Do NOT `process.exit()` here: a large `--json` payload written to a PIPE is
  // truncated at the 64 KiB pipe buffer because stdout is async on a pipe and
  // `exit()` does not wait for it to drain. That truncation once made loop-gate
  // read worktree-guard as NOT ESTABLISHED (v143). Setting exitCode preserves the
  // status and lets node flush.
  process.exitCode = main(process.argv.slice(2));
}
