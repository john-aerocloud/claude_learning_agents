#!/usr/bin/env node
'use strict';
/**
 * impacted-tests.js — IMP-007 changed-node -> impacted-spec lookup (agent-ops).
 *
 * Allowlisted entry point — invoked by the ROOT Makefile target:
 *   make impacted-tests SINCE=<sha> [PROJECT=<name>]
 * which runs:
 *   node .claude/tools/impacted-tests.js --since <sha> --project <name>
 * (PROJECT defaults to work/ACTIVE, like the other root targets.)
 *
 * WHY HERE (.claude/tools/, not work/<project>/scripts/)
 *   This is CROSS-PROJECT agent-ops tooling: it operates on ANY project's
 *   change-impact model and serves the tester's flow regardless of project.
 *   Per-project probes (waf/ws/uniqueness) live in work/<project>/scripts/
 *   because they target one project's deployed surface; this one is
 *   parameterised by PROJECT and belongs with the agents, peer to
 *   .claude/skills/. Pure git + filesystem. NO credentials, NO network.
 *
 * WHAT IT DOES (done-condition, IMP-007)
 *   1. Determines the set of CHANGED/added/removed mermaid node ids in
 *      work/<project>/architecture/dependencies/*.mmd. The changed-set is
 *      SOURCED FROM THE DIFF (OI-42 fix), as the UNION of:
 *        - the COMMITTED window diff `git diff <since>..HEAD` on those files, AND
 *        - the UNCOMMITTED working-tree diff `git diff` (no revs) on those files.
 *      From the ADDED (+) / REMOVED (-) lines of those diffs we pull node ids
 *      that actually MOVED in the window: a node declaration (`id[...]`), a node
 *      newly given a `changed`-class mark inline (`id...:::sNNNchanged`), a node
 *      named in a `class A,B,C <...changed...>;` statement, and the endpoints of
 *      an added/removed edge (`a -->|...| b`).
 *      (The mark forms have varied across slices — `:::changed`,
 *       `:::s005h3changed`, `:::s007aChanged`, `class wsfn,conn,games changed`
 *       — so the rule is: any class name CONTAINING "changed" (case-insensitive)
 *       is a change mark; `:::stable`/`:::delivered`/`:::store`/`:::gate`/
 *       `:::actor`/`:::compute`/`:::secret` are NOT. The TRAILING SEMICOLON IS
 *       OPTIONAL and the house style omits it — see below; requiring it was a
 *       three-percent-recall blindness that lasted until 2026-08-21.)
 *
 *      RECALL IS ASSERTED, NOT ASSUMED
 *      (OI-IMPACTED-TESTS-CANNOT-SEE-190-OF-192-CHANGE-MARKS).
 *      The `class …` statement form was read by a regex ending `\s*;`, so a
 *      trailing semicolon was REQUIRED while the house style omits it: measured on
 *      the real committed corpus it saw 6 of 169 class statements (16 of 270 marked
 *      nodes). A `class X …changed` mark has NO consumer but this tool, so 163
 *      statements were written into a void; commit d92f5dd8 changed the graph ONLY
 *      by adding one such mark and this tool reported ZERO candidate nodes — a
 *      false CLEAN over a control whose behaviour had changed. The regex is gone:
 *      `class` statements are read by parseMermaidStructure() like every other
 *      node identity, and the recall claim is now MEASURED against the real corpus
 *      in impacted-tests-class-stmt-recall.test.js (169/169) rather than pinned on
 *      a hand-written `class a,b changed;` line that carried the code's own
 *      assumption. A change-marking statement the parse reads no node out of is
 *      REPORTED in the run (unreadClassStatements), because the fault was a
 *      SILENT false negative and the only cure for that is self-observation.
 *
 *      WHY DIFF-SOURCED, NOT A FULL-FILE SCAN (OI-42, proven on s009):
 *      classDef marks are CLEARED at delivery by RECOLOURING the classDef (green)
 *      while the class NAME still contains "changed" forever. A full working-tree
 *      scan for any "changed"-named class therefore re-reports every prior slice's
 *      long-delivered nodes regardless of the SINCE window (s009 over-reported
 *      ~half its 79 nodes as stale prior-slice marks). A stale mark committed N
 *      slices ago appears in NEITHER diff, so a diff-sourced set drops it; only
 *      marks/edges/decls that moved IN the window survive.
 *
 *      THE DIFF SELECTS; IT DOES NOT IDENTIFY (OI-IMPACTED-TESTS-JUNK-NODE-IDS).
 *      A diff hands us isolated LINES, and a line lifted out of a multi-line
 *      label — or a label containing an ASCII `--` used as an English dash, or an
 *      edge label carrying a literal `|` — is indistinguishable from a statement
 *      when read alone. That is how `THE`, `an`, `code`, `resolve`, `delta-072`,
 *      `BUY`, `which`, `reason`, `group`, `field`, `skip`, `stage`, `deploy` were
 *      emitted as graph nodes: 46 of 398 "changed nodes" on a 26-day window were
 *      label prose, and they inflated the UNCOVERED list (164 -> 118 once gated),
 *      so every agent running this had to hand-discount the number before
 *      believing it. Node IDENTITY therefore comes from parseMermaidStructure()
 *      over WHOLE files (working tree + HEAD + the SINCE revision), which skips
 *      comments, bracket-balanced quote-aware labels and `|...|` edge labels; the
 *      diff-sourced candidates are FILTERED through that declared inventory and
 *      everything else is REPORTED as `rejected` rather than dropped silently.
 *      This is not a stop-word list: no English word appears anywhere in this
 *      file, and a node genuinely declared `code` passes straight through.
 *   2. Greps committed specs (tests/validation, tests/smoke, tests/skeleton, and
 *      unit suites anywhere under src/**) for `@covers <node-id>[, <node-id>...]`
 *      tags and builds node-id -> {spec files} map.
 *   3. Emits TWO plain-text lists consumable as a test-plan tick-off:
 *        IMPACTED SPECS        — changed node -> covering spec(s)
 *        UNCOVERED CHANGED NODES — changed node with NO covering spec (WARNING)
 *
 * EXIT CODES (ADVISORY — NOT CI-BLOCKING YET, IMP-007 done-condition #3)
 *   0  clean: every changed node has >=1 covering spec, OR there are no changes.
 *   2  WARNING: >=1 changed node has no covering spec. This is wired into the
 *      tester's flow first (the uncovered list IS the tester's new-spec work);
 *      it is NOT yet a CI gate. Promote to a blocking gate only after two slices
 *      of clean use (per the slice's "promote to CI gate only after two slices").
 *   1  usage/operational error (bad args, git failure).
 *
 * SELF-TESTING: .claude/tools/impacted-tests.test.js (node --test) proves the
 * behaviours with fixtures + throwaway git repo(s). No credentials.
 * .claude/tools/impacted-tests-junk-node-ids.test.js pins the structural parse
 * against fixtures/impacted-tests/junk-node-ids-capture.mmd — six statements
 * lifted VERBATIM from the real corpus at a recorded sha, each annotated with the
 * junk pair the old parse emitted from it.
 *
 * NESTED-REPO GIT-ROOT RESOLUTION (EXP-104, fixed here — recurred 5x before this)
 *   Under the v50 topology, work/<project>/ is very often its OWN independent git
 *   repo (a nested `.git`), disjoint from the parent/integration repo's history
 *   (the parent .gitignores every work/<project> dir entirely). Before this fix, `gitDiff()` ran
 *   unconditionally against `root` (the parent, `process.cwd()` by default) — a
 *   SHA that only exists in the project's nested repo was `fatal: bad revision`
 *   there, and vice versa. `resolveDiffRoot()` asks each candidate repo whether it
 *   owns `since` (`git rev-parse --verify <sha>^{commit}`), PREFERRING the nested
 *   project repo (that is where a project SHA actually lives), falling back to
 *   the parent only when the nested repo doesn't own it, and raising an
 *   ACTIONABLE error (not a raw `fatal: bad revision`) when NEITHER does. Both the
 *   committed-window diff and the uncommitted working-tree diff run against the
 *   SAME resolved root, since a nested repo's working tree/index is disjoint from
 *   the parent's too.
 *
 * @covers / NODE-ID CONVENTION SANITY CHECK (see checkTagConvention())
 *   A project can have @covers tags that are semantically real but keyed to a
 *   DIFFERENT id vocabulary than the .mmd node ids (e.g. spec tags `domain-map`,
 *   `domain-serialize` vs .mmd node ids `MAP`, `G_CONF`) — every changed node then
 *   silently shows UNCOVERED even though a covering spec exists, which reads as
 *   "no tests were written" when the real problem is a naming mismatch. This is
 *   a STRUCTURAL check (full node-id inventory vs the full @covers-tag set,
 *   independent of the SINCE window) that fires a loud WARNING banner in the
 *   report rather than silently under-reporting. It does not change exit codes;
 *   it changes what a human/tester DOES with an "uncovered" line.
 *
 * @alias RECONCILIATION (OI-COVERS-NODEID, see parseAliasComments/effectiveSpecsFor)
 *   The fix for the convention mismatch above, WITHOUT flattening a project's
 *   thoughtful semantic @covers vocabulary into the diagram's terse ids (or
 *   coupling specs to a lightweight "context-only, NOT a build spec" sketch).
 *   A .mmd node declares which @covers tags cover it via comment lines:
 *     %% @alias MAP=domain-map,domain-serialize
 *     %% @alias G_CONF=domain-conformance
 *   The tool reads these alongside node ids; a changed node's covering specs are
 *   its directly-tagged specs UNIONed with the specs of every aliased tag, so
 *   node `MAP` reports IMPACTED via specs tagged `domain-map`. The alias lives next
 *   to the node id it explains, is self-documenting, expresses the natural
 *   granularity mismatch in both directions (many tags -> one node; one tag ->
 *   many nodes by repeating it), and generalises to any project with this same
 *   mismatch. Purely ADDITIVE: absent any @alias line the map is empty and the
 *   tool behaves exactly as before, and an adopted alias also suppresses the
 *   convention-mismatch WARNING for the tags it reconciles.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ---- pure parsers -----------------------------------------------------------

// A mermaid class name that means "this node changed this slice". The marks have
// varied; the invariant is the substring "changed" (case-insensitive).
function isChangedClass(name) {
  return /changed/i.test(name);
}

// Node-id declaration on a line: `  someId["label"...` or `  someId(...` etc.
// Mermaid node ids are leading-token alphanumerics + - _ before a shape bracket.
const NODE_DECL_RE = /^[+\- ]?\s*([A-Za-z0-9_-]+)\s*[[({]/;

// Inline class application on a node line: `someId[...]:::className`
const INLINE_MARK_RE = /([A-Za-z0-9_-]+)\s*(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?\s*:::([A-Za-z0-9_]+)/g;

// Statement form: `class A,B,C className` — with or WITHOUT a trailing semicolon.
// There is deliberately NO REGEX for this any more
// (OI-IMPACTED-TESTS-CANNOT-SEE-190-OF-192-CHANGE-MARKS). The one there used to be
// ended `\s*;`, so the semicolon was REQUIRED while this repo's house style omits
// it: measured on the real corpus it read 6 of 169 class statements (16 of 270
// marked nodes), and a `class X …changed` mark has NO consumer but this tool, so
// 163 statements were being written into a void. Commit d92f5dd8 changed the graph
// ONLY by adding `class declared-corpus-absences oiReachChanged` and this tool
// extracted ZERO nodes from its diff — a false CLEAN over a control whose
// behaviour had changed; f059f0e2 then worked around it by hand, adding a `;` to
// that ONE line. Making the semicolon optional would have been the same class of
// mistake (delta-074 R12: no control is verified by text-slicing an artifact whose
// layout it does not own), so identity comes from the same structural tokeniser
// that supplies it everywhere else: tokeniseMermaid() ends a statement at `\n` OR
// `;`, skips comments, quoted/bracket-balanced labels and `|edge labels|`, and
// parseMermaidStructure() reads `class A,B <cls>` off the resulting tokens. So the
// semicolon is irrelevant and nothing new over-matches.

// Is this line/body a `class …` STATEMENT (as opposed to a `classDef`, an id
// called `classy`, or a node declaration)? Statement-leading only: mermaid has no
// mid-line `class` statement, and the old regex's `(?:^|\s)class` alternative is
// exactly what let label prose containing the word "class" reach the parse.
const CLASS_STMT_LEAD_RE = /^\s*class\s/;

// The node ids a `class A,B <...changed...>` statement MARKS, read structurally.
// Empty for `class A,B stable` (names nodes, marks nothing) and for anything that
// is not a class statement.
function classStatementMarkedNodes(body) {
  if (!CLASS_STMT_LEAD_RE.test(body)) return [];
  return [...parseMermaidStructure(body).marked];
}

/**
 * Node ids carrying a CHANGED mark in the given .mmd text (working-tree state).
 * Structural: inline `:::mark` and `class A,B mark` statements alike.
 */
