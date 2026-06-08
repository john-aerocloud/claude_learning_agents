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
 *       `:::s005h3changed`, `:::s007aChanged`, `class wsfn,conn,games changed;`
 *       — so the rule is: any class name CONTAINING "changed" (case-insensitive)
 *       is a change mark; `:::stable`/`:::delivered`/`:::store`/`:::gate`/
 *       `:::actor`/`:::compute`/`:::secret` are NOT.)
 *
 *      WHY DIFF-SOURCED, NOT A FULL-FILE SCAN (OI-42, proven on s009):
 *      classDef marks are CLEARED at delivery by RECOLOURING the classDef (green)
 *      while the class NAME still contains "changed" forever. A full working-tree
 *      scan for any "changed"-named class therefore re-reports every prior slice's
 *      long-delivered nodes regardless of the SINCE window (s009 over-reported
 *      ~half its 79 nodes as stale prior-slice marks). A stale mark committed N
 *      slices ago appears in NEITHER diff, so a diff-sourced set drops it; only
 *      marks/edges/decls that moved IN the window survive.
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
 * three behaviours with fixtures + a throwaway git repo. No credentials.
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

// Statement form: `class A,B,C className;`
const CLASS_STMT_RE = /(?:^|\s)class\s+([A-Za-z0-9_,\s-]+?)\s+([A-Za-z0-9_]+)\s*;/g;

/**
 * Node ids carrying a CHANGED mark in the given .mmd text (working-tree state).
 */
function extractMarkedNodes(text) {
  const out = new Set();
  let m;
  INLINE_MARK_RE.lastIndex = 0;
  while ((m = INLINE_MARK_RE.exec(text)) !== null) {
    if (isChangedClass(m[2])) out.add(m[1]);
  }
  CLASS_STMT_RE.lastIndex = 0;
  while ((m = CLASS_STMT_RE.exec(text)) !== null) {
    if (!isChangedClass(m[2])) continue;
    for (const id of m[1].split(',')) {
      const t = id.trim();
      if (t) out.add(t);
    }
  }
  return [...out];
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

    // (1) `class A,B,C <...changed...>;` statement — only when the class is a
    //     change mark (a `class A,B stable;` line is not a change).
    CLASS_STMT_RE.lastIndex = 0;
    let cm = CLASS_STMT_RE.exec(body);
    if (cm && /^\s*class\s/.test(body)) {
      if (isChangedClass(cm[2])) {
        for (const id of cm[1].split(',')) {
          const t = id.trim();
          if (t) out.add(t);
        }
      }
      continue; // a `class ...;` statement is not a decl/edge line
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
 * @covers tags in a spec's text -> Map(nodeId -> Set(specPath)). A tag is a
 * `@covers a, b, c` list; a trailing ` (annotation)` is stripped; tokens that
 * are pure annotations (start with `(`) are ignored.
 */
function parseCoversTags(text, specPath) {
  const map = new Map();
  const re = /@covers\s+(.+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // strip a trailing parenthetical annotation: "a, b (class-deps.mmd s005-h3)"
    const list = m[1].replace(/\([^)]*\)\s*$/, '').trim();
    for (const raw of list.split(',')) {
      const id = raw.trim().replace(/[.,;]+$/, '');
      if (!id || id.startsWith('(')) continue;
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(specPath);
    }
  }
  return map;
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
function gitDiff(root, revs, files) {
  const rel = files.map((f) => path.relative(root, f));
  try {
    return execFileSync('git', ['-C', root, 'diff', ...revs, '--', ...rel],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const what = revs.length ? `(is "${revs.join(' ')}" a valid range?)` : '(working tree)';
    throw new Error(`git diff failed ${what}: ${e.message}`);
  }
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
  if (files.length) {
    const committedDiff = gitDiff(root, [`${since}..HEAD`], files);
    for (const id of extractNodesFromDiffLines(committedDiff)) changed.add(id);
    const workingDiff = gitDiff(root, [], files);
    for (const id of extractNodesFromDiffLines(workingDiff)) changed.add(id);
  }
  const changedNodes = [...changed].sort();

  // 2. covers index over committed specs
  const coversIndex = buildCoversIndex(findSpecFiles(root, project));

  // 3. partition
  const impacted = [];
  const uncovered = [];
  for (const node of changedNodes) {
    const set = coversIndex.get(node);
    if (set && set.size) {
      impacted.push({ node, specs: [...set].sort() });
    } else {
      uncovered.push(node);
    }
  }

  const exitCode = uncovered.length ? 2 : 0;
  return { changedNodes, impacted, uncovered, exitCode };
}

// ---- plain-text report ------------------------------------------------------

function formatReport(res, { project, since, root }) {
  const lines = [];
  lines.push(`# impacted-tests — project=${project} since=${since}`);
  lines.push('');
  if (res.changedNodes.length === 0) {
    lines.push('No changed/added/removed nodes in architecture/dependencies/*.mmd.');
    lines.push('');
    lines.push('EXIT 0 (clean — nothing to tick off).');
    return lines.join('\n');
  }
  lines.push(`Changed nodes (${res.changedNodes.length}): ${res.changedNodes.join(', ')}`);
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
  process.exit(res.exitCode);
}

if (require.main === module) main();

module.exports = {
  extractMarkedNodes,
  extractNodesFromDiffLines,
  parseCoversTags,
  run,
  formatReport,
};
