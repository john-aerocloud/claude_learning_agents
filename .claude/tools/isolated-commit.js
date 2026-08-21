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
 *   6  MESSAGE GUARD FIRED — the message is not provably the one you passed
 *      (crossed with a concurrent agent's, clobbered in its file, or corrupted
 *      between here and the commit object); nothing was committed
 *
 * THE MESSAGE IS THE SECOND SHARED-MUTABLE-STATE PROBLEM, and it is not in git
 * (OI-CO-OWNED-LEDGER-FILES-CROSS-ATTRIBUTE-WORK-AND-ONE-CROSSED-A-COMMIT-MESSAGE).
 * Measured 2026-08-21: TWO commits landed carrying a CONCURRENT AGENT'S MESSAGE over
 * their own correct tree — e29fb8f0 (with 6cc2b368's text) and 49e9f0a8 (with
 * f14b0a3a's). Both pairs byte-identical.
 *
 *   MECHANISM, established before this guard was written: the agent scratchpad is a
 *   per-SESSION directory that every concurrent subagent of one orchestrator session
 *   SHARES, and several agents each wrote their message there as `msg.txt` (the
 *   directory really held msg.txt, msg1..msg11, msgA, msgB). One was overwritten
 *   between the caller's write and this tool's `--message-file` read. The private
 *   index is minted per invocation (`mkdtemp`), so the git plumbing was never the
 *   shared state — the MESSAGE INPUT CHANNEL was, and the Makefile's own worked
 *   example (`MSG_FILE=/tmp/msg.txt`) TAUGHT the collision.
 *
 *   This is the SAME SHAPE as the co-owned `class-deps.mmd` / `edge-ledger.md`
 *   append-target this item's limb A attacks: a shared location plus a non-unique
 *   name, contended by construction. Different substrate, one root cause.
 *
 *   So the remedy is not a convention. Four controls, in the order they bite:
 *     A. --mint-message-file prints a path that CANNOT collide (pid + random +
 *        declared-path digest), so a caller does not get to choose a colliding one;
 *     B. a --message-file whose basename carries no identity token is REFUSED;
 *     C. the file is re-read immediately before the commit and a divergence refused;
 *     D. the message on the created commit object is READ BACK before the ref moves,
 *        and a message byte-identical to a recent ancestor's is refused — because two
 *        identical messages on a shared tree is the crossing signature, not intent,
 *        and it is the only limb that catches a clobber that happened BEFORE this
 *        process started (which is what both real instances were).
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_CAS_ATTEMPTS = 5;

/** How far back to look for an identical message. Both real crossings were ADJACENT
 *  commits; 25 is generous, cheap, and bounded so the check cannot grow with history. */
const DUP_SCAN_DEPTH = 25;

/** Record/unit separators for the message scan: a commit message can contain any
 *  newline, so a newline-delimited format would mis-split it. */
const RS = '\x1e';
const US = '\x1f';

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

/**
 * `git commit-tree -m` stores the message VERBATIM and adds exactly ONE trailing
 * newline if absent. MEASURED 2026-08-21 — and the first measurement said "collapses
 * trailing newlines", which was WRONG because shell `$()` had already eaten them; the
 * corrected fact is pinned in AC-MSGCROSS.4's non-vacuity case rather than trusted to
 * this comment. Trailing blank lines, trailing spaces, internal blank lines, CRLF,
 * leading blank lines and a leading `#` all survive untouched. So message identity is
 * compared with trailing newlines stripped, and any OTHER difference is a real
 * crossing or corruption rather than git being git.
 */
function normalizeMessage(m) {
  return String(m).replace(/\n+$/, '');
}

/**
 * The identity token in a message-file name: what is left after a generic
 * `msg`/`message`/`commit-msg`/`m` stem. `msg.txt` -> ``; `msg12.txt` -> `12`;
 * `msg-OI-CROSS-ROUTE.txt` -> `OI-CROSS-ROUTE`.
 */
function messageFileIdentityToken(p) {
  const base = path.basename(String(p)).replace(/\.[^.]*$/, '');
  return base.replace(/^(?:commit[-_.]?)?(?:msg|message|m)[-_. ]*/i, '');
}

/**
 * Refuse a message-file name that is not unique BY CONSTRUCTION. The measured
 * collision family is exactly the generic stem with nothing, a digit or a single
 * letter after it — msg.txt, msg1..msg11, msgA, msgB — all of which several agents
 * chose independently in one shared scratchpad. A token needs >= 4 alphanumerics AND
 * at least one letter, which admits every real work-item id (OI-CROSS-ROUTE,
 * SPEC-078-B, DEFECT-OAG-137, UC-ML5) and refuses every member of that family.
 *
 * Returns null when the name is safe, else the refusal text.
 */
function sharedMessageFileRefusal(p) {
  const token = messageFileIdentityToken(p);
  const alnum = token.replace(/[^A-Za-z0-9]/g, '');
  if (alnum.length >= 4 && /[A-Za-z]/.test(alnum)) return null;
  return [
    `--message-file ${p} carries no identity token, so it is NOT unique to you.`,
    'A commit MESSAGE crossed between two agents on 2026-08-21 for exactly this reason:',
    'the agent scratchpad is shared by every concurrent subagent of one session, several',
    'agents each wrote `msg.txt` there, and one was overwritten between the write and the',
    'read. isolated-commit protected the CONTENT and nothing protected the message.',
    'Take a path you CANNOT collide on:',
    '  P=$(node .claude/tools/isolated-commit.js --mint-message-file)   # or: make commit-msg-file',
    'or name the file after your work item:  msg-<ITEM-ID>.txt',
    'A deliberate single-agent share takes --allow-shared-message-file (MSG_FILE_SHARED_OK=1).',
  ].join('\n');
}

/**
 * Mint a message-file path that cannot collide: the scratchpad-or-tmpdir, plus pid,
 * plus randomness, plus a digest of the declared paths. Printed for the caller to
 * write into — the tool owning the name is the only control that does not rely on
 * every caller remembering a convention.
 */
function mintMessageFilePath(paths = [], dir = null) {
  const tag = crypto
    .createHash('sha256')
    .update((paths || []).map(normalizeDeclared).sort().join('\n'))
    .digest('hex')
    .slice(0, 8);
  const base = dir || process.env.CLAUDE_SCRATCHPAD || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, `msg-${process.pid}-${crypto.randomBytes(4).toString('hex')}-${tag}.txt`);
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

/** Like gitOut but NOT trimmed — a message's leading whitespace is significant. */
function gitRaw(repo, args, env) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function lines(s) {
  return s ? s.split('\n').filter(Boolean) : [];
}

/** The message body of a commit OBJECT, verbatim (everything after the header). */
function commitObjectMessage(repo, sha) {
  const raw = gitRaw(repo, ['cat-file', 'commit', sha]);
  const sep = raw.indexOf('\n\n');
  return sep === -1 ? '' : raw.slice(sep + 2);
}

/**
 * The first ancestor of `head` (within `depth`) whose message is identical to
 * `message`. Two commits with the same message on a shared tree is the CROSSING
 * SIGNATURE: both measured instances were byte-identical pairs
 * (sha256 ca17fae5… for e29fb8f0/6cc2b368, 730784a0… for f14b0a3a/49e9f0a8).
 * @returns {{sha:string, subject:string, back:number}|null}
 */
function duplicateMessageAncestor(repo, head, message, depth = DUP_SCAN_DEPTH) {
  if (!head || depth <= 0) return null;
  const want = normalizeMessage(message);
  const res = gitTry(repo, ['log', `--max-count=${depth}`, `--format=${RS}%H${US}%B`, head]);
  if (!res.ok) return null;
  const records = gitRaw(repo, ['log', `--max-count=${depth}`, `--format=${RS}%H${US}%B`, head])
    .split(RS)
    .filter((r) => r.includes(US));
  for (let i = 0; i < records.length; i += 1) {
    const cut = records[i].indexOf(US);
    const sha = records[i].slice(0, cut).trim();
    const body = records[i].slice(cut + 1);
    if (normalizeMessage(body) === want)
      return { sha, subject: want.split('\n')[0], back: i + 1 };
  }
  return null;
}

// --- the operation -----------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.repo        repo (or worktree) directory
 * @param {string} o.message     commit message
 * @param {string[]} o.paths     literal repo-relative paths I own
 * @param {string} [o.messageFile]     the file `message` was read from, so a
 *                                      concurrent overwrite can be detected
 * @param {boolean} [o.allowDuplicateMessage]   opt out of the crossing guard
 * @param {boolean} [o.allowSharedMessageFile]  opt out of the unique-name guard
 * @param {number} [o.dupScanDepth]     how far back to look for an identical message
 * @param {boolean} [o.syncIndex=true]  resync the shared index for MY paths
 * @param {object} [o.hooks]     test seam: { beforeUpdateRef, beforeCommitTree,
 *                               corruptMessageForCommitTree }
 * @returns {{sha:string, files:string[], attempts:number, branch:string}}
 */
function isolatedCommit({
  repo,
  message,
  paths,
  messageFile = null,
  allowDuplicateMessage = false,
  allowSharedMessageFile = false,
  dupScanDepth = DUP_SCAN_DEPTH,
  syncIndex = true,
  hooks = {},
}) {
  if (!repo) throw new IsolatedCommitError(2, '--repo is required');
  if (!message || !String(message).trim()) throw new IsolatedCommitError(2, '--message is required');

  // GUARD B — a message-file name that is not unique BY CONSTRUCTION is refused
  // before anything else happens, because the clobber it enables is silent and the
  // victim cannot detect it afterwards.
  if (messageFile && !allowSharedMessageFile) {
    const refusal = sharedMessageFileRefusal(messageFile);
    if (refusal) throw new IsolatedCommitError(2, refusal);
  }
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

      // --- THE MESSAGE GUARDS (exit 6). Everything below happens BEFORE the ref
      //     moves, so a fired guard leaves a dangling commit object and nothing else.
      //     The hook marks the real concurrent-write window: between the caller
      //     writing its message file and this tool using it.
      if (typeof hooks.beforeCommitTree === 'function') hooks.beforeCommitTree();

      // GUARD C — the message file still says what we are about to commit.
      if (messageFile) {
        let onDisk = null;
        try {
          onDisk = fs.readFileSync(messageFile, 'utf-8');
        } catch (e) {
          throw new IsolatedCommitError(
            6,
            `MESSAGE FILE WAS OVERWRITTEN or removed during this commit: cannot re-read ${messageFile} (${e.message}). Nothing committed.`,
          );
        }
        if (normalizeMessage(onDisk) !== normalizeMessage(message))
          throw new IsolatedCommitError(
            6,
            [
              'MESSAGE FILE WAS OVERWRITTEN while this commit was being built — nothing committed.',
              `  file: ${messageFile}`,
              `  read at start: ${normalizeMessage(message).split('\n')[0]}`,
              `  now on disk:   ${normalizeMessage(onDisk).split('\n')[0]}`,
              'A concurrent agent wrote your message path. Mint a private one:',
              '  P=$(node .claude/tools/isolated-commit.js --mint-message-file)',
            ].join('\n'),
          );
      }

      // GUARD D1 — an identical message on a recent ancestor is the crossing
      //            signature, and the ONLY limb that catches a clobber that happened
      //            BEFORE this process started (which is what both real ones were).
      if (!allowDuplicateMessage) {
        const dup = duplicateMessageAncestor(repo, oldHead, message, dupScanDepth);
        if (dup)
          throw new IsolatedCommitError(
            6,
            [
              'MESSAGE-CROSSING GUARD FIRED — nothing committed.',
              `Your message is IDENTICAL to ${dup.sha} (${dup.back} commit(s) back on ${branch}):`,
              `  ${dup.subject}`,
              'Two commits with the same message on a shared tree is the signature of a',
              'CROSSED MESSAGE, not of intent — e29fb8f0/6cc2b368 and f14b0a3a/49e9f0a8 were',
              'both byte-identical pairs (measured 2026-08-21). Your message file was very',
              'likely overwritten by a concurrent agent between your write and this read.',
              'CHECK, then choose:',
              `  - that sha is YOURS and this is a genuine re-commit of the same intent`,
              '      -> --allow-duplicate-message   (make: MSG_DUP_OK=1)',
              '  - otherwise re-write your message to a path you cannot collide on:',
              '      P=$(node .claude/tools/isolated-commit.js --mint-message-file)',
            ].join('\n'),
          );
      }

      // 4. commit-tree + compare-and-swap ref update.
      const parentArgs = oldHead ? ['-p', oldHead] : [];
      const messageForCommitTree =
        typeof hooks.corruptMessageForCommitTree === 'function'
          ? hooks.corruptMessageForCommitTree(message)
          : message;
      const sha = gitOut(repo, ['commit-tree', tree, ...parentArgs, '-m', messageForCommitTree]);

      // GUARD D2 — read the message BACK OFF THE COMMIT OBJECT and compare. The
      //            backstop: whatever happens between here and the object, the
      //            message that lands is provably the one the caller passed.
      const landed = commitObjectMessage(repo, sha);
      if (normalizeMessage(landed) !== normalizeMessage(message))
        throw new IsolatedCommitError(
          6,
          [
            'MESSAGE READ-BACK MISMATCH — the ref was NOT advanced, nothing landed.',
            `  you passed:      ${normalizeMessage(message).split('\n')[0]}`,
            `  the object says: ${normalizeMessage(landed).split('\n')[0]}`,
            `  (dangling, unreferenced commit ${sha})`,
          ].join('\n'),
        );

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
  const out = {
    repo: null,
    message: null,
    messageFile: null,
    paths: [],
    syncIndex: true,
    json: false,
    allowDuplicateMessage: false,
    allowSharedMessageFile: false,
    mintMessageFile: false,
  };
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
      out.messageFile = p;
      try {
        out.message = require('fs').readFileSync(p, 'utf-8');
      } catch (e) {
        return { error: `cannot read --message-file ${p}: ${e.message}` };
      }
    }
    // --mint-message-file prints a path that CANNOT collide, and is the primary
    // remedy for the 2026-08-21 message crossing: a convention ("please pick a
    // unique name") is the class of control this project keeps finding does not fire,
    // so the TOOL owns the name instead of every caller's discipline.
    else if (a === '--mint-message-file') out.mintMessageFile = true;
    else if (a === '--allow-duplicate-message') out.allowDuplicateMessage = true;
    else if (a === '--allow-shared-message-file') out.allowSharedMessageFile = true;
    else if (a === '--no-sync-index') out.syncIndex = false;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else return { error: `unknown argument: ${a}` };
  }
  return out;
}

