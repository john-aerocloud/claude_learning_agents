// UC-S018-3 — useQueueRank: the slice's ONLY read call (READ-ONLY discipline,
// fetch-on-step-entry).
//
// HEXAGONAL ROLE: composes the API adapter (api/client.js: getActive +
// getItems — the useWipItems loader idiom) into the {status, items} fetch state
// QueueRankStep renders. The directional-rank computation is the pure domain fn
// lib/queueRank.js; this hook adds only fetch state. NO write call, ever.
//
// WHEN IT FETCHES (ui-design.md UC-S018-3, decision recorded — the shell-lift
// seam): the GET fires ONCE, the FIRST time the hook is `enabled`. The wizard
// lifts the hook (calls it itself, always mounted) and enables it only when
// `step >= 3`, so the read fires on step-3 ENTRY, not on wizard open
// (NOWRITE-S018-3-2: zero items GET while currentStep < 3). Once fetched the
// items are CACHED for the wizard session: a Back→step-2→forward round trip
// re-enables the hook but does NOT re-fetch (AC-S018-3-2/3 / NOWRITE-S018-3-1:
// exactly one GET). A Value/Urgency change re-derives the rank from the cached
// items by rankPreview — no second GET.
//
// FAIL-SOFT (RANK contract): a null active project, a null/absent items
// response, or a throw → status:'error'. QueueRankStep renders a distinct
// fail-soft state, NEVER a fabricated rank. An empty/header-only items.csv ([])
// is a VALID ready state (AC-S018-3-4), NOT an error.
import { useEffect, useRef, useState } from 'preact/hooks';
import { getActive, getItems } from '../api/client.js';

/**
 * The queue-rank read hook. Resolves the active project then loads items ONCE,
 * the first time the hook is `enabled`; caches thereafter (a re-enable does not
 * re-fetch). Exposes the fetch state for QueueRankStep to render against the
 * lifted codScore. Defaulted/injectable loaders so it is unit-testable with a
 * mock items endpoint.
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] - gate the fetch (the shell sets this
 *   true only when step >= 3, so the read fires on step-3 entry).
 * @param {() => Promise<string|null>} [opts.loadActive]
 * @param {(project:string) => Promise<Array|null>} [opts.loadItems]
 * @returns {{status:'loading'|'ready'|'error', items:Array}}
 */
export function useQueueRank({ enabled = true, loadActive = getActive, loadItems = getItems } = {}) {
  const [state, setState] = useState({ status: 'loading', items: [] });

  // Latest loaders captured in a ref so the fetch doesn't depend on their
  // identity (a re-render from an upstream tier change must not re-fetch).
  const loadersRef = useRef({ loadActive, loadItems });
  loadersRef.current = { loadActive, loadItems };
  // One-shot guard: the fetch fires exactly once per hook lifetime, the first
  // time enabled goes true — caching the items for the wizard session.
  const startedRef = useRef(false);
  // `live` is cleared ONLY on true unmount — NOT when enabled toggles back to
  // false (a Back→step-2 before the fetch resolves must NOT drop the result;
  // that was the gated-path bug). So a result that lands while the user is on
  // step 2 still caches, and returning to step 3 shows it with no re-fetch.
  const liveRef = useRef(true);
  useEffect(() => () => {
    liveRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    const { loadActive: la, loadItems: li } = loadersRef.current;
    Promise.resolve()
      .then(la)
      .then((project) => {
        if (!project) throw new Error('no active project');
        return li(project);
      })
      .then((records) => {
        if (!liveRef.current) return;
        if (!Array.isArray(records)) throw new Error('items unreachable');
        setState({ status: 'ready', items: records });
      })
      .catch(() => {
        if (liveRef.current) setState({ status: 'error', items: [] });
      });
  }, [enabled]); // fires once, on the first enable — the step-3-entry read.

  return state;
}