function extractMarkedNodes(text) {
  return [...parseMermaidStructure(text).marked];
}

// Edge endpoints on a line: `a -->|"label"| b`, `a -.->|x| b`, `a --- b`, etc.
// Captures the leading source id and the trailing target id around an arrow.
const EDGE_RE = /([A-Za-z0-9_-]+)\s*(?:--+>?|-\.->|==+>|--+)\s*(?:\|[^|]*\|\s*)?([A-Za-z0-9_-]+)/;

/**
 * Node ids that ACTUALLY MOVED on the added (+) or removed (-) lines of a unified
 * git diff (OI-42: this is the sole source of the changed-set, so it must catch
 * every way a node enters/changes in-window — declaration, inline change-mark,
 * `class A,B changed;` statement, and edge endpoints — but NOT recolour-only
 * `classDef` lines, which carry no node id).
 */
function extractNodesFromDiffLines(diffText) {
  const out = new Set();
  for (const line of diffText.split('\n')) {
    if (line[0] !== '+' && line[0] !== '-') continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const body = line.slice(1);
    // comments and pure type/layout directives carry no node id of interest.
    if (/^\s*(%%|classDef|linkStyle|subgraph|flowchart|graph|end\b|direction\b)/.test(body)) continue;

    // (1) `class A,B,C <...changed...>` statement (trailing `;` optional — the
    //     house style omits it) — only when the class is a change mark; a
    //     `class A,B stable` line names nodes but marks no change.
    if (CLASS_STMT_LEAD_RE.test(body)) {
      for (const id of classStatementMarkedNodes(body)) out.add(id);
      continue; // a `class ...` statement is never a decl/edge line
    }

    // (2) node declaration: `id["label"]...` / `id(...)` / `id{...}`
    const dm = body.match(NODE_DECL_RE);
    if (dm) out.add(dm[1]);

    // (3) inline change-marks anywhere on the line: `id...:::sNNNchanged`. Catches
    //     a node re-marked changed in-window even when re-declared with a shape
    //     bracket (dm above) OR when only the mark is added.
    INLINE_MARK_RE.lastIndex = 0;
    let im;
    while ((im = INLINE_MARK_RE.exec(body)) !== null) {
      if (isChangedClass(im[2])) out.add(im[1]);
    }

    // (4) edge endpoints: an added/removed edge means both endpoints moved.
    const em = body.match(EDGE_RE);
    if (em) { out.add(em[1]); out.add(em[2]); }
  }
  return [...out];
}

