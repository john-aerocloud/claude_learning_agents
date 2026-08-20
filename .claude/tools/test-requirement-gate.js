#!/usr/bin/env node
/**
 * test-requirement-gate — the mechanism for a human process ruling (2026-08-02).
 *
 *   "A test was written to match the code. I do not care AT ALL about code coverage.
 *    The ONLY thing tests should be validating is the requirements. If we are making
 *    up tests for coverage that do not map onto requirements then either (a) we are
 *    wasting time, or (b) we have identified a new acceptance criteria and we need to
 *    retro as to why it wasn't discovered earlier."
 *
 * TWO LIMBS.
 *
 * LIMB 1 — AC TRACEABILITY. Every test case declares the acceptance criterion it
 * validates, using the vocabulary the codebase already uses (`AC-<ID>.<n>`, e.g.
 * AC-ML1.12, AC-BPC1.3, AC-14-5). A case with no AC reference is a violation. Per the
 * ruling the gate does NOT make the choice — an untagged test is either waste (delete
 * it) or an undiscovered acceptance criterion (register it, and the discovery gap
 * earns a retro). The gate's only job is to make the choice unavoidable.
 *
 * LIMB 2 — NO AUTHORED PRECONDITIONS. A test that constructs its precondition by
 * MUTATING a real capture cannot validate a requirement about reality: the test
 * authored the world, so it can only confirm the code. The prior must be FOLDED FROM
 * EVENTS or HARVESTED. Five rules, all static, all deliberately narrow — precision
 * over recall, because a noisy gate gets ignored (which is how `make render-diagrams`
 * ended up red on trunk for 20 days):
 *
 *   delete-on-real-capture         `delete <corpus-derived>.<leaf>`
 *   spread-override-on-real-capture `{ ...<corpus-derived>, <leaf>: … }`
 *   mutate-real-capture            `<corpus-derived>.<leaf> = …`
 *   authored-derived-prior         `{ <foldedField>: … } as [unknown as] <Aggregate>`
 *   exec-boundary-stubbed          stubbing subprocess.run / child_process
 *
 * THE FOUNDING EVIDENCE (three instances in ONE session — a pattern, not an incident):
 *   1. uc-hf041-cancellation-recovery.test.ts built its "pre-fix stream" by re-ingesting
 *      a REAL captured record with `statusDetails[].state` deleted — exactly the leaf
 *      whose presence breaks the heal. 2,171 tests green; nine real cancellations
 *      silently unhealed in prod on the passenger-facing feed.
 *   2. The awaiting_observation probe test stubbed `subprocess.run`, so it "only proved
 *      the mapping agreed with itself". Against a real `make` every probe read BROKEN.
 *   3. The provenance ledger's `read` dispositions were declared, not proven; tested
 *      differentially against `normalise()`, 8 of the engineer's own claims fell.
 *
 * WHAT LIMB 2 CANNOT SEE, stated rather than left as a comfortable silence:
 *   - a folded field hand-set through a LOCAL BUILDER (`prior({ state: 'Cancelled' })`).
 *     Catching it needs the builder's return type, and the same rule would flag the
 *     CORRECTED test verbatim. Recall gap, deliberately accepted.
 *   - instance 3's shape (a ledger disposition declared, not proven) is not statically
 *     decidable. It is closed by the differential census (`imp028-d2-inbound-key-
 *     coverage.test.ts`), which is the same discipline in a different mechanism.
 *
 * EXIT CODES. `make` cannot express a three-way exit (a recipe exiting 3 makes make
 * print `Error 3` and exit 2), so the verdict is carried by a STDOUT SENTINEL —
 * `TRG-VERDICT: PASS|FAIL|NOT-CONFIGURED` — and the exit code is only 0 or 2.
 *
 * Zero dependencies, pure git-tree + filesystem, no creds, no network.
 *
 *   node .claude/tools/test-requirement-gate.js --project OagEventSource [--json]
 *                                               [--mode enforce|ratchet|report]
 *                                               [--write-baseline]
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

// ---------------------------------------------------------------------------
// The AC vocabulary. Reuses what the codebase already writes; a second one would
// be a second writer of the same fact (EXP-047).
//   AC-ML1.12  AC-BPC1.3  AC-14-5  AC-HF041.4  AC-R1.9  AC-XE1.0
// ---------------------------------------------------------------------------
// The id segment may start with a DIGIT — the codebase writes AC-14-5 as well as
// AC-ML1.12 and AC-BPC1.3. Anchoring it to a letter silently failed to see the
// numeric family, which is the same "confident about a vocabulary I did not check"
// error this gate exists to catch.
const AC_TAG = /\bAC-[A-Za-z0-9]+[.-][A-Za-z0-9]+/g

const DEFAULT_CORPUS = {
  // Modules whose exports return bytes reality authored (manifest-gated).
  readerModules: ['fixture-corpus-reader', 'capture-provenance'],
  // A direct read is a corpus root when the reading expression names the fixture tree.
  fileReaders: ['readFileSync', 'readFile', 'loadFixture'],
  fixturePathTokens: ['fixtures/', 'FIXTURES_ROOT', 'FIXTURES_DIR', 'CORPUS_ROOT'],
  extraRootIdentifiers: [],
}

const DEFAULT_DERIVED = { types: [], fields: [] }

// ===========================================================================
// SCANNER — one pass, producing two masks of identical length so every offset
// in either is an offset in the original. Comments and string CONTENTS are
// blanked to spaces (never removed), so line numbers survive untouched.
//   codeOnly        comments AND all string contents blanked -> safe bracket matching
//   codeWithStrings comments blanked, strings intact          -> safe text matching
//   codeNoTemplates comments + TEMPLATE chunks blanked        -> exec-boundary rules,
//                   which need a real module specifier but must not fire on a fixture
//                   of one embedded in a template literal (this gate's own tests)
// ===========================================================================
const RE_PREV = /[({[,;=:?!&|+\-*%~^<>]$|\b(?:return|typeof|case|in|of|instanceof|new|delete|void|do|else|yield|await)$/

function scanJs(src) {
  const codeOnly = src.split('')
  const codeWithStrings = src.split('')
  // A THIRD mask: comments and TEMPLATE-literal chunks blanked, quoted strings intact.
  // Needed because the exec-boundary rules must read a module specifier out of a real
  // `vi.mock('node:child_process')` while NOT firing on a fixture of one embedded in a
  // template literal — which is exactly what this gate's own tests contain.
  const codeNoTemplates = src.split('')
  const comments = []
  const strings = []
  const blank = (from, to, arr) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' '
  }
  let i = 0
  let prevSignificant = ''
  const n = src.length
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (c === '/' && c2 === '/') {
      let j = i + 2
      while (j < n && src[j] !== '\n') j++
      comments.push({ start: i, end: j, text: src.slice(i, j) })
      blank(i, j, codeOnly)
      blank(i, j, codeWithStrings)
      blank(i, j, codeNoTemplates)
      i = j
      continue
    }
    if (c === '/' && c2 === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j === -1 ? n : j + 2
      comments.push({ start: i, end: j, text: src.slice(i, j) })
      blank(i, j, codeOnly)
      blank(i, j, codeWithStrings)
      blank(i, j, codeNoTemplates)
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++
        if (src[j] === '\n') break
        j++
      }
      j = Math.min(j + 1, n)
      strings.push({ start: i, end: j, text: src.slice(i + 1, j - 1) })
      blank(i + 1, j - 1, codeOnly)
      prevSignificant = 'x'
      i = j
      continue
    }
    if (c === '`') {
      // Template literal. `${ … }` interiors stay CODE; the literal chunks blank.
      let j = i + 1
      let chunkStart = j
      let depth = 0
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (depth === 0 && src[j] === '`') break
        if (depth === 0 && src[j] === '$' && src[j + 1] === '{') {
          strings.push({ start: chunkStart, end: j, text: src.slice(chunkStart, j) })
          blank(chunkStart, j, codeOnly)
          blank(chunkStart, j, codeNoTemplates)
          depth = 1
          j += 2
          continue
        }
        if (depth > 0) {
          if (src[j] === '{') depth++
          else if (src[j] === '}') { depth--; if (depth === 0) chunkStart = j + 1 }
        }
        j++
      }
      if (depth === 0 && chunkStart < j) {
        strings.push({ start: chunkStart, end: j, text: src.slice(chunkStart, j) })
        blank(chunkStart, j, codeOnly)
        blank(chunkStart, j, codeNoTemplates)
      }
      prevSignificant = 'x'
      i = Math.min(j + 1, n)
      continue
    }
    if (c === '/' && RE_PREV.test(prevSignificant)) {
      // Regex literal (standard heuristic on the preceding significant text).
      let j = i + 1
      let cls = false
      let closed = false
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') cls = true
        else if (src[j] === ']') cls = false
        else if (src[j] === '/' && !cls) { closed = true; break }
        j++
      }
      if (closed) {
        blank(i + 1, j, codeOnly)
        blank(i + 1, j, codeWithStrings)
        blank(i + 1, j, codeNoTemplates)
        prevSignificant = 'x'
        i = j + 1
        continue
      }
    }
    if (!/\s/.test(c)) prevSignificant = (prevSignificant + c).slice(-12)
    i++
  }
  return {
    codeOnly: codeOnly.join(''),
    codeWithStrings: codeWithStrings.join(''),
    codeNoTemplates: codeNoTemplates.join(''),
    comments,
    strings,
  }
}

/**
 * Python, producing the same three masks. The TRIPLE-quoted string is python's
 * template literal for our purposes — it is where an embedded fixture of the very
 * pattern we hunt would live — so `codeNoTemplates` blanks triple-quoted bodies and
 * keeps single-line strings, which is what `patch("…subprocess.run")` needs.
 */
