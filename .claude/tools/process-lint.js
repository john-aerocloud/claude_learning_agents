#!/usr/bin/env node
'use strict';
/**
 * process-lint — STRUCTURAL integrity gate for the process files (process §25a / §27.5).
 *
 * `doc-lint` is a DENYLIST scanner: it catches live docs that still name a retired
 * mechanic. It cannot catch a file that is internally inconsistent, and two such
 * inconsistencies have now each survived many versions:
 *
 *  1. `# Current Process — vNN` went STALE for 19 versions (found at v138) and was
 *     stale again 2 versions later (v142 heading against a v144 file, found at v145).
 *     Every agent that reads the heading to learn the current version reads a lie.
 *
 *  2. `process/experiments.md` mints experiment ids from a GLOBAL monotonic counter,
 *     read PER-INSTANCE from whatever the worktree happens to hold. On 2026-08-20 two
 *     different experiments were both allocated `EXP-142` — main's test-requirement-gate
 *     ratchet and ROC's screen-viewport hypothesis — and v144 recorded that it had no
 *     standing to silently relabel either. The same day, DEF-ROC-077 was a GLOBAL
 *     declared-exception registry scored against a PER-PROJECT sweep, whose printed
 *     remedy would have DESTROYED another project's rows. Same defect class, two
 *     registries: shared global namespace, per-instance writers, no uniqueness check.
 *
 * Ids are therefore PER-PROJECT namespaced (`EXP-<PROJ>-<nnn>`) from v145, exactly as
 * work items already are, and the bare-numeric space is FROZEN — collisions become
 * impossible by construction rather than detected after the fact.
 *
 * CHECKS (hard — any hit exits 1):
 *   C1  the `# Current Process — vNN` heading matches the highest `<!-- vNN ...`
 *       retro-record comment in the same file.
 *   C2  every `## EXP-<id>` section has a matching row in the registry table, and no
 *       id is DEFINED twice (two rows, or two sections). A section with no row is
 *       invisible to the WIP cap it is supposed to be governed by — that invisibility
 *       is what made "8 active, AT cap" untrue for two consecutive retros.
 *   C3  bare-numeric `EXP-<n>` ids are LEGACY and the set is FROZEN. Any bare-numeric
 *       id outside the frozen set fails, so no new row can be minted from the old
 *       global counter.
 *
 *   C4  active rows per project are at or under the per-project hard cap of 8, and no row
 *       is unattributed (a row naming no project sits outside every cap). v143 scoped the
 *       cap per-project and routed its enforcement to "a committed tool"; nothing was built,
 *       so it stayed prose — and §25a's own text records that the 3-strikes rule it protects
 *       "has never once fired in its life".
 *
 *   C5  every QUEUE named in a `work/<project>/queues/policy.csv` is REACHABLE from the queue
 *       map in process/machinery/state-graphs.json, and every EXPERIMENT a knob cites
 *       exists in the registry or the archive. `deploy,wip_limit,1` was declared in
 *       every project and in the _TEMPLATE, and NO state maps to a `deploy` queue — the
 *       queue can never have a member, so the declared serialisation was unenforceable
 *       BY CONSTRUCTION and read as a control for months (DEF-ROC-119). The same day,
 *       three live `wip.*` knobs cited `EXP-ROC-005`, which exists nowhere, so the limit
 *       in force had never been scoreable. Two orphan declarations, one class.
 *
 * What this tool does NOT do: score rows, or block on a row past its horizon still at 0/N.
 * That needs the item event stream and belongs in `loop-gate` (still owed, §25a).
 *
 * The registry table is the region BEFORE the first `## ` section heading. Sections
 * contain their own tables whose first column is sometimes an EXP id (a cross-instance
 * summary), and counting those as registry rows would make C2 pass vacuously.
 *
 * Usage:  node .claude/tools/process-lint.js [--root <dir>] [--json]
 * Exit:   0 clean · 1 violations · 2 usage/IO error
 */

const fs = require('fs');
const path = require('path');

// Bare-numeric ids that legitimately live in process/experiments.md. Frozen at v145:
// nothing may be added. A new experiment takes a namespaced id (`EXP-ROC-001`).
const FROZEN_LEGACY_IDS = new Set([
  'EXP-127', 'EXP-128', 'EXP-129', 'EXP-131', 'EXP-132',
  'EXP-134', 'EXP-135', 'EXP-142', 'EXP-143',
]);

