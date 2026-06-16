// UC-S018-3 — useQueueRank: the slice's ONLY read call (READ-ONLY discipline,
// fetch-on-step-entry).
//
// HEXAGONAL ROLE: composes the API adapter (api/client.js: getActive +
// getItems — the useWipItems loader idiom) into the {status, items} fetch state
// QueueRankStep renders. The directional-rank computation is the pure domain fn
// lib/queueRank.js; this hook adds only fetch state. NO write call, ever.
//
// WHEN IT FETCHES (ui-design.md UC-S018-3, decision recorded): the GET fires on
// the hook's MOUNT. QueueRankStep is mounted by the shell ONLY when
// currentStep === 3, so the read fires on step-3 ENTRY, not on wizard open
// (NOWRITE-S018-3-2: zero items GET while currentStep < 3). It does NOT re-fetch
// on a Value/Urgency change — the item set is unchanged; only the operator's own
// codScore.token changes, and the rank is RE-DERIVED from the already-fetched
// items by rankPreview (AC-S018-3-3 / NOWRITE-S018-3-1: still exactly one GET).
//
// FAIL-SOFT (RANK contract): a null active project, a null/absent items
// response, or a throw → status:'error'. QueueRankStep renders a distinct
// fail-soft state, NEVER a fabricated rank. An empty/header-only items.csv ([])
// is a VALID ready state (AC-S018-3-4), NOT an error.
import { useEffect, useRef, useState } from 'preact/hooks';
import { getActive, getItems } from '../api/client.js';

/**
 * The queue-rank read hook. Resolves the active project then loads items ONCE
 * on mount; exposes the fetch state for QueueRankStep to render against the
 * lifted codScore. Defaulted/injectable loaders so it is unit-testable with a
 * mock items endpoint.
 * @param {object} [opts]
 * @param {() => Promise<string|null>} [opts.loadActive]
 * @param {(project:string) => Promise<Array|null>} [opts.loadItems]
 * @returns {{status:'loading'|'ready'|'error', items:Array}}
 */
export function useQueueRank({ loadActive = getActive, loadItems = getItems } = {}) {
  const [state, setState] = useState({ status: 'loading', items: [] });

  // Latest loaders captured in a ref so the mount effect runs EXACTLY once
  // (a re-render from an upstream tier change must not re-fetch).
  const loadersRef = useRef({ loadActive, loadItems });
  loadersRef.current = { loadActive, loadItems };

  useEffect(() => {
    let live = true;
    const { loadActive: la, loadItems: li } = loadersRef.current;
    Promise.resolve()
      .then(la)
      .then((project) => {
        if (!project) throw new Error('no active project');
        return li(project);
      })
      .then((records) => {
        if (!live) return;
        if (!Array.isArray(records)) throw new Error('items unreachable');
        setState({ status: 'ready', items: records });
      })
      .catch(() => {
        if (live) setState({ status: 'error', items: [] });
      });
    return () => {
      live = false;
    };
  }, []); // MOUNT only — the step-3-entry read; never re-fetch on re-render.

  return state;
}