function scanPy(src) {
  const codeOnly = src.split('')
  const codeWithStrings = src.split('')
  const codeNoTemplates = src.split('')
  const comments = []
  const strings = []
  const blank = (from, to, arr) => { for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ' }
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '#') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      comments.push({ start: i, end: j, text: src.slice(i, j) })
      blank(i, j, codeOnly)
      blank(i, j, codeWithStrings)
      blank(i, j, codeNoTemplates)
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      const triple = src.slice(i, i + 3)
      if (triple === '"""' || triple === "'''") {
        let j = src.indexOf(triple, i + 3)
        j = j === -1 ? n : j + 3
        strings.push({ start: i + 3, end: j - 3, text: src.slice(i + 3, j - 3) })
        blank(i + 3, j - 3, codeOnly)
        blank(i + 3, j - 3, codeNoTemplates)
        i = j
        continue
      }
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
      strings.push({ start: i + 1, end: j, text: src.slice(i + 1, j) })
      blank(i + 1, j, codeOnly)
      i = Math.min(j + 1, n)
      continue
    }
    i++
  }
  return {
    codeOnly: codeOnly.join(''),
    codeWithStrings: codeWithStrings.join(''),
    codeNoTemplates: codeNoTemplates.join(''),
    comments,
    strings,
  }
}

