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
import './vsm-container.css';

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
  // DEFECT-003: have we lost the live channel since the last good fetch? When
  // true the figures are marked not-current and the disconnected banner shows.
  const [stale, setStale] = useState(false);

  const loadRef = useRef(loadFlow);
  loadRef.current = loadFlow;

  // refresh() always clears stale on a successful fetch — it is the self-heal
  // path used both by the SSE change-frame re-fetch and the reconnect re-fetch.
  const refresh = useCallback(() => {
    return Promise.resolve()
      .then(() => loadRef.current())
      .then((next) => {
        setStages(Array.isArray(next) ? next : null); // null → zero skeleton
        setStale(false); // fresh data is current again
      })
      .catch(() => setStages(null)); // fail-soft (stale stays set if it was)
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
    // Track whether we are currently in a dropped state, so the NEXT open is
    // recognised as a reconnect (→ re-fetch). A local flag, not React state,
    // because the open/error handlers read it synchronously within this effect.
    let dropped = false;

    const onChange = (evt) => {
      if (!evt || !isRelevantChange(evt.path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; refresh(); }, debounceMs);
    };

    // DEFECT-003 connection lifecycle:
    //  - onError: the live channel dropped — surface it (disconnected) and mark
    //    the visible figures STALE so they are never read as current.
    //  - onOpen: (re)connected — flip back to connected and, if we had just been
    //    disconnected, re-fetch immediately so the numbers self-heal.
    const onError = () => {
      dropped = true;
      setLiveState('disconnected');
      setStale(true);
    };
    const onOpen = () => {
      setLiveState('connected');
      if (dropped) refresh(); // a RECONNECT → re-fetch to self-heal
      dropped = false;
    };

    try {
      unsubscribe = subscribe(onChange, { onOpen, onError });
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
      {stale ? (
        <div
          class="map-live__stale-banner"
          data-testid="stale-banner"
          role="alert"
          aria-live="assertive"
        >
          Disconnected — data may be stale. Reconnecting and will refresh
          automatically.
        </div>
      ) : null}
      <ValueStreamMap stages={stages} stale={stale} />
    </div>
  );
}
