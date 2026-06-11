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
// SSE refresh is UC-S014-4 (the hook gains a subscribeEvents re-fetch there —
// deliberately NOT wired in this UC).

import { useState, useEffect, useRef } from 'preact/hooks';
import { getActive, getItems } from '../api/client.js';

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
 * @returns {{status: 'loading'|'ready'|'not-found'|'error', context: object|null}}
 */
export function useSteerContext(itemId, { project = null, loadProject = getActive, loadItems = getItems } = {}) {
  const [state, setState] = useState({ status: 'loading', context: null });

  // Stable refs so the fetch effect re-runs only on itemId/project changes,
  // never because a caller passed a fresh loader closure (container pattern).
  const loadProjectRef = useRef(loadProject);
  loadProjectRef.current = loadProject;
  const loadItemsRef = useRef(loadItems);
  loadItemsRef.current = loadItems;

  useEffect(() => {
    if (!itemId) {
      setState({ status: 'loading', context: null });
      return undefined;
    }
    let active = true;
    setState({ status: 'loading', context: null });
    Promise.resolve()
      .then(() => project || loadProjectRef.current())
      .then((proj) =>
        Promise.resolve()
          .then(() => loadItemsRef.current(proj))
          .then((rows) => ({ proj, rows })))
      .then(({ proj, rows }) => {
        if (!active) return;
        if (!Array.isArray(rows)) {
          setState({ status: 'error', context: null }); // unreachable/failed /items
          return;
        }
        const row = rows.find((r) => r && r.id === itemId);
        if (!row) {
          setState({ status: 'not-found', context: null }); // stale/queue-only id
          return;
        }
        setState({ status: 'ready', context: toSteerContext(row, proj) });
      })
      .catch(() => {
        if (active) setState({ status: 'error', context: null }); // fail-soft, never throw
      });
    return () => { active = false; };
  }, [itemId, project]);

  return state;
}
