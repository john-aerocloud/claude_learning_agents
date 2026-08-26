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

// `$(if a,b,c)`, `$(or …)`, `$(and …)` are the ONLY functions collapsed to their
// comma-separated arguments, because their arguments are the literal ALTERNATIVES and
// one of them really is the text make will use.
const MAKE_ALT_FN = /\$\((?:if|or|and)\s+([^()]*)\)/g;

// Every OTHER function computes its value, so offline we cannot know it. Collapsing one
// to its arguments INVENTS a path: `$(shell cat work/ACTIVE 2>/dev/null)` spliced into
// `work/$(PROJECT)/scripts/x.js` produced a finding for the non-existent
// `2>/dev/null/scripts/x.js` (seven of them, found by running this tool on its own
// repo). A checker that reports files nobody wrote is a checker people switch off —
// which is the exact fate of the control this whole item is about. So a computed
// function POISONS the reference and it is dropped.
const MAKE_COMPUTED_FN = /\$\([A-Za-z][A-Za-z0-9_-]*\s+[^()]*\)/g;

function expandMakeVars(str, vars, depth = 12) {
  // `$$` is an escaped dollar destined for the shell, not a make reference.
  let out = str.split('$$').join('\u0002');
  for (let i = 0; i < depth; i++) {
    const before = out;
    out = out.replace(/\$[({]([A-Za-z_][A-Za-z0-9_]*)[)}]/g,
      (_w, name) => (name in vars ? vars[name] : UNRESOLVED));
    out = out.replace(MAKE_ALT_FN, (_w, args) => args.split(',').join(' '));
    out = out.replace(MAKE_COMPUTED_FN, UNRESOLVED);
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
/**
 * Paths that are the operand of a SHELL EXISTENCE TEST, not something the recipe runs.
 *
 * `if [ -f X ]; then … else … fi` is a recipe that has been written to work in BOTH
 * worlds — the whole point is that `X` may be absent. Reporting it as "a committed make
 * target RUNS a file that is not on trunk" is false: the target runs whichever branch the
 * test selects, and the absent branch is deliberate.
 *
 * DEF-ROC-115 / v154 §F5e. This fired on `quarantine-gate`, whose `if [ -f
 * src/app/local/probe-real-bus-send.ts ]` guard exists PRECISELY because that path is the
 * DEF-ROC-076 quarantined artefact: kept on disk as evidence, never committed, and absent
 * in every fresh checkout. The gate blocked the loop on a file whose absence is the
 * contract. That is §F5e question 2 — a control must measure what it claims to, and this
 * one could not tell "runs it" from "asks whether it is there".
 *
 * Deliberately NARROW: only the operand of a file test is exempt. A path used anywhere
 * else on the line is still a reference, so `[ -f X ] && node X` still reports `X`.
 */
const FILE_TEST_OPERAND =
  /(?:\[\[?|\btest\b)\s+-[a-zA-Z]\s+([^\s'"`;|&\])]+)/g;

function fileTestOperands(line) {
  // A path is exempt only if EVERY occurrence on the line is a test operand. Strip the
  // test constructs and see what is left: `[ -f X ] && node X` still runs X, so X stays a
  // reference. Getting this wrong in the permissive direction would silently blind the
  // checker to real invocations, which is the failure it exists to prevent — so the
  // narrowness is asserted by its own test rather than left to the regex.
  const remainder = line.replace(FILE_TEST_OPERAND, ' ');
  const out = new Set();
  for (const m of line.matchAll(FILE_TEST_OPERAND)) {
    const raw = m[1];
    if (!raw || raw.includes(UNRESOLVED) || path.isAbsolute(raw)) continue;
    if (remainder.includes(raw)) continue;                      // also used outside the test
    out.add(path.normalize(raw));
  }
  return out;
}

function refsInLine(line, vars, baseDirs, exists) {
  const out = [];
  const expanded = expandMakeVars(line, vars);
  // Collected BEFORE tokenising, because tokenise() discards the `[ -f` context.
  const guarded = fileTestOperands(expanded);
  for (const tok of tokenise(expanded)) {
    if (!tok || tok.startsWith('-') || tok.startsWith('$')) continue;
    if (tok.includes(UNRESOLVED)) continue;
    if (/[*?[\]{}]/.test(tok)) continue;                        // a glob names no one file
    if (!CODE_EXT.test(tok)) continue;
    if (path.isAbsolute(tok)) continue;                         // not ours to track
    const norm = path.normalize(tok);
    if (norm.startsWith('..')) continue;                        // outside the repo
    if (guarded.has(norm)) continue;                            // `[ -f X ]` — asks, does not run
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
  const nestedRepoTracked = world.nestedRepoTracked || (() => null);
  const foreignTerritory = world.foreignTerritory || (() => false);
  // `untracked` and `dangling` are counted separately because the loop-gate wiring
  // gives them DIFFERENT severities (§F8a): an untracked file still exists on a disk,
  // so stopping the line is the remedy and it BLOCKS; a dangling one is already gone,
  // so stopping recovers nothing and it is advisory.
  const counts = {
    makefilesScanned: 0, refs: 0, tracked: 0, generated: 0, foreign: 0,
    untracked: 0, dangling: 0,
  };
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

        // ANOTHER REPO'S TERRITORY. A multi-project orchestrating makefile (the
        // agent-system root Makefile) runs files that live inside nested project repos
        // it deliberately gitignores, so "do YOU track this?" is the wrong question.
        // Delegate to the owning repo when it is present; skip when it is not, because
        // whether a sibling project is checked out is machine-local and says nothing
        // about trunk. Ownership is a STRUCTURAL fact — never the ignore rule alone,
        // which would have excused all six founding firings.
        // ORDER MATTERS, and both possible mistakes were made and caught here.
        //
        // A reference is tried against every candidate base dir, so a spurious candidate
        // can land in an unrelated nested repo or in ignored, foreign ground. Taking the
        // first ownership answer let a spurious `false` report a real foreign file as
        // dangling. Then taking territory too early did the OPPOSITE and far worse: a
        // spurious foreign candidate exonerated a genuinely untracked file, and deleting
        // this very tool from the index produced NO finding — the check went blind to its
        // own disappearance while still saying PASS.
        //
        // So the candidates are consulted STRONGEST EVIDENCE FIRST, and PRESENCE IN THE
        // SCANNED REPO OUTRANKS TERRITORY: a file that is sitting right there, untracked,
        // is the defect, whatever some other candidate path would have been.
        if (cands.some((c) => nestedRepoTracked(c) === true)) { counts.foreign++; continue; }
        const present = cands.find((c) => exists(c));
        if (!present && cands.some((c) => foreignTerritory(c))) { counts.foreign++; continue; }
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

  // --- another repo's territory (real-world side of the two predicates) -----
  // A path is foreign when a DIFFERENT git repository owns the ground it sits on. That
  // is a structural fact about repositories, deliberately NOT "the scanned repo ignores
  // it" — an ignore rule as the excuse would have excused all six founding firings,
  // since src/app/scripts was itself ignored. Territory therefore additionally requires
  // that the scanned repo track NOTHING beneath the directory.
  const trackedPrefixes = new Set();
  for (const p of listed) {
    const parts = p.split('/');
    for (let i = 1; i <= parts.length - 1; i++) trackedPrefixes.add(parts.slice(0, i).join('/'));
  }

  const ancestors = (rel) => {
    const parts = rel.split('/');
    const out = [];
    for (let i = parts.length - 1; i >= 1; i--) out.push(parts.slice(0, i).join('/'));
    return out;                                        // nearest-first
  };

  const nestedRepoTracked = (rel) => {
    for (const dir of ancestors(rel)) {
      if (!fs.existsSync(path.join(repoDir, dir, '.git'))) continue;
      const sub = rel.slice(dir.length + 1);
      try {
        const out = execFileSync('git', ['-C', path.join(repoDir, dir), 'ls-files', '-z', '--', sub],
          { encoding: 'utf8' }).split('\0').filter(Boolean);
        return out.length > 0;
      } catch { return false; }
    }
    return null;                                       // no nested repo owns it
  };

  // The TRAILING SLASH matters. A directory-only pattern (`/work/*/`) does not match a
  // path git cannot see is a directory, and a sibling project that is not checked out is
  // exactly that case — so `check-ignore work/Viggo-fix` says "not ignored" while
  // `check-ignore work/Viggo-fix/` correctly says it is. Ask both.
  const ignoredDir = (dir) => [dir, dir + '/'].some((d) => {
    try {
      execFileSync('git', ['-C', repoDir, 'check-ignore', '-q', '--', d], { stdio: 'ignore' });
      return true;
    } catch { return false; }
  });

  const foreignTerritory = (rel) => ancestors(rel).some(
    (dir) => !trackedPrefixes.has(dir) && ignoredDir(dir));

  return {
    repo: label || repoDir,
    nestedRepoTracked,
    foreignTerritory,
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
if (require.main === module) {
  // §17g sweep off AC-DEFECT-OAG-076.5: `process.exit()` does not wait for a PIPE
  // to drain, so any payload over the 64 KiB pipe buffer reaches the consumer
  // TRUNCATED. `worktree-guard scan-all --json` hit exactly that on 2026-08-19 and
  // loop-gate read the guard as unrunnable. Set exitCode; let the runtime flush.
  process.exitCode = main(process.argv.slice(2));
}
