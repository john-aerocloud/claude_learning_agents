// UC-S014-2 — useSteerContext(itemId): item-context state for the SteerPanel.
//
// HEXAGONAL ROLE: a thin wiring hook between the API adapter (api/client.js:
// getActive + getItems — READ-ONLY, the existing /items endpoint; no new
// route) and the steer surfaces. It owns the fetch + status derivation so the
// panel stays a pure function of props.
//
// THE CROSS-UC CONTRACT (consumed VERBATIM by UC-S014-3 promptBuilder and
// UC-S015-3 ReslicePreviewPanel — do not reshape without versioning both):
//   {
//     status: "loading" | "ready" | "not-found" | "error",
//     context: {
//       id: string,        // "CHK-5"
//       job: string,       // human job sentence (items.csv `job`)
//       state: string,     // human state label (never a raw enum/CSV key)
//       value: string,     // "HIGH" | "MED" | "LOW" ('' when absent — render "—")
//       cost: string,      // "S" | "M" | "L"      ('' when absent — render "—")
//       sourceRef: string, // "work/<project>/items/items.csv#id=<id>" (§8 traceability)
//     } | null,            // null in EVERY non-ready state
//   }
//
// FAIL-SOFT (S14-2-FIG-4): an id absent from /items (stale chip, queue-only
// item) → "not-found"; an unreachable/failed /items → "error". Both keep
// context null and never throw into the render. Raw CSV row keys (vc_ratio,
// done_ts, …) are NOT carried into the contract — only the six fields above.
//
// SSE REFRESH (UC-S014-4, S14-4-SSE-1/2): the hook subscribes to the SSE
// change channel (subscribeEvents — the useWipItems idiom) and re-fetches,
// DEBOUNCED, on a relevant items.csv frame. The refresh is IN-PLACE: status
// stays 'ready' with the old context while the re-fetch is in flight (no
// loading-skeleton flash — GEO-S014-4-4 upstream guard); an ADDITIVE
// `refreshing` flag drives the ContextRefreshCue. Fail-soft: no EventSource
// (jsdom) → static data, no crash (`unsubscribe = null` path). The displayed
// PROMPT is untouched by any refresh — prompt state lives in
// SteerPanelContainer and mutates only on an explicit Generate
// (PROMPT-FREEZE-1).

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { getActive, getItems, subscribeEvents } from '../api/client.js';

const DEFAULT_DEBOUNCE_MS = 250;

/** Is this SSE change-frame path one the steer context reads? items.csv only. */
function isRelevantChange(path) {
  if (typeof path !== 'string') return false;
  return /items\.csv$/i.test(path.replace(/\\/g, '/'));
}

/** Humanise a state token: underscores read as spaces ("in_progress" → "in progress"). */
function humanState(state) {
  return typeof state === 'string' ? state.replace(/_/g, ' ') : '';
}

/** Map a raw items.csv row onto the six-field SteerContext contract. */
function toSteerContext(row, project) {
  return {
    id: row.id,
    job: typeof row.job === 'string' ? row.job : '',
    state: humanState(row.state),
    value: typeof row.value === 'string' ? row.value : '',
    cost: typeof row.cost === 'string' ? row.cost : '',
    sourceRef: `work/${project}/items/items.csv#id=${row.id}`,
  };
}

/**
 * @param {string|null} itemId - the steered item's id (falsy → stays loading)
 * @param {object} [opts]
 * @param {string|null} [opts.project] - active project id; resolved via loadProject when absent
 * @param {() => Promise<string|null>} [opts.loadProject] - active-project resolver (injectable)
 * @param {(project:string) => Promise<Array|null>} [opts.loadItems] - items loader (injectable)
 * @param {(onChange:(evt:{type:string,path:string})=>void) => (()=>void)} [opts.subscribe] - SSE channel (injectable)
 * @param {number} [opts.debounceMs] - SSE frame-burst debounce window
 * @returns {{status: 'loading'|'ready'|'not-found'|'error', context: object|null, refreshing: boolean}}
 */
export function useSteerContext(itemId, {
  project = null,
  loadProject = getActive,
  loadItems = getItems,
  subscribe = subscribeEvents,
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  const [state, setState] = useState({ status: 'loading', context: null });
  const [refreshing, setRefreshing] = useState(false);

  // Stable refs so the fetch effect re-runs only on itemId/project changes,
  // never because a caller passed a fresh loader closure (container pattern).
  const loadProjectRef = useRef(loadProject);
  loadProjectRef.current = loadProject;
  const loadItemsRef = useRef(loadItems);
  loadItemsRef.current = loadItems;
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;
  const projectRef = useRef(project);
  projectRef.current = project;

  /** Resolve the steer context once: rows → ready/not-found/error state. */
  const resolveContext = useCallback((id) => Promise.resolve()
    .then(() => projectRef.current || loadProjectRef.current())
    .then((proj) =>
      Promise.resolve()
        .then(() => loadItemsRef.current(proj))
        .then((rows) => ({ proj, rows })))
    .then(({ proj, rows }) => {
      if (!Array.isArray(rows)) {
        return { status: 'error', context: null }; // unreachable/failed /items
      }
      const row = rows.find((r) => r && r.id === id);
      if (!row) {
        return { status: 'not-found', context: null }; // stale/queue-only id
      }
      return { status: 'ready', context: toSteerContext(row, proj) };
    }), []);

  useEffect(() => {
    if (!itemId) {
      setState({ status: 'loading', context: null });
      return undefined;
    }
    let active = true;
    setState({ status: 'loading', context: null });
    resolveContext(itemId)
      .then((next) => { if (active) setState(next); })
      .catch(() => {
        if (active) setState({ status: 'error', context: null }); // fail-soft, never throw
      });
    return () => { active = false; };
  }, [itemId, project, resolveContext]);

  // IN-PLACE refresh (UC-S014-4): no loading reset — the old context stays
  // displayed while the re-fetch is in flight; `refreshing` flags it.
  const refresh = useCallback(() => {
    const id = itemIdRef.current;
    if (!id) return Promise.resolve();
    setRefreshing(true);
    return resolveContext(id)
      .then((next) => {
        if (itemIdRef.current === id) setState(next); // drop stale-id frames
      })
      .catch(() => {
        if (itemIdRef.current === id) setState({ status: 'error', context: null });
      })
      .finally(() => setRefreshing(false));
  }, [resolveContext]);

  // SSE live refresh — debounce a burst of change frames into one re-fetch
  // (mirrors useWipItems; fail-soft when there is no EventSource).
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

  return { ...state, refreshing };
}
