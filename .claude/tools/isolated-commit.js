#!/usr/bin/env node
'use strict';
/**
 * isolated-commit.js — race-free commit on a SHARED working tree (DEFECT-OAG-058).
 *
 * Allowlisted entry point — invoked by the ROOT Makefile target:
 *   make commit-isolated REPO=<dir> MSG="type(scope): intent" PATHS="a b c"
 * which runs:
 *   node .claude/tools/isolated-commit.js --repo <dir> --message <msg> -- <path>...
 *
 * WHY THIS EXISTS
 *   Up to five agents share one working tree, and therefore ONE git index.
 *   Both previously-prescribed remedies are broken, each in its own way:
 *
 *     git add -- <mine> && git commit          `git add` takes a pathspec,
 *                                              `git commit` DOES NOT — it commits
 *                                              the WHOLE INDEX. Commit b477f08
 *                                              published 102 files including nine
 *                                              source files belonging to two other
 *                                              agents mid-task, and because the
 *                                              push IS the apply on this trunk,
 *                                              applied their untested code.
 *
 *     git commit -- <mine>                     commits from the WORKING TREE, not
 *                                              the index — so it picks up whatever
 *                                              a concurrent agent has SAVED under
 *                                              that pathspec mid-edit (observed:
 *                                              33 lines of another agent's
 *                                              in-flight work, 2026-08-06).
 *
 *   The race-free form takes its content from an index NOBODY ELSE CAN WRITE:
 *
 *     1. build a PRIVATE index (GIT_INDEX_FILE=<temp>) seeded from HEAD;
 *     2. add ONLY the declared paths to it;
 *     3. assert the resulting tree differs from HEAD only inside those paths;
 *     4. write it with `git commit-tree` and move the branch with a
 *        COMPARE-AND-SWAP `git update-ref <new> <old>` — so a commit another
 *        agent lands in the meantime is never lost, it is retried on top;
 *     5. resync the SHARED index for MY paths only, because a stale shared-index
 *        entry silently REVERTS my file the next time anyone commits the index.
 *
 *   The shared index is never read into the tree and never rewritten except for
 *   step 5's own-path resync. Other agents' staged work stays staged.
 *
 * NOT A DISCIPLINE FIX (item limb 4). Discipline failed six times. This is the
 * mechanism; the agent files point at it.
 *
 * Pure git + filesystem. NO credentials, NO network.
 *
 * EXIT CODES
 *   0  committed (sha on stdout)
 *   2  usage / precondition refused (detached HEAD, bad path, no message)
 *   3  DECLARED-SUBSET ASSERTION FIRED — the pathspec reached outside the paths
 *      you declared; nothing was committed
 *   4  nothing to commit for the declared paths (never an empty commit); names a
 *      .gitignore'd path when that is why
 *   5  the branch could not be advanced after N compare-and-swap attempts
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_CAS_ATTEMPTS = 5;

class IsolatedCommitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// --- pure helpers ------------------------------------------------------------

/** Normalise a repo-relative declared path: strip `./` and any trailing `/`. */
function normalizeDeclared(p) {
  let s = String(p).replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  while (s.endsWith('/') && s.length > 1) s = s.slice(0, -1);
  return s;
}

/**
 * The declared-subset assertion, as a predicate so it can be tested on its own.
 * Returns the changed paths that fall OUTSIDE every declared path. A declared
 * path matches a changed path exactly, or as a directory prefix — `items` covers
 * `items/A.md` but NOT `itemsX/A.md`.
 */
function pathsOutsideDeclared(changed, declared) {
  const decls = declared.map(normalizeDeclared);
  return changed.filter((c) => {
    const f = normalizeDeclared(c);
    return !decls.some((d) => d === '.' || f === d || f.startsWith(`${d}/`));
  });
}

/**
 * Refuse anything that is not a literal, repo-relative path. Globs and pathspec
 * magic are refused rather than expanded, because the subset assertion compares
 * LITERALLY: a form whose meaning git decides is a form whose blast radius the
 * caller has not declared.
 */
function validateDeclaredPath(p) {
  const raw = String(p);
  if (raw === '') return 'empty path';
  if (raw.startsWith(':')) return `pathspec magic is not allowed (${raw}) — declare literal paths`;
  if (path.isAbsolute(raw)) return `absolute path is not allowed (${raw}) — declare repo-relative paths`;
  const s = normalizeDeclared(raw);
  if (s === '..' || s.startsWith('../') || s.split('/').includes('..'))
    return `path escapes the repo (${raw})`;
  return null;
}

// --- git plumbing ------------------------------------------------------------

