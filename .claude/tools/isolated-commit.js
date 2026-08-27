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
 *   7  CO-OWNED CONFLICT — a concurrent agent committed an OVERLAPPING change to a
 *      file you both own and it cannot be merged automatically; nothing committed
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

const { execFileSync, spawnSync } = require('node:child_process');
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

/** How far back to look for a concurrent agent's commit to a co-owned file.
 *  Bounded so the check cannot grow with history; a stale working copy older than
 *  25 commits to ONE file is not the concurrency window this guards. */
const COOWNED_SCAN_DEPTH = 25;

// --- the CO-OWNED APPEND-TARGET clobber (limb A) -----------------------------
//
// MEASURED 2026-08-26, and it is worse than the item recorded. `class-deps.mmd`
// and `edge-ledger.md` are append-targets SHARED BY EVERY ITEM BY CONSTRUCTION, so
// two agents declaring the same path is certain rather than unlucky — and the
// declared-subset assertion cannot see it, because the path IS declared. What then
// happens is not mis-attribution, it is SILENT PERMANENT LOSS:
//
//   A appends its row to the shared file and commits (exit 0).
//   B's copy was read before A committed. B saves it and commits: the private index
//   is seeded from the NEW head and B's WORKING-TREE blob REPLACES A's. A's
//   already-committed row is gone from HEAD, with a clean log and no warning.
//
// Every mitigation in this repo is written as DO NOT SWEEP OTHERS; this is the
// other direction, SOMEONE SWEPT MINE, and the victim cannot defend itself by being
// careful. Two agents independently invented the same workaround under time
// pressure — build the commit from HEAD's blob plus only my lines — and the reason
// no helper was shipped for it is that done properly it is a THREE-WAY MERGE. This
// is that merge, done properly.

