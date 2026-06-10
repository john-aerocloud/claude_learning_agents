// UC-S004-1 — ledger aggregator (DOMAIN).
//
// Pure function: (raw ledger CSV string, project id) → per-stage value-stream
// array. Imports only the CSV parser (sibling domain) — no Express, no fs, no
// SDK. The HTTP adapter (routes/stageFlow.js) reads the file and calls this.
//
// §8 RESILIENCE / FIDELITY: never throws, never 500s. A null/empty ledger, a
// project with no rows, half-open enter→(no exit), duplicate rows, and ragged
// comma-shifted rows all yield numbers (zeros where appropriate), not errors.
// A stage with no events is PRESENT with all four figures = 0 (never omitted).
//
// STAGE→LEDGER MAPPING (pragmatic, derived from the real observatory rows):
//   intake       enqueue queue=intake               (gate/intake signal)
//   decompose    agent=product   task_start/task_end
//   ready        enqueue queue=ready
//   capabilities agent=cicd      task_start/task_end
//   ui-design    agent=ui-designer task_start/task_end (non-validate)
//   build        agent=engineer  task_start/task_end  (+ stage_enter/exit for WIP)
//   ui-validate  agent=ui-designer with a 'validate' note/slice signal
//   deploy       event=deploy                         (gate/deploy signal)
//   validate     agent=tester    task_start/task_end (+ validation_run)
//   done         event=deploy outcome ∈ {success,pass}
//   rework       failure/recovery/rework events
//
// THROUGHPUT vs WIP (the AC1.4/AC1.5 reconciliation):
//   throughput = count of THROUGHPUT in-event rows for the stage. For `build`
//     the throughput in-event is task_start ONLY (AC1.4 hand-counts task_start),
//     so build.throughput == #(engineer task_start) — a number a tester can grep.
//   wip        = items with an OPEN in-event (task_start OR stage_enter) and no
//     matching out-event (task_end OR stage_exit). Pulled-but-not-done work is
//     COUNTABLE here — this is the key fix. wip_items names the open ids.

// DEFECT-002 — WIP reconciliation against the authoritative item registry.
// WIP from raw enter/exit pairing alone counts an item that was HELD/DROPPED
// (a stage_enter with no exit) as in-flight FOREVER. An open enter is genuine
// in-flight ONLY if the item (1) still EXISTS in items.csv AND (2) is in a
// non-terminal state. Absent-from-registry or terminal → STALE, not in-flight.
// Throughput/dwell/rework are HISTORICAL counts and are NOT reconciled — only
// WIP is "now". Fail-soft: no/empty items registry → no reconciliation, keep
// the raw open-enter behaviour (never throw).
import { parseCsv } from '../parsers/csv.js';

const TERMINAL_ITEM_STATES = new Set(['done', 'dropped', 'cancelled']);

/**
 * Build an item-id → {exists, terminal} registry from raw items.csv text.
 * Null/empty/unparseable input → null (signals "no reconciliation, fail soft").
 * @param {string|null|undefined} itemsCsv raw work/<project>/items/items.csv
 * @returns {Map<string,{terminal:boolean}>|null}
 */
function buildItemRegistry(itemsCsv) {
  if (typeof itemsCsv !== 'string' || itemsCsv.trim() === '') return null;
  let records;
  try {
    records = parseCsv(itemsCsv);
  } catch {
    return null; // unparseable registry → fall back to raw open-enter (fail soft)
  }
  if (!Array.isArray(records) || records.length === 0) return null;
  const reg = new Map();
  for (const rec of records) {
    const id = (rec.id ?? '').trim();
    if (!id) continue;
    const state = (rec.state ?? '').trim().toLowerCase();
    reg.set(id, { terminal: TERMINAL_ITEM_STATES.has(state) });
  }
  return reg.size > 0 ? reg : null;
}

