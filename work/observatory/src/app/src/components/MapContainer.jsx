// UC-S002-3 — data→render container. Bridges the UC2 domain (initQueueState)
// to the pure PipelineMap on mount: load the QueueState[] once, hand it to the
// render. This is the seam main.jsx mounts as the App child; PipelineMap stays
// a pure function of props so it is unit-testable without fetch.
//
// UC-S002-5: this container is ALSO where the ToC constraint is loaded and
// matched to a queue, then handed to PipelineMap as constraintQueue. The fetch
// (getBaseline) + parse (parseConstraint) + queue-match (matchConstraintQueue)
// compose here into one injectable loadConstraint — so PipelineMap stays a pure
// function of props and the match logic stays in the tested parser.
//
// UC-S002-6: this container now SUBSCRIBES to the SSE change channel
// (subscribeEvents) on mount and RE-RUNS both loaders on a relevant change frame
// — debounced/coalesced — so the map refreshes live (counts, badges, constraint)
// within ~1s of a file change, with no manual reload. The subscribe is injected
// (default subscribeEvents) so jsdom — which has no EventSource — drives it with
// a fake; the real EventSource path is proven by the Playwright live spec.
//   * PATH FILTERING: only a queue/policy CSV or baseline.md change re-loads;
//     unrelated files (slice.md, etc.) are ignored (AC6.2).
//   * DEBOUNCE: a burst of frames coalesces into ONE re-load (AC6.1 "exactly
//     once" / sensible coalescing) — a flow manager rewriting four CSVs in a row
//     triggers a single refresh, not four.
//   * UNSUBSCRIBE on unmount — the EventSource is closed, no leak.
//   * The LiveStatusDot reflects the connection state ('connected' once
//     subscribed; 'reconnecting' on a channel error). A subscribe that throws
//     degrades the dot, never the map (last-known state stays visible).
//
// FAIL-SOFT: initQueueState / getBaseline never throw (the client returns null
// on any failure), but we still guard each loader here so an unexpected reject
// degrades to the empty state / no-highlight (graceful) rather than an
// unhandled rejection or blank page — the same posture the API adapter takes.

import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { initQueueState } from '../state/queues.js';
import { getBaseline, subscribeEvents } from '../api/client.js';
import { parseConstraint, matchConstraintQueue } from '../parsers/baseline.js';
import { PipelineMap } from './PipelineMap.jsx';
import { LiveStatusDot } from './LiveStatusDot.jsx';

/** Default constraint loader: fetch raw baseline → parse name → match to a queue. */
async function loadConstraintQueue() {
  const raw = await getBaseline();
  return matchConstraintQueue(parseConstraint(raw));
}

/** Default debounce window for coalescing a burst of SSE change frames (ms). */
const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Is this change-frame path one that affects the rendered map? A queue/policy
 * CSV under a project's queues/ dir, or the DORA baseline.md (constraint source).
 * Path is repo-relative, OS-separated (the watcher uses path.join) — match both
 * '/' and '\' separators so the filter holds on any host.
 * @param {string} [path]
 */
function isRelevantChange(path) {
  if (typeof path !== 'string') return false;
  const norm = path.replace(/\\/g, '/');
  // a queue or policy CSV: .../queues/<intake|ready|deploy|rework|policy>.csv
  if (/\/queues\/(intake|ready|deploy|rework|policy)\.csv$/i.test(norm)) return true;
  // the ToC constraint source
  if (/baseline\.md$/i.test(norm)) return true;
  return false;
}

/**
 * @param {object} [props]
 * @param {() => Promise<Array>} [props.load] - state loader; defaults to initQueueState (injectable for tests).
 * @param {() => Promise<string|null>} [props.loadConstraint] - constraint-queue loader; defaults to fetch+parse+match.
 * @param {(onChange: (evt: {type:string,path:string}) => void) => (() => void)} [props.subscribe]
 *        - SSE change subscription; defaults to subscribeEvents (injectable for tests / no EventSource in jsdom).
 * @param {number} [props.debounceMs] - coalescing window for a burst of change frames.
 */
export function MapContainer({
  load = () => initQueueState(),
  loadConstraint = loadConstraintQueue,
  subscribe = subscribeEvents,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) {
  const [queues, setQueues] = useState([]);
  const [constraintQueue, setConstraintQueue] = useState(null);
  const [liveState, setLiveState] = useState('reconnecting');

  // Keep live refs to the latest loaders so the SSE handler (registered once on
  // mount) always calls the current loader without re-subscribing on every prop
  // change — re-subscribing would churn the EventSource.
  const loadRef = useRef(load);
  const loadConstraintRef = useRef(loadConstraint);
  loadRef.current = load;
  loadConstraintRef.current = loadConstraint;

  /** Run the queue loader, fail-soft → empty state. */
  const refreshQueues = useCallback(() => {
    return Promise.resolve()
      .then(() => loadRef.current())
      .then((next) => setQueues(Array.isArray(next) ? next : []))
      .catch(() => setQueues([])); // fail-soft → empty state
  }, []);

  /** Run the constraint loader, fail-soft → no highlight. */
  const refreshConstraint = useCallback(() => {
    return Promise.resolve()
      .then(() => loadConstraintRef.current())
      .then((q) => setConstraintQueue(typeof q === 'string' ? q : null))
      .catch(() => setConstraintQueue(null)); // fail-soft → no highlight
  }, []);

  // Initial one-shot loads on mount (and when an injected loader changes).
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(load)
      .then((next) => {
        if (active) setQueues(Array.isArray(next) ? next : []);
      })
      .catch(() => {
        if (active) setQueues([]);
      });
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(loadConstraint)
      .then((q) => {
        if (active) setConstraintQueue(typeof q === 'string' ? q : null);
      })
      .catch(() => {
        if (active) setConstraintQueue(null);
      });
    return () => {
      active = false;
    };
  }, [loadConstraint]);

  // UC6 — subscribe to the SSE change channel ONCE on mount; on a relevant
  // change frame, debounce then re-run BOTH loaders so counts/badges/constraint
  // refresh live. Unsubscribe + clear the timer on unmount (no leak).
  useEffect(() => {
    let timer = null;
    let unsubscribe = null;

    const onChange = (evt) => {
      if (!evt || !isRelevantChange(evt.path)) return; // path filtering (AC6.2)
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refreshQueues();
        refreshConstraint();
      }, debounceMs);
    };

    try {
      unsubscribe = subscribe(onChange);
      setLiveState('connected');
    } catch {
      // A subscribe that throws (no EventSource / blocked) must NOT blank the
      // map — degrade the indicator, keep last-known state (AC6.6).
      setLiveState('reconnecting');
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [subscribe, debounceMs, refreshQueues, refreshConstraint]);

  return (
    <div class="map-live">
      <div class="map-live__bar">
        <LiveStatusDot state={liveState} />
      </div>
      <PipelineMap queues={queues} constraintQueue={constraintQueue} />
    </div>
  );
}
