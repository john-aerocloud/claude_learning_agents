// UC-S015-1 — useWipItems: the WIP-navigation data hook.
//
// HEXAGONAL ROLE: composes the API adapter (api/client.js: getActive +
// getStageFlow + getItems + subscribeEvents) into the WipItem[] view-model the
// presentational WipPanel renders. The composition itself (composeWipItems) and
// the figure formatting (formatDwell/formatHorizon) are PURE DOMAIN — no fetch,
// no DOM — exported for direct unit testing; the hook adds only fetch/SSE state.
//
// WIP SEMANTICS (DEFECT-011 / S15-1-WIP-1/2, EXP-035):
//   - horizonMs is read from the stage-flow response (`wip_horizon_ms`, stamped
//     server-side from the exported WIP_STALENESS_HORIZON_MS) — NEVER a
//     hard-coded client literal. A horizon change lands in ONE place.
//   - the row set is `open_items` (ALL unmatched opens, any age) — a stale-open
//     item (dwell > horizon) is precisely what this panel exists to surface, so
//     it is flagged `isStale`, never dropped. The at-a-glance VSM WIP headline
//     stays recency-only; the two surfaces intentionally differ.
//
// FIGURE LEGIBILITY (S15-1-FIG-1..3): dwell is humanised WITH a unit
// ("2 h 14 min" / "28 min" / "53 s"); an uncomputable dwell renders "—"
// (unknown ≠ 0). Sort is here (dwell DESC, nulls last) so the panel stays a
// pure function of props (F-4: longest-in-stage leads; stale lead naturally).
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { getActive, getStageFlow, getItems, subscribeEvents } from '../api/client.js';

export const WIP_SOURCE_REF = 'process/dora/ledger.csv';

const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Humanise a dwell duration in ms with a time unit (S15-1-FIG-1).
 * null/NaN/negative → "—" (unknown ≠ 0, S15-1-FIG-3).
 * @param {number|null|undefined} ms
 * @returns {string} e.g. "2 h 14 min" | "28 min" | "53 s" | "—"
 */
