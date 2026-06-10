// Observatory API client — the shared SEAM that UC-S002-2..6 import.
//
// HEXAGONAL ROLE: this is the SPA-side ADAPTER over the CHK-1 read layer's HTTP
// API. It is the ONLY module that knows the API base URL, the endpoint paths,
// and the JSON envelope shapes ({active}, {content}, raw arrays). The domain
// (UC2 state layer, UC5 parser) and the render layer (UC3 PipelineMap) consume
// these plain helpers and never touch fetch/URLs — so endpoint shape changes
// land here, in one place, behind a stable export surface.
//
// TOPOLOGY: the SPA and the read layer are served by the SAME Express server on
// :3001. API_BASE is therefore empty string (relative URLs) — requests go to
// the same origin as the page, with no cross-origin fetch. No CORS needed.
//
// FAIL-SOFT (AC1.6): every GET returns its parsed value or `null` on ANY
// failure — network error, non-2xx status, or unparseable body. The read layer
// is one WE OWN and runs locally; a transient miss must degrade the SPA to a
// graceful empty/last-known state, never an unhandled rejection or a blank page.
// A null here is a data-absence signal the caller handles (UC2 maps it to
// length 0 / status 'ok'); it is NOT swallowing a real defect — the read layer's
// own tests pin its correctness, and the SSE channel re-drives state on recovery.
//
// STABLE EXPORT SURFACE (so UC2-6 attach without editing each other):
//   API_BASE                          — '' (relative, same-origin server)
//   getActive()            -> Promise<string|null>            (active project id)
//   getProjects()          -> Promise<Array|null>             (project registry)
//   getQueues(project, q)  -> Promise<QueueRecord[]|null>     (q: intake|ready|deploy|rework)
//   getPolicy(project)     -> Promise<PolicyRecord[]|null>    (the policy queue CSV)
//   getBaseline()          -> Promise<string|null>            (raw baseline.md)
//   getFlow(project)       -> Promise<string|null>            (raw flow.md; UC-S003-1)
//   getItems(project)      -> Promise<ItemRecord[]|null>      (work-item records; UC-S005-2)
//   subscribeEvents(onChange) -> () => void                   (SSE; returns unsubscribe)
// AC-named aliases (acceptance.md AC1.3-1.5): fetchQueues, fetchPolicy, fetchBaseline, fetchFlow.

// Relative base — SPA and API share one origin; no hardcoded port.
export const API_BASE = '';

/** GET a JSON endpoint; null on any network/HTTP/parse failure (fail soft). */
async function getJson(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null; // network error / parse error → null; never throws to caller
  }
}

/** GET /api/active → active project id, or null when none / unreachable. */
export async function getActive() {
  const body = await getJson('/api/active');
  return body && typeof body === 'object' ? (body.active ?? null) : null;
}

/** GET /api/projects → project registry array, or null when unreachable. */
export async function getProjects() {
  return getJson('/api/projects');
}

/**
 * GET /api/projects/:id/queues/:queue → QueueRecord[] (raw §4 string records),
 * or null when missing/unreachable. Path segments are URL-encoded.
 * @param {string} project
 * @param {'intake'|'ready'|'deploy'|'rework'|'policy'} queue
 */
export async function getQueues(project, queue) {
  return getJson(`/api/projects/${encodeURIComponent(project)}/queues/${encodeURIComponent(queue)}`);
}

/** GET the policy CSV for a project → PolicyRecord[] or null. */
export async function getPolicy(project) {
  return getQueues(project, 'policy');
}

/** GET /api/dora/baseline → the RAW baseline.md string, or null when absent. */
export async function getBaseline() {
  const body = await getJson('/api/dora/baseline');
  return body && typeof body === 'object' ? (body.content ?? null) : null;
}

/**
 * GET /api/projects/:id/dora/flow → the RAW flow.md string, or null when absent
 * (UC-S003-1). Same fail-soft + {content} envelope contract as getBaseline; the
 * project segment is URL-encoded. UC-S003-1's parseFlow() consumes this string;
 * UC4 (TimeThiefView) renders it; UC6 re-fetches it on an SSE flow.md change.
 * @param {string} project
 */
export async function getFlow(project) {
  const body = await getJson(`/api/projects/${encodeURIComponent(project)}/dora/flow`);
  return body && typeof body === 'object' ? (body.content ?? null) : null;
}

/**
 * GET /api/projects/:id/stage-flow → the value-stream array (UC-S004-1), one
 * object per canonical stage in flow order. Unlike getBaseline/getFlow, this
 * endpoint returns the ARRAY DIRECTLY (no {content} envelope) — match the
 * UC-S004-1 route shape. Fails soft to null on any network/HTTP/parse error
 * (the caller maps null → all-zeros skeleton). Project segment is URL-encoded.
 * @param {string} project
 * @returns {Promise<Array|null>}
 */