// Projects an id or a `routed` cell may name. Used for the per-project INFO count.
const KNOWN_PROJECTS = ['ROC', 'OagEventSource', 'AdixOut', 'OperationalFlowSimulator', 'OAG'];

// One project, two spellings. A project's experiment ids use the SAME short token as its work
// items (`EXP-OAG-001` beside `DEFECT-OAG-nnn`), while its `routed` cells spell the project out.
// Both must fold to ONE name or the per-project cap in C4 is silently doubled — the cap defeated
// by an alias rather than by an argument, which is this registry's own recurring failure class
// (a control that exists, is believed, and does not fire). Canonical name on the RIGHT.
const PROJECT_ALIASES = { OAG: 'OagEventSource', OFS: 'OperationalFlowSimulator' };

const canonicalProject = (p) => PROJECT_ALIASES[p] || p;

const PER_PROJECT_CAP = 8;

// --- process-current.md -----------------------------------------------------

function checkHeadingVersion(text) {
  const violations = [];
  const heading = /^#\s+Current Process\s+[—-]\s+v(\d+)\s*$/m.exec(text);
  if (!heading) {
    violations.push('C1 process-current.md has no `# Current Process — vNN` heading');
    return { violations, heading: null, latest: null };
  }
  const versions = [...text.matchAll(/^<!--\s*v(\d+)\b/gm)].map((m) => Number(m[1]));
  if (versions.length === 0) {
    violations.push('C1 process-current.md has no `<!-- vNN ...` retro-record comment to check the heading against');
    return { violations, heading: Number(heading[1]), latest: null };
  }
  const latest = Math.max(...versions);
  const declared = Number(heading[1]);
  if (declared !== latest) {
    violations.push(
      `C1 stale version heading: "# Current Process — v${declared}" but the highest retro record is v${latest} `
      + `(every agent that reads the heading to learn the current version reads v${declared})`
    );
  }
  return { violations, heading: declared, latest };
}

// --- experiments.md --------------------------------------------------------

/**
 * Split the registry table (before the first `## ` heading) from the sections.
 * Returns { rows: [{id, line, routed}], sections: [{id, line}] }.
 */
function parseRegistry(text) {
  const lines = text.split('\n');
  const firstSection = lines.findIndex((l) => /^##\s/.test(l));
  const tableEnd = firstSection === -1 ? lines.length : firstSection;

  const rows = [];
  for (let i = 0; i < tableEnd; i++) {
    const m = /^\|\s*(EXP-[A-Za-z0-9-]+)\s*\|(.*)$/.exec(lines[i]);
    if (m) rows.push({ id: m[1], line: i + 1, routed: m[2] });
  }

  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(EXP-[A-Za-z0-9-]+)\b/.exec(lines[i]);
    if (m) sections.push({ id: m[1], line: i + 1 });
  }
  return { rows, sections };
}

/**
 * Index `entries` ({id, line}) by id, first occurrence wins, reporting every repeat
 * through `onDuplicate(id, line, firstLine)`. C2's two duplicate checks are the same
 * operation over two populations, and C5 needs the same notion of "an id this registry
 * declares" — one place, so the three can never disagree about what a declaration is.
 */
function indexById(entries, onDuplicate) {
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.id)) {
      if (onDuplicate) onDuplicate(e.id, e.line, seen.get(e.id));
    } else seen.set(e.id, e.line);
  }
  return seen;
}