/**
 * Class statements the diff OFFERED that the parse read NO node out of, returned
 * as their raw line bodies.
 *
 * WHY THIS EXISTS. The fault above was a false NEGATIVE that was also SILENT: a
 * statement the parser could not read looked exactly like a window in which
 * nothing changed. AC-JUNK made the parse report what it REJECTS; this makes it
 * report what it FAILED TO READ, which is the same obligation from the other
 * side. A statement whose class is not a change mark (`class A,B stable`) is read
 * correctly and is not reported; only a statement that NAMES A CHANGE and yields
 * no node is.
 */
function unreadClassStatementLines(diffText) {
  const out = [];
  for (const line of diffText.split('\n')) {
    if (line[0] !== '+' && line[0] !== '-') continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const body = line.slice(1);
    if (!CLASS_STMT_LEAD_RE.test(body)) continue;
    if (!isChangedClass(body)) continue;      // not a change mark at all
    if (classStatementMarkedNodes(body).length === 0) out.push(body);
  }
  return out;
}

/**
 * @covers tags in a spec's text -> Map(nodeId -> Set(specPath)). A tag is a
 * `@covers a, b, c` list; a trailing ` (annotation)` is stripped; tokens that
 * are pure annotations (start with `(`) are ignored.
 *
 * The annotation is allowed to WRAP onto subsequent `//`-comment lines (a
 * widespread convention across this repo's specs, e.g. a multi-paragraph
 * rationale after the id list) — the id list itself is always complete on
 * the FIRST line, ending at the first `(` if one is present, so it's cut
 * there rather than requiring the parenthetical to close on the same line
 * (a same-line-only close previously made every wrapped annotation silently
 * fail to register its node-id at all — 2026-07-21 tool-bug fix).
 */
function parseCoversTags(text, specPath) {
  const map = new Map();
  const re = /@covers\s+(.+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    const parenIdx = raw.indexOf('(');
    const list = (parenIdx === -1 ? raw : raw.slice(0, parenIdx)).trim();
    for (const rawId of list.split(',')) {
      const id = rawId.trim().replace(/[.,;]+$/, '');
      if (!id || id.startsWith('(')) continue;
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(specPath);
    }
  }
  return map;
}

