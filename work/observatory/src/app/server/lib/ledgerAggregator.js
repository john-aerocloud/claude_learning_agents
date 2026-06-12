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

// DEFECT-002/009/010/011 — WIP staleness history.
// WIP from raw enter/exit pairing alone counts a HELD/DROPPED open enter as
// in-flight FOREVER (DEFECT-002). DEFECT-009 made RECENCY the primary gate but
// kept an items.csv terminal SECONDARY exclusion. DEFECT-010 DROPS that secondary
// check: it hid recent ACTIVE work logged against delivered (terminal) chunks/UCs.
// WIP is now RECENCY-ONLY (a recent open in-event with no close IS in-flight,
// registry state irrelevant); recency alone excludes the hours-old DEFECT-002
// phantoms. DEFECT-011: the 30-min horizon ITSELF was too short — its premise
// ("real agent tasks complete in single-digit minutes") was falsified by real
// 29–32-min tasks that vanished from WIP while still running; horizon is now
// 2 HOURS (see WIP_STALENESS_HORIZON_MS). The items.csv registry is still used
// for QUEUE-DEPTH stale-filtering and coherence (DEFECT-004) — see
// computeQueueState; only the WIP path drops it.
// Throughput/dwell/rework are HISTORICAL counts and are never reconciled.
import { parseCsv } from '../parsers/csv.js';

const TERMINAL_ITEM_STATES = new Set(['done', 'dropped', 'cancelled']);

// DEFECT-009 — WIP is RECENCY-based, not items.csv-membership-based.
// An open in-event (task_start/stage_enter with no matching close) is in-flight
// iff it is RECENT — within this staleness horizon of request time. DEFECT-002's
// phantom orphans (a held/dropped UC's enter, hours-to-days old) fail this gate.
// DEFECT-011 — horizon value. The earlier claim "real agent tasks complete in
// single-digit minutes" is FALSE: observed real tasks now run ~29–32 minutes
// (and durations grow with model capability). The 30-min horizon hid a
// genuinely-running 32-min product task (REPLENISH-CHK6) and would have hidden
// the 29-min engineer task beside it at minute 30. 2 hours comfortably exceeds
// the observed max (~4x headroom) while remaining far below known phantom ages
// (the DEFECT-002 orphans were hours-to-days old; an abandoned open ages past
// 2h quickly, so phantoms still self-clear). Recency stays the ONLY gate
// (EXP-035: simplest predicate wins; no new exclusions added).
// Named so it can be tuned without logic changes (ruling §"Horizon value").
// EXPORTED (UC-S015-1): the stage-flow response stamps this on every stage as
// `wip_horizon_ms` so the WIP navigation panel reads the LIVE horizon from the
// source instead of hard-coding 2h client-side (S15-1-WIP-1 / EXP-035).
export const WIP_STALENESS_HORIZON_MS = 2 * 60 * 60 * 1000; // 2 hours (DEFECT-011)

// DEFECT-004 — buffer (queue) stages hold items RIGHT NOW. Each maps to a queue
// CSV (work/<project>/queues/<stage>.csv) for current depth/wait, and (where a
// clean items.csv state exists) to the items.csv state used for the coherence
// cross-check (§4): queue_depth must equal the items.csv count for that state.
// `coherenceState: null` → depth comes from the queue CSV only, no warning.
const BUFFER_STAGES = {
  intake: { coherenceState: 'backlog' },
  ready: { coherenceState: 'ready' },
  deploy: { coherenceState: null },
  rework: { coherenceState: null },
};

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
    reg.set(id, { terminal: TERMINAL_ITEM_STATES.has(state), state });
  }
  return reg.size > 0 ? reg : null;
}

/**
 * Compute the queue current-state fields for one buffer stage (DEFECT-004 §3/§4).
 * Stale-filters the queue CSV against the item registry (an item whose items.csv
 * state is terminal — done/dropped/cancelled — is a STALE queue entry and is
 * dropped silently with a server-side warning, per §4.1), computes accruing
 * wait_s = now − enqueued_ts, and cross-checks depth against the items.csv count
 * for the stage's coherence state (§4 consistency check → coherence_warning).
 * Fail-soft: no/empty/unparseable queue CSV → depth 0, items [], warning false.
 * @param {{coherenceState: string|null}} bufferDef
 * @param {string|null|undefined} queueCsv raw work/<project>/queues/<stage>.csv
 * @param {Map<string,{terminal:boolean,state:string}>|null} itemRegistry
 * @param {number} now epoch ms used for wait_s (request time)
 * @param {string} stage stage id (for log context)
 * @returns {{queue_depth:number, queue_items:Array, coherence_warning:boolean}}
 */