// NOTE ON PARSING — why NOT the shared parseCsv (csv.js):
// The real process/dora/ledger.csv is not strict RFC-4180. Agents append free
// text into `note` that contains unescaped commas AND unbalanced double-quotes
// (e.g. `commit 1715807"`). A strict columns:true csv parser treats one stray
// quote as the start of a quoted field and SWALLOWS every subsequent physical
// line until the next quote — silently dropping real rows (build throughput read
// 4 instead of the true 7). The §8 fidelity requirement ("numbers must be
// correct against the real ledger") forces a tolerant, LINE-ORIENTED parse:
// the ledger is append-only, one event per physical line, and the column layout
// is fixed — the first 9 columns (timestamp..ref) never contain commas, the last
// 2 (item_id, queue) are simple tokens, and `note` is everything in between.
// So we split each line, take the fixed prefix and the trailing pair, and rejoin
// the middle as the note. One bad line can never corrupt another.

// Fixed ledger column order (process/dora/ledger.csv header).
const COLUMNS = [
  'timestamp', 'project', 'iteration', 'slice', 'agent', 'event',
  'duration_s', 'outcome', 'ref', 'note', 'item_id', 'queue',
];
const MIN_FIELDS = COLUMNS.length; // a usable row has at least 12 comma-fields
const PREFIX_LEN = 9; // timestamp..ref — never contain commas
const TRAILING_LEN = 2; // item_id, queue — trailing simple tokens

/**
 * Tolerant, line-oriented ledger parse. Each non-blank line after the header
 * becomes a row object keyed by COLUMNS. Lines with fewer than 12 fields, or a
 * non-timestamp first field, are skipped (never throw). `note` absorbs any
 * commas between the fixed prefix and the trailing item_id/queue pair.
 * @param {string|null|undefined} text raw ledger CSV
 * @returns {Array<Record<string,string>>}
 */
export function parseLedger(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const lines = text.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    if (raw.trim() === '') continue;
    const parts = raw.split(',');
    if (parts.length < MIN_FIELDS) continue; // ragged/garbage line — skip soft
    const first = parts[0].trim();
    // Skip the header and any line that does not start with a timestamp.
    if (first === 'timestamp' || !/^\d{4}-\d{2}-\d{2}T/.test(first)) continue;

    const prefix = parts.slice(0, PREFIX_LEN);
    const trailing = parts.slice(parts.length - TRAILING_LEN);
    const note = parts.slice(PREFIX_LEN, parts.length - TRAILING_LEN).join(',');

    const row = { rowRef: `row:${i + 1}` }; // 1-based physical line number
    for (let c = 0; c < PREFIX_LEN; c++) row[COLUMNS[c]] = (prefix[c] ?? '').trim();
    row[COLUMNS[PREFIX_LEN]] = note; // note (keep commas, do not trim aggressively)
    row[COLUMNS[PREFIX_LEN + 1]] = (trailing[0] ?? '').trim(); // item_id
    row[COLUMNS[PREFIX_LEN + 2]] = (trailing[1] ?? '').trim(); // queue
    rows.push(row);
  }
  return rows;
}

// Canonical stages in flow order. `wip`/`open` event sets drive WIP pairing;
// `tp` is the throughput in-event matcher; `out` closes a WIP pair.
// Each stage carries pure predicate matchers over a normalised row.
export const CANONICAL_STAGES = [
  { stage: 'intake', label: 'Intake (gate)' },
  { stage: 'decompose', label: 'Decompose (product)' },
  { stage: 'ready', label: 'Ready (queue)' },
  { stage: 'capabilities', label: 'Capabilities (cicd)' },
  { stage: 'ui-design', label: 'UI-Design' },
  { stage: 'engineer', label: 'Build / TDD (engineer)' },
  { stage: 'ui-validate', label: 'UI-Validate' },
  { stage: 'deploy', label: 'Deploy (gate)' },
  { stage: 'validate', label: 'Validate (tester)' },
  { stage: 'done', label: 'Done' },
  { stage: 'rework', label: 'Rework (loop)' },
];

const REWORK_EVENTS = new Set(['failure', 'recovery', 'rework']);
const DONE_OUTCOMES = new Set(['success', 'pass']);

function isUiValidate(r) {
  const hay = `${r.note} ${r.slice} ${r.ref}`.toLowerCase();
  return hay.includes('validate') || hay.includes('validation');
}