// `%% @alias <nodeId>=<tag>[, <tag>...]` comment lines in a .mmd -> Map(nodeId ->
// Set(coversTag)). The alias reconciles a node id (the diagram's terse vocabulary,
// e.g. `MAP`) with the @covers tags that actually cover it (the specs' semantic
// vocabulary, e.g. `domain-map`, `domain-serialize`) WITHOUT forcing either side
// to change — see OI-COVERS-NODEID. Keyed by node id so the natural granularity
// mismatch is expressible in BOTH directions: many tags -> one node
// (`%% @alias MAP=domain-map,domain-serialize`) and one tag -> many nodes (repeat
// the tag on each node's alias line). Purely additive: a .mmd with no @alias lines
// yields an empty map and the tool behaves exactly as before.
function parseAliasComments(text) {
  const map = new Map();
  const re = /^\s*%%\s*@alias\s+([A-Za-z0-9_-]+)\s*=\s*(.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const node = m[1].trim();
    // a trailing parenthetical annotation is allowed and stripped, mirroring @covers
    const list = m[2].replace(/\([^)]*\)\s*$/, '').trim();
    for (const raw of list.split(',')) {
      const tag = raw.trim().replace(/[.,;]+$/, '');
      if (!tag || tag.startsWith('(')) continue;
      if (!map.has(node)) map.set(node, new Set());
      map.get(node).add(tag);
    }
  }
  return map;
}

// The covering specs for a node id: its own directly-tagged specs (a spec that
// literally says `@covers <nodeId>`) UNIONed with the specs of every @covers tag
// aliased to it. Returns a sorted array (possibly empty).
function effectiveSpecsFor(node, coversIndex, aliasMap) {
  const specs = new Set(coversIndex.get(node) || []);
  const tags = aliasMap.get(node);
  if (tags) {
    for (const tag of tags) {
      const set = coversIndex.get(tag);
      if (set) for (const s of set) specs.add(s);
    }
  }
  return [...specs].sort();
}

// ---- filesystem / git glue --------------------------------------------------

