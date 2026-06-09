// UC-S002-2 — queue data + state layer (DOMAIN of the SPA, hexagonal).
//
// This module owns the buffer-state derivation in ONE tested place: it fetches
// the four queue CSVs + the policy CSV via the UC1 API client PORT and produces
// a typed QueueState[] (one per queue) that the render UCs (UC3 boxes, UC4
// flags) consume. It NEVER touches fetch/URLs/CSV text — that is the client
// adapter's job; the client is injected so this layer is unit-testable with a
// fake and depends on no transport concept (ports & adapters: domain depends on
// the port, never the adapter).
//
// QueueState shape (the contract UC3/UC4 bind to — see ui-design.md §2 +
// design/components.md QueueBox: data-status, count, buffer meta):
//   {
//     name: 'intake' | 'ready' | 'deploy' | 'rework',
//     length: number,            // queue depth = CSV data-row count (0 if absent)
//     min_items?: number,        // policy floor; undefined when no policy row
//     wip_limit?: number,        // policy cap;   undefined when no policy row
//     status: 'ok' | 'starving' | 'over-wip',
//   }
//
// status rule (acceptance AC2.1–AC2.3): over-wip when length >= wip_limit;
// starving when length < min_items; ok otherwise. over-wip is checked first so a
// queue at/over its cap reads as over-WIP even if a floor is also configured.
//
// FAIL-SOFT (AC2.4–AC2.6): a null queue CSV ⇒ length 0; a null/absent policy or
// non-numeric policy value ⇒ that threshold is undefined (rule that needs it is
// skipped); no active project ⇒ [] (the empty-state UC3 renders). Never throws —
// the client already returns null on any fetch failure; we only interpret nulls.

import * as defaultClient from '../api/client.js';

/** The four real queues, in flow order (intake → ready → deploy → rework). */
export const QUEUE_NAMES = ['intake', 'ready', 'deploy', 'rework'];

/**
 * Build the QueueState[] for a project.
 * @param {object} [opts]
 * @param {object} [opts.client] - API client port (getActive/getQueues/getPolicy); defaults to the real client.
 * @param {string|null} [opts.project] - explicit project id; when omitted, resolved via client.getActive().
 * @returns {Promise<QueueState[]>} one entry per queue in flow order, or [] when no active project.
 */
export async function initQueueState({ client = defaultClient, project } = {}) {
  const projectId = project !== undefined ? project : await client.getActive();
  if (!projectId) return []; // no active project → empty-state result (AC2.6)

  const [queueRecords, policyRecords] = await Promise.all([
    Promise.all(QUEUE_NAMES.map((q) => client.getQueues(projectId, q))),
    client.getPolicy(projectId),
  ]);

  const thresholds = parsePolicy(policyRecords);

  return QUEUE_NAMES.map((name, i) => {
    const length = Array.isArray(queueRecords[i]) ? queueRecords[i].length : 0; // null CSV ⇒ 0 (AC2.5)
    const { min_items, wip_limit } = thresholds[name] ?? {};
    return { name, length, min_items, wip_limit, status: deriveStatus(length, min_items, wip_limit) };
  });
}

/**
 * Reduce policy records → { [queue]: { min_items?, wip_limit? } } with numeric
 * thresholds. The real policy.csv keys the metric in `param`; the UC1 fixture
 * used `key` — accept either. A non-numeric value is ignored (threshold absent).
 * @param {Array<Record<string,string>>|null} records
 */
function parsePolicy(records) {
  const byQueue = {};
  if (!Array.isArray(records)) return byQueue; // null/absent policy → no thresholds (AC2.4)
  for (const row of records) {
    if (!row) continue;
    const queue = row.queue;
    const param = row.param ?? row.key;
    if (!queue || (param !== 'min_items' && param !== 'wip_limit')) continue;
    const n = Number(row.value);
    if (!Number.isFinite(n)) continue; // malformed value ⇒ skip (no throw)
    (byQueue[queue] ??= {})[param] = n;
  }
  return byQueue;
}

/** over-wip when length>=wip_limit; starving when length<min_items; else ok. */
function deriveStatus(length, min_items, wip_limit) {
  if (wip_limit !== undefined && length >= wip_limit) return 'over-wip';
  if (min_items !== undefined && length < min_items) return 'starving';
  return 'ok';
}