function lineOf(src, offset) {
  let line = 1
  for (let k = 0; k < offset && k < src.length; k++) if (src[k] === '\n') line++
  return line
}

function matchBracket(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' }
  const close = pairs[code[open]]
  if (!close) return -1
  let depth = 0
  for (let k = open; k < code.length; k++) {
    if (code[k] === code[open]) depth++
    else if (code[k] === close) { depth--; if (depth === 0) return k }
  }
  return -1
}

/**
 * The nearest UNMATCHED opening bracket of ANY kind before `at`, or -1.
 *
 * The spread rule may only fire inside an OBJECT LITERAL, and asking for the nearest unmatched
 * `{` alone cannot tell `{ ...a, k: v }` from `new Set([...a, ...b])` written inside a function
 * body: the array's brackets are invisible to a `{`-only walk, so the enclosing BLOCK is found
 * and any `const x: T =` annotation in it reads as an override key. Observed on
 * `defect-oag-110-keyless-corpus-and-guard.test.ts:417`, where an array spread of two event
 * lists was reported as `{ ...afterKeyless, lateKeyed: … }` (DEFECT-OAG-122). Precision over
 * recall, mechanically — a noisy gate gets ignored.
 */
function enclosingOpenAny(code, at) {
  const closeFor = { '(': ')', '{': '}', '[': ']' }
  const depth = { ')': 0, '}': 0, ']': 0 }
  for (let k = at; k >= 0; k--) {
    const c = code[k]
    if (c === ')' || c === '}' || c === ']') depth[c]++
    else if (c === '(' || c === '{' || c === '[') {
      const close = closeFor[c]
      if (depth[close] === 0) return k
      depth[close]--
    }
  }
  return -1
}

/** Walk back from `at` to the nearest unmatched opening bracket of kind `open`. */
function enclosingOpen(code, at, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' }
  const close = pairs[open]
  let depth = 0
  for (let k = at; k >= 0; k--) {
    if (code[k] === close) depth++
    else if (code[k] === open) { if (depth === 0) return k; depth-- }
  }
  return -1
}