function computeQueueState(bufferDef, queueCsv, itemRegistry, now, stage) {
  let rows = [];
  if (typeof queueCsv === 'string' && queueCsv.trim() !== '') {
    try {
      rows = parseCsv(queueCsv);
    } catch {
      rows = []; // unparseable queue CSV → empty (fail-soft, never throw)
    }
  }

  const queueItems = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = (r.item_id ?? '').trim();
    if (!id) continue;
    // §4.1 stale-entry filter: a queue row for a terminal item does NOT count.
    if (itemRegistry) {
      const entry = itemRegistry.get(id);
      if (entry && entry.terminal) {
        // eslint-disable-next-line no-console
        console.warn(
          `[stage-flow] stale queue entry filtered: ${id} in ${stage} queue but items.csv state is terminal`,
        );
        continue;
      }
    }
    const enqueuedAt = (r.enqueued_ts ?? '').trim();
    const t = Date.parse(enqueuedAt);
    const waitS = Number.isFinite(t) && Number.isFinite(now) && now > t
      ? Math.round((now - t) / 1000)
      : 0;
    queueItems.push({ item_id: id, enqueued_at: enqueuedAt, wait_s: waitS });
  }

  const queueDepth = queueItems.length;

  // §4 coherence cross-check: where the stage has a clean items.csv state, the
  // count of items in that state (the tree's view) must equal queue_depth. If
  // they differ, surface a warning rather than show a silently-wrong number.
  let coherenceWarning = false;
  if (bufferDef.coherenceState && itemRegistry) {
    let stateCount = 0;
    for (const entry of itemRegistry.values()) {
      if (entry.state === bufferDef.coherenceState) stateCount += 1;
    }
    if (stateCount !== queueDepth) {
      coherenceWarning = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[stage-flow] coherence mismatch in ${stage}: items.csv ${bufferDef.coherenceState}-count=${stateCount} vs queue_depth=${queueDepth}`,
      );
    }
  }

  return { queue_depth: queueDepth, queue_items: queueItems, coherence_warning: coherenceWarning };
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

// DEFECT-005 — the traceability reveal must show readable CONTRIBUTING EVENTS,
// not internal CSV line indices. The aggregator already visits each contributing
// row, so we project its readable fields into source_events. Capped server-side
// so a busy stage (85 engineer task_starts) does not ship a huge payload; the
// true count is reported as source_total so the UI can render "…and N more".
const SOURCE_EVENTS_CAP = 50;

// DEFECT-008 — the bare item_id is opaque ("SLC-vision" says nothing about the
// work). Every ledger row already carries a rich `note` (the human "why"), which
// the tolerant parser preserves (commas and all). Carry it into source_events so
// the reveal can show context, not just a machine ref. The UI trims/ellipsises;
// we keep the full note here (a server cap could be added if payloads grow).
/** Project a parsed ledger row into a readable source-event tuple (DEFECT-005/008). */
function toSourceEvent(r) {
  return {
    ts: r.timestamp,
    agent: r.agent,
    event: r.event,
    item_id: r.item_id,
    note: r.note ?? '',
  };
}

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

// DEFECT-007 — active-days denominator for the throughput RATE.
// The UTC calendar date (YYYY-MM-DD) of an ISO timestamp. This is exactly the
// basis dora.py uses for deploy-frequency (parse_ts(ts).date()) and queue
// throughput — so the map's per-stage rate is coherent with baseline.md.
// Unparseable / blank timestamp → null (does not contribute a date).
function utcDate(ts) {
  if (typeof ts !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(ts.trim());
  return m ? m[1] : null;
}

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

// Queue current-state fields for a stage: a buffer stage gets computed depth/
// items/warning; a work stage gets nulls (the UI treats null as "not a queue").
function queueFieldsFor(stage, queues, itemRegistry, now) {
  const bufferDef = BUFFER_STAGES[stage];
  if (!bufferDef) {
    return { queue_depth: null, queue_items: null, coherence_warning: false };
  }
  const queueCsv = queues && typeof queues === 'object' ? queues[stage] : null;
  return computeQueueState(bufferDef, queueCsv, itemRegistry, now, stage);
}

function emptyStages(queues = null, itemRegistry = null, now = Date.now()) {
  return CANONICAL_STAGES.map((s) => ({
    stage: s.stage,
    label: s.label,
    throughput: 0,
    active_days: 0,
    throughput_per_active_day: null, // DEFECT-007 — 0 active days ⇒ null (UI shows "—")
    dwell_median_s: 0,
    dwell_pairs: 0,
    wip: 0,
    rework: 0,
    wip_items: [],
    wip_horizon_ms: WIP_STALENESS_HORIZON_MS, // UC-S015-1: live horizon, never client-hardcoded
    open_items: [],
    source_rows: [],
    source_events: [],
    source_total: 0,
    ...queueFieldsFor(s.stage, queues, itemRegistry, now),
  }));
}

/**
 * Aggregate the per-stage value-stream for one project from a raw ledger CSV.
 * @param {string|null|undefined} ledgerCsv raw contents of process/dora/ledger.csv
 * @param {string} project project id to filter to
 * @param {string|null} [itemsCsv] raw work/<project>/items/items.csv — used for
 *   QUEUE-DEPTH stale-filtering + coherence (DEFECT-004) only. WIP is RECENCY-ONLY
 *   (DEFECT-010) and does NOT consult the registry. Omitted/null/empty → no queue
 *   reconciliation (fail-soft); WIP is unaffected by its presence either way.
 * @returns {Array<{stage:string,label:string,throughput:number,dwell_median_s:number,
 *   wip:number,rework:number,wip_items:string[],source_rows:string[]}>}
 */
export function aggregateStageFlow(ledgerCsv, project, itemsCsv = null, opts = {}) {
  // DEFECT-004: queue current-state (depth/wait/coherence) is computed from the
  // queue CSVs + item registry at REQUEST TIME. `now` is request time (epoch ms);
  // the server may pass Date.now() — this is a normal Node process.
  const queues = opts && typeof opts === 'object' ? opts.queues || null : null;
  // `now` defaults to request time — but an EXPLICITLY-passed non-finite now
  // (NaN) is honoured as "uncomputable", NOT silently swapped for Date.now():
  // the downstream dwell/wait guards then fail soft to null (unknown ≠ 0,
  // S15-1-FIG-3). The old `Number.isFinite(opts.now) ? … : Date.now()` was a
  // time bomb — the NaN-now pin only passed while the wall clock trailed the
  // fixture's open timestamp, and went red on trunk the moment it caught up.
  const now = opts && opts.now !== undefined ? Number(opts.now) : Date.now();

  // DEFECT-002: reconcile WIP against the authoritative item registry. null →
  // no registry available → keep raw open-enter pairing (fail soft).
  const itemRegistry = buildItemRegistry(itemsCsv);

  if (typeof ledgerCsv !== 'string' || ledgerCsv.trim() === '') {
    return emptyStages(queues, itemRegistry, now);
  }

  let rows;
  try {
    rows = parseLedger(ledgerCsv).filter((r) => r.project === project);
  } catch {
    return emptyStages(queues, itemRegistry, now); // never throw on a malformed ledger
  }

  return CANONICAL_STAGES.map((stageDef) => {
    const m = STAGE_MATCHERS[stageDef.stage];
    // DEFECT-005: keep the contributing ROW (not just its index) keyed by rowRef
    // so we can emit both source_rows (audit) and readable source_events. A Map
    // preserves insertion order and dedups exactly as the old Set did.
    const sourceByRef = new Map();
    const sourceRows = { add: (r) => sourceByRef.set(r.rowRef, r) };
    let throughput = 0;
    let rework = 0;
    // DEFECT-007 D7-AC-7 (basis coherence) — active_days is the denominator of
    // the throughput RATE, so it counts distinct UTC dates of THROUGHPUT
    // in-events (tpIn) ONLY — the same rows the numerator counts. Counting all
    // contributing rows (opens/closes/rework) diluted the rate the first day an
    // engineer stage_enter landed with no task_start (live ledger 2026-06-12):
    // aggregator said 4 active days, the task_start hand-count said 3.
    const tpDates = new Set();

    // WIP pairing: walk rows in order, opening/closing per item_id. An item with
    // an open in-event and no later close is in-flight (WIP). Rows lacking an
    // item_id still count toward throughput/rework but cannot be WIP-paired
    // (no identity to pair on) — they fail soft to "not WIP", never an error.
    const openByItem = new Map(); // item_id → open row (last unmatched in-event)
    const dwellSamples = [];

    for (const r of rows) {
      if (m.tpIn(r)) {
        throughput += 1;
        sourceRows.add(r);
        const tpDate = utcDate(r.timestamp);
        if (tpDate) tpDates.add(tpDate);
      }
      if (m.rework && m.rework(r)) {
        rework += 1;
        sourceRows.add(r);
      }
      const id = r.item_id;
      if (m.openIn(r) && id) {
        openByItem.set(id, r);
        sourceRows.add(r);
      } else if (m.close(r) && id && openByItem.has(id)) {
        const openRow = openByItem.get(id);
        openByItem.delete(id);
        sourceRows.add(r);
        const d = pairDurationS(openRow, r);
        if (d !== null) dwellSamples.push(d);
      } else if (m.close(r) && id) {
        // close with no open (half-open / out-of-order) — record source, no crash
        sourceRows.add(r);
      }
    }

    // DEFECT-010: WIP is RECENCY-ONLY. The items.csv terminal/registry exclusion
    // (DEFECT-009's secondary rule) is DROPPED entirely — it hid recent ACTIVE
    // work logged against delivered (terminal) chunks/UCs (defect-fix & rework).
    //   isWip(openRow, now) = (now - parse(openRow.timestamp)) <= WIP_STALENESS_HORIZON_MS
    // That is the whole predicate: one condition, no registry lookup, no terminal
    // check, no done_ts comparison. A recent open in-event with no matching close
    // IS in-flight regardless of the item's registry state. The DEFECT-002 phantom
    // orphans (UC-S003-2/3/4) are hours-to-days old and fail recency → still
    // excluded (DEFECT-002 stays fixed by recency alone). The items.csv registry
    // is NOT consulted here; it remains used for queue depth/coherence (DEFECT-004).
    // wip_items entries are {item_id, note} (DEFECT-008): note = open row's note.
    const wipItems = [];
    // UC-S015-1 — open_items: EVERY unmatched open, regardless of age, with its
    // open timestamp + computed dwell. The recency horizon governs the at-a-glance
    // WIP headline (wip/wip_items, below — unchanged); the WIP NAVIGATION panel is
    // precisely where stale-open items must NOT silently vanish (S15-1-WIP-2), so
    // they ship here flagged `stale` instead of being dropped. dwell_ms is null
    // (unknown ≠ 0, S15-1-FIG-3) when it cannot be computed.
    const openItems = [];
    for (const [id, openRow] of openByItem) {
      const openTs = Date.parse(openRow.timestamp);
      const dwellMs = Number.isFinite(openTs) && Number.isFinite(now) && now >= openTs
        ? now - openTs
        : null;
      openItems.push({
        item_id: id,
        note: openRow.note ?? '',
        opened_at: openRow.timestamp,
        dwell_ms: dwellMs,
        stale: dwellMs !== null && dwellMs > WIP_STALENESS_HORIZON_MS,
      });
      const recent = Number.isFinite(openTs) && Number.isFinite(now)
        ? (now - openTs) <= WIP_STALENESS_HORIZON_MS
        : true; // unparseable ts → fail-soft to "recent" (never silently drop)
      if (!recent) continue;
      wipItems.push({ item_id: id, note: openRow.note ?? '' });
    }

    // DEFECT-005: contributing rows in encounter order. source_rows keeps the
    // audit indices; source_events projects readable fields (capped, with the
    // true total so the UI can render "…and N more").
    const contributing = [...sourceByRef.values()];
    const sourceTotal = contributing.length;

    // DEFECT-007 — throughput is a RATE: items per active-day. active_days is the
    // count of DISTINCT UTC calendar dates among the THROUGHPUT in-event rows
    // (tpDates — D7-AC-7 basis coherence: same rows as the numerator, same basis
    // as dora.py deploy-frequency, §1 of the ruling). 0 active days → rate is null
    // (the UI renders "—"), never a division-by-zero artefact. throughput (the raw
    // integer count) is KEPT — it is the numerator shown in the source/hover panel.
    const activeDays = tpDates.size;
    const throughputPerActiveDay = activeDays === 0 ? null : throughput / activeDays;

    return {
      stage: stageDef.stage,
      label: stageDef.label,
      throughput,
      active_days: activeDays,
      throughput_per_active_day: throughputPerActiveDay,
      dwell_median_s: median(dwellSamples),
      // DEFECT-004 AC-2: number of completed pairs behind dwell — the UI shows
      // "—" (unknown ≠ 0) when < 2 pairs, never a misleading "0s".
      dwell_pairs: dwellSamples.length,
      wip: wipItems.length,
      rework,
      wip_items: wipItems,
      wip_horizon_ms: WIP_STALENESS_HORIZON_MS, // UC-S015-1 (S15-1-WIP-1)
      open_items: openItems, // UC-S015-1 (S15-1-WIP-2) — all opens, stale flagged

      source_rows: contributing.map((r) => r.rowRef),
      source_events: contributing.slice(0, SOURCE_EVENTS_CAP).map(toSourceEvent),
      source_total: sourceTotal,
      ...queueFieldsFor(stageDef.stage, queues, itemRegistry, now),
    };
  });
}