function depFiles(root, project) {
  const dir = path.join(root, 'work', project, 'architecture', 'dependencies');
  if (!fs.existsSync(dir)) return { dir, files: [] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mmd'))
    .map((f) => path.join(dir, f));
  return { dir, files };
}

// Unified diff text for the given files. `revs` is the leading git-diff revision
// args: ['<since>..HEAD'] for the committed window, or [] for the uncommitted
// working-tree diff. Both feed the SAME line extractor; their union is the set of
// nodes that moved in-window (OI-42: diff-sourced, not a full-file class scan).
// `diffRoot` is the RESOLVED git root (see resolveDiffRoot) — NOT necessarily
// the tool's `root` arg, since a project SHA usually lives in the project's own
// nested repo (EXP-104).
function gitDiff(diffRoot, revs, files) {
  const rel = files.map((f) => path.relative(diffRoot, f));
  try {
    return execFileSync('git', ['-C', diffRoot, 'diff', ...revs, '--', ...rel],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const what = revs.length ? `(is "${revs.join(' ')}" a valid range in ${diffRoot}?)` : '(working tree)';
    throw new Error(`git diff failed ${what}: ${e.message}`);
  }
}

// The content of one file AT a revision, or null when it does not exist there
// (a newly-added diagram at `since`, a since-deleted one at HEAD). Used to build
// the DECLARED-NODE inventory across the whole window, so the structural gate
// cannot swallow a node whose declaration was removed in-window.
function gitShow(diffRoot, rev, relPath) {
  try {
    return execFileSync('git', ['-C', diffRoot, 'show', `${rev}:${relPath}`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Does `repoRoot`'s OWN git history contain `sha`? Used to pick which repo a
// project SHA actually belongs to (EXP-104).
function shaExistsIn(repoRoot, sha) {
  try {
    execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`],
      { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

// Which repo should the revision range / diff run against? Under v50, work/
// <project>/ is very often its OWN independent git repo (nested `.git`),
// disjoint from the parent/integration repo's history. Prefer the nested
// project repo when it owns `since` (that is where a project SHA actually
// lives); fall back to the parent when the nested repo doesn't own it (or
// doesn't exist); raise an ACTIONABLE error when NEITHER repo owns the SHA
// (never let a raw `fatal: bad revision` leak out uncontextualised).
function resolveDiffRoot(root, project, since) {
  const projectRoot = path.join(root, 'work', project);
  const hasNestedGit = fs.existsSync(path.join(projectRoot, '.git'));
  if (hasNestedGit && shaExistsIn(projectRoot, since)) return projectRoot;
  if (shaExistsIn(root, since)) return root;
  if (hasNestedGit) {
    throw new Error(
      `SHA "${since}" not found in the project repo (${projectRoot}) or the parent ` +
      `repo (${root}). Pass a SHA that exists in one of these two repos.`
    );
  }
  throw new Error(`SHA "${since}" not found in repo (${root}).`);
}

// ---- structural mermaid parse (OI-IMPACTED-TESTS-JUNK-NODE-IDS) -------------
//
// WHY A PARSE AND NOT A LINE REGEX. Node IDENTITY used to come from the same
// per-line regexes used on diff lines (NODE_DECL_RE / EDGE_RE) swept over the
// whole file. Those regexes cannot tell STRUCTURE from LABEL PROSE, and this
// project's labels are long English paragraphs, so ordinary words became "node
// ids": measured on the real corpus, the 791-entry "inventory" contained `THE`,
// `an`, `code`, `resolve`, `delta-072`, `BUY`, `which`, `reason`, `group`. Three
// mechanisms produced them:
//   (1) an ASCII `--` used as an English dash inside a label matched EDGE_RE, so
//       both surrounding words became edge endpoints
//       (`...IATA code -- BUY = Burlington NC...` -> nodes `code` and `BUY`);
//   (2) an edge label carrying a literal pipe (`-.->|"... | reason no-genesis ..."|`)
//       ended EDGE_RE's `\|[^|]*\|` early, so the next prose word read as the
//       edge TARGET (`SCOPEGATE -> reason`);
//   (3) a label spanning two physical lines (three exist in class-deps.mmd) left
//       its continuation line looking like a statement.
// Those ids flowed into the UNCOVERED list and inflated it, and every agent
// running the tool had to hand-discount the number before believing it.
//
// delta-074 R12: "no control is verified by text-slicing an artifact whose layout
// it does not own." So identity is read from DECLARED STRUCTURE. This is a small
// mermaid flowchart tokeniser: it walks the whole text (crossing newlines, since
// labels do), and SKIPS every region that is not structure — `%%` comments,
// bracket-balanced quote-aware node labels (`[...]`, `(...)`, `{...}`, `>...]`,
// including `[(`/`((`/`{{` compounds), and `|...|` edge labels. Only what is
// left is tokenised into ids, arrows and `:::class` marks.
//
// NOT A STOP-WORD LIST (AC-JUNK.4). No English word is named anywhere in this
// tool. A node genuinely DECLARED `code` is a node; the same characters inside a
// label are not. The rule is positional, so the next label word cannot
// reintroduce the fault.

// A mermaid id: alphanumerics/underscore, single hyphens allowed INSIDE (so
// `ordered-write-sweep` is one id) but never a `--`, which is an arrow.
// STICKY (`y`), matched at a set lastIndex — never `.exec(text.slice(i))`, which
// would be quadratic on a half-megabyte diagram.
const MMD_ID_RE = /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/y;

// Edge operators, sticky and longest-first: a terminated arrow must win over its
// own prefix (`-->` must not tokenise as `--` + `>`). The FIRST alternatives are
// mermaid's INLINE-TEXT arrow forms `-.text.->` / `-- text -->` / `== text ==>`,
// which this corpus uses 80+ times (`-.implemented by.->`, `-.constructs (reads
// oag/rest-key).->`). Consuming the text AS PART OF THE ARROW is what stops
// `implemented` / `by` / `constructs` / `resolver` / `client` / `source` being
// read as nodes — the mirror-image of the label-prose fault, found by diffing the
// structural inventory against the old one rather than assumed away.
// `terminated` distinguishes `-->`/`--x`/`--o`/`==>` from the OPEN `--`/`---`/
// `-.-`/`==` forms, which is how the `A -- text --> B` sandwich is recognised.
// `x`/`o` heads need a boundary or they would eat the first char of `xyz`; `>`
// does not (`A-->B` is legal and has no separator).
const MMD_ARROW_HEAD = '(?:>|[xo](?![A-Za-z0-9_-]))';
const MMD_ARROW_RE = new RegExp(
  '<?(?:'
  // the inline text is bounded by the END OF LINE (`\n` excluded), not by an
  // arbitrary character budget: the longest real one in this corpus is 134 chars
  // (`-.constructs (default scope + gate; CONNECTION_CONFIG_TABLE_NAME absent =>
  // ... NEVER unfiltered).->`), and a guessed budget is exactly the "text-slicing
  // a layout you do not own" fault delta-074 R12 rules out.
  + `-\\.[^.\\n|"]*\\.-+${MMD_ARROW_HEAD}?`                  // -.text.->  /  -.text.-
  + `|-{2,}[^-\\n|">]+-{2,}${MMD_ARROW_HEAD}`                // -- text -->
  + `|={2,}[^=\\n|">]+={2,}>`                                // == text ==>
  + `|-\\.+-+${MMD_ARROW_HEAD}?`                             // -.->  -.-
  + `|-{2,}${MMD_ARROW_HEAD}`                                // -->  --x  --o
  + '|={2,}>'                                                // ==>
  + '|-{2,}'                                                 // ---  (open link)
  + '|={2,}'                                                 // ===  (open thick link)
  + ')', 'y');

// statement-leading keywords that declare no node id of interest. `class` is
// handled separately (it NAMES nodes); the rest are layout/type directives.
const MMD_STMT_KEYWORDS = new Set([
  'flowchart', 'graph', 'subgraph', 'end', 'direction', 'classdef', 'linkstyle',
  'style', 'click', 'acctitle', 'accdescr', 'linkstyle',
]);

// Index just past the closing `"` of the quoted run starting at i. Crosses
// newlines: mermaid labels legitimately span lines (three do in class-deps.mmd,
// which is precisely what defeated the per-line parse).
function skipQuoted(text, i) {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j++;
  return j + 1;
}

// Index just past the close of the node-label region opening at i. Balanced on
// the OPENER'S OWN family so `[(label)]`, `((label))`, `{{label}}` all close
// correctly, and quote-aware so a bracket inside label prose cannot unbalance it.
// `>` (the asymmetric shape) closes on `]` and is not itself counted.
function skipNodeLabel(text, i) {
  const open = text[i];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  const countOpener = open !== '>';
  let depth = 1;
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '"') { j = skipQuoted(text, j); continue; }
    if (countOpener && c === open) { depth++; j++; continue; }
    if (c === close) { depth--; j++; if (depth === 0) return j; continue; }
    j++;
  }
  return text.length; // unbalanced: consume to EOF rather than resync into prose
}

// Index just past the closing `|` of the edge label opening at i. Quote-aware,
// which is the fix for mechanism (2): a literal pipe INSIDE the quoted label no
// longer terminates it.
function skipEdgeLabel(text, i) {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '"') { j = skipQuoted(text, j); continue; }
    if (c === '|') return j + 1;
    j++;
  }
  return text.length;
}

/**
 * Tokenise a .mmd into STATEMENTS of structure-level tokens. Label bodies,
 * comments and edge labels are consumed and discarded — they never reach a
 * token, so nothing inside them can become an id.
 *
 * Token shapes: {t:'id', v, shaped} · {t:'arrow', terminated} · {t:'elabel'} ·
 * {t:'cls', v} · {t:'amp'} · {t:'other'}
 */
function tokeniseMermaid(text) {
  const statements = [];
  let cur = [];
  const flush = () => { if (cur.length) statements.push(cur); cur = []; };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n' || c === ';') { flush(); i++; continue; }
    if (c === '%' && text[i + 1] === '%') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '|') { cur.push({ t: 'elabel' }); i = skipEdgeLabel(text, i); continue; }
    if (c === '"') { i = skipQuoted(text, i); continue; }
    if (c === '&') { cur.push({ t: 'amp' }); i++; continue; }
    if (text.startsWith(':::', i)) {
      MMD_ID_RE.lastIndex = i + 3;
      const m = MMD_ID_RE.exec(text);
      if (m && m.index === i + 3) { cur.push({ t: 'cls', v: m[0] }); i = i + 3 + m[0].length; continue; }
      i += 3; continue;
    }
    MMD_ARROW_RE.lastIndex = i;
    const am = MMD_ARROW_RE.exec(text);
    if (am) {
      cur.push({ t: 'arrow', terminated: /[>xo]$/.test(am[0]) });
      i += am[0].length;
      continue;
    }
    MMD_ID_RE.lastIndex = i;
    const im = MMD_ID_RE.exec(text);
    if (im) {
      const id = im[0];
      let k = i + id.length;
      while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
      const opener = text[k];
      const shaped = opener === '[' || opener === '(' || opener === '{' || opener === '>';
      cur.push({ t: 'id', v: id, shaped });
      i = shaped ? skipNodeLabel(text, k) : i + id.length;
      continue;
    }
    cur.push({ t: 'other' });
    i++;
  }
  flush();
  return statements;
}

/**
 * The DECLARED-NODE inventory of a .mmd, read from structure.
 *
 * A node id is declared when it is (a) given a shape/label (`id[...]`), (b) an
 * endpoint of an edge, or (c) named in a `class A,B <cls>;` statement — mermaid's
 * three ways of bringing a node into existence. `changed` marks are collected in
 * the same pass.
 *
 * @returns {{declared:Set<string>, shaped:Set<string>, marked:Set<string>}}
 */
function parseMermaidStructure(text) {
  const declared = new Set();
  const shaped = new Set();
  const marked = new Set();
  for (const stmt of tokeniseMermaid(text)) {
    const first = stmt[0];
    if (first && first.t === 'id' && !first.shaped) {
      const kw = first.v.toLowerCase();
      if (kw === 'class') {
        // `class A,B,C someClass` — every id but the LAST names a node.
        const ids = stmt.slice(1).filter((t) => t.t === 'id').map((t) => t.v);
        const cls = ids.pop();
        for (const id of ids) declared.add(id);
        if (cls && isChangedClass(cls)) for (const id of ids) marked.add(id);
        continue;
      }
      if (MMD_STMT_KEYWORDS.has(kw)) continue; // layout/type directive
    }
    for (let k = 0; k < stmt.length; k++) {
      const tok = stmt[k];
      if (tok.t === 'cls' && isChangedClass(tok.v)) {
        // the mark attaches to the nearest preceding id
        for (let b = k - 1; b >= 0; b--) {
          if (stmt[b].t === 'id') { marked.add(stmt[b].v); break; }
        }
        continue;
      }
      if (tok.t !== 'id') continue;
      if (tok.shaped) { declared.add(tok.v); shaped.add(tok.v); continue; }
      // an unshaped id is a node only if it is an EDGE ENDPOINT: adjacent to an
      // arrow (an intervening `|edge label|` does not break adjacency), or joined
      // by `&`.
      const neighbour = (dir) => {
        let j = k + dir;
        while (j >= 0 && j < stmt.length && stmt[j].t === 'elabel') j += dir;
        return stmt[j];
      };
      const prev = neighbour(-1);
      const next = neighbour(1);
      const linked = (t) => t && (t.t === 'arrow' || t.t === 'amp');
      if (!linked(prev) && !linked(next)) continue;
      // mermaid's legacy inline edge-label form `A -- text --> B`: an unshaped id
      // sandwiched between an OPEN arrow and a TERMINATED one is the LABEL, not a
      // node. A chain (`A --> B --> C`) has a TERMINATED arrow before B, so B
      // survives. (Limit: `A -- text --- B` is textually ambiguous with the chain
      // `A --- B --- C`; the chain reading wins.)
      if (prev && next && prev.t === 'arrow' && next.t === 'arrow'
          && !prev.terminated && next.terminated) continue;
      declared.add(tok.v);
    }
  }
  return { declared, shaped, marked };
}

// Node ids appearing ANYWHERE in this .mmd text (declaration or edge endpoint),
// regardless of "changed" state — the FULL inventory of this diagram's node-id
// vocabulary. Used for the @covers/node-id convention sanity check AND as the
// gate the diff-sourced changed-set is filtered through; the changed-set is
// still SELECTED by the diff only (OI-42), never IDENTIFIED by it.
function extractAllNodeIds(text) {
  return parseMermaidStructure(text).declared;
}

// Structural sanity check, independent of the SINCE window: do ANY @covers tags
// in this project match ANY node id declared in its .mmd diagrams, EITHER directly
// or via a documented `%% @alias` (OI-COVERS-NODEID)? If the project HAS @covers
// tags but NONE reconcile with the diagram's node-id vocabulary, every changed
// node will show UNCOVERED even when a covering spec exists under a different tag
// vocabulary (e.g. `domain-map` vs `MAP`) — a silent under-report, not a real
// coverage gap. Loud, not silent (this file's header). An adopted alias mapping
// IS the reconciliation, so a tag referenced by any alias counts as matched and
// no longer trips the warning.
function checkTagConvention(allNodeIds, coversIndex, aliasMap = new Map()) {
  const taggedIds = [...coversIndex.keys()].sort();
  if (taggedIds.length === 0) {
    return { mismatch: false, taggedIds, overlap: [], allNodeIds: [...allNodeIds].sort() };
  }
  // tags reconciled by an alias line (`%% @alias NODE=tag,...`) count as matched.
  const aliasedTags = new Set();
  for (const tags of aliasMap.values()) for (const t of tags) aliasedTags.add(t);
  const overlap = taggedIds.filter((id) => allNodeIds.has(id) || aliasedTags.has(id));
  return {
    mismatch: overlap.length === 0,
    taggedIds,
    overlap,
    allNodeIds: [...allNodeIds].sort(),
  };
}

// Spec discovery: walk work/<project>/src for *.ts/*.js test files, plus the
// tester suites under tests/{validation,smoke,skeleton}.
function findSpecFiles(root, project) {
  const base = path.join(root, 'work', project, 'src');
  const out = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'cdk.out', 'coverage']);
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP.has(ent.name)) continue;
        walk(full);
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(ent.name)) {
        out.push(full);
      }
    }
  }
  walk(base);
  return out;
}

function buildCoversIndex(specFiles) {
  const index = new Map(); // nodeId -> Set(specPath)
  for (const spec of specFiles) {
    let text;
    try { text = fs.readFileSync(spec, 'utf8'); } catch { continue; }
    if (!text.includes('@covers')) continue;
    const fileMap = parseCoversTags(text, spec);
    for (const [node, set] of fileMap) {
      if (!index.has(node)) index.set(node, new Set());
      for (const s of set) index.get(node).add(s);
    }
  }
  return index;
}

// ---- orchestration ----------------------------------------------------------

/**
 * @returns {{changedNodes:string[], impacted:{node:string,specs:string[]}[],
 *            uncovered:string[], exitCode:number}}
 */
function run({ root, project, since }) {
  const { files } = depFiles(root, project);

  // 1. changed nodes = nodes that MOVED in the window, sourced from the diff
  //    (OI-42): the committed window diff <since>..HEAD UNION the uncommitted
  //    working-tree diff. NOT a full-file `changed`-class scan — that re-reports
  //    long-delivered prior-slice marks (recoloured-but-still-named-"changed")
  //    that are in neither diff, which is exactly the s009 over-report.
  const changed = new Set();
  const unreadClassStatements = [];
  let resolvedDiffRoot = null;
  if (files.length) {
    // EXP-104: resolve the git root that actually owns `since` BEFORE diffing —
    // a project SHA usually lives in work/<project>/'s own nested repo, not the
    // parent/integration repo at `root`. Both the committed-window diff and the
    // uncommitted working-tree diff run against the SAME resolved root.
    const diffRoot = resolveDiffRoot(root, project, since);
    const committedDiff = gitDiff(diffRoot, [`${since}..HEAD`], files);
    for (const id of extractNodesFromDiffLines(committedDiff)) changed.add(id);
    const workingDiff = gitDiff(diffRoot, [], files);
    for (const id of extractNodesFromDiffLines(workingDiff)) changed.add(id);
    resolvedDiffRoot = diffRoot;
    // recall, self-observed: a change-marking `class` statement the parse could
    // not read a node out of is REPORTED, never silently dropped.
    for (const l of unreadClassStatementLines(committedDiff)) unreadClassStatements.push(l);
    for (const l of unreadClassStatementLines(workingDiff)) unreadClassStatements.push(l);
  }
  const candidates = [...changed].sort();

  // 1b. GATE THE CANDIDATES ON DECLARED STRUCTURE
  //     (OI-IMPACTED-TESTS-JUNK-NODE-IDS).
  //     A diff hands us isolated LINES. A line lifted out of the middle of a
  //     multi-line label, or a label containing an ASCII `--` used as an English
  //     dash, is indistinguishable from a statement when read on its own — which
  //     is how `THE`, `an`, `code`, `resolve`, `delta-072`, `BUY`, `which`,
  //     `reason` and `group` were emitted as graph nodes and inflated the
  //     UNCOVERED list to 70 on the real corpus.
  //     So the diff SELECTS; it never IDENTIFIES. Identity comes from
  //     parseMermaidStructure() over WHOLE files, where labels can be skipped
  //     properly. The inventory spans three revisions of each diagram — the
  //     working tree, HEAD, and the SINCE revision — so a node whose declaration
  //     was REMOVED in-window is still recognised and still reported.
  //     This is NOT a stop-word list (AC-JUNK.4): no word is named anywhere here,
  //     and a node genuinely declared `code` passes straight through.
  const declaredNodes = new Set();
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const id of parseMermaidStructure(text).declared) declaredNodes.add(id);
  }
  if (resolvedDiffRoot && files.length) {
    for (const rev of ['HEAD', since]) {
      for (const f of files) {
        const text = gitShow(resolvedDiffRoot, rev, path.relative(resolvedDiffRoot, f));
        if (text === null) continue; // file absent at that revision — nothing to add
        for (const id of parseMermaidStructure(text).declared) declaredNodes.add(id);
      }
    }
  }
  const changedNodes = candidates.filter((n) => declaredNodes.has(n));
  const rejected = candidates.filter((n) => !declaredNodes.has(n));

  // 2. covers index over committed specs
  const coversIndex = buildCoversIndex(findSpecFiles(root, project));

  // 2b. full node-id inventory + adopted @alias mappings (current working-tree
  // content of the .mmd files, NOT diff-sourced) for coverage resolution and the
  // @covers/node-id convention sanity check.
  const allNodeIds = new Set();
  const aliasMap = new Map(); // nodeId -> Set(coversTag)
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const id of extractAllNodeIds(text)) allNodeIds.add(id);
    for (const [node, tags] of parseAliasComments(text)) {
      if (!aliasMap.has(node)) aliasMap.set(node, new Set());
      for (const t of tags) aliasMap.get(node).add(t);
    }
  }
  const tagConvention = checkTagConvention(allNodeIds, coversIndex, aliasMap);

  // 3. partition — a node is IMPACTED if it has directly-tagged specs OR specs
  //    reached through an adopted @alias (effectiveSpecsFor unions both).
  const impacted = [];
  const uncovered = [];
  for (const node of changedNodes) {
    const specs = effectiveSpecsFor(node, coversIndex, aliasMap);
    if (specs.length) {
      impacted.push({ node, specs });
    } else {
      uncovered.push(node);
    }
  }

  const exitCode = uncovered.length ? 2 : 0;
  return {
    changedNodes, impacted, uncovered, exitCode, tagConvention,
    // the structural gate, reported not silent: a dropped candidate a reader
    // cannot see is indistinguishable from an input that never contained it.
    rejected, declaredNodes, candidateCount: candidates.length,
    // a change-marking `class` statement the parse could not read (should be
    // empty; non-empty means this tool has met a form it cannot see, which is the
    // fault OI-IMPACTED-TESTS-CANNOT-SEE-190-OF-192-CHANGE-MARKS was).
    unreadClassStatements,
  };
}

