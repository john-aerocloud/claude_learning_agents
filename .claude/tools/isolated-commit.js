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
 *   2  usage / precondition refused (detached HEAD, bad path, no message, an
 *      argument this tool does not define or a value that is plainly another
 *      option, a one-token message — DEF-ROC-248)
 *   3  DECLARED-SUBSET ASSERTION FIRED — the pathspec reached outside the paths
 *      you declared; nothing was committed
 *   4  nothing to commit for the declared paths (never an empty commit); names a
 *      .gitignore'd path when that is why
 *   5  the branch could not be advanced after N compare-and-swap attempts
 *   6  MESSAGE GUARD FIRED — the message is not provably the one you passed
 *      (crossed with a concurrent agent's, clobbered in its file, or corrupted
 *      between here and the commit object); nothing was committed
 *   7  CO-OWNED CONFLICT — a concurrent agent committed an OVERLAPPING change to a
 *      file you both own and it cannot be merged automatically; nothing committed.
 *      NEVER your own previous commit to that file. Exactly one commit's content
 *      missing, that commit naming the SAME work item, and the id not naming the
 *      path, is a CONTINUATION: it commits, and the decision is printed (DEF-ROC-189)
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
 * A MESSAGE THAT IS ONE BARE TOKEN (DEF-ROC-248). Every commit here is
 * `type(scope): intent` plus a work-item id (§14) — several words, always. One
 * token is never a message anybody wrote on purpose; it is what is left when a
 * CLI misread swallowed the real one, and it is the ONLY signal independent of
 * which misread it was. dd44e2f1's entire message is `x`.
 *
 * Deliberately not a bar: --allow-terse-message commits it anyway. A guard people
 * can satisfy with a lie is worse than one they can satisfy with an absence
 * (DEF-ROC-173), and an override that is visible in the command line is evidence,
 * where `xx yy` would be none.
 *
 * @returns {string|null} the refusal text, or null when the subject is a message.
 */