/** Lines of a text blob, blanks dropped — the unit of "is my copy stale". */
function contentLines(text) {
  return String(text).split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/**
 * Lines present in `after` that are absent from `before`. Set semantics, not diff
 * hunks: what we need to know is whether a contribution EXISTS in a copy, not where.
 */
function linesAdded(before, after) {
  const had = new Set(contentLines(before));
  const seen = new Set();
  const out = [];
  for (const l of contentLines(after)) {
    if (!had.has(l) && !seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}

/**
 * The trigger, and it deliberately needs BOTH halves:
 *
 *   STALE   — some commit C reachable from HEAD contributed lines to this path and
 *             NOT ONE of them is in my copy, so my copy predates C; and
 *   NOVEL   — my copy has content HEAD does not, so I am a writer too.
 *
 * BOTH is the concurrent-append signature. STALE alone is a deliberate DELETION of
 * a recently-added block — an intent, which must not be merged back (AC-COOWNED.3).
 * NOVEL alone is an ordinary additive commit, where nothing can be clobbered.
 *
 * A commit that CREATED the path is never evidence: every copy of an existing file
 * necessarily derives from at least the version that created it, so "my copy lacks
 * what the creating commit added" means I REWROTE the file, which is intent. Only a
 * commit that MODIFIED an already-tracked path can have landed under me. That single
 * condition is what separates this guard from a false positive on every wholesale
 * rewrite (measured: without it, 20 of the file's own existing cases fired).
 *
 * SURVIVING EVIDENCE ONLY (DEFECT-OAG-142 limb A, and it is the whole bug). A
 * commit's contribution is evidence that MY copy is stale only if HEAD STILL HAS
 * IT. If the lines are absent from HEAD too, their absence from my copy is not
 * staleness — it is AGREEMENT: some later commit legitimately superseded them and
 * both sides moved on together. Without this filter, `sst.config.ts` selected
 * 265bea2c TWICE, hours apart, on a file only ONE agent had touched: its 17 added
 * lines were in neither side (measured inMine=0, inHEAD=0), so the base went 23
 * commits and ~48 KB behind both copies and the "merge" duplicated a 22 KB region
 * into trunk at exit 0. Measured: with the filter, both instances select NOTHING.
 *
 * @param {boolean} [o.evidenceMustSurviveInHead=true] CONTROL toggle — false
 *        reproduces the historical (defective) selection, for the test's losing arm.
 * @returns {{sha:string, added:string[]}|null} the OLDEST commit missing from my
 *          copy — its parent's blob is the merge base I actually started from.
 */
function coownedStaleAgainst({ headText, mineText, history, evidenceMustSurviveInHead = true }) {
  if (linesAdded(headText, mineText).length === 0) return null; // no novel content
  const mine = new Set(contentLines(mineText));
  const head = new Set(contentLines(headText));
  let oldest = null;
  for (const h of history) {
    if (h.parentText === null) continue; // created the path — see above
    const contributed = linesAdded(h.parentText, h.text);
    const added = evidenceMustSurviveInHead ? contributed.filter((l) => head.has(l)) : contributed;
    if (added.length === 0) continue; // nothing of it survives in HEAD — proves nothing
    if (added.some((l) => mine.has(l))) continue; // I have some of it; not cleanly stale
    oldest = { sha: h.sha, added };
  }
  return oldest;
}

// --- the DERIVED-BLOCK exemption (limb B) ------------------------------------
//
// `make wi-project` rewrites the machine-rendered `derived:` block of ALL items on
// every run, and that block is a PURE FUNCTION of the event log and the clock —
// time_in_state / time_by_owner carry no agent's intent at all. So two agents whose
// copies were regenerated at different moments "both changed the same line", which
// is a REAL overlap by the merge's own rule and was refused at exit 7 with nobody
// else live. Merging two recomputations of one pure function is meaningless: exempt
// the block from detection AND from the merge, keep MY regeneration, and let the
// next `wi-project` reconcile it. The AUTHORED region above the sentinel — where
// every event append lands — is merged exactly as before, so the loss guard is
// untouched (AC-142.6).
//
// The anchor is the machinery's own sentinel line, written by
// .claude/skills/work-items/scripts/work-items.py, and it is LIFECYCLE-STABLE: it is
// re-emitted on every render, so it cannot rot the way a path- or name-based
// exclusion does (OI-EXCLUSION-WITHOUT-AUTHORITY-READS-AS-HEALTHY).
const DERIVED_SENTINEL_PREFIX = '# --- everything below this line is DERIVED';

/**
 * Split a rendered item file around its machine-written derived block.
 * @returns {{before:string[], derived:string[], after:string[]}|null} null when the
 *          anchor is absent or unterminated — then nothing is exempted, ever.
 */
function splitDerived(text) {
  const src = String(text).split('\n');
  const i = src.findIndex((l) => l.startsWith(DERIVED_SENTINEL_PREFIX));
  if (i === -1) return null;
  let j = -1;
  for (let k = i + 1; k < src.length; k += 1) {
    if (src[k].trim() === '---') { j = k; break; }
  }
  if (j === -1) return null; // no frontmatter terminator — do not guess
  return { before: src.slice(0, i + 1), derived: src.slice(i + 1, j), after: src.slice(j) };
}

/** The text with its derived block removed; unchanged text when there is none. */
function maskDerived(text) {
  if (text === null || text === undefined) return text;
  const s = splitDerived(text);
  return s === null ? text : [...s.before, ...s.after].join('\n');
}

/**
 * Put MY derived block back into a merged, masked text.
 * @returns {{text:string}|{error:string}} an error when the merged text does not
 *          carry exactly one anchor — a structural surprise is never guessed at.
 */
function spliceDerived(maskedText, derivedLines) {
  const src = String(maskedText).split('\n');
  const hits = src.filter((l) => l.startsWith(DERIVED_SENTINEL_PREFIX)).length;
  if (hits !== 1)
    return { error: `the merged text carries ${hits} derived sentinels; refusing to splice` };
  const i = src.findIndex((l) => l.startsWith(DERIVED_SENTINEL_PREFIX));
  return { text: [...src.slice(0, i + 1), ...derivedLines, ...src.slice(i + 1)].join('\n') };
}

/**
 * THE DUPLICATION POST-CONDITION (DEFECT-OAG-142 limb A, AC-142.4).
 *
 * The base-selection fix removes the cause; this removes the CLASS. A three-way
 * merge may reorder and interleave, but it may never make content APPEAR MORE OFTEN
 * than the side that had it most — and the merge that corrupted trunk did exactly
 * that while reporting "16 line(s) merged back in", because `linesAdded` is a SET
 * difference and is therefore structurally blind to duplication.
 *
 * Scoped to content NOVEL TO BOTH SIDES relative to the common base. A line the base
 * already carried (`  },`, a blank, boilerplate) legitimately multiplies when two
 * agents each add a block, so counting those would refuse every honest append; a
 * line only ONE side has cannot be doubled by keeping both sides. What remains —
 * absent from the base, present in BOTH sides, emitted more often than either had it
 * — is a duplication by definition. It fails CLOSED: refuse, never commit.
 *
 * @returns {string[]} the offending content lines; empty means clean.
 */
function duplicatedBeyondBothSides({ baseText, mineText, headText, mergedText }) {
  const tally = (t) => {
    const m = new Map();
    for (const l of contentLines(t === null || t === undefined ? '' : t))
      m.set(l, (m.get(l) || 0) + 1);
    return m;
  };
  const base = tally(baseText);
  const mine = tally(mineText);
  const theirs = tally(headText);
  const out = [];
  for (const [line, n] of tally(mergedText)) {
    if (base.has(line)) continue; // the base already carried it — multiplicity is structural
    const a = mine.get(line) || 0;
    const b = theirs.get(line) || 0;
    if (a === 0 || b === 0) continue; // only one side contributed it — cannot be doubled
    if (n > Math.max(a, b)) out.push(line);
  }
  return out;
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

/**
 * Resolve the ADD/ADD hunks in a `git merge-file --diff3` result.
 *
 * TWO AGENTS APPENDING TO THE SAME LEDGER BOTH INSERT AT THE END OF THE FILE, so a
 * plain three-way merge reports a conflict for what is not a semantic conflict at
 * all: neither side touched the other's lines, they merely landed at the same
 * offset. Refusing those would re-impose exactly the serialisation this removes —
 * append-targets are contended BY CONSTRUCTION, so "take turns" is the cost, not
 * the fix.
 *
 * So a hunk whose COMMON BASE section is EMPTY (both sides purely inserted) is
 * resolved by keeping BOTH, theirs first: theirs is already committed, so commit
 * order is preserved and the file reads in the order the work landed.
 *
 * A hunk with a NON-EMPTY base is a genuine overlap — both sides rewrote the SAME
 * existing lines — and is NEVER resolved silently. That is the exit-7 refusal.
 *
 * AND "keep both" IS ONLY SOUND WHEN THE TWO SIDES ARE DISJOINT CONTRIBUTIONS
 * (DEFECT-OAG-142 limb A). Against a stale base, a region BOTH sides already had
 * looks like an ADD/ADD insertion, and keeping both emitted it TWICE — 22 KB and a
 * second `const AEROBUS_PRODUCER_REGISTRY` into trunk, at exit 0. So, by content:
 *   - either side EMPTY .............. keep the other
 *   - one side CONTAINS the other .... keep the container; identical sides are
 *                                     therefore a NO-OP BY CONSTRUCTION, which is
 *                                     the point: a tool that reports lines merged
 *                                     when both sides agree is reporting a fiction
 *   - sides INTERSECT but neither contains the other .... the same region seen
 *                                     twice, not two appends — REFUSE (exit 7)
 *   - sides DISJOINT ................. keep both, theirs first (the real append case)
 *
 * @returns {{text:string}|{conflict:string}}
 */
function resolveAppendCollisions(diff3Text, { contentRule = true } = {}) {
  const src = String(diff3Text).split('\n');
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (!src[i].startsWith('<<<<<<<')) {
      out.push(src[i]);
      i += 1;
      continue;
    }
    const mine = [];
    const base = [];
    const theirs = [];
    let bucket = mine;
    let closed = false;
    i += 1;
    for (; i < src.length; i += 1) {
      const l = src[i];
      if (l.startsWith('|||||||')) { bucket = base; continue; }
      if (l === '=======' || l.startsWith('======= ')) { bucket = theirs; continue; }
      if (l.startsWith('>>>>>>>')) { closed = true; i += 1; break; }
      bucket.push(l);
    }
    if (!closed) return { conflict: diff3Text };
    const nonBlank = (a) => a.some((l) => l.trim().length > 0);
    if (nonBlank(base)) return { conflict: diff3Text }; // both changed the SAME lines

    // ADD/ADD with an empty base — resolve BY CONTENT, not by position.
    // contentRule=false is the CONTROL toggle that restores the historical
    // position-only "keep both" — the losing arm of AC-142.2, never for real use.
    if (!contentRule) { out.push(...theirs, ...mine); continue; }
    const setOf = (a) => new Set(a.map((l) => l.trim()).filter((l) => l.length > 0));
    const sMine = setOf(mine);
    const sTheirs = setOf(theirs);
    const contains = (outer, inner) => [...inner].every((l) => outer.has(l));
    if (sTheirs.size === 0) { out.push(...mine); continue; }
    if (sMine.size === 0) { out.push(...theirs); continue; }
    if (contains(sMine, sTheirs)) { out.push(...mine); continue; } // incl. IDENTICAL sides
    if (contains(sTheirs, sMine)) { out.push(...theirs); continue; }
    if ([...sMine].some((l) => sTheirs.has(l))) return { conflict: diff3Text };
    out.push(...theirs, ...mine);
  }
  return { text: out.join('\n') };
}

/** Blob text at <rev>:<path>, or null when the path is absent there. */
function blobAt(repo, rev, file, env) {
  const r = gitTry(repo, ['cat-file', 'blob', `${rev}:${file}`], env);
  return r.ok ? gitRaw(repo, ['cat-file', 'blob', `${rev}:${file}`], env) : null;
}

/** True for content git would treat as binary — merge-file must not touch it. */
function looksBinary(text) {
  return text.includes('\0');
}

/**
 * The staged mode+sha for one path in a given index. `null` when absent (deleted).
 */
function indexEntry(repo, file, env) {
  const out = gitTry(repo, ['ls-files', '--stage', '--', file], env);
  if (!out.ok || !out.out) return null;
  const m = /^(\d{6}) ([0-9a-f]{40}) \d\t/.exec(out.out.split('\n')[0]);
  return m ? { mode: m[1], sha: m[2] } : null;
}

/**
 * Resolve a co-owned clobber for ONE path, three-way.
 *
 * @returns {null}                        nothing to do (not stale, or not mergeable material)
 *        | {merged:string, since:string, addedBack:number}   clean three-way merge
 *        | {conflict:string, since:string}                   genuinely overlapping — refuse
 */
function resolveCoowned({
  repo,
  privEnv,
  oldHead,
  file,
  depth = COOWNED_SCAN_DEPTH,
  derivedExempt = true,
  evidenceMustSurviveInHead = true,
  duplicationPostCondition = true,
  addAddContentRule = true,
}) {
  const headBlob = blobAt(repo, oldHead, file);
  if (headBlob === null) return null; // new file — nobody to clobber
  const mineEntry = indexEntry(repo, file, privEnv);
  if (!mineEntry) return null; // deleted by me — a different decision, not this guard
  if (mineEntry.mode !== '100644' && mineEntry.mode !== '100755') return null;
  const mineBlob = gitRaw(repo, ['cat-file', 'blob', mineEntry.sha]);
  if (looksBinary(headBlob) || looksBinary(mineBlob)) return null;

  // LIMB B — exempt the machine-regenerated derived block, but ONLY when BOTH sides
  // are rendered item files. Asymmetric masking would be a structural difference
  // worth surfacing, not something to paper over.
  const mineSplit = derivedExempt ? splitDerived(mineBlob) : null;
  const headSplit = derivedExempt ? splitDerived(headBlob) : null;
  const exempting = mineSplit !== null && headSplit !== null;
  const mask = exempting ? maskDerived : (t) => t;

  const log = gitTry(repo, ['log', `--max-count=${depth}`, '--format=%H', oldHead, '--', file]);
  if (!log.ok) return null;
  const history = [];
  for (const sha of lines(log.out)) {
    const text = blobAt(repo, sha, file);
    if (text === null) continue;
    const parentText = blobAt(repo, `${sha}^`, file);
    history.push({ sha, text: mask(text), parentText: parentText === null ? null : mask(parentText) });
  }

  const stale = coownedStaleAgainst({
    headText: mask(headBlob),
    mineText: mask(mineBlob),
    history,
    evidenceMustSurviveInHead,
  });
  if (!stale) return null;

  const rawBase = blobAt(repo, `${stale.sha}^`, file);
  const baseText = rawBase === null ? null : mask(rawBase);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-merge-'));
  try {
    const w = (n, t) => {
      const f = path.join(dir, n);
      fs.writeFileSync(f, t);
      return f;
    };
    const res = spawnSync(
      'git',
      [
        '-C', repo, 'merge-file', '-p', '--diff3',
        '-L', `${file} (MINE)`,
        '-L', `${file} (common base ${stale.sha.slice(0, 8)}^)`,
        '-L', `${file} (HEAD — concurrent agent)`,
        w('mine', mask(mineBlob)), w('base', baseText === null ? '' : baseText), w('head', mask(headBlob)),
      ],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    if (res.status !== 0 && res.stdout === '')
      return { conflict: res.stderr || '(git merge-file gave no output)', since: stale.sha };
    const resolved =
      res.status === 0
        ? { text: res.stdout }
        : resolveAppendCollisions(res.stdout, { contentRule: addAddContentRule });
    if (resolved.conflict) return { conflict: resolved.conflict, since: stale.sha };

    // THE DUPLICATION POST-CONDITION (AC-142.4) — checked on the MASKED texts the
    // merge actually operated on, and BEFORE anything is written. `merge-file` can
    // also duplicate at status 0, with no conflict markers for the hunk resolver to
    // see, so this cannot live inside `resolveAppendCollisions`.
    if (duplicationPostCondition) {
      const dup = duplicatedBeyondBothSides({
        baseText,
        mineText: mask(mineBlob),
        headText: mask(headBlob),
        mergedText: resolved.text,
      });
      if (dup.length > 0)
        return {
          conflict: [
            `DUPLICATION POST-CONDITION: the three-way merge against base ${stale.sha.slice(0, 8)}^ would`,
            `emit ${dup.length} line(s) MORE OFTEN than either side had them — that is not a merge, it is a`,
            'duplication, and it is how e3ea51f9/f64a13fa put a second copy of a 22 KB region into trunk',
            'at exit 0. The base does not describe either side. First few offenders:',
            ...dup.slice(0, 12).map((l) => `    ${l}`),
          ].join('\n'),
          since: stale.sha,
          duplicated: dup,
        };
    }

    // Put MY derived block back — it is a recomputation, not a contribution.
    let finalText = resolved.text;
    if (exempting) {
      const spliced = spliceDerived(finalText, mineSplit.derived);
      if (spliced.error)
        return { conflict: `DERIVED-BLOCK SPLICE: ${spliced.error}`, since: stale.sha };
      finalText = spliced.text;
    }

    return {
      merged: finalText,
      since: stale.sha,
      addedBack: linesAdded(mineBlob, finalText).length,
      byteDelta: Buffer.byteLength(finalText) - Buffer.byteLength(mineBlob),
      derivedExempted: exempting,
      mode: mineEntry.mode,
      mineSha: mineEntry.sha,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
 * @param {boolean} [o.coownedMerge=true] three-way merge a concurrent agent's
 *                               committed lines back into a CO-OWNED file rather
 *                               than silently reverting them (limb A)
 * @param {boolean} [o.derivedExempt=true] exempt an item file's machine-regenerated
 *                               derived block from detection and merge (limb B)
 * @param {boolean} [o.staleEvidenceMustSurviveInHead=true] CONTROL toggle for the
 *                               base-selection fix (limb A). false reproduces the
 *                               historical selection and exists for the losing arm
 *                               of AC-142.2 — never set it in anger.
 * @param {boolean} [o.duplicationPostCondition=true] CONTROL toggle for AC-142.4.
 * @param {boolean} [o.addAddContentRule=true] CONTROL toggle for AC-142.3 — false
 *                               restores the historical position-only "keep both".
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
  coownedMerge = true,
  coownedScanDepth = COOWNED_SCAN_DEPTH,
  derivedExempt = true,
  staleEvidenceMustSurviveInHead = true,
  duplicationPostCondition = true,
  addAddContentRule = true,
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
    /** Reset on every CAS attempt — a retry recomputes the merge against the new head. */
    const coownedMerges = [];
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

      let tree = gitOut(repo, ['write-tree'], privEnv);

      // 3. the declared-subset assertion.
      let changed = oldHead
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

      // GUARD E — THE CO-OWNED APPEND-TARGET CLOBBER (exit 7 on conflict).
      //   Runs after the subset assertion, because it only ever rewrites a blob for
      //   a path that has ALREADY been proved to be one I declared. The merged
      //   result is committed instead of my stale blob, so the concurrent agent's
      //   committed lines survive MY commit — the loss AC-COOWNED.1 reproduces.
      coownedMerges.length = 0;
      if (coownedMerge && oldHead) {
        for (const file of changed) {
          const r = resolveCoowned({
            repo,
            privEnv,
            oldHead,
            file,
            depth: coownedScanDepth,
            derivedExempt,
            evidenceMustSurviveInHead: staleEvidenceMustSurviveInHead,
            duplicationPostCondition,
            addAddContentRule,
          });
          if (!r) continue;
          if (r.conflict)
            throw new IsolatedCommitError(
              7,
              [
                'CO-OWNED CONFLICT — nothing committed, HEAD unmoved.',
                `  file: ${file}`,
                `  a concurrent agent committed an OVERLAPPING change (since ${r.since.slice(0, 8)}) and your`,
                '  copy predates it, so committing yours would REVERT theirs. It cannot be merged',
                '  automatically. Take THEIR committed version, re-apply your block on top, and',
                '  commit again. The conflict:',
                r.conflict
                  .split('\n')
                  .slice(0, 40)
                  .map((l) => `    ${l}`)
                  .join('\n'),
              ].join('\n'),
            );
          const blob = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], {
            input: r.merged,
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
          }).trim();
          gitOut(repo, ['update-index', '--cacheinfo', `${r.mode},${blob},${file}`], privEnv);
          coownedMerges.push({
            path: file,
            since: r.since,
            linesRecovered: r.addedBack,
            byteDelta: r.byteDelta,
            derivedExempted: r.derivedExempted,
            merged: r.merged,
            mineSha: r.mineSha,
          });
        }
        if (coownedMerges.length > 0) {
          // The tree changed under us — rebuild it and RE-ASSERT the subset, because
          // an assertion that ran before the last mutation is not an assertion.
          tree = gitOut(repo, ['write-tree'], privEnv);
          const after = lines(
            gitOut(repo, ['diff-tree', '-r', '--no-commit-id', '--name-only', oldHead, tree]),
          );
          const escapedAfter = pathsOutsideDeclared(after, paths);
          if (escapedAfter.length > 0)
            throw new IsolatedCommitError(
              3,
              `DECLARED-SUBSET ASSERTION FIRED after the co-owned merge — nothing committed: ${escapedAfter.join(' ')}`,
            );
          changed = after;
        }
      }

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
      // 5a. LEAVE THE WORKING TREE HOLDING THE UNION. Without this the merge only
      //     DEFERS the clobber: the next agent's copy is still the stale one, and the
      //     file on disk no longer matches what was committed. Written atomically
      //     (temp + rename in the same directory) so a concurrent reader never sees a
      //     torn file, and only when the file on disk is still the blob we merged FROM
      //     — if another agent has written it since, theirs is the newer intent.
      for (const m of coownedMerges) {
        const abs = path.join(top.out, m.path);
        try {
          const nowSha = gitOut(repo, ['hash-object', '--', abs]);
          if (nowSha !== m.mineSha) {
            m.writtenBack = false;
            continue;
          }
          const tmp = `${abs}.isolated-merge-${process.pid}.tmp`;
          fs.writeFileSync(tmp, m.merged);
          fs.renameSync(tmp, abs);
          m.writtenBack = true;
        } catch {
          m.writtenBack = false;
        }
        delete m.merged;
      }

      if (syncIndex) {
        for (const p of paths) gitTry(repo, ['add', '--all', '--', normalizeDeclared(p)]);
      }

      return { sha, files: changed, attempts, branch, coownedMerges };
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
    coownedMerge: true,
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
    else if (a === '--no-coowned-merge') out.coownedMerge = false;
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

A CO-OWNED FILE (architecture/dependencies/class-deps.mmd, edge-ledger.md — append
targets shared by every item BY CONSTRUCTION) is the other half of the same problem,
and on a shared tree it is SILENT LOSS: your copy was read before the other agent
committed, so committing yours REVERTS their already-committed lines with exit 0 and
a clean log. Their lines are three-way merged back in and the merge is REPORTED; an
overlapping edit is refused (exit 7) rather than guessed at.

THE MERGE NEVER DUPLICATES (DEFECT-OAG-142). Staleness is only ever evidenced by
content HEAD STILL HAS; two identical sides are a no-op; and content novel to BOTH
sides may not leave the merge more often than it went in, or the commit is refused.
An item file's machine-written \`derived:\` block is a pure function of the event log
and the clock, so it is EXEMPT — yours is kept verbatim and \`wi-project\` reconciles it.
The report states the BYTE delta, because the line count is a set difference and is
blind to duplication.

  --allow-duplicate-message      commit a message identical to a recent ancestor's
  --allow-shared-message-file    accept a non-unique --message-file name
  --no-coowned-merge             commit MY blob verbatim over a co-owned file
                                 (reverts a concurrent agent's committed lines)`;

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
    // A merge that is not reported is a merge nobody audits — and this one changes
    // what lands relative to what the caller staged, so it is never silent.
    for (const m of res.coownedMerges || [])
      process.stderr.write(
        [
          `CO-OWNED MERGE — ${m.path}`,
          `  a concurrent agent committed to this file since ${m.since.slice(0, 8)}; your copy predated it.`,
          `  ${m.linesRecovered} line(s) of THEIRS were merged back in rather than reverted by your commit.`,
          // The line count is a SET difference and is therefore blind to duplication:
          // it said "16 line(s)" while 15 KB had been doubled into trunk. The byte
          // delta is the number that cannot lie about that (AC-142.8).
          `  size change vs your copy: ${m.byteDelta >= 0 ? '+' : ''}${m.byteDelta} byte(s).`,
          ...(m.derivedExempted
            ? ['  (the machine-regenerated DERIVED block was exempt; yours was kept verbatim)']
            : []),
          m.writtenBack === false
            ? '  (the working-tree copy was NOT rewritten — it changed again while this commit ran)'
            : '  (the working tree now holds the union, so the next agent is not stale)',
          '',
        ].join('\n'),
      );
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
  contentLines,
  linesAdded,
  coownedStaleAgainst,
  resolveAppendCollisions,
  duplicatedBeyondBothSides,
  splitDerived,
  maskDerived,
  spliceDerived,
  DERIVED_SENTINEL_PREFIX,
  COOWNED_SCAN_DEPTH,
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