// ---- plain-text report ------------------------------------------------------

function formatReport(res, { project, since, root }) {
  const lines = [];
  lines.push(`# impacted-tests — project=${project} since=${since}`);
  lines.push('');
  if (res.tagConvention && res.tagConvention.mismatch) {
    lines.push('## WARNING: @covers TAG / NODE-ID CONVENTION MISMATCH');
    lines.push(`  ${res.tagConvention.taggedIds.length} @covers tag(s) found across this project's specs,`);
    lines.push(`  but NONE match any of the ${res.tagConvention.allNodeIds.length} node id(s) declared in`);
    lines.push('  architecture/dependencies/*.mmd.');
    lines.push(`  Tags found:     ${res.tagConvention.taggedIds.join(', ')}`);
    lines.push(`  Node ids found: ${res.tagConvention.allNodeIds.join(', ')}`);
    lines.push('  Every "UNCOVERED" node below may just be tagged under a DIFFERENT vocabulary');
    lines.push('  (e.g. `domain-map` vs `MAP`) — do NOT treat UNCOVERED as "write a new spec"');
    lines.push('  until this is reconciled: (a) retag specs to the exact .mmd node id, or');
    lines.push('  (b) add `%% @alias <nodeId>=<tag>,<tag>` comment lines to the .mmd (this');
    lines.push('  tool reads them and unions the aliased tag\'s specs into the node\'s coverage).');
    lines.push('  This is flagged as a follow-up, not auto-fixed by this tool run.');
    lines.push('');
  }
  if (res.unreadClassStatements && res.unreadClassStatements.length) {
    lines.push('## WARNING: UNREAD `class` STATEMENT(S) — this tool met a mark form it cannot read');
    lines.push(`  ${res.unreadClassStatements.length} change-marking \`class\` statement(s) on in-window diff`);
    lines.push('  lines yielded NO node id. Every such mark is INVISIBLE to this report, so the');
    lines.push('  window below may read CLEAN while a marked node changed');
    lines.push('  (OI-IMPACTED-TESTS-CANNOT-SEE-190-OF-192-CHANGE-MARKS). Fix the parse, not the mark:');
    for (const l of res.unreadClassStatements.slice(0, 10)) lines.push(`    ${l.trim()}`);
    lines.push('');
  }
  if (res.changedNodes.length === 0) {
    lines.push('No changed/added/removed nodes in architecture/dependencies/*.mmd.');
    if (res.rejected && res.rejected.length) {
      lines.push(`(${res.rejected.length} of ${res.candidateCount} candidate token(s) rejected as `
        + `not-declared label prose: ${res.rejected.join(', ')})`);
    }
    lines.push('');
    lines.push('EXIT 0 (clean — nothing to tick off).');
    return lines.join('\n');
  }
  lines.push(`Changed nodes (${res.changedNodes.length}): ${res.changedNodes.join(', ')}`);
  if (res.rejected && res.rejected.length) {
    // OI-IMPACTED-TESTS-JUNK-NODE-IDS: state the gate's work out loud. These are
    // tokens the diff lines OFFERED that are not declared nodes in ANY revision
    // of the diagrams in this window — label prose, almost always. Shown so the
    // reader can see the parse discarding rather than have to infer it, and so a
    // genuinely-declared node wrongly landing here is visible as a tool bug.
    lines.push(`Rejected (${res.rejected.length} of ${res.candidateCount} candidate token(s) `
      + 'are not declared nodes in any in-window revision — label prose, not graph nodes): '
      + res.rejected.join(', '));
  }
  lines.push('');
  lines.push('## IMPACTED SPECS (changed node -> covering spec) — test-plan tick-off');
  if (res.impacted.length === 0) {
    lines.push('  (none)');
  } else {
    for (const { node, specs } of res.impacted) {
      lines.push(`  [ ] ${node}`);
      for (const s of specs) lines.push(`        - ${path.relative(root, s)}`);
    }
  }
  lines.push('');
  lines.push('## UNCOVERED CHANGED NODES (no covering spec) — WARNING: tester new-spec work');
  if (res.uncovered.length === 0) {
    lines.push('  (none — every changed node has a covering spec)');
  } else {
    for (const node of res.uncovered) lines.push(`  [!] ${node}  <- needs a @covers spec or an explicit test-plan waiver`);
  }
  lines.push('');
  lines.push(res.exitCode === 0
    ? 'EXIT 0 (clean — all changed nodes covered).'
    : `EXIT 2 (WARNING — ${res.uncovered.length} uncovered changed node(s); advisory, not CI-blocking).`);
  return lines.join('\n');
}