function terseMessageRefusal(message) {
  const subject = normalizeMessage(message).split('\n').find((l) => l.trim().length > 0) || '';
  if (/\s/.test(subject.trim())) return null;
  return [
    `THE COMMIT MESSAGE IS A SINGLE TOKEN (\`${subject.trim()}\`) — nothing was committed.`,
    'A commit message here is `type(scope): intent (WORK-ITEM-ID)`, which is several words. One',
    'token is what is left when a mistyped flag swallowed the real message: dd44e2f1 sits on',
    'trunk, pushed, with commits on top, and its entire message is `x`. Its author intended a',
    'real one, and the amend that would have repaired it was correctly refused as destructive —',
    'so a bad message is PERMANENT and this is the last point it can be stopped.',
    'Write the message, or say you meant it:  --allow-terse-message  (MSG_TERSE_OK=1)',
  ].join('\n');
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
 * A DECLARED SUPERSESSION IS NOT STALENESS (DEF-ROC-173). Everything above asks of
 * a line "is it ABSENT FROM MY COPY?", and the answer is the same whether I never saw
 * it or saw it and REPLACED it. DEF-ROC-189 could separate those only when the tip
 * commit was MINE under the SAME work item — the narrow case. On a co-owned file the
 * tip is usually ANOTHER item's, so the broad case was refused at exit 7 and the only
 * documented way past disabled the guard wholesale, on the very files with a measured
 * silent-loss history. The evidence a line-level diff cannot hold has to come from the
 * engineer: NAMING the lines is an assertion that HEAD was read and decided against,
 * and it is narrow BY CONSTRUCTION — a line not named is still evidence, so a
 * concurrent agent's row landing meanwhile still fires. `superseded` therefore only
 * ever REMOVES evidence, line by line; it can never add any, and it never touches
 * what a merge EMITS, which is why it cannot duplicate (the same argument that makes
 * DEF-ROC-189's discount safe).
 *
 * @param {boolean} [o.evidenceMustSurviveInHead=true] CONTROL toggle — false
 *        reproduces the historical (defective) selection, for the test's losing arm.
 * @param {Set<string>} [o.superseded] content lines the committer has DECLARED it
 *        removed deliberately. Validated against reality by the caller: a line that
 *        is not actually present in HEAD and absent from my copy is refused (exit 2),
 *        so the declaration cannot be written from memory.
 * @returns {{sha:string, added:string[]}|null} the OLDEST commit missing from my
 *          copy — its parent's blob is the merge base I actually started from.
 */
function coownedStaleAgainst({
  headText,
  mineText,
  history,
  evidenceMustSurviveInHead = true,
  superseded = new Set(),
}) {
  if (linesAdded(headText, mineText).length === 0) return null; // no novel content
  const mine = new Set(contentLines(mineText));
  const head = new Set(contentLines(headText));
  let oldest = null;
  for (const h of history) {
    if (h.parentText === null) continue; // created the path — see above
    const contributed = linesAdded(h.parentText, h.text);
    const surviving = evidenceMustSurviveInHead ? contributed.filter((l) => head.has(l)) : contributed;
    // DEF-ROC-173 — a line I DECLARED superseded is a decision, not an absence.
    const added = superseded.size === 0 ? surviving : surviving.filter((l) => !superseded.has(l));
    if (added.length === 0) continue; // nothing of it survives in HEAD, or all of it was decided against
    if (added.some((l) => mine.has(l))) continue; // I have some of it; not cleanly stale
    oldest = { sha: h.sha, added };
  }
  return oldest;
}

// --- WORK-ITEM CONTINUITY (DEF-ROC-189) --------------------------------------
//
// The staleness question above asks, of a line some commit added: "is it ABSENT
// FROM MY COPY?" That is ALSO TRUE OF AN ORDINARY EDIT TO THAT LINE. So an agent
// REPLACING a line IT ITSELF committed presents identically to an agent REVERTING
// a concurrent agent's work, and the tool refused at exit 7. Generalised by the
// DEF-ROC-206 engineer: it false-positives WHENEVER ONE AGENT COMMITS TWICE IN A
// ROW TO ONE FILE, which is a common shape, not an edge case. Four agents hit it in
// one day; two abandoned real changes rather than take the documented safety
// bypass, and one shipped a DUPLICATE "test:process" key into HEAD because the
// merge kept both sides of its own replaced line. A false-positive control does not
// cost minutes — it silently deters improvements nobody then records.
//
// FROM THE BLOBS ALONE THE TWO SITUATIONS ARE THE SAME FILE PAIR. Measured: with C
// the tip commit for the path,
//     I replace my own line   HEAD = base+L,  mine = base+L'
//     I revert a concurrent   HEAD = base+L,  mine = base+L'
// are byte-for-byte identical, so NO function of headText/mineText/history can
// separate them, and neither can "does HEAD still have it" (DEFECT-OAG-142's fix —
// it does, in both). Authorship cannot either: every agent on this tree commits
// under ONE git identity, so `%an` is constant and would read as "mine" for the
// concurrent case too — convenient, and unsound. The fix must therefore bring
// EVIDENCE FROM OUTSIDE THE BLOBS.
//
// THE EVIDENCE: the WORK ITEM the commit message names. §14 already requires every
// commit here to reference its tracked item, and the process allocates PATH CLAIMS
// PER ITEM (§F7) — two agents on one item touching one file is the collision the
// flow-manager exists to prevent. So "the tip commit for this path names the SAME
// work item as the commit I am making" is real evidence that the contribution is
// MINE, continued — not a second writer's.
//
// It is admitted under THREE conditions, every one of which FAILS CLOSED:
//
//   1. EXACT ACCOUNTING — the ONLY content of HEAD my copy lacks is PRECISELY that
//      one commit's surviving contribution. If my copy is also missing anything
//      else, it does not derive from HEAD-minus-one-commit and the reading is
//      wrong. This is what keeps the FOUNDING LOSS (four agents, four commits, one
//      of four rows surviving) out of reach of the discount entirely: staleness
//      spanning two commits can never qualify, whatever the messages say.
//   2. CONTINUITY — both messages carry a work-item id and the id SETS ARE EQUAL.
//      Set EQUALITY, not intersection, so an incidental hyphenated capital in prose
//      (CO-OWNED, ADD/ADD) cannot manufacture a match; and an id on neither side is
//      no evidence, so the guard holds exactly as before.
//   3. NOT-THE-SUBJECT — the id must not appear in the PATH. On an item file every
//      agent's message says UC-X because the FILE is UC-X; there the id names the
//      subject, not the author, and the evidence is void.
//
// WHAT IT CANNOT DO, which is the reason it is safe: it never changes what a merge
// EMITS. It either suppresses the merge entirely (committing my own blob, which is
// what a sole author replacing its own line always wanted) or it stands aside. So
// it cannot duplicate, and the only content it can drop is content attributed to my
// own item by all three conditions at once.
//
// RESIDUAL, stated rather than hidden: two agents genuinely sharing ONE work item
// id and ONE file, where the second's copy is exactly one commit stale, would be
// discounted instead of merged. That is the concurrency the per-item path claim
// forbids, and it was the price of making the common shape work at all — the
// alternative measured cost was engineers abandoning changes.

/** Hyphenated uppercase tokens — the work-item id family this repo uses
 *  (UC-ROC-119, DEF-ROC-189, DEFECT-OAG-142, REQ-ROC-001, VF-003, ITEM-A). */
const WORK_ITEM_ID_RE = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;

/** The work-item ids a commit message declares (§14 requires at least one). */
function workItemIds(message) {
  return new Set(String(message || '').match(WORK_ITEM_ID_RE) || []);
}

/**
 * The ids two messages agree on, or null. EQUALITY, not intersection: an
 * incidental hyphenated capital shared by both messages cannot then carry a match
 * that the real ids contradict.
 * @returns {string[]|null} the shared ids, sorted; null when they are not the same work.
 */
function sameWorkItem(a, b) {
  if (a.size === 0 || b.size === 0 || a.size !== b.size) return null;
  for (const id of a) if (!b.has(id)) return null;
  return [...a].sort();
}

/**
 * Is the selected staleness evidence MY OWN PREVIOUS COMMIT, continuing the same
 * work item? All three conditions above, in cost order, each failing closed.
 * @returns {{ids:string[], accounted:string[]}|null}
 */
function ownWorkItemContinuation({ file, headText, mineText, stale, myMessage, theirMessage }) {
  // 1. EXACT ACCOUNTING. `stale.added` is, by selection, in HEAD and absent from
  //    mine, so it is always a SUBSET of what my copy is missing; the question is
  //    whether it is the WHOLE of it.
  const missing = linesAdded(mineText, headText);
  if (missing.length === 0) return null;
  const evidence = new Set(stale.added);
  if (missing.some((l) => !evidence.has(l))) return null;

  // 2. CONTINUITY.
  const ids = sameWorkItem(workItemIds(myMessage), workItemIds(theirMessage));
  if (!ids) return null;

  // 3. NOT-THE-SUBJECT.
  const f = normalizeDeclared(file);
  if (ids.some((id) => f.includes(id))) return null;

  return { ids, accounted: missing };
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

// A git output can be a WHOLE FILE — `show HEAD:<path>`, `diff`, `cat-file` — and
// execFileSync's default maxBuffer is 1 MB, so any declared path bigger than that failed
// the commit with a bare `spawnSync git ENOBUFS` and no clue which call blew up. Hit for
// real on 2026-08-27 committing a 4.4 MB reference asset: the prescribed commit path simply
// could not commit a large file. Same ceiling as the two call sites below that already set
// it; the merge path was raised, the plumbing path was not.
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

function gitOut(repo, args, env) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: GIT_MAX_BUFFER,
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
    maxBuffer: GIT_MAX_BUFFER,
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
 *        | {ownItem:{ids,accounted}, since:string}           MY OWN previous commit,
 *                                          same work item — not a concurrent writer;
 *                                          commit my blob, merge nothing (DEF-ROC-189)
 */
/**
 * THE TWO SIDES OF ONE CO-OWNED PATH, and the mask that makes them comparable.
 * Extracted so every reader of "what does HEAD have that my copy does not" answers
 * it from the SAME texts the merge operates on — a second derivation of the same
 * fact is how two readers come to disagree (EXP-047).
 *
 * @returns {null} when the path is not mergeable material at all (new here, deleted
 *          by me, not a regular file, binary) — the cases the guard never governs
 *        | {headBlob, mineBlob, mineEntry, mineSplit, exempting, mask}
 */
function coownedTexts({ repo, privEnv, oldHead, file, derivedExempt = true }) {
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
  return { headBlob, mineBlob, mineEntry, mineSplit, exempting, mask };
}

function resolveCoowned({
  repo,
  privEnv,
  oldHead,
  file,
  message = null,
  depth = COOWNED_SCAN_DEPTH,
  derivedExempt = true,
  evidenceMustSurviveInHead = true,
  duplicationPostCondition = true,
  addAddContentRule = true,
  ownItemContinuity = true,
  superseded = new Set(),
}) {
  const sides = coownedTexts({ repo, privEnv, oldHead, file, derivedExempt });
  if (sides === null) return null;
  const { headBlob, mineBlob, mineEntry, mineSplit, exempting, mask } = sides;

  const log = gitTry(repo, ['log', `--max-count=${depth}`, '--format=%H', oldHead, '--', file]);
  if (!log.ok) return null;
  const history = [];
  for (const sha of lines(log.out)) {
    const text = blobAt(repo, sha, file);
    if (text === null) continue;
    const parentText = blobAt(repo, `${sha}^`, file);
    history.push({ sha, text: mask(text), parentText: parentText === null ? null : mask(parentText) });
  }

  const missing = linesAdded(mask(mineBlob), mask(headBlob));

  const stale = coownedStaleAgainst({
    headText: mask(headBlob),
    mineText: mask(mineBlob),
    history,
    evidenceMustSurviveInHead,
    superseded,
  });
  if (!stale) return null;

  // DEF-ROC-189 — before treating this as a concurrent writer, ask whether it is MY
  // OWN previous commit continuing the same work item. This can only ever SUPPRESS
  // a merge; it never changes what a merge emits, so it cannot duplicate.
  if (ownItemContinuity) {
    const own = ownWorkItemContinuation({
      file,
      headText: mask(headBlob),
      mineText: mask(mineBlob),
      stale,
      myMessage: message,
      theirMessage: commitObjectMessage(repo, stale.sha),
    });
    if (own) return { ownItem: own, since: stale.sha };
  }

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
      return { conflict: res.stderr || '(git merge-file gave no output)', since: stale.sha, missing };
    const resolved =
      res.status === 0
        ? { text: res.stdout }
        : resolveAppendCollisions(res.stdout, { contentRule: addAddContentRule });
    if (resolved.conflict) return { conflict: resolved.conflict, since: stale.sha, missing };

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
          missing,
        };
    }

    // Put MY derived block back — it is a recomputation, not a contribution.
    let finalText = resolved.text;
    if (exempting) {
      const spliced = spliceDerived(finalText, mineSplit.derived);
      if (spliced.error)
        return { conflict: `DERIVED-BLOCK SPLICE: ${spliced.error}`, since: stale.sha, missing };
      finalText = spliced.text;
    }

    // AC-189-4 — the RESTORED lines, not just how many. The old report could not
    // mention a restored NON-NOVEL line at all (`addedBack` is a set-difference
    // COUNT), which is why the duplicate `test:process` key was caught only by a
    // human re-reading HEAD. A control whose report cannot name its own effect is
    // the shape this repo keeps rediscovering.
    const restored = linesAdded(mineBlob, finalText);
    return {
      merged: finalText,
      since: stale.sha,
      addedBack: restored.length,
      restored,
      missing,
      // DEF-ROC-173 — evidence remained beyond what was declared, so the merge ran
      // anyway and may have put a DECLARED-superseded line back. That is the safe
      // direction (content restored, never lost) but it un-does a decision, so it is
      // named rather than left for a human to find by re-reading HEAD.
      restoredDespiteDeclaration: restored.filter((l) => superseded.has(l)),
      byteDelta: Buffer.byteLength(finalText) - Buffer.byteLength(mineBlob),
      derivedExempted: exempting,
      mode: mineEntry.mode,
      mineSha: mineEntry.sha,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * THE REVIEW LIST (DEF-ROC-173): what HEAD carries that MY staged copy does not,
 * per path. It is the exact set a supersession declaration may draw from, and the
 * reason the declaration cannot be written from memory — the tool prints it
 * (`--print-coowned-missing`), the engineer DELETES from it every line it did not
 * decide against, and what is left is the assertion.
 *
 * Derived from `coownedTexts`, i.e. from the same masked texts the merge itself
 * operates on, so the list an engineer reviews and the evidence the guard weighs
 * cannot be two different derivations of one fact (EXP-047).
 *
 * @returns {Map<string, string[]>} path -> the content lines of HEAD my copy lacks.
 */
function coownedMissingByPath({ repo, privEnv, oldHead, files, derivedExempt = true }) {
  const out = new Map();
  for (const file of files) {
    const sides = coownedTexts({ repo, privEnv, oldHead, file, derivedExempt });
    if (sides === null) continue;
    const missing = linesAdded(sides.mask(sides.mineBlob), sides.mask(sides.headBlob));
    if (missing.length > 0) out.set(file, missing);
  }
  return out;
}

/**
 * Check a supersession declaration against reality, and scope it per path.
 *
 * FAILS CLOSED, and this is the limb that keeps the affordance honest: a declared
 * line must ACTUALLY be one HEAD carries and my copy does not. So a declaration can
 * only ever be written from a real, current removal — not from memory, not
 * speculatively, and not as a standing "ignore this file" incantation. A line is
 * honoured only for the paths where it genuinely went missing, so declaring a line
 * for one file cannot quietly excuse an identical line in another.
 *
 * @returns {{honoured: Map<string, Set<string>>, unmatched: string[]}}
 */
function scopeSupersession({ declared, missingByPath }) {
  const honoured = new Map();
  const unmatched = new Set(declared);
  for (const [file, missing] of missingByPath) {
    const hit = declared.filter((l) => missing.includes(l));
    if (hit.length === 0) continue;
    honoured.set(file, new Set(hit));
    for (const l of hit) unmatched.delete(l);
  }
  return { honoured, unmatched: [...unmatched] };
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
 * @param {string[]|Set<string>} [o.superseded] DEF-ROC-173: content lines of HEAD
 *                               this commit removes DELIBERATELY. A narrow, checked
 *                               assertion — "I read HEAD and decided against exactly
 *                               these" — where the only previous move was to disable
 *                               the co-owned merge wholesale. Everything NOT named
 *                               stays guarded.
 * @param {boolean} [o.ownItemContinuity=true] DEF-ROC-189: do not read MY OWN
 *                               previous commit to this path, under the SAME work
 *                               item, as a concurrent writer. CONTROL toggle —
 *                               false reproduces the false positive that deterred
 *                               four agents' changes in one day.
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
  allowTerseMessage = false,
  dupScanDepth = DUP_SCAN_DEPTH,
  coownedMerge = true,
  coownedScanDepth = COOWNED_SCAN_DEPTH,
  derivedExempt = true,
  staleEvidenceMustSurviveInHead = true,
  duplicationPostCondition = true,
  addAddContentRule = true,
  ownItemContinuity = true,
  superseded = [],
  syncIndex = true,
  hooks = {},
}) {
  if (!repo) throw new IsolatedCommitError(2, '--repo is required');
  if (!message || !String(message).trim()) throw new IsolatedCommitError(2, '--message is required');

  // DEF-ROC-248 — the outcome guard, independent of which CLI misread produced it.
  if (!allowTerseMessage) {
    const terse = terseMessageRefusal(message);
    if (terse) throw new IsolatedCommitError(2, terse);
  }

  // GUARD B — a message-file name that is not unique BY CONSTRUCTION is refused
  // before anything else happens, because the clobber it enables is silent and the
  // victim cannot detect it afterwards.
  if (messageFile && !allowSharedMessageFile) {
    const refusal = sharedMessageFileRefusal(messageFile);
    if (refusal) throw new IsolatedCommitError(2, refusal);
  }
  if (!paths || paths.length === 0)
    throw new IsolatedCommitError(2, 'at least one declared path is required (after `--`)');

  // DEF-ROC-173 — one line per entry, trimmed, blanks dropped: exactly the unit the
  // staleness question is asked in, so a declaration means the same thing the guard means.
  const declaredSuperseded = contentLines([...superseded].join('\n'));
  if (declaredSuperseded.length > 0 && !coownedMerge)
    throw new IsolatedCommitError(
      2,
      [
        'A SUPERSESSION DECLARATION AND --no-coowned-merge ARE CONTRADICTORY — nothing committed.',
        'The declaration is the NARROW move: it excuses the lines you name and leaves everything',
        'else guarded. --no-coowned-merge is the WHOLESALE one: it excuses everything, including a',
        'concurrent agent\'s row you have never seen. Asking for both says you do not know which',
        'you meant. Drop one.',
      ].join('\n'),
    );

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
    /** Evidence discounted as MY OWN previous commit (DEF-ROC-189) — reported, never silent. */
    const coownedContinuations = [];
    /** Evidence the committer DECLARED superseded (DEF-ROC-173) — reported, never silent. */
    const coownedSupersessions = [];
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
      coownedContinuations.length = 0;
      coownedSupersessions.length = 0;
      // DEF-ROC-173 — CHECK THE DECLARATION AGAINST REALITY FIRST. Recomputed on every
      // CAS attempt, because a line that was genuinely missing a moment ago may have
      // been superseded in HEAD by the commit that just beat us.
      let honouredSupersessions = new Map();
      if (declaredSuperseded.length > 0) {
        const missingByPath = oldHead
          ? coownedMissingByPath({ repo, privEnv, oldHead, files: changed, derivedExempt })
          : new Map();
        const scoped = scopeSupersession({ declared: declaredSuperseded, missingByPath });
        if (scoped.unmatched.length > 0)
          throw new IsolatedCommitError(
            2,
            [
              'SUPERSESSION DECLARATION REFUSED — nothing committed.',
              'You declared these lines superseded, but HEAD does not carry them where your copy',
              'lacks them, so they are not removals you are making:',
              ...scoped.unmatched.slice(0, 12).map((l) => `  ${l.slice(0, 200)}`),
              ...(scoped.unmatched.length > 12 ? [`  … and ${scoped.unmatched.length - 12} more`] : []),
              'A declaration is an assertion about a REAL, CURRENT removal — it is checked so it',
              'cannot be written from memory. Take the review list from the tool and delete from it',
              'every line you did NOT decide against:',
              `  node .claude/tools/isolated-commit.js --repo ${repo} --print-coowned-missing -- ${paths.join(' ')}`,
            ].join('\n'),
          );
        honouredSupersessions = scoped.honoured;
      }
      if (coownedMerge && oldHead) {
        for (const file of changed) {
          const declaredHere = honouredSupersessions.get(file) || new Set();
          const r = resolveCoowned({
            repo,
            privEnv,
            oldHead,
            file,
            message,
            depth: coownedScanDepth,
            derivedExempt,
            evidenceMustSurviveInHead: staleEvidenceMustSurviveInHead,
            duplicationPostCondition,
            addAddContentRule,
            ownItemContinuity,
            superseded: declaredHere,
          });
          if (declaredHere.size > 0)
            coownedSupersessions.push({
              path: file,
              lines: [...declaredHere],
              stoodDown: r === null,
              restoredDespiteDeclaration: (r && r.restoredDespiteDeclaration) || [],
            });
          if (!r) continue;
          if (r.ownItem) {
            // MY OWN previous commit, same work item: nothing to merge, my blob
            // stands. Recorded so the decision is auditable — a control that acts
            // silently is one nobody can challenge when it is wrong.
            coownedContinuations.push({
              path: file,
              since: r.since,
              ids: r.ownItem.ids,
              accounted: r.ownItem.accounted,
            });
            continue;
          }
          if (r.conflict)
            throw new IsolatedCommitError(
              7,
              [
                'CO-OWNED CONFLICT — nothing committed, HEAD unmoved.',
                `  file: ${file}`,
                `  a concurrent agent committed an OVERLAPPING change (since ${r.since.slice(0, 8)}) and your`,
                '  copy predates it, so committing yours would REVERT theirs. It cannot be merged',
                '  automatically. Take THEIR committed version, re-apply your block on top, and',
                '  commit again.',
                // DEF-ROC-173 — NAME THE LINES. The refusal is right about the FACTS and may
                // be wrong about their MEANING, and a reader cannot tell which without seeing
                // what is actually at stake. Three parties were blocked by this refusal in one
                // day and the only move it offered any of them was the wholesale switch.
                ...(r.missing && r.missing.length > 0
                  ? [
                      `  THE ${r.missing.length} LINE(S) OF HEAD YOUR COPY DOES NOT CARRY:`,
                      ...r.missing.slice(0, 12).map((l) => `    ${l.slice(0, 200)}${l.length > 200 ? ' …' : ''}`),
                      ...(r.missing.length > 12 ? [`    … and ${r.missing.length - 12} more`] : []),
                      '  IF — AND ONLY IF — YOU READ HEAD AND DELIBERATELY REPLACED OR REMOVED THEM, say so',
                      '  about THOSE LINES rather than switching the guard off (DEF-ROC-173):',
                      `    node .claude/tools/isolated-commit.js --repo ${repo} --print-coowned-missing -- ${paths.join(' ')} > S`,
                      '    # DELETE from S every line you did NOT decide against — what is left is your assertion',
                      '    make commit-isolated REPO=… MSG_FILE=… SUPERSEDE_FILE=S PATHS=…',
                      '  Anything you leave out of S stays guarded, which is the whole difference from',
                      '  COOWNED_MERGE_OFF=1 — that one excuses every line in the file, including one you',
                      '  have never seen.',
                    ]
                  : []),
                '  The conflict:',
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
            restored: r.restored,
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

      return {
        sha,
        files: changed,
        attempts,
        branch,
        coownedMerges,
        coownedContinuations,
        coownedSupersessions,
      };
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- CLI ---------------------------------------------------------------------

/** Thrown inside parseArgv so a refusal can be raised from a nested helper and
 *  still leave the function returning `{error}` like every other caller expects. */
class ArgvError extends Error {}

/** Every option that CONSUMES the token after it. Data, so "and what if the value
 *  is missing, or is itself an option?" is answered once (DEF-ROC-248). */
const VALUE_OPTIONS = ['--repo', '--message', '-m', '--message-file', '-F', '--supersede-file', '--supersede'];

/** Options that may be given at most ONCE. `--supersede`/`--supersede-file` are
 *  repeatable by design (a declaration is a list of lines). */
const SINGLE_SHOT_OPTIONS = ['--repo', '--message', '-m', '--message-file', '-F'];

/** Looks like an option rather than a value: a leading dash and a letter. Bare `-`
 *  and a negative number are values. */
function looksLikeOption(tok) {
  return /^--?[A-Za-z]/.test(String(tok));
}

/**
 * ARGUMENT HYGIENE (DEF-ROC-248). An argument this tool does not define, a value
 * that is plainly another option, a value that is not there at all, and a SECOND
 * source for a fact that can only have one are all instructions the caller meant
 * something by. The historical parser absorbed each of them silently:
 *
 *   --message --json          committed with the message `--json`
 *   --repo <end of argv>      `not a git repository: undefined`
 *   -- src/f.ts --json        `--json` silently declared as a PATH
 *   --message-file P --message x   the authored message read, then thrown away
 *
 * dd44e2f1 is what that costs: a commit on trunk, pushed, with commits on top,
 * whose entire message is `x`, made by an agent that intended a real one. The
 * message cannot be repaired — the amend was correctly refused as destructive — so
 * the only place this class can be stopped is here, before the commit exists.
 *
 * `hygiene: false` reproduces the historical rule and exists for the tests' losing
 * arm (AC-248.1/.3/.5). It is not reachable from the CLI: there is no legitimate
 * reason to ask this tool to misread you.
 */
function parseArgv(argv, { hygiene = true } = {}) {
  try {
    return parseArgvOrThrow(argv, { hygiene });
  } catch (e) {
    if (e instanceof ArgvError) return { error: e.message };
    throw e;
  }
}

function parseArgvOrThrow(argv, { hygiene = true }) {
  const out = {
    repo: null,
    message: null,
    messageFile: null,
    paths: [],
    syncIndex: true,
    json: false,
    allowDuplicateMessage: false,
    allowSharedMessageFile: false,
    allowTerseMessage: false,
    coownedMerge: true,
    mintMessageFile: false,
    superseded: [],
    printCoownedMissing: false,
  };
  let i = 0;
  const seen = new Set();
  /**
   * CONSUME THE FOLLOWING ARGV TOKEN as `name`'s value. One named place, because
   * five call sites each writing `argv[++i]` is five independent answers to
   * "and what if there is no value, or the value is itself an option?" — and the
   * answer they all gave was to take it silently (DEF-ROC-248).
   *
   * @param {boolean} [o.valueMayLookLikeOption] `--supersede` only: a content line
   *        of real source or markdown can legitimately begin with `-`, and refusing
   *        it would make the narrow DEF-ROC-173 move unusable on the very files it
   *        exists for.
   */
  const takeValue = (name, { valueMayLookLikeOption = false } = {}) => {
    i += 1;
    const v = argv[i];
    if (!hygiene) return v;
    if (v === undefined)
      throw new ArgvError(
        `${name} was given NO VALUE — the command line ended. Nothing was committed.`,
      );
    if (!valueMayLookLikeOption && looksLikeOption(v))
      throw new ArgvError(
        [
          `${name} was given \`${v}\`, which is an OPTION, not a value — nothing was committed.`,
          'This tool will not guess. If that really is your value, pass it through a file:',
          '  P=$(make -s commit-msg-file); printf %s "<your value>" > "$P"',
          '  make commit-isolated REPO=<dir> MSG_FILE="$P" PATHS="<paths>"',
          'Absorbing a mistyped instruction is how dd44e2f1 reached trunk with the message `x`.',
        ].join('\n'),
      );
    return v;
  };
  /** A fact with ONE value may be stated ONCE. Last-wins silently discarded an
   *  authored message in favour of a stray `--message x` (DEF-ROC-248). */
  const claim = (name) => {
    if (!hygiene) return;
    const family = name === '--message' || name === '-m' || name === '--message-file' || name === '-F'
      ? 'the commit message'
      : name;
    for (const prior of seen) {
      const priorFamily = prior === '--message' || prior === '-m' || prior === '--message-file' || prior === '-F'
        ? 'the commit message'
        : prior;
      if (priorFamily !== family) continue;
      throw new ArgvError(
        [
          `TWO SOURCES FOR ${family.toUpperCase()} — \`${prior}\` and \`${name}\` — nothing was committed.`,
          'One of them would silently win and the other would be read and thrown away, which is',
          'exactly how an authored message becomes a stray one (DEF-ROC-248). Say it once.',
        ].join('\n'),
      );
    }
    seen.add(name);
  };
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      out.paths = argv.slice(i + 1);
      // EVERYTHING AFTER `--` IS A DECLARED PATH, so an option written there is not
      // an option at all — it is a path nobody owns, and the historical parser took
      // it without a word (AC-248.3).
      const strayOptions = hygiene ? out.paths.filter(looksLikeOption) : [];
      if (strayOptions.length > 0)
        throw new ArgvError(
          [
            `${strayOptions.join(', ')} appears AFTER \`--\`, where every token is a declared PATH — nothing was committed.`,
            'Options go BEFORE the `--`; after it, this tool would have declared them as files',
            'you own, silently, and committed whatever else you passed.',
          ].join('\n'),
        );
      break;
    } else if (a === '--repo') { claim(a); out.repo = takeValue(a); }
    else if (a === '--message' || a === '-m') { claim(a); out.message = takeValue(a); }
    // --message-file / -F: the ONLY route a commit message cannot be corrupted on
    // (OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT). A message on a command line crosses
    // make's expansion and then a shell double-quoted string: `$` is expanded away, a
    // backtick is EXECUTED (the macOS `open` binary really ran and the word vanished
    // from a committed message), and a `"` refuses the commit outright with
    // `unexpected EOF while looking for matching '"'`. A PATH has no metacharacters.
    // Same reason `git commit -F` exists.
    else if (a === '--message-file' || a === '-F') {
      claim(a);
      const p = takeValue(a);
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
    // DEF-ROC-173 — the NARROW alternative to --no-coowned-merge. A FILE is the
    // primary form for the same reason --message-file is: a line of real source can
    // carry `$`, a backtick or a quote, and a shell would eat or EXECUTE it.
    else if (a === '--supersede-file') {
      const f = takeValue(a);
      try {
        out.superseded.push(...require('fs').readFileSync(f, 'utf-8').split('\n'));
      } catch (e) {
        return { error: `cannot read --supersede-file ${f}: ${e.message}` };
      }
    } else if (a === '--supersede') out.superseded.push(takeValue(a, { valueMayLookLikeOption: true }));
    else if (a === '--print-coowned-missing') out.printCoownedMissing = true;
    else if (a === '--allow-duplicate-message') out.allowDuplicateMessage = true;
    else if (a === '--allow-shared-message-file') out.allowSharedMessageFile = true;
    else if (a === '--allow-terse-message') out.allowTerseMessage = true;
    else if (a === '--no-sync-index') out.syncIndex = false;
    else if (a === '--no-coowned-merge') out.coownedMerge = false;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (hygiene && /^--?[A-Za-z][^=]*=/.test(a) && VALUE_OPTIONS.includes(a.slice(0, a.indexOf('='))))
      throw new ArgvError(
        [
          `${a.slice(0, a.indexOf('='))} does not take the \`=\` form — nothing was committed.`,
          `Write it as two tokens:  ${a.slice(0, a.indexOf('='))} <value>`,
          'Named rather than refused as an opaque "unknown argument", because a caller who',
          'cannot see WHICH HALF was wrong retypes the same thing (DEF-ROC-248).',
        ].join('\n'),
      );
    else throw new ArgvError(`unknown argument: ${a}`);
  }
  return out;
}

const USAGE = `usage: node .claude/tools/isolated-commit.js --repo <dir> (--message <msg> | --message-file <path>) [--supersede-file <path>] [--no-sync-index] [--json] -- <path>...
       node .claude/tools/isolated-commit.js --mint-message-file [-- <path>...]
       node .claude/tools/isolated-commit.js --repo <dir> --print-coowned-missing -- <path>...

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
The report states the BYTE delta and NAMES the lines it restored, because the line
count is a set difference and is blind to duplication.

AND REPLACING A LINE YOU COMMITTED YOURSELF IS NOT A CONCURRENT REVERT (DEF-ROC-189).
"absent from your copy" is equally true of an ordinary edit, so committing twice in a
row to one file used to be refused at exit 7 — four agents hit it in one day and two
abandoned real changes rather than take the bypass. The guard now stands down when
the ONLY content of HEAD your copy lacks is exactly one commit's surviving
contribution AND that commit's message names the SAME WORK ITEM as yours AND the id
does not name the path. Any of those missing, it refuses as before; the decision is
always printed. So keep the work-item id in your message (§14) — it is evidence now,
not decoration.

AND SUPERSEDING A COMMITTED LINE IS NOT BEING STALE AGAINST IT (DEF-ROC-173). The two
are the same file pair, so replacing a line ANOTHER item's commit added was refused at
exit 7 — three parties hit it in one day and the only documented way past,
COOWNED_MERGE_OFF=1, disables the guard WHOLESALE on the exact files with a measured
silent-loss history. A guard people learn to switch off is worth less than its running
cost. So NAME THE LINES instead:

  node .claude/tools/isolated-commit.js --repo R --print-coowned-missing -- <paths> > S
  # DELETE from S every line you did NOT decide against; what is left is your assertion
  make commit-isolated REPO=R MSG_FILE="$P" SUPERSEDE_FILE=S PATHS="<paths>"

Every declared line is CHECKED against reality — it must be one HEAD carries that your
copy does not, or the commit is refused (exit 2) — so a declaration cannot be written
from memory. Anything you do NOT name stays guarded, which is the whole difference from
the wholesale switch: a concurrent agent's row landing meanwhile still refuses. The
declaration only ever REMOVES evidence, never changes what a merge emits, so it cannot
duplicate. It is REPORTED on every commit that uses one.

  --supersede-file <path>        lines of HEAD this commit removes DELIBERATELY
  --supersede <line>             the same, one line at a time (prefer the file: a
                                 line of source can carry a shell metacharacter)
  --print-coowned-missing        print the review list and exit; commits nothing
  --allow-duplicate-message      commit a message identical to a recent ancestor's
  --allow-terse-message          commit a message that is a single bare token
  --allow-shared-message-file    accept a non-unique --message-file name
  --no-coowned-merge             commit MY blob verbatim over a co-owned file
                                 (reverts a concurrent agent's committed lines) — the
                                 BLUNT last resort; --supersede-file is the narrow one`;

/**
 * THE REVIEW-LIST MODE (DEF-ROC-173, `--print-coowned-missing`). Builds the same
 * private index a commit would, and prints the lines of HEAD your staged copy does
 * not carry — one per line, nothing else, so it can be redirected straight to a file
 * and EDITED DOWN. Reading it is how "did you see this line?" gets an answer; deleting
 * from it is how "and did you decide against it?" gets one.
 *
 * Commits nothing and moves nothing. Exit 4 when there is nothing missing, because
 * "no review list" is a different answer from "an empty declaration is fine".
 */
function printCoownedMissing({ repo, paths, derivedExempt = true }) {
  if (!repo) throw new IsolatedCommitError(2, '--repo is required');
  if (!paths || paths.length === 0)
    throw new IsolatedCommitError(2, 'at least one declared path is required (after `--`)');
  for (const q of paths) {
    const bad = validateDeclaredPath(q);
    if (bad) throw new IsolatedCommitError(2, bad);
  }
  const headRes = gitTry(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!headRes.ok || !headRes.out) throw new IsolatedCommitError(4, 'no HEAD — nothing can be missing from it');
  const oldHead = headRes.out;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-review-'));
  const privEnv = { GIT_INDEX_FILE: path.join(tmpDir, 'index') };
  try {
    gitOut(repo, ['read-tree', oldHead], privEnv);
    for (const q of paths) gitOut(repo, ['add', '--all', '--', normalizeDeclared(q)], privEnv);
    const tree = gitOut(repo, ['write-tree'], privEnv);
    const changed = lines(
      gitOut(repo, ['diff-tree', '-r', '--no-commit-id', '--name-only', oldHead, tree]),
    );
    const byPath = coownedMissingByPath({ repo, privEnv, oldHead, files: changed, derivedExempt });
    const out = [];
    for (const [, missing] of byPath) for (const l of missing) if (!out.includes(l)) out.push(l);
    if (out.length === 0)
      throw new IsolatedCommitError(4, 'nothing of HEAD is missing from your copy of the declared paths — there is nothing to declare.');
    return out;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * The CO-OWNED MERGE report. Extracted so every report limb is in one place and a
 * new one cannot be added to half of them.
 */
function formatCoownedMerge(m) {
  return [
    `CO-OWNED MERGE — ${m.path}`,
    `  a concurrent agent committed to this file since ${m.since.slice(0, 8)}; your copy predated it.`,
    `  ${m.linesRecovered} line(s) of THEIRS were merged back in rather than reverted by your commit.`,
    // AC-189-4 — NAME them. The count is a set difference and could not mention a
    // restored line that was not novel, so a line the committer had deliberately
    // REPLACED came back into HEAD with a reassuring report and a green suite.
    ...(m.restored && m.restored.length > 0
      ? [
          '  restored into your copy:',
          ...m.restored.slice(0, 12).map((l) => `    ${l}`),
          ...(m.restored.length > 12 ? [`    … and ${m.restored.length - 12} more`] : []),
          '  If you deliberately REPLACED any of those, re-read HEAD: your replacement and',
          '  theirs are now BOTH in the file (this left a duplicate JSON key in trunk once).',
        ]
      : []),
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
  ].join('\n');
}

/**
 * The WORK-ITEM CONTINUITY report (DEF-ROC-189). A guard that stands DOWN silently
 * is as unauditable as one that acts silently: say which commit was discounted, on
 * what evidence, and what content the decision accounts for.
 */
function formatCoownedContinuation(c) {
  return [
    `WORK-ITEM CONTINUITY — ${c.path}`,
    `  ${c.since.slice(0, 8)} is the only commit whose content your copy lacks, and its message names`,
    `  the SAME work item as yours (${c.ids.join(', ')}). Read as YOUR OWN previous commit, not a`,
    '  concurrent writer, so your blob is committed as-is and nothing is merged back.',
    `  ${c.accounted.length} line(s) of ${c.since.slice(0, 8)} are replaced by this commit:`,
    ...c.accounted.slice(0, 8).map((l) => `    ${l}`),
    ...(c.accounted.length > 8 ? [`    … and ${c.accounted.length - 8} more`] : []),
    '  If that commit was NOT yours, STOP: re-read HEAD and re-apply your change on top.',
    '',
  ].join('\n');
}

/**
 * THE SUPERSESSION report (DEF-ROC-173). The declaration changes what the guard is
 * allowed to conclude, so it is stated on every commit that uses one — including the
 * case where it did NOT settle the matter, which is the one a committer is least
 * likely to expect.
 */
function formatCoownedSupersession(x) {
  return [
    `SUPERSESSION DECLARED — ${x.path}`,
    `  you asserted that ${x.lines.length} line(s) of HEAD are ones you READ AND DECIDED AGAINST, so`,
    '  their absence from your copy is a decision and not a stale copy:',
    ...x.lines.slice(0, 8).map((l) => `    ${l.slice(0, 200)}${l.length > 200 ? ' …' : ''}`),
    ...(x.lines.length > 8 ? [`    … and ${x.lines.length - 8} more`] : []),
    x.stoodDown
      ? '  That accounted for ALL of it: the co-owned guard stood down and your blob is committed as-is.'
      : '  IT DID NOT ACCOUNT FOR ALL OF IT — your copy lacks content beyond what you declared, so the',
    ...(x.stoodDown ? [] : ['  three-way merge still ran. Everything you did NOT name is still guarded.']),
    ...(x.restoredDespiteDeclaration && x.restoredDespiteDeclaration.length > 0
      ? [
          `  AND ${x.restoredDespiteDeclaration.length} LINE(S) YOU DECLARED SUPERSEDED CAME BACK, because the merge that`,
          '  ran for the rest of the staleness restored them. That is the SAFE direction — content is',
          '  restored, never lost — but it un-does your decision, so RE-READ HEAD and re-apply it:',
          ...x.restoredDespiteDeclaration.slice(0, 5).map((l) => `    ${l.slice(0, 200)}`),
        ]
      : []),
    '  Anything you did not name was NOT excused. If a line here was another agent\'s work rather',
    '  than yours to replace, that commit has removed it — re-read HEAD.',
    '',
  ].join('\n');
}

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
  if (opts.printCoownedMissing) {
    try {
      process.stdout.write(`${printCoownedMissing(opts).join('\n')}\n`);
      return 0;
    } catch (e) {
      process.stderr.write(`${e.message}\n`);
      return e instanceof IsolatedCommitError ? e.code : 1;
    }
  }
  try {
    const res = isolatedCommit(opts);
    // A merge that is not reported is a merge nobody audits — and this one changes
    // what lands relative to what the caller staged, so it is never silent.
    for (const x of res.coownedSupersessions || []) process.stderr.write(formatCoownedSupersession(x));
    for (const m of res.coownedMerges || []) process.stderr.write(formatCoownedMerge(m));
    for (const c of res.coownedContinuations || []) process.stderr.write(formatCoownedContinuation(c));
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
  parseArgv,
  looksLikeOption,
  pathsOutsideDeclared,
  normalizeMessage,
  messageFileIdentityToken,
  sharedMessageFileRefusal,
  terseMessageRefusal,
  mintMessageFilePath,
  duplicateMessageAncestor,
  commitObjectMessage,
  contentLines,
  linesAdded,
  coownedTexts,
  coownedMissingByPath,
  scopeSupersession,
  printCoownedMissing,
  coownedStaleAgainst,
  workItemIds,
  sameWorkItem,
  ownWorkItemContinuation,
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