export async function getStageFlow(project) {
  return getJson(`/api/projects/${encodeURIComponent(project)}/stage-flow`);
}

/**
 * GET /api/projects/:id/items → ItemRecord[] (raw §4 records:
 * {id,type,parent,children,job,state,value,cost,vc_ratio,...}), or null when
 * missing/unreachable. Like getStageFlow, this endpoint returns the ARRAY
 * DIRECTLY (no {content} envelope) — match the UC-S001-2 /items route shape.
 * Fails soft to null on any network/HTTP/parse error (the caller maps null →
 * empty tree). Project segment is URL-encoded. UC-S005-2's WorkItemTree builds
 * the REQ→CHK→SLC→UC hierarchy from these records' parent/children fields.
 * @param {string} project
 * @returns {Promise<Array|null>}
 */
export async function getItems(project) {
  return getJson(`/api/projects/${encodeURIComponent(project)}/items`);
}

/**
 * GET /api/projects/:id/slices → string[] of slice directory names (slugs), or
 * null when missing/unreachable. Returns the ARRAY DIRECTLY (no envelope), like
 * /items. UC-S005-3's detail pane uses the slug list to resolve which slice dir
 * backs the selected work item (itemDetail.deriveSliceSlug). Fail-soft to null.
 * @param {string} project
 * @returns {Promise<string[]|null>}
 */
export async function getSlices(project) {
  return getJson(`/api/projects/${encodeURIComponent(project)}/slices`);
}

/**
 * GET /api/projects/:id/slices/:slug/:artifact → the RAW artifact text, or null
 * when absent/unreachable. The route wraps the body in a {content} envelope
 * (content:null when the file is missing — AC-S005-3-4), so this helper UNWRAPS
 * it to the raw string (or null). UC-S005-3 shows this text raw (a <pre> slot);
 * UC-S005-4 will swap the slot for the markdown/mmd renderer. All segments are
 * URL-encoded. Fail-soft to null on any network/HTTP/parse error.
 * @param {string} project
 * @param {string} slug
 * @param {string} artifact  - e.g. 'slice.md'
 * @returns {Promise<string|null>}
 */
export async function getSliceArtifact(project, slug, artifact) {
  const body = await getJson(
    `/api/projects/${encodeURIComponent(project)}/slices/${encodeURIComponent(slug)}/${encodeURIComponent(artifact)}`,
  );
  return body && typeof body === 'object' ? (body.content ?? null) : null;
}

/**
 * Open the SSE channel (GET /api/events) and forward each `change` frame to
 * `onChange({ type, path })`. Returns an unsubscribe that closes the
 * EventSource. EventSource reconnects natively on drop; an unparseable frame is
 * ignored (never throws). UC6 builds path-filtering + re-fetch on top of this.
 *
 * DEFECT-003 — the SSE channel also surfaces CONNECTION state so the UI never
 * presents stale data as live. The optional second argument hooks the raw
 * EventSource lifecycle events:
 *   - onOpen()  fires on EventSource `open` (connected / reconnected). The
 *     container uses the reconnect open to re-fetch and self-heal.
 *   - onError() fires on EventSource `error` (dropped / unreachable). The
 *     container marks the figures stale and shows a disconnected indicator.
 * These are connection events, NOT data frames — they never call onChange. The
 * options arg is optional, so the original `subscribeEvents(onChange)` contract
 * is unchanged.
 * @param {(evt: { type: string, path: string }) => void} onChange
 * @param {{ onOpen?: () => void, onError?: () => void }} [opts]
 * @returns {() => void} unsubscribe
 */
export function subscribeEvents(onChange, opts = {}) {
  const { onOpen, onError } = opts;
  const source = new EventSource(`${API_BASE}/api/events`);
  source.addEventListener('message', (e) => {
    let evt;
    try {
      evt = JSON.parse(e.data);
    } catch {
      return; // ignore heartbeats / malformed frames
    }
    onChange(evt);
  });
  if (typeof onOpen === 'function') source.addEventListener('open', () => onOpen());
  if (typeof onError === 'function') source.addEventListener('error', () => onError());
  return () => source.close();
}

// AC-named aliases (acceptance.md AC1.3-AC1.5 reference these names directly).
export const fetchQueues = getQueues;
export const fetchPolicy = getPolicy;
export const fetchBaseline = getBaseline;
export const fetchFlow = getFlow;