// Per-stage matchers. Each returns predicates over a normalised row `r`.
//   tpIn:  counts toward throughput (an in-event)
//   openIn: opens a WIP pair (item is now in-flight in this stage)
//   close: closes a WIP pair for the same item
//   rework: a rework re-entry for this stage
const STAGE_MATCHERS = {
  intake: {
    tpIn: (r) => r.event === 'enqueue' && r.queue === 'intake',
    openIn: () => false,
    close: () => false,
  },
  decompose: {
    tpIn: (r) => r.agent === 'product' && r.event === 'task_start',
    openIn: (r) => r.agent === 'product' && r.event === 'task_start',
    close: (r) => r.agent === 'product' && r.event === 'task_end',
    rework: (r) => r.agent === 'product' && REWORK_EVENTS.has(r.event),
  },
  ready: {
    tpIn: (r) => r.event === 'enqueue' && r.queue === 'ready',
    openIn: () => false,
    close: () => false,
  },
  capabilities: {
    tpIn: (r) => r.agent === 'cicd' && r.event === 'task_start',
    openIn: (r) => r.agent === 'cicd' && r.event === 'task_start',
    close: (r) => r.agent === 'cicd' && r.event === 'task_end',
    rework: (r) => r.agent === 'cicd' && REWORK_EVENTS.has(r.event),
  },
  'ui-design': {
    tpIn: (r) => r.agent === 'ui-designer' && r.event === 'task_start' && !isUiValidate(r),
    openIn: (r) =>
      r.agent === 'ui-designer' &&
      (r.event === 'task_start' || r.event === 'stage_enter') &&
      !isUiValidate(r),
    close: (r) =>
      r.agent === 'ui-designer' &&
      (r.event === 'task_end' || r.event === 'stage_exit') &&
      !isUiValidate(r),
    rework: (r) => r.agent === 'ui-designer' && REWORK_EVENTS.has(r.event) && !isUiValidate(r),
  },
  engineer: {
    // AC1.4: build throughput == #(engineer task_start) — task_start only.
    tpIn: (r) => r.agent === 'engineer' && r.event === 'task_start',
    // WIP opens on task_start OR stage_enter (AC1.5), closes on either out-event.
    openIn: (r) => r.agent === 'engineer' && (r.event === 'task_start' || r.event === 'stage_enter'),
    close: (r) => r.agent === 'engineer' && (r.event === 'task_end' || r.event === 'stage_exit'),
    rework: (r) => r.agent === 'engineer' && REWORK_EVENTS.has(r.event),
  },
  'ui-validate': {
    tpIn: (r) => r.agent === 'ui-designer' && r.event === 'task_start' && isUiValidate(r),
    openIn: (r) =>
      r.agent === 'ui-designer' &&
      (r.event === 'task_start' || r.event === 'stage_enter') &&
      isUiValidate(r),
    close: (r) =>
      r.agent === 'ui-designer' &&
      (r.event === 'task_end' || r.event === 'stage_exit') &&
      isUiValidate(r),
    rework: (r) => r.agent === 'ui-designer' && REWORK_EVENTS.has(r.event) && isUiValidate(r),
  },
  deploy: {
    tpIn: (r) => r.event === 'deploy',
    openIn: () => false,
    close: () => false,
  },
  validate: {
    tpIn: (r) => r.agent === 'tester' && r.event === 'task_start',
    openIn: (r) => r.agent === 'tester' && (r.event === 'task_start' || r.event === 'stage_enter'),
    close: (r) => r.agent === 'tester' && (r.event === 'task_end' || r.event === 'stage_exit'),
    rework: (r) => r.agent === 'tester' && REWORK_EVENTS.has(r.event),
  },
  done: {
    tpIn: (r) => r.event === 'deploy' && DONE_OUTCOMES.has(r.outcome),
    openIn: () => false,
    close: () => false,
  },
  rework: {
    tpIn: (r) => REWORK_EVENTS.has(r.event),
    openIn: () => false,
    close: () => false,
    rework: (r) => REWORK_EVENTS.has(r.event),
  },
};

