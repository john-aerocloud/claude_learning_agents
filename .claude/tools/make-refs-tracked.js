'use strict';
/**
 * make-refs-tracked.js — OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS, AC-GI.3.
 * =====================================================================================
 *
 * A FILE A COMMITTED `make` TARGET RUNS MUST BE ON TRUNK. This asserts it.
 *
 * WHY IT EXISTS. A blanket `.gitignore` on `src/app/scripts/*.mjs` silently swallowed a
 * committed tool SIX times in the OagEventSource repo. Every firing looks identical:
 * an engineer writes a re-runnable tool, wires a `make` target to it, `git add`s it,
 * git says nothing, the suite is green, and the tool is on exactly one machine. The
 * most recent (DEFECT-OAG-070) was `capture-ddb-stream-records.mjs` — the tool that
 * produces the real AWS-shaped fixture that whole fix depends on.
 *
 * That is the DEF-ROC-001 / v89 FALSE-GREEN shape: nothing goes red, because nothing
 * was looking. The established remedy had become "append another negation line", and
 * the `.gitignore`'s negation list is therefore a written record of the trap firing.
 * A rule that must be exempted every time it is used is not a rule.
 *
 * Re-shaping that one ignore fixes the six that happened. THIS is the general form,
 * and it is deliberately indifferent to which ignore rule, which directory, or which
 * project caused the omission — the trap is generic (its founding instance,
 * DEF-ROC-001, was a different project entirely).
 *
 * WHAT IT CHECKS. For every path-like reference in a recipe of a COMMITTED makefile:
 *
 *   tracked    -> fine.
 *   generated  -> fine, IF some committed generator declares it as an output
 *                 (`--outfile=`/`-o`/`>` in a makefile recipe or a package.json
 *                 script). Such a file is reproducible from trunk by definition.
 *   untracked  -> FINDING. It is on this machine and nowhere else.
 *   dangling   -> FINDING. It is on no machine: the target outlived its file. Same
 *                 false green from the other side — `make sync-linear` sat on trunk
 *                 for months after `scripts/sync-linear.py` was retired.
 *
 * THE EXEMPTION IS DERIVED, NEVER DECLARED. It would have been far easier to exempt
 * `build/` by name. That is the negation list again — a hand-kept exemption list is
 * the thing this item exists to delete, and a directory-name rule would have EXCUSED
 * the sixth firing rather than caught it. `--outfile=` is a fact about a committed
 * generator, so the exemption set maintains itself.
 *
 * NOT FLOODING IS PART OF THE JOB (§F8a — a gate blocks only on harm stopping
 * relieves). A check with a standing backlog is a check people learn to ignore, so:
 * only COMMITTED makefiles are scanned (`Makefile.orig` runs nothing and is not
 * evidence); globs, prose inside an `echo`, absolute paths, paths outside the repo,
 * and references carrying an unresolvable variable are not findings. On the repo this
 * was written for the honest count is ZERO, so there is no ratchet baseline here and
 * no floor to erode — a count above zero is a regression, full stop.
 *
 * Pure git + filesystem. NO creds, NO network.
 *
 *   node .claude/tools/make-refs-tracked.js --project OagEventSource [--repo-root R]
 *   node .claude/tools/make-refs-tracked.js --repo work/OagEventSource [--json]
 *
 * Exit 0 = clean. Exit 1 = findings. Exit 2 = could not run (never silent: an
 * unevaluated precondition is not a met one, §17c.2).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// A reference carrying a variable we could not resolve is marked with this and
// dropped: guessing at it would invent findings, and inventing findings is how a
// check earns the right to be ignored.
const UNRESOLVED = '\u0001';

// Extensions that denote CODE THAT GETS RUN. Deliberately narrow: this is the
// defect class (a tool a target executes), and every extra extension buys noise.
const CODE_EXT = /\.(mjs|cjs|js|ts|tsx|sh|bash|py)$/;

const MAKEFILE_NAME = /(^|\/)(GNUmakefile|[Mm]akefile|[^/]+\.mk)$/;

// --- make variables --------------------------------------------------------

function parseMakeVars(text) {
  const vars = Object.create(null);
  for (const line of text.split('\n')) {
    if (line.startsWith('\t')) continue;                       // a recipe, not an assignment
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(:|\?|\+)?=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (m[2] === '?' && m[1] in vars) continue;                 // ?= defers to a set value
    vars[m[1]] = m[3];
  }
  return vars;
}

// Functions whose arguments may contain a path we care about. Collapsed to their
// comma-separated arguments joined by a space, which is enough to expose the path
// without pretending to evaluate make.
const MAKE_FN = /\$\((if|or|and|shell|wildcard|firstword|lastword|sort|strip|abspath|realpath|notdir|dir|addprefix|addsuffix)\s+([^()]*)\)/g;

function expandMakeVars(str, vars, depth = 12) {
  // `$$` is an escaped dollar destined for the shell, not a make reference.
  let out = str.split('$$').join('\u0002');
  for (let i = 0; i < depth; i++) {
    const before = out;
    out = out.replace(/\$[({]([A-Za-z_][A-Za-z0-9_]*)[)}]/g,
      (_w, name) => (name in vars ? vars[name] : UNRESOLVED));
    out = out.replace(MAKE_FN, (_w, _fn, args) => args.split(',').join(' '));
    if (out === before) break;
  }
  return out.split('\u0002').join('$');
}

// --- reference extraction --------------------------------------------------

/** Directories a recipe may run inside, so a workspace-relative path resolves. */
function collectBaseDirs(lines, vars) {
  const dirs = new Set(['']);
  for (const raw of lines) {
    const line = expandMakeVars(raw, vars);
    const patterns = [
      /--prefix[= ]\s*([^\s'"`;|&)]+)/g,
      /(?:^|\s)-C\s+([^\s'"`;|&)]+)/g,
      /chdir\(\s*['"]([^'"]+)['"]\s*\)/g,
      /(?:^|[\s;&])cd\s+([^\s'"`;|&)]+)/g,
    ];
    for (const re of patterns) {
      for (const m of line.matchAll(re)) {
        const d = m[1];
        if (!d || d.includes(UNRESOLVED) || path.isAbsolute(d)) continue;
        const n = path.normalize(d);
        if (n.startsWith('..')) continue;
        dirs.add(n === '.' ? '' : n);
      }
    }
  }
  return [...dirs];
}

function tokenise(line) {
  // Strip make's recipe-line prefixes (@ silences, - ignores errors, + forces).
  const body = line.replace(/^\t[@\-+]*/, '');
  return body.split(/[\s'"`]+/).map((t) => {
    // `--outfile=X`, `ENV=X`, `SPEC=X` — the value is the reference.
    const eq = t.indexOf('=');
    if (eq >= 0) t = t.slice(eq + 1);
    return t.replace(/^[({<>|&;,]+/, '').replace(/[)}<>|&;,\\]+$/, '');
  });
}

/**
 * Candidate references in a recipe line. `exists` is consulted only to decide
 * whether a bare word (no separator) is a path at all — `dora.py` inside an
 * `echo "… dora.py check-drift …"` is prose, and a checker that reports prose is a
 * checker nobody runs.
 */
function refsInLine(line, vars, baseDirs, exists) {
  const out = [];
  for (const tok of tokenise(expandMakeVars(line, vars))) {
    if (!tok || tok.startsWith('-') || tok.startsWith('$')) continue;
    if (tok.includes(UNRESOLVED)) continue;
    if (/[*?[\]{}]/.test(tok)) continue;                        // a glob names no one file
    if (!CODE_EXT.test(tok)) continue;
    if (path.isAbsolute(tok)) continue;                         // not ours to track
    const norm = path.normalize(tok);
    if (norm.startsWith('..')) continue;                        // outside the repo
    if (!norm.includes(path.sep) && !baseDirs.some((d) => exists(path.posix.join(d, norm)))) continue;
    out.push(norm);
  }
  return out;
}

// --- generator outputs (the DERIVED exemption set) -------------------------

const OUTPUT_DECL = /--outfile[= ]\s*([^\s'"`;|&)]+)|(?:^|\s)-o\s+([^\s'"`;|&)]+)|>\s*([^\s'"`;|&<]+)/g;

function outputsIn(text, baseDir, vars) {
  const out = [];
  for (const m of expandMakeVars(text, vars).matchAll(OUTPUT_DECL)) {
    const raw = m[1] || m[2] || m[3];
    if (!raw || raw.includes(UNRESOLVED) || path.isAbsolute(raw)) continue;
    const n = path.normalize(path.posix.join(baseDir, raw));
    if (n.startsWith('..')) continue;
    out.push(n);
  }
  return out;
}

// --- the analysis (pure) ---------------------------------------------------

/**
 * @param {{makefiles: {path:string,text:string}[],
 *          packageJsons: {path:string,json:object}[],
 *          tracked: Set<string>, exists: (p:string)=>boolean, repo?: string}} world
 */
function analyse(world) {
  const { tracked, exists } = world;
  // `untracked` and `dangling` are counted separately because the loop-gate wiring
  // gives them DIFFERENT severities (§F8a): an untracked file still exists on a disk,
  // so stopping the line is the remedy and it BLOCKS; a dangling one is already gone,
  // so stopping recovers nothing and it is advisory.
  const counts = { makefilesScanned: 0, refs: 0, tracked: 0, generated: 0, untracked: 0, dangling: 0 };
  const findings = [];

  // Only COMMITTED makefiles. An untracked one is not a committed make target.
  const makefiles = (world.makefiles || [])
    .filter((m) => tracked.has(m.path) && MAKEFILE_NAME.test(m.path));
  counts.makefilesScanned = makefiles.length;

  const generated = new Set();
  for (const mk of makefiles) {
    const vars = parseMakeVars(mk.text);
    for (const line of mk.text.split('\n')) {
      if (line.startsWith('\t')) generated.add.apply(generated, []);
      if (line.startsWith('\t')) for (const o of outputsIn(line, '', vars)) generated.add(o);
    }
  }
  for (const pkg of world.packageJsons || []) {
    if (!tracked.has(pkg.path)) continue;                        // uncommitted: not a generator
    const dir = path.dirname(pkg.path) === '.' ? '' : path.dirname(pkg.path);
    const vars = Object.create(null);
    for (const script of Object.values((pkg.json && pkg.json.scripts) || {})) {
      for (const o of outputsIn(String(script), dir, vars)) generated.add(o);
    }
  }

  const seen = new Set();
  for (const mk of makefiles) {
    const lines = mk.text.split('\n');
    const vars = parseMakeVars(mk.text);
    const baseDirs = collectBaseDirs(lines.filter((l) => l.startsWith('\t')), vars);
    lines.forEach((line, i) => {
      if (!line.startsWith('\t')) return;
      for (const ref of refsInLine(line, vars, baseDirs, exists)) {
        const key = `${mk.path}\u0000${ref}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts.refs++;
        const cands = baseDirs.map((d) => path.posix.join(d, ref));
        if (cands.some((c) => generated.has(c))) { counts.generated++; continue; }
        if (cands.some((c) => tracked.has(c))) { counts.tracked++; continue; }
        const present = cands.find((c) => exists(c));
        findings.push(present
          ? {
            kind: 'untracked', ref, resolved: present, makefile: mk.path, line: i + 1,
            message: `${mk.path}:${i + 1} runs ${present}, which is ON DISK BUT NOT TRACKED — `
              + 'it exists on this machine and nowhere else, and nothing regenerates it. A green '
              + 'suite here is a FALSE GREEN (DEF-ROC-001 / v89). Remedy: commit it, or (if it '
              + 'really is generated) declare its generator so the exemption is derived. If a '
              + '.gitignore rule swallowed it, FIX THE RULE — do not add a negation.',
          }
          : {
            kind: 'dangling', ref, resolved: null, makefile: mk.path, line: i + 1,
            message: `${mk.path}:${i + 1} runs ${ref}, WHICH IS NOT IN THE REPO AT ALL — the `
              + 'target outlived its file, so it cannot run for anyone. Remedy: restore the file '
              + 'or delete the target.',
          });
      }
    });
  }

  for (const f of findings) counts[f.kind]++;
  findings.sort((a, b) => (a.makefile + a.ref).localeCompare(b.makefile + b.ref));
  return { repo: world.repo, verdict: findings.length ? 'FAIL' : 'PASS', counts, findings };
}

// --- the real world -------------------------------------------------------

function collectRepo(repoDir, label) {
  const listed = execFileSync('git', ['-C', repoDir, 'ls-files', '-z'],
    { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  const tracked = new Set(listed);
  const read = (rel) => fs.readFileSync(path.join(repoDir, rel), 'utf8');

  const makefiles = listed.filter((p) => MAKEFILE_NAME.test(p) && !p.includes('node_modules/'))
    .map((p) => ({ path: p, text: read(p) }));

  const packageJsons = [];
  for (const p of listed) {
    if (path.basename(p) !== 'package.json' || p.includes('node_modules/')) continue;
    try { packageJsons.push({ path: p, json: JSON.parse(read(p)) }); } catch { /* not our problem */ }
  }

  return {
    repo: label || repoDir,
    makefiles,
    packageJsons,
    tracked,
    exists: (rel) => fs.existsSync(path.join(repoDir, rel)),
  };
}

// --- CLI ------------------------------------------------------------------

function parseArgs(argv) {
  const a = { json: false, repoRoot: path.resolve(__dirname, '..', '..') };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--repo') a.repo = argv[++i];
    else if (t === '--project') a.project = argv[++i];
    else if (t === '--repo-root') a.repoRoot = argv[++i];
  }
  return a;
}

function main(argv) {
  const a = parseArgs(argv);
  let dir;
  let label;
  if (a.repo) { dir = path.resolve(a.repo); label = a.repo; }
  else if (a.project) { label = path.join('work', a.project); dir = path.join(a.repoRoot, label); }
  else {
    process.stderr.write('make-refs-tracked: need --repo <dir> or --project <name>\n');
    return 2;
  }

  let report;
  try {
    report = analyse(collectRepo(dir, label));
  } catch (e) {
    process.stderr.write(`make-refs-tracked: NOT ESTABLISHED — could not read ${dir} `
      + `(${e.name}: ${String(e.message).slice(0, 200)}). An unrunnable check is not a clean one.\n`);
    return 2;
  }

  if (a.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const c = report.counts;
    process.stdout.write(`make-refs-tracked ${report.verdict} [${label}] — `
      + `${c.makefilesScanned} committed makefile(s), ${c.refs} reference(s): `
      + `${c.tracked} tracked, ${c.generated} generated, ${report.findings.length} finding(s)\n`);
    for (const f of report.findings) process.stdout.write(`  ${f.kind.toUpperCase()} ${f.message}\n`);
  }
  return report.verdict === 'FAIL' ? 1 : 0;
}

module.exports = {
  analyse, collectRepo, parseMakeVars, expandMakeVars, refsInLine, outputsIn, collectBaseDirs, main,
};
if (require.main === module) process.exit(main(process.argv.slice(2)));
