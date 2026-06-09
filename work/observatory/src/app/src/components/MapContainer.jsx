// UC-S002-3 — data→render container. Bridges the UC2 domain (initQueueState)
// to the pure PipelineMap on mount: load the QueueState[] once, hand it to the
// render. This is the seam main.jsx mounts as the App child; PipelineMap stays
// a pure function of props so it is unit-testable without fetch.
//
// FAIL-SOFT: initQueueState never throws (the client returns null on any
// failure), but we still guard the loader here so an unexpected reject degrades
// to the empty state (graceful) rather than an unhandled rejection or blank
// page — the same posture the API adapter takes. UC6 will replace the one-shot
// load with an SSE-driven re-load through this same seam.

import { useEffect, useState } from 'preact/hooks';
import { initQueueState } from '../state/queues.js';
import { PipelineMap } from './PipelineMap.jsx';

/**
 * @param {object} [props]
 * @param {() => Promise<Array>} [props.load] - state loader; defaults to initQueueState (injectable for tests).
 */
export function MapContainer({ load = () => initQueueState() }) {
  const [queues, setQueues] = useState([]);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(load)
      .then((next) => {
        if (active) setQueues(Array.isArray(next) ? next : []);
      })
      .catch(() => {
        if (active) setQueues([]); // fail-soft → empty state
      });
    return () => {
      active = false;
    };
  }, [load]);

  return <PipelineMap queues={queues} />;
}