// ===========================================================================
// LIMB 1 — describe/it extraction and AC resolution
// ===========================================================================
const RE_CALL = /(?<![\w$.'"`])(describe|it|test)((?:\.(?:only|skip|todo|concurrent|sequential|fails|each|runIf|skipIf))*)\s*\(/g

function extractCases(src, scan) {
  const { codeOnly, comments, strings } = scan
  const calls = []
  RE_CALL.lastIndex = 0
  let m
  while ((m = RE_CALL.exec(codeOnly)) !== null) {
    const kind = m[1]
    const start = m.index
    let openParen = m.index + m[0].length - 1
    let end = matchBracket(codeOnly, openParen)
    if (end === -1) continue
    // `it.each([...])('title', fn)` — the CASE is the second call.
    if (/\.each$/.test(m[1] + m[2])) {
      const next = codeOnly.indexOf('(', end + 1)
      if (next !== -1 && codeOnly.slice(end + 1, next).trim() === '') {
        const e2 = matchBracket(codeOnly, next)
        if (e2 !== -1) { openParen = next; end = e2 }
      }
    }
    const title = (strings.find((s) => s.start > openParen && s.end <= end) || { text: '' }).text
    calls.push({ kind: kind === 'describe' ? 'describe' : 'it', start, end, openParen, title })
  }
  calls.sort((a, b) => a.start - b.start || b.end - a.end)

  const firstCall = calls.length ? calls[0].start : src.length

  // Comments glued to a call: consecutive comment tokens with only whitespace between.
  // A comment that precedes the FIRST call is the FILE HEADER and is deliberately NOT
  // attributed to it — a file-level `@covers` is a coverage claim about the module,
  // not a statement of what this one case validates (that is the whole distinction
  // limb 1 turns on, so it may not be blurred by adjacency).
  const leadingComments = (start) => {
    const out = []
    let cursor = start
    for (let k = comments.length - 1; k >= 0; k--) {
      const c = comments[k]
      if (c.end > cursor) continue
      if (c.start < firstCall) break
      if (src.slice(c.end, cursor).trim() !== '') break
      out.unshift(c.text)
      cursor = c.start
    }
    return out
  }

  const headerTags = new Set()
  for (const c of comments) {
    if (c.start >= firstCall) break
    for (const t of c.text.match(AC_TAG) || []) headerTags.add(t)
  }

  const cases = []
  for (const call of calls) {
    if (call.kind !== 'it') continue
    const ancestors = calls.filter(
      (c) => c.kind === 'describe' && c.start < call.start && c.end >= call.end,
    )
    const texts = []
    for (const a of ancestors) { texts.push(a.title); texts.push(...leadingComments(a.start)) }
    texts.push(call.title)
    texts.push(...leadingComments(call.start))
    for (const c of comments) if (c.start >= call.start && c.end <= call.end) texts.push(c.text)
    for (const s of strings) if (s.start >= call.start && s.end <= call.end) texts.push(s.text)
    const tags = new Set()
    for (const t of texts) for (const hit of String(t).match(AC_TAG) || []) tags.add(hit)
    cases.push({
      title: call.title,
      line: lineOf(src, call.start),
      tags: [...tags],
      suite: ancestors.map((a) => a.title).join(' > '),
    })
  }
  return { cases, headerTags: [...headerTags] }
}

// ===========================================================================
// LIMB 2 — taint: which identifiers in this file hold bytes REALITY authored
// ===========================================================================
const RE_DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;\n]+?)?=/g
// A destructuring pattern is SINGLE-LEVEL and SINGLE-LINE here on purpose. A looser
// char class silently ran away across `) {` and a newline — `for (const [k, v] of
// Object.entries(cap))\n  out[k] =` was read as ONE destructuring binding, tainting
// `of`, `Object`, `entries` and the fresh accumulator `out`, and produced this gate's
// only false positive on its first real run. Precision over recall, mechanically.
const RE_DESTRUCT = /\b(?:const|let|var)\s*([{[][^{}()[\];\n]*[}\]])\s*(?::\s*[^=;\n]+?)?=/g
const RE_FOROF = /\bfor\s*\(\s*(?:const|let|var)\s+(?:([A-Za-z_$][\w$]*)|([{[][^{}()[\];\n]*[}\]]))\s+(?:of|in)\s+/g
const RE_FNDECL = /\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g

/** Read an initialiser expression from just after `=` to the end of the statement. */
function readInitialiser(code, eq) {
  let depth = 0
  let k = eq + 1
  for (; k < code.length; k++) {
    const c = code[k]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth-- }
    else if (c === ';' && depth === 0) break
    else if (c === '\n' && depth === 0) {
      const line = code.slice(code.lastIndexOf('\n', k - 1) + 1, k).trimEnd()
      if (!/[=+\-*/%&|,?:.([<>{]$|\b(?:new|typeof|await|return|as|of|in|instanceof)$/.test(line)) break
    }
  }
  return code.slice(eq + 1, k)
}

function mentions(text, names) {
  for (const nm of names) {
    const re = new RegExp(`(?<![\\w$])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`)
    if (re.test(text)) return true
  }
  return false
}

function computeTaint(scan, corpus) {
  const code = scan.codeWithStrings
  const tainted = new Set(corpus.extraRootIdentifiers || [])

  // Root A — a named import from a manifest-gated corpus reader module.
  const RE_IMPORT = /import\s+(?:type\s+)?(\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g
  let m
  while ((m = RE_IMPORT.exec(code)) !== null) {
    if (!corpus.readerModules.some((mod) => m[2].includes(mod))) continue
    const clause = m[1]
    if (clause.startsWith('{')) {
      for (const part of clause.slice(1, -1).split(',')) {
        const nm = part.trim().split(/\s+as\s+/).pop().trim()
        if (/^[A-Za-z_$][\w$]*$/.test(nm)) tainted.add(nm)
      }
    } else tainted.add(clause)
  }

  // Root B — a direct read whose expression NAMES the fixture tree.
  const isCorpusRead = (rhs) =>
    corpus.fileReaders.some((fn) => mentions(rhs, [fn])) &&
    corpus.fixturePathTokens.some((tok) => rhs.includes(tok))

  const collect = () => {
    const decls = []
    for (const [re, group] of [[RE_DECL, 1], [RE_DESTRUCT, 1]]) {
      re.lastIndex = 0
      let d
      while ((d = re.exec(code)) !== null) {
        const eq = d.index + d[0].length - 1
        const names = group === 1 && d[1].startsWith('{') === false && d[1].startsWith('[') === false
          ? [d[1]]
          : (d[1].match(/[A-Za-z_$][\w$]*/g) || [])
        decls.push({ names, rhs: readInitialiser(code, eq) })
      }
    }
    RE_FOROF.lastIndex = 0
    let f
    while ((f = RE_FOROF.exec(code)) !== null) {
      const names = f[1] ? [f[1]] : (f[2].match(/[A-Za-z_$][\w$]*/g) || [])
      const close = code.indexOf(')', f.index + f[0].length)
      decls.push({ names, rhs: code.slice(f.index + f[0].length, close === -1 ? f.index + 200 : close) })
    }
    RE_FNDECL.lastIndex = 0
    let g
    while ((g = RE_FNDECL.exec(code)) !== null) {
      const brace = scan.codeOnly.indexOf('{', g.index + g[0].length)
      const end = brace === -1 ? -1 : matchBracket(scan.codeOnly, brace)
      if (end === -1) continue
      decls.push({ names: [g[1]], rhs: code.slice(brace, end) })
    }
    return decls
  }

  const decls = collect()
  for (const d of decls) if (isCorpusRead(d.rhs)) for (const nm of d.names) tainted.add(nm)

  for (let pass = 0; pass < 12; pass++) {
    const before = tainted.size
    for (const d of decls) {
      if (d.names.every((nm) => tainted.has(nm))) continue
      if (mentions(d.rhs, [...tainted])) for (const nm of d.names) tainted.add(nm)
    }
    if (tainted.size === before) break
  }
  return tainted
}

// ===========================================================================
// LIMB 2 — the rules
// ===========================================================================
const RE_DELETE = /\bdelete\s+([A-Za-z_$][\w$]*)/g
const RE_SPREAD = /\.\.\.\s*([A-Za-z_$][\w$]*)/g
const RE_ASSIGN = /(?<![\w$.])([A-Za-z_$][\w$]*)((?:\s*\??\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]\n]*\])+)\s*=(?![=>])/g
const RE_CAST = /\bas\s+(?:unknown\s+as\s+)?([A-Za-z_$][\w$]*)/g

const EXEC_STUB_JS = [
  [/\b(?:vi|jest)\.mock\(\s*['"](?:node:)?child_process['"]/g, 'vi.mock(child_process)'],
  [/\b(?:vi|jest)\.spyOn\(\s*[\w$.]+\s*,\s*['"](?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)['"]/g, 'spyOn(exec boundary)'],
  [/(?<![\w$])(?:[A-Za-z_$][\w$]*\.)*(?:execSync|spawnSync|execFileSync)\s*=(?![=>])/g, 'exec boundary reassigned'],
]
const EXEC_STUB_PY = [
  [/(?<![\w.])(?:[A-Za-z_][\w.]*\.)?subprocess\.(?:run|Popen|check_output|check_call|call)\s*=(?!=)/g, 'subprocess.* reassigned'],
  [/(?<![\w.])(?:[A-Za-z_][\w.]*\.)?os\.(?:system|popen)\s*=(?!=)/g, 'os.system/popen reassigned'],
  [/\bpatch\(\s*["'][^"']*\b(?:subprocess\.(?:run|Popen|check_output|check_call|call)|os\.(?:system|popen))["']/g, 'mock.patch of the exec boundary'],
  [/\bpatch\.object\(\s*[\w.]*subprocess\s*,\s*["'](?:run|Popen|check_output|check_call|call)["']/g, 'patch.object(subprocess, …)'],
  [/\bsetattr\(\s*[\w.]*subprocess\s*,\s*["'](?:run|Popen|check_output)["']/g, 'monkeypatch.setattr(subprocess, …)'],
]

/**
 * The spans of every `expect(...)` argument list.
 *
 * Limb 2 is about a PRECONDITION the test authored. `{ ...observed, id: null }` inside
 * an assertion is normalising an OBSERVED value before comparing it (blanking a random
 * uuid, say) — the opposite act, and the gate's only other false positive on its first
 * real run (uc-ml1-genesis-phase-relay.test.ts:592). Excluded deliberately, at the cost
 * of missing an authored prior written inline inside an assertion.
 */
function assertionSpans(code) {
  const spans = []
  // `expect(observed)` AND the matcher's EXPECTED argument — `.toEqual({ ...observed,
  // id: null })` sits outside the `expect(...)` parens but is the same act.
  const re = /(?<![\w$.])expect\s*\(|\.(?:toEqual|toStrictEqual|toMatchObject|toContainEqual|toHaveProperty|toMatchInlineSnapshot|toReturnWith|toHaveBeenCalledWith|toHaveBeenLastCalledWith)\s*\(/g
  let m
  while ((m = re.exec(code)) !== null) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(code, open)
    if (close !== -1) spans.push([open, close])
  }
  return spans
}

function authoredViolations(src, scan, tainted, derived, lang) {
  const code = scan.codeOnly
  const withStrings = scan.codeWithStrings
  const execScan = scan.codeNoTemplates
  const spans = lang === 'js' ? assertionSpans(code) : []
  const inAssertion = (o) => spans.some(([a, b]) => o > a && o < b)
  const out = []
  const push = (rule, offset, detail) => {
    if (inAssertion(offset)) return
    out.push({ limb: 'authored', rule, line: lineOf(src, offset), detail })
  }

  if (lang === 'js') {
    RE_DELETE.lastIndex = 0
    let m
    while ((m = RE_DELETE.exec(code)) !== null) {
      if (tainted.has(m[1])) {
        const stmt = withStrings.slice(m.index, withStrings.indexOf('\n', m.index) + 1 || undefined)
        push('delete-on-real-capture', m.index,
          `${stmt.trim()} — \`${m[1]}\` reaches this test from a real capture; deleting a leaf ` +
          'off it AUTHORS the precondition. Fold the prior from events, or harvest a real one.')
      }
    }

    RE_SPREAD.lastIndex = 0
    while ((m = RE_SPREAD.exec(code)) !== null) {
      if (!tainted.has(m[1])) continue
      // The enclosing bracket must be an OBJECT literal's, not merely the nearest `{`: an
      // ARRAY spread has no override to find, and a `{`-only walk lands on the enclosing block.
      const open = enclosingOpenAny(code, m.index - 1)
      if (open === -1 || code[open] !== '{') continue
      const close = matchBracket(code, open)
      if (close === -1 || close < m.index) continue
      // An override is a own-property at depth 1 of the SAME literal.
      let depth = 0
      let override = null
      for (let k = open + 1; k < close; k++) {
        const c = code[k]
        if (c === '{' || c === '(' || c === '[') depth++
        else if (c === '}' || c === ')' || c === ']') depth--
        else if (c === ':' && depth === 0) {
          const before = code.slice(Math.max(open + 1, k - 60), k)
          const key = before.match(/([A-Za-z_$][\w$]*|\[[^\]]*\]|['"][^'"]*['"])\s*$/)
          if (key) { override = key[1]; break }
        }
      }
      if (override) {
        push('spread-override-on-real-capture', m.index,
          `{ ...${m[1]}, ${override}: … } — spreading an override over a real capture invents ` +
          'a record reality never sent. Fold the prior from events, or harvest a real one.')
      }
    }

    RE_ASSIGN.lastIndex = 0
    while ((m = RE_ASSIGN.exec(code)) !== null) {
      if (!tainted.has(m[1])) continue
      const pre = code.slice(Math.max(0, m.index - 12), m.index)
      if (/\b(?:const|let|var)\s+$/.test(pre)) continue
      push('mutate-real-capture', m.index,
        `${(m[1] + m[2]).replace(/\s+/g, '')} = … — writing into a real capture AUTHORS the ` +
        'precondition; the record is no longer one reality produced.')
    }

    if ((derived.types || []).length) {
      RE_CAST.lastIndex = 0
      while ((m = RE_CAST.exec(code)) !== null) {
        if (!derived.types.includes(m[1])) continue
        let k = m.index - 1
        while (k >= 0 && /\s/.test(code[k])) k--
        if (code[k] !== '}') continue
        const open = enclosingOpen(code, k - 1, '{')
        if (open === -1) continue
        const literal = code.slice(open, k + 1)
        if (RE_SPREAD.test(literal)) { RE_SPREAD.lastIndex = 0; continue }
        RE_SPREAD.lastIndex = 0
        const hit = (derived.fields || []).find((f) =>
          new RegExp(`(?<![\\w$])${f}\\s*:`).test(literal))
        if (!hit) continue
        push('authored-derived-prior', open,
          `{ ${hit}: … } as ${m[1]} — \`${hit}\` is DERIVED by the fold, so hand-setting it ` +
          'builds a prior no real stream can hold. Fold it from events instead.')
      }
    }
  }

  // ONE finding per file. A stub is an assign/restore PAIR repeated across cases —
  // counting each site would inflate the number and make the allowlist per-line.
  // "this file stubs the exec boundary" is the fact; the lines are the evidence.
  const stubSites = []
  for (const [re, what] of lang === 'py' ? EXEC_STUB_PY : EXEC_STUB_JS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(execScan)) !== null) {
      stubSites.push({ offset: m.index, what, line: lineOf(src, m.index) })
    }
  }
  if (stubSites.length) {
    stubSites.sort((a, b) => a.offset - b.offset)
    // Deliberately bypasses the assertion filter: a stub is set up, never asserted in.
    out.push({ limb: 'authored', rule: 'exec-boundary-stubbed', line: stubSites[0].line, detail:
      `${stubSites.length} stub site(s): ` +
      stubSites.map((s) => `${s.what} @L${s.line}`).join('; ') +
      '. A fact about what a real command DOES cannot be established by a stub of the exec ' +
      'boundary — the stub is written by whoever was wrong about the command. (Founding case: ' +
      "`make` does not propagate a recipe's exit status, so every probe read BROKEN against " +
      'real make while the stubbed mapping was green.) Drive the real binary, or allowlist ' +
      'this file with the reason it asserts argv construction rather than behaviour.' })
  }
  return out
}

// ===========================================================================
// Config, allowlist, walk
// ===========================================================================
function globToRe(glob) {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++ }
    else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(out + '$')
}

function walk(dir, out) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, out)
    else if (/(\.test|\.spec)\.(ts|tsx|js|mjs|cjs)$/.test(e.name) || /^test_.*\.py$/.test(e.name) ||
             /_test\.py$/.test(e.name)) out.push(abs)
  }
  return out
}

function loadConfig(repoRoot, project) {
  const p = path.join(repoRoot, '.claude/config/test-requirement-gate', `${project}.json`)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

const MIN_WHY = 30

// ===========================================================================
// runGate — the whole analysis, as data. No process.exit, no printing.
// ===========================================================================
function runGate(opts) {
  const repoRoot = opts.repoRoot
  const project = opts.project
  const cfg = opts.config || loadConfig(repoRoot, project)
  if (!cfg) {
    return {
      verdict: 'NOT-CONFIGURED', exitCode: 0, project, mode: 'n/a',
      violations: [], configErrors: [], regressions: [], slack: [],
      counts: { files: 0, cases: 0, ac: 0, authored: 0, allowlisted: 0, allowlistEntries: 0,
                staleAllowlistEntries: 0, acCoveredByFileHeaderOnly: 0 },
      note: `no .claude/config/test-requirement-gate/${project}.json — the gate is not ` +
            'configured for this project, which is NOT the same as clean.',
    }
  }

  const mode = opts.mode || cfg.mode || 'enforce'
  const corpus = Object.assign({}, DEFAULT_CORPUS, cfg.corpus || {})
  const derived = Object.assign({}, DEFAULT_DERIVED, cfg.derived || {})
  const configErrors = []

  const allowlist = (cfg.allowlist || []).map((a, idx) => {
    if (!a.path) configErrors.push(`allowlist[${idx}]: no path`)
    if (!a.why || String(a.why).trim().length < MIN_WHY) {
      configErrors.push(
        `allowlist[${idx}] (${a.path}): 'why' must state a REASON of at least ${MIN_WHY} ` +
        `characters — got ${JSON.stringify(a.why || '')}. An allowlist entry without a stated ` +
        'reason is the silent exemption this gate exists to prevent.')
    }
    return { ...a, re: globToRe(a.path || ''), hits: 0 }
  })

  const files = []
  for (const root of cfg.roots || []) {
    const abs = path.join(repoRoot, root.path)
    if (!fs.existsSync(abs)) {
      configErrors.push(
        `root '${root.path}' does not exist under ${repoRoot} — a gate that scans nothing ` +
        'and reports clean is worse than no gate.')
      continue
    }
    for (const f of walk(abs, [])) {
      files.push({ abs, file: path.relative(repoRoot, f).split(path.sep).join('/'), limbs: root.limbs || ['ac', 'authored'] })
    }
  }
  files.sort((a, b) => a.file.localeCompare(b.file))

  const raw = []
  let cases = 0
  let headerOnly = 0
  for (const f of files) {
    const src = fs.readFileSync(path.join(repoRoot, f.file), 'utf8')
    const lang = /\.py$/.test(f.file) ? 'py' : 'js'
    const scan = lang === 'py' ? scanPy(src) : scanJs(src)

    if (f.limbs.includes('ac') && lang === 'js') {
      const { cases: cs, headerTags } = extractCases(src, scan)
      cases += cs.length
      for (const c of cs) {
        if (c.tags.length) continue
        if (headerTags.length) {
          headerOnly++
          if (cfg.fileHeaderCoversCounts) continue
        }
        raw.push({
          limb: 'ac', rule: 'no-ac-reference', file: f.file, line: c.line, test: c.title,
          suite: c.suite,
          detail: headerTags.length
            ? `no AC reference on the case; the FILE header claims ${headerTags.join(', ')}, ` +
              'which is a file-level coverage claim, not this case\'s requirement. Either it ' +
              'validates a criterion (name it) or it validates none (delete it, or register ' +
              'the criterion it found and retro why it was missed).'
            : 'no AC reference in the case title, its suite, or its comments. Per the ruling ' +
              'this is either waste (delete it) or an undiscovered acceptance criterion ' +
              '(register it — and the discovery gap earns a retro).',
        })
      }
    }
    if (f.limbs.includes('authored')) {
      const tainted = computeTaint(scan, corpus)
      for (const v of authoredViolations(src, scan, tainted, derived, lang)) {
        raw.push({ ...v, file: f.file })
      }
    }
  }

  const violations = []
  let allowlisted = 0
  for (const v of raw) {
    const hit = allowlist.find((a) =>
      a.re.test(v.file) &&
      (!a.limb || a.limb === '*' || a.limb === v.limb) &&
      (!a.rule || a.rule === v.rule) &&
      (!a.test || (v.test || '').includes(a.test)))
    if (hit) { hit.hits++; allowlisted++; continue }
    violations.push(v)
  }

  const counts = {
    files: files.length,
    cases,
    ac: violations.filter((v) => v.limb === 'ac').length,
    authored: violations.filter((v) => v.limb === 'authored').length,
    allowlisted,
    allowlistEntries: allowlist.length,
    staleAllowlistEntries: allowlist.filter((a) => a.hits === 0).length,
    acCoveredByFileHeaderOnly: headerOnly,
  }

  const baseline = cfg.baseline || { ac: 0, authored: 0 }
  const regressions = []
  const slack = []
  for (const limb of ['ac', 'authored']) {
    const b = baseline[limb] === undefined ? 0 : baseline[limb]
    if (counts[limb] > b) regressions.push({ limb, count: counts[limb], baseline: b })
    else if (counts[limb] < b) slack.push({ limb, count: counts[limb], baseline: b })
  }

  let verdict
  if (configErrors.length) verdict = 'FAIL'
  else if (mode === 'report') verdict = 'PASS'
  else if (mode === 'ratchet') verdict = regressions.length ? 'FAIL' : 'PASS'
  else verdict = violations.length ? 'FAIL' : 'PASS'

  return {
    verdict, exitCode: verdict === 'FAIL' ? 2 : 0, project, mode,
    violations, configErrors, counts, baseline, regressions, slack,
    allowlist: allowlist.map((a) => ({ path: a.path, limb: a.limb, rule: a.rule, why: a.why, hits: a.hits })),
  }
}

// ===========================================================================
// Reporting — the verdict rides a STDOUT SENTINEL (make has only 0 and non-0).
// ===========================================================================
function formatReport(r, opts) {
  const o = opts || {}
  const L = []
  L.push(`test-requirement-gate[${r.project}] — the ONLY thing tests validate is the requirements`)
  L.push(`TRG-VERDICT: ${r.verdict}`)
  L.push(`TRG-MODE: ${r.mode}`)
  L.push(
    `TRG-COUNTS: files=${r.counts.files} cases=${r.counts.cases} ` +
    `limb1-untagged=${r.counts.ac} limb2-authored=${r.counts.authored} ` +
    `allowlisted=${r.counts.allowlisted} allowlist-entries=${r.counts.allowlistEntries} ` +
    `stale-allowlist=${r.counts.staleAllowlistEntries} ` +
    `file-header-only=${r.counts.acCoveredByFileHeaderOnly}`)
  if (r.baseline) {
    L.push(`TRG-BASELINE: limb1=${r.baseline.ac || 0} limb2=${r.baseline.authored || 0} (ratchet floor — may only shrink)`)
  }
  if (r.note) L.push(`  note: ${r.note}`)
  for (const e of r.configErrors) L.push(`  CONFIG ERROR: ${e}`)
  for (const x of r.regressions) {
    L.push(`  REGRESSION [${x.limb}]: ${x.count} > committed baseline ${x.baseline}. A new ` +
           'violation landed. Fix it, or move the baseline DOWN — never up.')
  }
  for (const x of r.slack) {
    L.push(`  RATCHET SLACK [${x.limb}]: ${x.count} < baseline ${x.baseline} — lower the ` +
           `baseline to ${x.count} in the config so it cannot drift back (--write-baseline).`)
  }
  const byRule = {}
  for (const v of r.violations) byRule[v.rule] = (byRule[v.rule] || 0) + 1
  if (Object.keys(byRule).length) {
    L.push('  by rule: ' + Object.entries(byRule).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`).join(' '))
  }
  // Limb 2 is ALWAYS listed in full: it is small by construction and every line is a
  // specific, actionable claim. Limb 1 is the standing debt — listed only under
  // --verbose (or --json), because 1900 lines of "no AC reference" scrolling past every
  // run is how a gate teaches people to stop reading it.
  const shown = r.violations.filter((v) => o.verbose || v.limb === 'authored')
  for (const v of shown) {
    L.push(`  - [${v.limb}/${v.rule}] ${v.file}:${v.line}` +
           (v.test ? ` — "${v.test}"` : '') + `\n      ${v.detail}`)
  }
  const elided = r.violations.length - shown.length
  if (elided > 0) {
    L.push(`  … ${elided} limb-1 (no-ac-reference) violation(s) not listed — ` +
           '`--verbose` for every line, `--json` to triage them. Each is either waste ' +
           '(delete it) or an undiscovered acceptance criterion (register it, and the ' +
           'discovery gap earns a retro).')
  }
  for (const a of (r.allowlist || [])) {
    if (a.hits === 0) L.push(`  STALE ALLOWLIST ENTRY: ${a.path} (${a.limb || '*'}) matched nothing — delete it.`)
  }
  return L.join('\n')
}

// ===========================================================================
// CLI
// ===========================================================================
function main(argv) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(name)
    return i === -1 ? dflt : argv[i + 1]
  }
  const has = (name) => argv.includes(name)
  const repoRoot = path.resolve(arg('--repo-root', process.cwd()))
  const project = arg('--project', (() => {
    try { return fs.readFileSync(path.join(repoRoot, 'work/ACTIVE'), 'utf8').trim() } catch { return '' }
  })())
  if (!project) {
    console.error('test-requirement-gate: --project is required (or work/ACTIVE must name one)')
    process.exit(2)
  }
  const r = runGate({ repoRoot, project, mode: arg('--mode', undefined) })

  // NEVER process.exit() after writing to a pipe: node exits before stdout flushes and
  // the consumer gets TRUNCATED JSON. Set exitCode and let the runtime drain.
  if (has('--json')) { console.log(JSON.stringify(r, null, 2)); process.exitCode = r.exitCode; return }

  if (has('--write-baseline')) {
    const p = path.join(repoRoot, '.claude/config/test-requirement-gate', `${project}.json`)
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
    const old = cfg.baseline || { ac: 0, authored: 0 }
    for (const limb of ['ac', 'authored']) {
      if (r.counts[limb] > (old[limb] || 0) && !has('--allow-baseline-growth')) {
        console.error(
          `refusing to RAISE the ${limb} baseline ${old[limb] || 0} -> ${r.counts[limb]}. ` +
          'The ratchet may only shrink; fix the new violation instead ' +
          '(--allow-baseline-growth exists for a deliberate, reviewed re-baseline).')
        process.exit(2)
      }
    }
    cfg.baseline = { ac: r.counts.ac, authored: r.counts.authored }
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
    console.log(`baseline written: limb1=${cfg.baseline.ac} limb2=${cfg.baseline.authored}`)
    return
  }

  console.log(formatReport(r, {
    verbose: has('--verbose'),
    limit: has('--verbose') ? 0 : Number(arg('--limit', 40)),
  }))

  // AUTO-TIGHTEN (v142). A ratchet that only moves when a human remembers to move it is not
  // a ratchet — it is a high-water mark that drifts. Evidence: the floor was lowered to 1749
  // by hand at the moment someone noticed a gain, and 106 minutes later two commits took the
  // true count to 1811. Nobody saw it for THREE DAYS, because the only observer is the next
  // gate run. So on every PASSING run, if the observed count is strictly BELOW the committed
  // floor, tighten the floor now, mechanically, and say so.
  // It can only ever LOWER: the raise path stays manual and reviewed (--write-baseline
  // --allow-baseline-growth). A failing run tightens nothing.
  if (r.exitCode === 0 && !has('--no-auto-tighten')) {
    const p = path.join(repoRoot, '.claude/config/test-requirement-gate', `${project}.json`)
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
      const old = cfg.baseline || {}
      const next = { ...old }
      const moved = []
      for (const limb of ['ac', 'authored']) {
        const seen = r.counts[limb]
        if (typeof old[limb] === 'number' && seen < old[limb]) {
          next[limb] = seen
          moved.push(`${limb} ${old[limb]} -> ${seen}`)
        }
      }
      if (moved.length) {
        cfg.baseline = next
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
        console.log(
          `\n  RATCHET TIGHTENED AUTOMATICALLY: ${moved.join(', ')}.\n` +
          '  The gain is now locked in and cannot silently drift back. ' +
          'COMMIT this config change with your work.')
      }
    } catch (e) {
      console.log(`\n  (auto-tighten skipped: ${e.message})`)
    }
  }

  process.exitCode = r.exitCode
}

module.exports = { runGate, formatReport, scanJs, scanPy, extractCases, computeTaint, globToRe }

if (require.main === module) main(process.argv.slice(2))
