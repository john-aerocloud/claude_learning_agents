// UC-S013-1 — defects aggregator (DOMAIN).
//
// Pure functions: (defect markdown files + raw ledger CSV + project id) →
// defect record array for GET /api/projects/:id/defects. No fs, no HTTP —
// the route adapter (routes/defects.js) reads files and calls this.
//
// GROUND TRUTH (slice s013): the project's defect set is the UNION of
//   (a) work/<project>/defects/DEFECT-*.md records, and
//   (b) ledger failure/recovery rows whose ref carries a DEFECT-NNN id
//       (DEFECT-011 exists ONLY in the ledger — no md file).
// MTTR = first matching recovery ts − first failure ts, in seconds. An
// unmatched failure is an OPEN defect (recovered_ts/mttr_s null), never an
// error. EXP-035: the id predicate is the simplest one — /DEFECT-\d+/ in the
// failure ref; non-defect failure refs (INFRA-STALL-…) are not defects.
//
// §8 RESILIENCE: never throws. A malformed md file degrades to null fields;
// missing ledger/dir yields [] — no 5xx on a well-formed request.
//
// READ-ONLY REUSE: parseLedger is imported from ledgerAggregator.js (the
// shared tolerant parser — no second CSV parser, per OI-S004/AC-S005-1-6).
import { parseLedger } from './ledgerAggregator.js';

const DEFECT_ID_RE = /DEFECT-\d+/;
// A fix sha is a 7–40 char hex token containing at least one digit AND one
// a–f letter (rejects bare run-ids like 27098875856 and English words).
const SHA_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
const FOUR_FIELDS = ['expected', 'actual', 'intent', 'importance'];

/** First DEFECT-NNN token in a string, or null. */
function extractDefectId(s) {
  const m = typeof s === 'string' ? s.match(DEFECT_ID_RE) : null;
  return m ? m[0] : null;
}

/** Numeric sort key for "DEFECT-012" → 12. Unparseable → +Inf (sorts last). */
function idNumber(id) {
  const m = /DEFECT-(\d+)/.exec(id);
  return m ? Number(m[1]) : Infinity;
}

/**
 * Normalise a raw status declaration ("CLOSED (fixed + verified)",
 * "confirmed → fix scheduled") to its leading status word, uppercased.
 */
function normaliseStatus(text) {
  const m = /^([A-Za-z-]+)/.exec((text ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

/**
 * Split markdown into H2 sections: [{heading, body}] where heading is the
 * text after "## " and body is everything until the next H2/EOF.
 */
function splitSections(text) {
  const re = /^##\s+(.+)$/gm;
  const marks = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    marks.push({
      heading: match[1].trim(),
      headingStart: match.index,
      bodyStart: match.index + match[0].length,
    });
  }
  return marks.map((mark, i) => ({
    heading: mark.heading,
    body: text
      .slice(mark.bodyStart, i + 1 < marks.length ? marks[i + 1].headingStart : text.length)
      .trim(),
  }));
}

/** Body of the first section whose heading starts with `name` (case-insensitive). */
function sectionBody(sections, name) {
  const lower = name.toLowerCase();
  const hit = sections.find((s) => s.heading.toLowerCase().startsWith(lower));
  return hit && hit.body !== '' ? hit.body : null;
}

/**
 * Parse the `## Four fields` bullet shape:
 *   - **Expected:** text…  (until the next "- **" bullet or section end)
 * @returns {Record<string,string>} keys ∈ expected/actual/intent/importance
 */
function parseFourFieldBullets(body) {
  const out = {};
  if (!body) return out;
  const re = /-\s+\*\*([A-Za-z]+):\*\*\s*([\s\S]*?)(?=\n-\s+\*\*|$)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1].toLowerCase();
    if (FOUR_FIELDS.includes(key)) out[key] = m[2].trim();
  }
  return out;
}

/**
 * Parse one DEFECT-*.md file (tolerant across the three live shapes:
 * inline-header + Four-fields bullets; own-line Status + H2 four-field
 * sections; later "## Status: …" heading overriding the header).
 * Missing/unparseable parts degrade to null — never throws.
 * @param {string} filename e.g. "DEFECT-001-ui-shows-zero.md"
 * @param {string} text raw markdown
 */
