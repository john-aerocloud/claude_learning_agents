// UC-S004-2/6 — data→render container for the value-stream map.
//
// HEXAGONAL ROLE: the wiring seam between the API adapter (api/client.js:
// getActive + getStageFlow) and the pure ValueStreamMap. It resolves the active
// project, fetches the /stage-flow array, and hands it to the map. ValueStreamMap
// stays a pure function of props (unit-testable without fetch).
//
// THE DEFECT-001 FIX PATH: this is what makes the REAL per-stage throughput +
// in-flight WIP reach the screen. The old MapContainer loaded queue depths
// (~0); this loads /stage-flow (engineer throughput 7, wip 2, …).
//
// UC-S004-6 (live refresh): subscribes to the SSE change channel on mount; a
// ledger.csv change frame triggers a debounced re-fetch so the map updates live
// (≤ refresh window) without a manual reload. Subscribe is injected (default
// subscribeEvents) so jsdom — which has no EventSource — drives it with a fake;
// the real EventSource path is proven by the Playwright live spec.
//
// FAIL-SOFT: getStageFlow returns null on any failure (network/HTTP/parse); the
// loader maps null → the ValueStreamMap zero skeleton (never a blank/crash).

import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { getActive, getStageFlow, subscribeEvents } from '../api/client.js';
import { ValueStreamMap } from './ValueStreamMap.jsx';
import { LiveStatusDot } from './LiveStatusDot.jsx';

/** Default loader: resolve the active project, then fetch its stage-flow array. */
async function loadStageFlow() {
  const project = await getActive();
  if (!project) return null;
  return getStageFlow(project);
}

const DEFAULT_DEBOUNCE_MS = 250;

/** Is this SSE change-frame path one that affects the value-stream map? The map
 * is computed entirely from the DORA ledger, so only a ledger.csv change matters. */
function isRelevantChange(path) {
  if (typeof path !== 'string') return false;
  return /ledger\.csv$/i.test(path.replace(/\\/g, '/'));
}

/**
 * @param {object} [props]
 * @param {() => Promise<Array|null>} [props.loadFlow] - stage-flow loader (injectable for tests).
 * @param {(onChange: (evt:{type:string,path:string}) => void) => (() => void)} [props.subscribe]
 * @param {number} [props.debounceMs]
 */
export function VsmContainer({
  loadFlow = loadStageFlow,
  subscribe = subscribeEvents,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) {
  const [stages, setStages] = useState(null);
  const [liveState, setLiveState] = useState('reconnecting');

  const loadRef = useRef(loadFlow);
  loadRef.current = loadFlow;

  const refresh = useCallback(() => {
    return Promise.resolve()
      .then(() => loadRef.current())
      .then((next) => setStages(Array.isArray(next) ? next : null)) // null → zero skeleton
      .catch(() => setStages(null)); // fail-soft
  }, []);

  // Initial one-shot load on mount (and when an injected loader changes).
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(loadFlow)
      .then((next) => { if (active) setStages(Array.isArray(next) ? next : null); })
      .catch(() => { if (active) setStages(null); });
    return () => { active = false; };
  }, [loadFlow]);

  // SSE live refresh — subscribe ONCE on mount; debounce a burst into one re-fetch.
  useEffect(() => {
    let timer = null;
    let unsubscribe = null;

    const onChange = (evt) => {
      if (!evt || !isRelevantChange(evt.path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; refresh(); }, debounceMs);
    };

    try {
      unsubscribe = subscribe(onChange);
      setLiveState('connected');
    } catch {
      setLiveState('reconnecting'); // no EventSource / blocked → degrade dot, keep data
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [subscribe, debounceMs, refresh]);

  return (
    <div class="map-live">
      <div class="map-live__bar">
        <LiveStatusDot state={liveState} />
      </div>
      <ValueStreamMap stages={stages} />
    </div>
  );
}