function projectOf(row) {
  const namespaced = /^EXP-([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(row.id);
  if (namespaced) return canonicalProject(namespaced[1]);
  for (const p of KNOWN_PROJECTS) {
    if (new RegExp(`\\b${p}\\b`).test(row.routed || '')) return canonicalProject(p);
  }
  return 'unattributed';
}

function checkExperiments(text) {
  const violations = [];
  const info = [];
  const { rows, sections } = parseRegistry(text);

  if (rows.length === 0) {
    violations.push('C2 experiments.md registry table has no `| EXP-... |` rows — the parser found nothing to check, which is not the same as clean');
    return { violations, info };
  }

  // C2a — no id defined twice.
  const seenRow = indexById(rows, (id, line, firstLine) =>
    violations.push(`C2 duplicate registry row \`${id}\` at line ${line} (already defined at line ${firstLine})`));
  indexById(sections, (id, line, firstLine) =>
    violations.push(`C2 duplicate \`## ${id}\` section at line ${line} (already defined at line ${firstLine}) — a continuation belongs in the row's scoring notes, not a second section under the same id`));

  // C2b — every section has a row.
  for (const s of sections) {
    if (!seenRow.has(s.id)) {
      violations.push(`C2 \`## ${s.id}\` (line ${s.line}) has NO registry row — it is invisible to the per-project WIP cap it is supposed to be governed by. Give it a row, or move it out of the EXP namespace (a finding awaiting a decision is an item or an open-items entry, never an EXP section).`);
    }
  }

  // C3 — the bare-numeric id space is frozen.
  for (const r of [...rows, ...sections]) {
    if (/^EXP-\d+$/.test(r.id) && !FROZEN_LEGACY_IDS.has(r.id)) {
      violations.push(`C3 \`${r.id}\` (line ${r.line}) is a bare-numeric id outside the FROZEN legacy set — the global counter is abolished; a new experiment takes a per-project id (\`EXP-<PROJ>-<nnn>\`)`);
    }
  }

  // C4 — the per-project hard cap. v143 scoped the cap per-project and routed its
  // enforcement to "a committed tool"; nothing was built, so the cap stayed prose and
  // §25a's own record says the 3-strikes rule "has never once fired in its life".
  const byProject = new Map();
  for (const r of rows) {
    const p = projectOf(r);
    if (!byProject.has(p)) byProject.set(p, []);
    byProject.get(p).push(r.id);
  }
  for (const [p, ids] of [...byProject.entries()].sort()) {
    const n = ids.length;
    if (p === 'unattributed') {
      violations.push(`C4 ${n} row(s) name no project in the id or the routed cell (${ids.join(', ')}) — an unattributed row is outside every per-project cap, i.e. uncapped`);
      continue;
    }
    if (n > PER_PROJECT_CAP) {
      violations.push(`C4 ${p} has ${n} active rows against the per-project hard cap of ${PER_PROJECT_CAP} (over by ${n - PER_PROJECT_CAP}) — retire one to open one (adopt or kill), do not re-excuse it: ${ids.join(', ')}`);
    } else {
      info.push(`${p}: ${n}/${PER_PROJECT_CAP} active row(s)`);
    }
  }
  return { violations, info };
}


// --- queues/policy.csv orphan declarations (C5, DEF-ROC-119) ----------------

// Reserved pseudo-queues: rows read by work-items.py that are NOT item queues and so
// have no state mapping by design. `_global` carries repo-wide knobs
// (`max_backlog_age_days`). Keep this list SHORT and justified — it is the ignore
// list, and widening it to move a number is how this check would be defeated.
const RESERVED_POLICY_QUEUES = new Set(['_global']);

/**
 * Parse state-graphs.json once, for every check that reads it.
 *
 * The file is read by MORE THAN ONE check (C5 reads `queue_map`, C6 reads `types`
 * against it), and each of them owes the same two answers when it will not parse:
 * nothing was checked, and that is NOT the same as clean. Parsing it in one place
 * keeps that verdict single-sourced rather than re-derived per check.
 *
 * Returns `{ graphs, error }` — exactly one of the two is set.
 */
function parseGraphs(graphsText) {
  try {
    return { graphs: JSON.parse(graphsText) || {}, error: null };
  } catch (e) {
    return { graphs: null, error: e.message };
  }
}

/** Non-null values of state-graphs.json's queue_map: the queues an item can be IN. */
function reachableQueues(graphs) {
  const map = (graphs || {}).queue_map || {};
  const out = new Set();
  for (const [state, q] of Object.entries(map)) {
    if (state.startsWith('_')) continue;      // `_comment`
    if (typeof q === 'string' && q) out.add(q);
  }
  return out;
}

/**
 * Every `EXP-...` id this repo has ever registered: the live registry's rows AND the
 * archive's. An ARCHIVED experiment is a real experiment — a knob citing one is
 * scoreable against a recorded result, and failing those would make C5 unusable on the
 * first run, which is how a gate gets switched off instead of obeyed. The archive read
 * accepts the three STRUCTURAL forms an archived id takes (below) and NOT a bare prose
 * mention: the id this check exists to catch, `EXP-ROC-005`, is named inside two OTHER
 * experiments' archived rows, so "mentioned anywhere" would pass it.
 */
function knownExperimentIds(registryText, archiveText) {
  const ids = new Set();
  if (registryText) {
    const { rows, sections } = parseRegistry(registryText);
    for (const e of [...rows, ...sections]) ids.add(e.id);
  }
  if (archiveText) {
    for (const re of ARCHIVE_DECLARATION_FORMS) {
      for (const m of archiveText.matchAll(re)) ids.add(m[1]);
    }
  }
  return ids;
}

// The three STRUCTURAL forms an id takes in experiments-archive.md. A retired row is
// re-quoted INDENTED under its retirement bullet, so `^|` alone misses EXP-022 — the
// most-cited id in every policy.csv — and reports it as existing nowhere. Prose mentions
// are deliberately NOT a form: EXP-ROC-005 appears inside EXP-ROC-007's and EXP-ROC-008's
// archived rows, and accepting a mention would pass the exact id this check was built for.
const ARCHIVE_DECLARATION_FORMS = [
  /^\|\s*(EXP-[A-Za-z0-9-]+)\s*\|/gm,                          // a live-format archived row
  /^\s*-\s*Original row:\s*\|\s*(EXP-[A-Za-z0-9-]+)\s*\|/gm,  // a re-quoted retired row
  /^\s*-\s*\*\*(EXP-[A-Za-z0-9-]+)\s*[\u2014-]/gm,              // a retirement entry
];

/** Parse a policy.csv into [{queue, param, experiment, line}]. */
function parsePolicy(text) {
  const lines = text.split('\n');
  const header = (lines[0] || '').split(',').map((c) => c.trim());
  const col = (name) => header.indexOf(name);
  const qi = col('queue'); const pi = col('param'); const ei = col('experiment');
  const out = [];
  if (qi === -1) return out;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split(',').map((c) => c.trim());
    const queue = cells[qi];
    if (!queue) continue;
    out.push({
      queue, param: pi === -1 ? '' : (cells[pi] || ''),
      experiment: ei === -1 ? '' : (cells[ei] || ''), line: i + 1,
    });
  }
  return out;
}

/** `work/<project>/queues/policy.csv` for every project dir present, _TEMPLATE included. */
function policyFiles(root) {
  const workDir = path.join(root, 'work');
  if (!fs.existsSync(workDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(workDir).sort()) {
    const p = path.join(workDir, name, 'queues', 'policy.csv');
    if (fs.existsSync(p)) out.push({ project: name, rel: path.join('work', name, 'queues', 'policy.csv'), path: p });
  }
  return out;
}

function checkPolicyDeclarations(root, graphsText, registryText, archiveText) {
  const violations = [];
  const info = [];
  const files = policyFiles(root);
  if (files.length === 0) {
    // Nothing declared anywhere: nothing can be orphaned. Reported so a zero is
    // VISIBLE — "found nothing to check" must never read the same as "clean".
    info.push('C5 scanned 0 policy file(s) — no work/*/queues/policy.csv exists in this root');
    return { violations, info };
  }

  let queues = null;
  if (graphsText === null) {
    violations.push(
      'C5 NOT ESTABLISHED — process/machinery/state-graphs.json is missing, so the set of '
      + `queues an item can actually be IN cannot be read, while ${files.length} policy file(s) `
      + 'declare caps against it. Remedy: restore the queue map; a cap checked against no map '
      + 'is exactly the unenforceable declaration this check exists to find.');
    return { violations, info };
  }
  const { graphs, error } = parseGraphs(graphsText);
  if (error) {
    violations.push(`C5 NOT ESTABLISHED — process/machinery/state-graphs.json will not parse (${error}). Remedy: fix the JSON; nothing was checked, which is not the same as clean.`);
    return { violations, info };
  }
  queues = reachableQueues(graphs);

  const known = knownExperimentIds(registryText, archiveText);
  let rowCount = 0;
  for (const f of files) {
    const rows = parsePolicy(fs.readFileSync(f.path, 'utf8'));
    rowCount += rows.length;
    const seenQueue = new Set();
    const seenExp = new Set();
    for (const r of rows) {
      if (!RESERVED_POLICY_QUEUES.has(r.queue) && !queues.has(r.queue) && !seenQueue.has(r.queue)) {
        seenQueue.add(r.queue);
        violations.push(
          `C5 ${f.rel}: queue \`${r.queue}\` (first at line ${r.line}) is a PHANTOM — `
          + 'no state maps to it in process/machinery/state-graphs.json, so it can never hold '
          + 'a member and every knob declared on it is unenforceable BY CONSTRUCTION. Reachable '
          + `queues: ${[...queues].sort().join(', ')}. Remedy: either map a state to \`${r.queue}\` `
          + 'in the queue map so the declaration can bind, or DELETE these rows — a cap that '
          + 'cannot bind is worse than no cap, because it reads as a control (DEF-ROC-119).');
      }
      if (r.experiment && /^EXP-/.test(r.experiment) && !known.has(r.experiment) && !seenExp.has(r.experiment)) {
        seenExp.add(r.experiment);
        violations.push(
          `C5 ${f.rel}: knob \`${r.queue}.${r.param}\` (line ${r.line}) cites \`${r.experiment}\`, `
          + 'which has no row in process/experiments.md OR process/experiments-archive.md — so the '
          + 'limit in force has never been scoreable against anything. Remedy: register the '
          + 'experiment, or re-attribute the knob to the experiment that actually set it.');
      }
    }
  }
  info.push(`C5 scanned ${files.length} policy file(s), ${rowCount} declaration(s), against ${queues.size} reachable queue(s) and ${known.size} known experiment id(s)`);
  return { violations, info };
}

// --- driver ---------------------------------------------------------------

function lint(root) {
  const violations = [];
  const info = [];
  // OPTIONAL read: null when the file is simply absent. A file whose absence is a
  // FINDING goes through `read` below, which says so.
  const readOptional = (rel) => {
    const p = path.join(root, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const read = (rel) => {
    const text = readOptional(rel);
    if (text === null) {
      violations.push(`C0 missing ${rel} (nothing was checked, which is not the same as clean)`);
    }
    return text;
  };

  const proc = read('process/process-current.md');
  if (proc !== null) violations.push(...checkHeadingVersion(proc).violations);

  const exps = read('process/experiments.md');
  if (exps !== null) {
    const r = checkExperiments(exps);
    violations.push(...r.violations);
    info.push(...r.info);
  }

  const c5 = checkPolicyDeclarations(
    root,
    readOptional('process/machinery/state-graphs.json'),
    exps,
    readOptional('process/experiments-archive.md'));
  violations.push(...c5.violations);
  info.push(...c5.info);

  return { violations, info };
}

function main(argv) {
  let root = path.resolve(__dirname, '..', '..');
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--json') json = true;
    else {
      process.stderr.write(`process-lint: unknown argument ${argv[i]}\n`);
      return 2;
    }
  }
  const { violations, info } = lint(root);
  if (json) {
    process.stdout.write(JSON.stringify({ ok: violations.length === 0, violations, info }, null, 2) + '\n');
  } else if (violations.length === 0) {
    process.stdout.write('process-lint: clean\n');
    for (const i of info) process.stdout.write(`  i ${i}\n`);
  } else {
    process.stdout.write(`process-lint: ${violations.length} violation(s)\n`);
    for (const v of violations) process.stdout.write(`  - ${v}\n`);
    for (const i of info) process.stdout.write(`  i ${i}\n`);
  }
  return violations.length === 0 ? 0 : 1;
}

// Set `exitCode`, never a synchronous exit on main's return value: that truncates
// stdout past the 64 KiB pipe buffer. The .claude/tools sweep (AC-DEFECT-OAG-076.5)
// caught this file doing exactly that, on its first run.
if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { checkHeadingVersion, parseRegistry, indexById, checkExperiments,
  reachableQueues, knownExperimentIds, parsePolicy, policyFiles, checkPolicyDeclarations,
  lint, FROZEN_LEGACY_IDS, PER_PROJECT_CAP, RESERVED_POLICY_QUEUES, ARCHIVE_DECLARATION_FORMS };