export function formatDwell(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalS = Math.floor(ms / 1000);
  if (totalS < 60) return `${totalS} s`;
  const totalMin = Math.floor(totalS / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

/**
 * Compact horizon text for the stale badge ("stale — over 2h").
 * Whole hours → "Nh"; otherwise minutes → "Nmin"; invalid → "".
 * @param {number|null|undefined} ms
 */
export function formatHorizon(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalMin = Math.round(ms / 60_000);
  return totalMin % 60 === 0 ? `${totalMin / 60}h` : `${totalMin}min`;
}

/**
 * PURE: stage-flow array + item records → { horizonMs, items: WipItem[] }.
 * WipItem = { id, job, stage, stageLabel, value, cost, dwellMs, dwellText, isStale }.
 * Sorted dwellMs DESC, nulls last, id tiebreak (deterministic). Fail-soft on
 * null/malformed inputs → { horizonMs: null, items: [] }.
 * @param {Array|null} flow      /api/projects/:id/stage-flow response
 * @param {Array|null} itemRecords /api/projects/:id/items response
 */
export function composeWipItems(flow, itemRecords) {
  const stages = Array.isArray(flow) ? flow : [];
  const horizonStage = stages.find((s) => s && Number.isFinite(s.wip_horizon_ms));
  const horizonMs = horizonStage ? horizonStage.wip_horizon_ms : null;

  const byId = new Map();
  for (const r of Array.isArray(itemRecords) ? itemRecords : []) {
    const id = typeof r?.id === 'string' ? r.id.trim() : '';
    if (id) byId.set(id, r);
  }

  const items = [];
  for (const s of stages) {
    const opens = Array.isArray(s?.open_items) ? s.open_items : [];
    for (const o of opens) {
      const id = typeof o?.item_id === 'string' ? o.item_id.trim() : '';
      if (!id) continue;
      const rec = byId.get(id);
      const dwellMs = Number.isFinite(o.dwell_ms) ? o.dwell_ms : null;
      items.push({
        id,
        // FIG-2: the human job sentence from items.csv; fall back to the open
        // row's note (also human-written), then the id — never blank.
        job: String(rec?.job ?? '').trim() || String(o.note ?? '').trim() || id,
        stage: typeof s.stage === 'string' ? s.stage : '',
        stageLabel: String(s.label ?? '').trim() || String(s.stage ?? ''),
        value: String(rec?.value ?? '').trim() || '—',
        cost: String(rec?.cost ?? '').trim() || '—',
        dwellMs,
        dwellText: formatDwell(dwellMs),
        // stale derived from the LIVE horizon (S15-1-WIP-1), not a literal.
        isStale: dwellMs !== null && horizonMs !== null && dwellMs > horizonMs,
      });
    }
  }

  items.sort((a, b) => {
    if (a.dwellMs === null && b.dwellMs === null) return a.id.localeCompare(b.id);
    if (a.dwellMs === null) return 1; // unknown dwell sorts last (F-4)
    if (b.dwellMs === null) return -1;
    if (b.dwellMs !== a.dwellMs) return b.dwellMs - a.dwellMs;
    return a.id.localeCompare(b.id);
  });

  return { horizonMs, items };
}

/** Is this SSE change-frame path one that affects the WIP panel? The rows are
 * computed from the DORA ledger; job/value/cost join against items.csv. */
function isRelevantChange(path) {
  if (typeof path !== 'string') return false;
  const p = path.replace(/\\/g, '/');
  return /ledger\.csv$/i.test(p) || /items\.csv$/i.test(p);
}

/**
 * The WIP-navigation hook. Resolves the active project, loads stage-flow +
 * items in parallel, composes the sorted WipItem[], and re-fetches (debounced)
 * on a relevant SSE change frame — the data path behind the polite live-region
 * count update (S15-1-A11Y-7).
 * @param {object} [opts]
 * @param {() => Promise<string|null>} [opts.loadActive]
 * @param {(project:string) => Promise<Array|null>} [opts.loadFlow]
 * @param {(project:string) => Promise<Array|null>} [opts.loadItems]
 * @param {(onChange:(evt:{type:string,path:string})=>void, o?:object) => (()=>void)} [opts.subscribe]
 * @param {number} [opts.debounceMs]
 * @returns {{status:'loading'|'ready'|'empty', horizonMs:number|null, items:Array, sourceRef:string}}
 */
export function useWipItems({
  loadActive = getActive,
  loadFlow = getStageFlow,
  loadItems = getItems,
  subscribe = subscribeEvents,
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  const [state, setState] = useState({ status: 'loading', horizonMs: null, items: [] });

  // Latest loaders without re-subscribing the SSE channel on each render.
  const loadersRef = useRef({ loadActive, loadFlow, loadItems });
  loadersRef.current = { loadActive, loadFlow, loadItems };

  const refresh = useCallback(() => {
    const { loadActive: la, loadFlow: lf, loadItems: li } = loadersRef.current;
    return Promise.resolve()
      .then(la)
      .then((project) => {
        if (!project) return [null, null];
        return Promise.all([lf(project), li(project)]);
      })
      .then(([flow, records]) => {
        const { horizonMs, items } = composeWipItems(flow, records);
        setState({ status: items.length > 0 ? 'ready' : 'empty', horizonMs, items });
      })
      .catch(() => {
        // fail-soft (AC1.6 convention): unreachable API → labelled empty state
        setState((prev) => ({ ...prev, status: 'empty' }));
      });
  }, []);

  // Initial load.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // SSE live refresh — debounce a burst of change frames into one re-fetch.
  useEffect(() => {
    let timer = null;
    let unsubscribe = null;
    const onChange = (evt) => {
      if (!evt || !isRelevantChange(evt.path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, debounceMs);
    };
    try {
      unsubscribe = subscribe(onChange);
    } catch {
      unsubscribe = null; // no EventSource (jsdom) → static data, no crash
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [subscribe, debounceMs, refresh]);

  return { ...state, sourceRef: WIP_SOURCE_REF };
}