// ---- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') opts.since = argv[++i];
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--root') opts.root = argv[++i];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root || process.cwd();
  const project = opts.project
    || (fs.existsSync(path.join(root, 'work', 'ACTIVE'))
      ? fs.readFileSync(path.join(root, 'work', 'ACTIVE'), 'utf8').trim()
      : null);
  if (!opts.since) {
    process.stderr.write('usage: impacted-tests.js --since <sha> [--project <name>]\n');
    process.exit(1);
  }
  if (!project) {
    process.stderr.write('no project: pass --project or create work/ACTIVE\n');
    process.exit(1);
  }
  let res;
  try {
    res = run({ root, project, since: opts.since });
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }
  process.stdout.write(formatReport(res, { project, since: opts.since, root }) + '\n');
  // §17g sweep off AC-DEFECT-OAG-076.5: `process.exit()` does not wait for a PIPE
  // to drain, so any payload over the 64 KiB pipe buffer reaches the consumer
  // TRUNCATED. `worktree-guard scan-all --json` hit exactly that on 2026-08-19 and
  // loop-gate read the guard as unrunnable. Set exitCode; let the runtime flush.
  process.exitCode = res.exitCode;
}

if (require.main === module) main();

module.exports = {
  extractMarkedNodes,
  classStatementMarkedNodes,
  unreadClassStatementLines,
  extractNodesFromDiffLines,
  extractAllNodeIds,
  tokeniseMermaid,
  parseMermaidStructure,
  checkTagConvention,
  parseCoversTags,
  parseAliasComments,
  effectiveSpecsFor,
  resolveDiffRoot,
  shaExistsIn,
  gitShow,
  run,
  formatReport,
};