// Median of a numeric array; [] → 0. Returns the average of the two middle
// values for even counts (a real positive number, AC1.6).
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Duration of a completed pair: prefer the out-row's duration_s; else compute
// from timestamps (out − in) in seconds. Non-positive / unparseable → skipped
// by the caller (only positive durations contribute to dwell).
function pairDurationS(openRow, closeRow) {
  const d = Number(closeRow.duration_s);
  if (Number.isFinite(d) && d > 0) return d;
  const tIn = Date.parse(openRow.timestamp);
  const tOut = Date.parse(closeRow.timestamp);
  if (Number.isFinite(tIn) && Number.isFinite(tOut) && tOut > tIn) {
    return (tOut - tIn) / 1000;
  }
  return null;
}

function emptyStages() {
  return CANONICAL_STAGES.map((s) => ({
    stage: s.stage,
    label: s.label,
    throughput: 0,
    dwell_median_s: 0,
    wip: 0,
    rework: 0,
    wip_items: [],
    source_rows: [],
  }));
}

/**
 * Aggregate the per-stage value-stream for one project from a raw ledger CSV.
 * @param {string|null|undefined} ledgerCsv raw contents of process/dora/ledger.csv
 * @param {string} project project id to filter to
 * @param {string|null} [itemsCsv] raw work/<project>/items/items.csv — when
 *   present, WIP is reconciled against it (DEFECT-002): an open enter for an
 *   item absent-from-registry or terminal is NOT in-flight. Omitted/null/empty
 *   → no reconciliation (fail-soft, raw open-enter behaviour preserved).
 * @returns {Array<{stage:string,label:string,throughput:number,dwell_median_s:number,
 *   wip:number,rework:number,wip_items:string[],source_rows:string[]}>}
 */
export function aggregateStageFlow(ledgerCsv, project, itemsCsv = null) {
  if (typeof ledgerCsv !== 'string' || ledgerCsv.trim() === '') return emptyStages();

  // DEFECT-002: reconcile WIP against the authoritative item registry. null →
  // no registry available → keep raw open-enter pairing (fail soft).
  const itemRegistry = buildItemRegistry(itemsCsv);

  let rows;
  try {
    rows = parseLedger(ledgerCsv).filter((r) => r.project === project);
  } catch {
    return emptyStages(); // never throw on a malformed ledger
  }

  return CANONICAL_STAGES.map((stageDef) => {
    const m = STAGE_MATCHERS[stageDef.stage];
    const sourceRows = new Set();
    let throughput = 0;
    let rework = 0;

    // WIP pairing: walk rows in order, opening/closing per item_id. An item with
    // an open in-event and no later close is in-flight (WIP). Rows lacking an
    // item_id still count toward throughput/rework but cannot be WIP-paired
    // (no identity to pair on) — they fail soft to "not WIP", never an error.
    const openByItem = new Map(); // item_id → open row (last unmatched in-event)
    const dwellSamples = [];

    for (const r of rows) {
      if (m.tpIn(r)) {
        throughput += 1;
        sourceRows.add(r.rowRef);
      }
      if (m.rework && m.rework(r)) {
        rework += 1;
        sourceRows.add(r.rowRef);
      }
      const id = r.item_id;
      if (m.openIn(r) && id) {
        openByItem.set(id, r);
        sourceRows.add(r.rowRef);
      } else if (m.close(r) && id && openByItem.has(id)) {
        const openRow = openByItem.get(id);
        openByItem.delete(id);
        sourceRows.add(r.rowRef);
        const d = pairDurationS(openRow, r);
        if (d !== null) dwellSamples.push(d);
      } else if (m.close(r) && id) {
        // close with no open (half-open / out-of-order) — record source, no crash
        sourceRows.add(r.rowRef);
      }
    }

    // DEFECT-002: an open enter is genuine in-flight only if the item still
    // exists in the registry AND is non-terminal. No registry → keep all opens.
    const wipItems = [...openByItem.keys()].filter((id) => {
      if (!itemRegistry) return true; // fail-soft: no registry to reconcile against
      const entry = itemRegistry.get(id);
      return entry !== undefined && !entry.terminal;
    });

    return {
      stage: stageDef.stage,
      label: stageDef.label,
      throughput,
      dwell_median_s: median(dwellSamples),
      wip: wipItems.length,
      rework,
      wip_items: wipItems,
      source_rows: [...sourceRows],
    };
  });
}
