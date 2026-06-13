// UC-S013-2 — useDefects: the defects-list view-model hook over the delivered
// GET /api/projects/:id/defects (UC-S013-1).
//
// HEXAGONAL ROLE: composes the API adapter (api/client.js: getActive +
// getDefects) into the grouped DefectVM[] the presentational DefectsPanel
// renders. The composition (composeDefects) and the MTTR humanisation
// (formatMttr) are PURE DOMAIN — no fetch, no DOM — exported for direct unit
// testing; the hook adds only fetch/SSE state. SSE live refresh (UC-S013-4)
// is the useWipItems debounced subscribeEvents→re-fetch idiom: relevant frames
// are defects/*.md AND ledger.csv (MTTR is a ledger join — a recovery row
// landing must refresh the list); the refresh is IN-PLACE (no remount, no
// loading flash — the panel's heading focus is never stolen); fail-soft when
// EventSource is absent (jsdom) — static data, no crash.
//
// FIGURE LEGIBILITY (S13-2-FIG-1/2/4/5):
//   - mttrText carries a time unit ("13 min" / "1 h 21 min" / "53 s"), never a
//     bare integer and never raw seconds in the headline.
//   - the OPEN ≠ ZERO rule: an OPEN (CONFIRMED) defect renders mttrText "open"
//     EVEN IF a recovery ledger row drifted in while the md status is still
//     CONFIRMED (live DEFECT-012 drift pin) — isOpen wins, never a number,
//     never "0". A CLOSED record with no mttr_s renders "—" (unknown ≠ 0).
//   - severity null (ledger-only DEFECT-011) → severityText "—", never blank,
//     never a defaulted "LOW".
//   - statusLabel is the OPERATOR'S word (CONFIRMED→"OPEN") for the badge; the
//     raw enum rides `status` (→ data-status).
//
// GROUPING (GEO-S013-2-4 order source): CONFIRMED (open) first, then CLOSED;
// each group sorted id-ascending — in the HOOK so the panel stays presentational
// (same discipline as useWipItems).
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getActive, getDefects, subscribeEvents } from '../api/client.js';

export const DEFECTS_SOURCE_REF = 'work/<project>/defects/ + process/dora/ledger.csv';

const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Humanise an MTTR duration in SECONDS with a time unit (S13-2-FIG-1).
 * null/NaN/negative → "—" (unknown ≠ 0, S13-2-FIG-2 defensive case).
 * @param {number|null|undefined} s
 * @returns {string} e.g. "13 min" | "1 h 21 min" | "53 s" | "2 h" | "—"
 */
export function formatMttr(s) {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${Math.floor(s)} s`;
  const totalMin = Math.floor(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

/**
 * PURE: defect records → { openCount, defects: DefectVM[] }.
 * DefectVM = { id, title, status, statusLabel, isOpen, severity, severityText,
 * mttrText }. Grouped open-first, each group id-ascending. Fail-soft on
 * null/malformed input → { openCount: 0, defects: [] }; records without a
 * usable id are dropped, never thrown on.
 * @param {Array|null} records  /api/projects/:id/defects response
 */
export function composeDefects(records) {
  const defects = [];
  for (const r of Array.isArray(records) ? records : []) {
    const id = typeof r?.id === 'string' ? r.id.trim() : '';
    if (!id) continue;
    const status = typeof r.status === 'string' ? r.status : '';
    const isOpen = status === 'CONFIRMED';
    const severity = typeof r.severity === 'string' && r.severity.trim() ? r.severity.trim() : null;
    defects.push({
      id,
      // FIG-3: the human title sentence — never the id alone, never a raw
      // ledger row ref. Fall back to the id only when no title exists at all.
      title: String(r.title ?? '').trim() || id,
      status,
      statusLabel: isOpen ? 'OPEN' : 'CLOSED',
      isOpen,
      severity,
      severityText: severity ?? '—', // FIG-4: unknown ≠ defaulted
      // FIG-2: isOpen WINS over any drifted mttr_s — "open", never a number.
      mttrText: isOpen ? 'open' : formatMttr(typeof r.mttr_s === 'number' ? r.mttr_s : null),
      // UC-S013-3: the RAW endpoint record rides the VM so the drill is a
      // pure projection of in-memory data — no extra fetch, no server change.
      record: r,
    });
  }

  // GEO-S013-2-4 order source: open group leads; id-ascending within groups.
  defects.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return { openCount: defects.filter((d) => d.isOpen).length, defects };
}

/** Is this SSE change-frame path one that affects the defects list? The
 * records are parsed from work/<project>/defects/*.md; reported/recovered
 * timestamps and MTTR are a DORA-ledger join (UC-S013-1) — BOTH sources are
 * relevant (S13-4-SSE-1; this differs from the items.csv-only steer hook). */
function isRelevantChange(path) {
  if (typeof path !== 'string') return false;
  const p = path.replace(/\\/g, '/');
  return /(^|\/)defects\/[^/]+\.md$/i.test(p) || /ledger\.csv$/i.test(p);
}

/**
 * The defects-list hook. Resolves the active project, loads the defect
 * records, composes the grouped view-model, and re-fetches (debounced) on a
 * relevant SSE change frame — the data path behind the polite live-region
 * count update (S13-2-A11Y-7 / UC-S013-4). Loaders injectable for tests;
 * defaults are the real API adapter (api/client.js).
 * @param {object} [opts]
 * @param {() => Promise<string|null>} [opts.loadActive]
 * @param {(project:string) => Promise<Array|null>} [opts.loadDefects]
 * @param {(onChange:(evt:{type:string,path:string})=>void, o?:object) => (()=>void)} [opts.subscribe]
 * @param {number} [opts.debounceMs]
 * @returns {{status:'loading'|'ready'|'empty', openCount:number, defects:Array, sourceRef:string}}
 */
export function useDefects({
  loadActive = getActive,
  loadDefects = getDefects,
  subscribe = subscribeEvents,
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  const [state, setState] = useState({ status: 'loading', openCount: 0, defects: [] });

  // Latest loaders without re-subscribing the SSE channel on each render.
  const loadersRef = useRef({ loadActive, loadDefects });
  loadersRef.current = { loadActive, loadDefects };

  const refresh = useCallback(() => {
    const { loadActive: la, loadDefects: ld } = loadersRef.current;
    return Promise.resolve()
      .then(la)
      .then((project) => (project ? ld(project) : null))
      .then((records) => {
        const { openCount, defects } = composeDefects(records);
        // IN-PLACE: ready→ready on refresh — no loading flash, no remount.
        setState({ status: defects.length > 0 ? 'ready' : 'empty', openCount, defects });
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

  // SSE live refresh (UC-S013-4) — debounce a burst of change frames into one
  // re-fetch (the useWipItems idiom).
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

  return { ...state, sourceRef: DEFECTS_SOURCE_REF };
}
