// UC-S002-3 — data→render container. Bridges the UC2 domain (initQueueState)
// to the pure PipelineMap on mount: load the QueueState[] once, hand it to the
// render. This is the seam main.jsx mounts as the App child; PipelineMap stays
// a pure function of props so it is unit-testable without fetch.
//
// UC-S002-5: this container is ALSO where the ToC constraint is loaded and
// matched to a queue, then handed to PipelineMap as constraintQueue. The fetch
// (getBaseline) + parse (parseConstraint) + queue-match (matchConstraintQueue)
// compose here into one injectable loadConstraint — so PipelineMap stays a pure
// function of props and the match logic stays in the tested parser. The live
// baseline names an AGENT ("tester"), so matchConstraintQueue returns null and
// no box is highlighted; if the baseline names a queue, that box lights up.
//
// FAIL-SOFT: initQueueState / getBaseline never throw (the client returns null
// on any failure), but we still guard each loader here so an unexpected reject
// degrades to the empty state / no-highlight (graceful) rather than an
// unhandled rejection or blank page — the same posture the API adapter takes.
// UC6 will replace the one-shot loads with an SSE-driven re-load through this
// same seam (re-evaluating the constraint on a baseline.md change event).

import { useEffect, useState } from 'preact/hooks';
import { initQueueState } from '../state/queues.js';
import { getBaseline } from '../api/client.js';
import { parseConstraint, matchConstraintQueue } from '../parsers/baseline.js';
import { PipelineMap } from './PipelineMap.jsx';

/** Default constraint loader: fetch raw baseline → parse name → match to a queue. */
async function loadConstraintQueue() {
  const raw = await getBaseline();
  return matchConstraintQueue(parseConstraint(raw));
}

/**
 * @param {object} [props]
 * @param {() => Promise<Array>} [props.load] - state loader; defaults to initQueueState (injectable for tests).
 * @param {() => Promise<string|null>} [props.loadConstraint] - constraint-queue loader; defaults to fetch+parse+match.
 */
export function MapContainer({ load = () => initQueueState(), loadConstraint = loadConstraintQueue }) {
  const [queues, setQueues] = useState([]);
  const [constraintQueue, setConstraintQueue] = useState(null);

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

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(loadConstraint)
      .then((q) => {
        if (active) setConstraintQueue(typeof q === 'string' ? q : null);
      })
      .catch(() => {
        if (active) setConstraintQueue(null); // fail-soft → no highlight
      });
    return () => {
      active = false;
    };
  }, [loadConstraint]);

  return <PipelineMap queues={queues} constraintQueue={constraintQueue} />;
}
