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

function projectOf(row) {
  const namespaced = /^EXP-([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(row.id);
  if (namespaced) return namespaced[1];
  for (const p of KNOWN_PROJECTS) {
    if (new RegExp(`\\b${p}\\b`).test(row.routed || '')) return p;
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
  const seenRow = new Map();
  for (const r of rows) {
    if (seenRow.has(r.id)) {
      violations.push(`C2 duplicate registry row \`${r.id}\` at line ${r.line} (already defined at line ${seenRow.get(r.id)})`);
    } else seenRow.set(r.id, r.line);
  }
  const seenSection = new Map();
  for (const s of sections) {
    if (seenSection.has(s.id)) {
      violations.push(`C2 duplicate \`## ${s.id}\` section at line ${s.line} (already defined at line ${seenSection.get(s.id)}) — a continuation belongs in the row's scoring notes, not a second section under the same id`);
    } else seenSection.set(s.id, s.line);
  }

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

// --- driver ---------------------------------------------------------------

function lint(root) {
  const violations = [];
  const info = [];
  const read = (rel) => {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) {
      violations.push(`C0 missing ${rel} (nothing was checked, which is not the same as clean)`);
      return null;
    }
    return fs.readFileSync(p, 'utf8');
  };

  const proc = read('process/process-current.md');
  if (proc !== null) violations.push(...checkHeadingVersion(proc).violations);

  const exps = read('process/experiments.md');
  if (exps !== null) {
    const r = checkExperiments(exps);
    violations.push(...r.violations);
    info.push(...r.info);
  }
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

module.exports = { checkHeadingVersion, parseRegistry, checkExperiments, lint, FROZEN_LEGACY_IDS, PER_PROJECT_CAP };