const USAGE = `usage: node .claude/tools/isolated-commit.js --repo <dir> (--message <msg> | --message-file <path>) [--no-sync-index] [--json] -- <path>...
       node .claude/tools/isolated-commit.js --mint-message-file [-- <path>...]

Commits ONLY the declared paths, taking content from a PRIVATE index, so a
concurrent agent's staged or mid-edit work on a shared tree cannot ride along.
Prefer the Makefile form:
  P=$(make -s commit-msg-file); cat > "$P" <<'EOF'
  <your message>
  EOF
  make commit-isolated REPO=<dir> MSG_FILE="$P" PATHS="a b"

Use --message-file / MSG_FILE for any message that is multi-line or carries a
metacharacter. A message on a command line crosses a shell: \`$\` is expanded away,
a backtick is EXECUTED, and a double quote refuses the commit outright.

THE MESSAGE FILE MUST BE UNIQUE TO YOU. The agent scratchpad is shared by every
concurrent subagent of one session; on 2026-08-21 several agents each wrote
\`msg.txt\` there and a COMMIT MESSAGE CROSSED between two of them. --mint-message-file
prints a path you cannot collide on; a name with no identity token is refused.

  --allow-duplicate-message      commit a message identical to a recent ancestor's
  --allow-shared-message-file    accept a non-unique --message-file name`;

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
  if (opts.mintMessageFile) {
    process.stdout.write(`${mintMessageFilePath(opts.paths)}\n`);
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
  normalizeMessage,
  messageFileIdentityToken,
  sharedMessageFileRefusal,
  mintMessageFilePath,
  duplicateMessageAncestor,
  commitObjectMessage,
  DUP_SCAN_DEPTH,
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
