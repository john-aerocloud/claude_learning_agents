// UC-S002-5 — baseline.md ToC constraint parser.
//
// HEXAGONAL ROLE: pure domain logic. It takes the RAW baseline.md string handed
// over by the API client adapter (getBaseline()) and extracts the constraint
// name in domain terms — no fetch, no URL, no markdown renderer. Fail soft: any
// shape it does not recognise yields null, never a throw (the operator's map
// must degrade gracefully, not crash, on an absent or reformatted baseline).
//
// TWO RESPONSIBILITIES, kept separate (see baseline.test.js for the rationale):
//   parseConstraint(raw)       — the name baseline.md NAMES as the constraint.
//   matchConstraintQueue(name) — that name IF it is one of the four pipeline
//                                queues, else null.
//
// THE DECISION THIS SLICE FORCES: the live computed baseline.md names the ToC
// constraint as the slowest AGENT (e.g. "tester"), which is NOT a pipeline
// queue. parseConstraint still extracts it truthfully; matchConstraintQueue maps
// it to null, so PipelineMap highlights NO box — we never paint a false
// constraint onto a queue (AC5.6 / A11Y-6 negative path). If baseline ever names
// an actual queue ("Constraint: ready"), the match resolves and that box lights
// up (AC5.5 / A11Y-6 positive path). Surfacing a non-queue constraint NAME in a
// labelled chip (without highlighting a box) is left to a later UC — this slice
// owns the queue-highlight contract only.

import { tableRows } from './markdown-table.js';

const QUEUE_NAMES = ['intake', 'ready', 'deploy', 'rework'];

// Matches a constraint line in any of the accepted forms (case-insensitive),
// tolerating a leading markdown list marker ("- ", "* ", "1. "):
//   Constraint: <name>
//   ToC: <name>
//   Constraint (ToC): <name>                  ← any parenthetical qualifier
//   - Constraint (slowest median step): <name> ← the real computed form
// Captures the rest of THAT line as the raw value. The post-colon gap uses
// [^\S\n]* (horizontal whitespace only) so an empty value does NOT spill onto
// the next line and capture it.
const CONSTRAINT_LINE = /^[^\S\n]*(?:[-*]|\d+\.)?[^\S\n]*(?:constraint|toc)\b[^:\n]*:[^\S\n]*(\S.*?)[^\S\n]*$/im;

/**
 * Extract the constraint name from a raw baseline.md string.
 * @param {string|null|undefined} raw
 * @returns {string|null} lowercased, trimmed, markdown-stripped name, or null
 */
export function parseConstraint(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(CONSTRAINT_LINE);
  if (!m) return null;
  return cleanName(m[1]);
}

/**
 * Map a parsed constraint name to a pipeline QUEUE name, or null when the
 * constraint is not one of the four queues.
 * @param {string|null|undefined} name
 * @returns {string|null} queue name (intake|ready|deploy|rework) or null
 */
export function matchConstraintQueue(name) {
  const norm = cleanName(name);
  if (!norm) return null;
  return QUEUE_NAMES.includes(norm) ? norm : null;
}

/**
 * Normalise a raw constraint value: strip markdown bold/emphasis markers and a
 * trailing clause (after an em-dash / dash), lowercase, trim. Returns null for
 * an empty result so callers treat it as "no constraint".
 */
function cleanName(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  // drop a trailing descriptive clause: "ready — the floor is empty" → "ready"
  v = v.split(/\s+[—–-]\s+/)[0];
  // strip surrounding markdown emphasis: **ready**, _deploy_, *intake*, `x`
  v = v.replace(/[*_`]+/g, '');
  v = v.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// UC-S003-1 — baseline.md four-metric + per-agent task-time parser.
//
// HEXAGONAL ROLE: pure domain logic, like parseConstraint above. parseBaseline
// takes the RAW baseline.md string from the SPA API adapter (getBaseline()) and
// returns a typed BaselineParsed record the render UCs (UC2 DoraPanel, UC3
// StageCards) consume — they never touch raw markdown. It COMPOSES parseConstraint
// (no duplication) for the constraint field.
//
// FIDELITY (§8 F1-F4): every value comes through EXACTLY as written in the source
// table cell — no rounding, no number coercion, no reformatting. The render UCs
// assert string-equality against the source, so we hand back raw cell strings.
// FAIL SOFT (§8 R1/R3): null / non-string / absent-table → metrics all null and
// agentTimes []; this never throws.
// ---------------------------------------------------------------------------

export const BASELINE_SOURCE_REF = 'process/dora/baseline.md';

// Map each four-key-metric row to its output key by the metric-name prefix in the
// `## Four key metrics` table (the leading "Metric" cell, lowercased).
const METRIC_KEY_BY_PREFIX = [
  ['gross lead time', 'grossLeadTimeMedian'],
  ['deployment frequency', 'deployFrequency'],
  ['change failure rate', 'changeFailureRate'],
  ['mttr', 'mttr'],
];

function emptyMetrics() {
  return {
    grossLeadTimeMedian: null,
    deployFrequency: null,
    changeFailureRate: null,
    mttr: null,
  };
}

/**
 * Parse a raw baseline.md string into a typed record.
 * @param {string|null|undefined} raw
 * @returns {{
 *   metrics: {
 *     grossLeadTimeMedian: {value: string, window: string}|null,
 *     deployFrequency: {value: string, window: string}|null,
 *     changeFailureRate: {value: string, window: string}|null,
 *     mttr: {value: string, window: string}|null,
 *   },
 *   agentTimes: Array<{agent: string, n: number, modal: string, median: string, mean: string}>,
 *   constraint: string|null,
 *   sourceRef: string,
 * }}
 */
export function parseBaseline(raw) {
  const result = {
    metrics: emptyMetrics(),
    agentTimes: [],
    constraint: parseConstraint(raw),
    sourceRef: BASELINE_SOURCE_REF,
  };
  if (typeof raw !== 'string') return result;

  // Four key metrics: rows are | Metric | Value | Window |.
  for (const cells of tableRows(raw)) {
    if (cells.length < 3) continue;
    const prefix = cells[0].toLowerCase();
    const match = METRIC_KEY_BY_PREFIX.find(([p]) => prefix.startsWith(p));
    if (match && result.metrics[match[1]] === null) {
      result.metrics[match[1]] = { value: cells[1], window: cells[2] };
    }
  }

  // Per-agent task completion: rows are | Agent | n | modal | median | mean |.
  // We recognise the agent rows by the 5-column shape with a numeric n cell,
  // skipping the metric table (3 cols) and any header/separator rows.
  for (const cells of tableRows(raw)) {
    if (cells.length < 5) continue;
    const n = Number(cells[1]);
    if (cells[0].toLowerCase() === 'agent' || Number.isNaN(n)) continue;
    result.agentTimes.push({
      agent: cells[0],
      n,
      modal: cells[2],
      median: cells[3],
      mean: cells[4],
    });
  }

  return result;
}