export function parseDefectMarkdown(filename, text) {
  const id = extractDefectId(filename);
  const raw = typeof text === 'string' ? text : '';

  // Title: H1 "# DEFECT-NNN — title"
  const h1 = /^#\s+(.+)$/m.exec(raw);
  let title = null;
  if (h1) {
    title = h1[1].replace(DEFECT_ID_RE, '').replace(/^[\s—–:-]+/, '').trim() || null;
  }

  // Status: LAST declaration wins — "**Status:** …" line or "## Status: …" heading
  // (DEFECT-009 opens CONFIRMED and closes with a later "## Status: CLOSED").
  let status = null;
  const statusRe = /(?:\*\*Status:\*\*|^##\s+Status:)\s*([^\n·]+)/gm;
  let sm;
  while ((sm = statusRe.exec(raw)) !== null) status = normaliseStatus(sm[1]);

  // Severity: token after "**Severity:**" (HIGH, MED-HIGH, LOW-MED, …)
  const sev = /\*\*Severity:\*\*\s*([A-Za-z][A-Za-z-]*)/.exec(raw);
  const severity = sev ? sev[1].toUpperCase() : null;

  const sections = splitSections(raw);

  // Four fields: bullet shape inside "## Four fields", else own H2 sections.
  let four = parseFourFieldBullets(sectionBody(sections, 'four fields'));
  if (Object.keys(four).length === 0) {
    four = {};
    for (const key of FOUR_FIELDS) {
      const body = sectionBody(sections, key);
      if (body) four[key] = body;
    }
  }

  const resolution_text = sectionBody(sections, 'resolution');
  const shas = resolution_text ? [...new Set(resolution_text.match(SHA_RE) ?? [])] : [];

  return {
    id,
    title,
    status,
    severity,
    expected: four.expected ?? null,
    actual: four.actual ?? null,
    intent: four.intent ?? null,
    importance: four.importance ?? null,
    classification: sectionBody(sections, 'classification'),
    root_cause: sectionBody(sections, 'root cause'),
    resolution_text,
    fix_sha: shas.length > 0 ? shas.join(', ') : null,
  };
}

/**
 * Aggregate the project's defects from md records + the ledger.
 * @param {{ files?: Array<{name: string, text: string}>,
 *           ledgerCsv?: string|null,
 *           projectId: string,
 *           idFilter?: string|null }} opts
 * @returns {Array<object>} defect records sorted ascending by id
 */
export function aggregateDefects({ files = [], ledgerCsv = null, projectId, idFilter = null }) {
  // --- Ledger pairing: per defect id, first failure + first matching recovery.
  const rows = parseLedger(ledgerCsv).filter((r) => r.project === projectId);
  const pairs = new Map(); // id → {failure: row|null, recovery: row|null}
  const byTime = [...rows].sort(
    (a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0),
  );
  for (const row of byTime) {
    if (row.event !== 'failure' && row.event !== 'recovery') continue;
    const id = extractDefectId(row.ref);
    if (!id) continue;
    if (!pairs.has(id)) pairs.set(id, { failure: null, recovery: null });
    const pair = pairs.get(id);
    if (row.event === 'failure' && !pair.failure) pair.failure = row;
    if (row.event === 'recovery' && !pair.recovery && pair.failure) pair.recovery = row;
  }

  // --- Union of ids: md files ∪ ledger failure refs.
  const fileById = new Map();
  for (const f of files) {
    const id = extractDefectId(f?.name);
    if (id && !fileById.has(id)) fileById.set(id, f);
  }
  const ids = new Set([...fileById.keys(), ...pairs.keys()]);

  const out = [];
  for (const id of ids) {
    const file = fileById.get(id) ?? null;
    const pair = pairs.get(id) ?? { failure: null, recovery: null };

    let record;
    if (file) {
      record = parseDefectMarkdown(file.name, file.text);
      record.id = id;
    } else {
      record = {
        id,
        title: null,
        status: null,
        severity: null,
        expected: null,
        actual: null,
        intent: null,
        importance: null,
        classification: null,
        root_cause: null,
        resolution_text: null,
        fix_sha: null,
      };
    }

    // Ledger-derived figures. Human-meaningful: durations carry a units field.
    const reported_ts = pair.failure?.timestamp ?? null;
    const recovered_ts = pair.recovery?.timestamp ?? null;
    let mttr_s = null;
    if (reported_ts && recovered_ts) {
      const span = (Date.parse(recovered_ts) - Date.parse(reported_ts)) / 1000;
      mttr_s = Number.isFinite(span) && span >= 0 ? Math.round(span) : null;
    }
    record.reported_ts = reported_ts;
    record.recovered_ts = recovered_ts;
    record.mttr_s = mttr_s;
    record.mttr_units = 's';
    record.source = { file: file ? file.name : null };

    // Status fallback when the file is absent or silent: a recovered ledger
    // pair is CLOSED; an unmatched failure is an OPEN (CONFIRMED) defect.
    if (!record.status && pair.failure) {
      record.status = pair.recovery ? 'CLOSED' : 'CONFIRMED';
    }
    // Title fallback: the failure note is the human-readable "what broke".
    if (!record.title && pair.failure?.note) record.title = pair.failure.note;

    out.push(record);
  }

  out.sort((a, b) => idNumber(a.id) - idNumber(b.id) || String(a.id).localeCompare(String(b.id)));
  return idFilter ? out.filter((d) => d.id === idFilter) : out;
}