function gitOut(repo, args, env) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitTry(repo, args, env) {
  try {
    return { ok: true, out: gitOut(repo, args, env) };
  } catch (e) {
    return { ok: false, out: '', err: (e.stderr || e.message || '').toString() };
  }
}

function lines(s) {
  return s ? s.split('\n').filter(Boolean) : [];
}

// --- the operation -----------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.repo        repo (or worktree) directory
 * @param {string} o.message     commit message
 * @param {string[]} o.paths     literal repo-relative paths I own
 * @param {boolean} [o.syncIndex=true]  resync the shared index for MY paths
 * @param {object} [o.hooks]     test seam: { beforeUpdateRef }
 * @returns {{sha:string, files:string[], attempts:number, branch:string}}
 */
function isolatedCommit({ repo, message, paths, syncIndex = true, hooks = {} }) {
  if (!repo) throw new IsolatedCommitError(2, '--repo is required');
  if (!message || !String(message).trim()) throw new IsolatedCommitError(2, '--message is required');
  if (!paths || paths.length === 0)
    throw new IsolatedCommitError(2, 'at least one declared path is required (after `--`)');

  for (const p of paths) {
    const bad = validateDeclaredPath(p);
    if (bad) throw new IsolatedCommitError(2, bad);
  }

  const top = gitTry(repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new IsolatedCommitError(2, `not a git repository: ${repo}`);

  const branchRef = gitTry(repo, ['symbolic-ref', '--quiet', 'HEAD']);
  if (!branchRef.ok || !branchRef.out.startsWith('refs/heads/'))
    throw new IsolatedCommitError(
      2,
      'HEAD is detached — refusing to commit. Check out a branch first; a detached commit on a shared tree is unreachable work.',
    );
  const ref = branchRef.out;
  const branch = ref.replace('refs/heads/', '');

  // A declared path that exists on disk but is EXCLUDED by .gitignore and not
  // already tracked contributes nothing, and `git add` would fail obscurely.
  // Name it: a green suite over a file git will not track is a false green.
  const ignored = paths.filter((p) => {
    const rel = normalizeDeclared(p);
    if (!fs.existsSync(path.join(repo, rel))) return false;
    if (!gitTry(repo, ['check-ignore', '-q', '--', rel]).ok) return false;
    return lines(gitTry(repo, ['ls-files', '--', rel]).out).length === 0;
  });
  if (ignored.length > 0)
    throw new IsolatedCommitError(
      4,
      [
        'nothing to commit — these declared paths exist on disk but are excluded by .gitignore, so they would contribute NOTHING:',
        ...ignored.map((p) => `  ${p}`),
        'A green suite over a file git will not track is a false green (DEF-ROC-001). Fix the ignore pattern or the path.',
      ].join('\n'),
    );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-index-'));
  const privateIndex = path.join(tmpDir, 'index');
  const privEnv = { GIT_INDEX_FILE: privateIndex };

  try {
    let attempts = 0;
    for (;;) {
      attempts += 1;
      const headRes = gitTry(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']);
      const oldHead = headRes.ok && headRes.out ? headRes.out : null;

      // 1. private index seeded from HEAD — the shared index is never read.
      if (fs.existsSync(privateIndex)) fs.unlinkSync(privateIndex);
      if (oldHead) gitOut(repo, ['read-tree', oldHead], privEnv);
      else gitOut(repo, ['read-tree', '--empty'], privEnv);

      // 2. add ONLY my declared paths.
      for (const p of paths) {
        const add = gitTry(repo, ['add', '--all', '--', normalizeDeclared(p)], privEnv);
        if (!add.ok) throw new IsolatedCommitError(2, `git add failed for ${p}: ${add.err}`);
      }

      const tree = gitOut(repo, ['write-tree'], privEnv);

      // 3. the declared-subset assertion.
      const changed = oldHead
        ? lines(gitOut(repo, ['diff-tree', '-r', '--no-commit-id', '--name-only', oldHead, tree]))
        : lines(gitOut(repo, ['ls-tree', '-r', '--name-only', tree]));

      const escaped = pathsOutsideDeclared(changed, paths);
      if (escaped.length > 0) {
        throw new IsolatedCommitError(
          3,
          [
            'DECLARED-SUBSET ASSERTION FIRED — nothing committed.',
            `You declared: ${paths.join(' ')}`,
            'but these paths would have been committed:',
            ...escaped.map((p) => `  ${p}`),
            'Declare literal paths (no globs, no pathspec magic); git expanded yours beyond what you declared.',
          ].join('\n'),
        );
      }

      if (changed.length === 0)
        throw new IsolatedCommitError(
          4,
          `nothing to commit for the declared paths (${paths.join(' ')}) — refusing to make an empty commit.`,
        );

      // 4. commit-tree + compare-and-swap ref update.
      const parentArgs = oldHead ? ['-p', oldHead] : [];
      const sha = gitOut(repo, ['commit-tree', tree, ...parentArgs, '-m', message]);

      if (typeof hooks.beforeUpdateRef === 'function') hooks.beforeUpdateRef();

      const cas = gitTry(repo, [
        'update-ref',
        '-m',
        `isolated-commit: ${String(message).split('\n')[0]}`,
        ref,
        sha,
        oldHead || '',
      ]);

      if (!cas.ok) {
        if (attempts >= MAX_CAS_ATTEMPTS)
          throw new IsolatedCommitError(
            5,
            `could not advance ${ref} after ${attempts} attempts — another agent is committing continuously. Last error: ${cas.err}`,
          );
        continue; // recompute against the new HEAD and retry
      }

      // 5. resync the SHARED index for MY paths only. Without this the shared
      //    index still holds the pre-commit blob for my files, and the next
      //    whole-index commit by ANY agent silently reverts them.
      if (syncIndex) {
        for (const p of paths) gitTry(repo, ['add', '--all', '--', normalizeDeclared(p)]);
      }

      return { sha, files: changed, attempts, branch };
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- CLI ---------------------------------------------------------------------

function parseArgv(argv) {
  const out = { repo: null, message: null, paths: [], syncIndex: true, json: false };
  let i = 0;
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      out.paths = argv.slice(i + 1);
      break;
    } else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--message' || a === '-m') out.message = argv[++i];
    // --message-file / -F: the ONLY route a commit message cannot be corrupted on
    // (OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT). A message on a command line crosses
    // make's expansion and then a shell double-quoted string: `$` is expanded away, a
    // backtick is EXECUTED (the macOS `open` binary really ran and the word vanished
    // from a committed message), and a `"` refuses the commit outright with
    // `unexpected EOF while looking for matching '"'`. A PATH has no metacharacters.
    // Same reason `git commit -F` exists.
    else if (a === '--message-file' || a === '-F') {
      const p = argv[++i];
      try {
        out.message = require('fs').readFileSync(p, 'utf-8');
      } catch (e) {
        return { error: `cannot read --message-file ${p}: ${e.message}` };
      }
    }
    else if (a === '--no-sync-index') out.syncIndex = false;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else return { error: `unknown argument: ${a}` };
  }
  return out;
}

const USAGE = `usage: node .claude/tools/isolated-commit.js --repo <dir> (--message <msg> | --message-file <path>) [--no-sync-index] [--json] -- <path>...

Commits ONLY the declared paths, taking content from a PRIVATE index, so a
concurrent agent's staged or mid-edit work on a shared tree cannot ride along.
Prefer the Makefile form:  make commit-isolated REPO=<dir> MSG_FILE=<path> PATHS="a b"

Use --message-file / MSG_FILE for any message that is multi-line or carries a
metacharacter. A message on a command line crosses a shell: \`$\` is expanded away,
a backtick is EXECUTED, and a double quote refuses the commit outright.`;

function main(argv) {
  const opts = parseArgv(argv);
  if (opts.error) {
    process.stderr.write(`${opts.error}\n${USAGE}\n`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  try {
    const res = isolatedCommit(opts);
    if (opts.json) process.stdout.write(`${JSON.stringify(res)}\n`);
    else
      process.stdout.write(
        `${res.sha.slice(0, 8)} on ${res.branch} — ${res.files.length} file(s):\n${res.files
          .map((f) => `  ${f}`)
          .join('\n')}\n`,
      );
    return 0;
  } catch (e) {
    const code = e instanceof IsolatedCommitError ? e.code : 1;
    process.stderr.write(`${e.message}\n`);
    if (code === 2) process.stderr.write(`${USAGE}\n`);
    return code;
  }
}

module.exports = {
  isolatedCommit,
  pathsOutsideDeclared,
  normalizeDeclared,
  validateDeclaredPath,
  IsolatedCommitError,
  main,
};

if (require.main === module) {
  // §17g sweep off AC-DEFECT-OAG-076.5: `process.exit()` does not wait for a PIPE
  // to drain, so any payload over the 64 KiB pipe buffer reaches the consumer
  // TRUNCATED. `worktree-guard scan-all --json` hit exactly that on 2026-08-19 and
  // loop-gate read the guard as unrunnable. Set exitCode; let the runtime flush.
  process.exitCode = main(process.argv.slice(2));
}
