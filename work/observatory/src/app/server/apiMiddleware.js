// Observatory API — connect/Vite middleware (no Express).
//
// This module exports createApiMiddleware({ repoRoot, watcher }) which wires
// ALL /api/* routes as a single connect-compatible middleware function. It is
// mounted inside the Vite plugin via configureServer(server) and
// configurePreviewServer(server) so both `vite dev` and `vite preview` serve
// the API from the SAME origin as the SPA — no CORS, no separate process.
//
// READ-ONLY POSTURE: only GET/HEAD/OPTIONS are served. Any other method returns
// 405 before reaching a route handler, exactly matching the old Express app.js
// guard (F7/AC6.2/AC6.3/T-READ-10).
//
// ROUTE TABLE (all mounted under /api):
//   GET /api/projects                               → UC1 project list
//   GET /api/active                                 → UC1 active project
//   GET /api/projects/:id/items                     → UC2 items CSV
//   GET /api/projects/:id/queues/:queue             → UC2 queue CSV
//   GET /api/projects/:id/queues/staging            → DEFECT-012 staging buffer {queue,depth,rows}
//   GET /api/dora/baseline                          → UC3 global baseline.md
//   GET /api/projects/:id/dora/:artifact            → UC3 per-project dora artifact
//   GET /api/projects/:id/deps/:artifact            → UC3 deps mmd
//   GET /api/projects/:id/slices                    → UC4 slice list
//   GET /api/projects/:id/slices/:slug/:artifact    → UC4 slice artifact
//   GET /api/projects/:id/stage-flow                → UC-S004-1 value-stream
//   GET /api/projects/:id/ledger?item_id=           → UC-S005-1 ledger history
//   GET /api/projects/:id/defects?id=               → UC-S013-1 defect records + MTTR
//   GET /api/events                                 → UC5 SSE live-refresh
//
// SECURITY: artifact names validated against fixed allowlists (AC3.7/T-READ-12/
// T-READ-13); :id/slug validated against safe-segment rules before path joins.
// Path-traversal cannot reach outside the intended dirs.

import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { listProjects, readActive } from './parsers/project-registry.js';
import { readItems, readQueue } from './parsers/csv.js';
import { readRaw } from './parsers/file-reader.js';
import { aggregateStageFlow } from './lib/ledgerAggregator.js';
import { parseLedger } from './lib/ledgerAggregator.js';
import { getDefects } from './routes/defects.js';
import { getStagingQueue } from './routes/staging.js';

const SHA = process.env.OBSERVATORY_SHA || process.env.GIT_SHA || 'dev';
const HEARTBEAT_MS = 30_000;

// DEFECT-009 — request-time `now` (epoch ms) for the WIP recency horizon.
// Real servers use Date.now(). A static-fixture server (e2e) can pin it via
// OBSERVATORY_NOW (ISO timestamp OR epoch-ms string) so a fixed-date in-flight
// open stays "recent" and the browser fixture renders deterministically. Read
// per-request (not cached) so a test can flip it; unparseable → Date.now().
function requestNow() {
  const raw = process.env.OBSERVATORY_NOW;
  if (raw) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && raw.trim() !== '') return asNum;
    const asIso = Date.parse(raw);
    if (Number.isFinite(asIso)) return asIso;
  }
  return Date.now();
}

// Read methods the server permits (F7/T-READ-10).
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Artifact allowlists (path-safety guards).
const DORA_ARTIFACTS = new Set(['flow', 'per-project']);
const DEPS_ARTIFACTS = new Set(['use-case-deps.mmd', 'class-deps.mmd', 'edge-ledger.md']);
const SLICE_ARTIFACTS = new Set([
  'slice.md', 'use-cases.md', 'acceptance.md', 'route.md',
  'ui-design.md', 'test-plan.md', 'result.md',
]);
const QUEUE_NAMES = new Set(['intake', 'ready', 'deploy', 'rework', 'policy']);
// DEFECT-004 — buffer stages whose queue CSVs feed stage-flow current-state.
const BUFFER_QUEUE_STAGES = ['intake', 'ready', 'deploy', 'rework'];
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const SAFE_PROJECT_ID = /^[A-Za-z0-9._-]+$/;

function isSafeSegment(seg) {
  return (
    typeof seg === 'string' &&
    seg.length > 0 &&
    !seg.includes('/') &&
    !seg.includes('\\') &&
    !seg.includes('\0') &&
    seg !== '.' &&
    seg !== '..'
  );
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Observatory-Sha': SHA,
  });
  res.end(data);
}

/**
 * Create the connect middleware handling all /api/* routes.
 * @param {{ repoRoot: string, watcher: ReturnType<import('./watcher.js').createWatcher> }} opts
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => void}
 */
export function createApiMiddleware({ repoRoot, watcher }) {
  const ledgerPath = join(repoRoot, 'process', 'dora', 'ledger.csv');

  return function apiMiddleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    // Only handle /api/* paths — pass everything else to Vite.
    if (!path.startsWith('/api')) return next();

    // Attach build-sha header to every /api response.
    res.setHeader('X-Observatory-Sha', SHA);

    // Read-only guard (F7/AC6.2/AC6.3/T-READ-10).
    if (!READ_METHODS.has(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return json(res, 405, { error: 'read-only: method not allowed', method: req.method });
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.writeHead(204);
      return res.end();
    }

    // --- Route dispatch ---

    // GET /api/projects
    if (path === '/api/projects') {
      return json(res, 200, listProjects(repoRoot));
    }

    // GET /api/active
    if (path === '/api/active') {
      return json(res, 200, { active: readActive(repoRoot) });
    }

    // GET /api/dora/baseline
    if (path === '/api/dora/baseline') {
      return json(res, 200, { content: readRaw(join(repoRoot, 'process', 'dora', 'baseline.md')) });
    }

    // GET /api/events — SSE long-lived stream (UC5)
    if (path === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Observatory-Sha': SHA,
      });
      res.write(':\n\n'); // initial heartbeat comment — opens the stream so onopen fires
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const unsubscribe = watcher.subscribe((evt) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(':\n\n');
      }, HEARTBEAT_MS);
      heartbeat.unref?.();

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return; // long-lived — never call next()
    }

    // /api/projects/:id/...  — parse :id from the path
    const projectsMatch = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
    if (projectsMatch) {
      const id = decodeURIComponent(projectsMatch[1]);
      const rest = projectsMatch[2] || '';

      if (!isSafeSegment(id)) {
        return json(res, 400, { error: 'invalid project id' });
      }

      // GET /api/projects/:id/items
      if (rest === '/items') {
        return json(res, 200, readItems(repoRoot, id));
      }

      // GET /api/projects/:id/queues/:queue
      const queuesMatch = rest.match(/^\/queues\/([^/]+)$/);
      if (queuesMatch) {
        const queue = decodeURIComponent(queuesMatch[1]);
        // DEFECT-012 — the staging buffer (decomposed, awaiting triage) has its
        // own envelope { queue, depth, rows }: empty is the HAPPY state, so a
        // missing file is depth 0, never null (see routes/staging.js).
        if (queue === 'staging') {
          return json(res, 200, getStagingQueue({ repoRoot, projectId: id }));
        }
        if (!QUEUE_NAMES.has(queue)) {
          return json(res, 404, { error: 'unknown queue', queue });
        }
        return json(res, 200, readQueue(repoRoot, id, queue));
      }

      // GET /api/projects/:id/dora/:artifact
      const doraMatch = rest.match(/^\/dora\/([^/]+)$/);
      if (doraMatch) {
        const artifact = decodeURIComponent(doraMatch[1]);
        if (!DORA_ARTIFACTS.has(artifact)) {
          return json(res, 400, { error: 'unknown dora artifact' });
        }
        const filePath = join(repoRoot, 'work', id, 'dora', `${artifact}.md`);
        return json(res, 200, { content: readRaw(filePath) });
      }

      // GET /api/projects/:id/deps/:artifact
      const depsMatch = rest.match(/^\/deps\/([^/]+)$/);
      if (depsMatch) {
        const artifact = decodeURIComponent(depsMatch[1]);
        if (!DEPS_ARTIFACTS.has(artifact)) {
          return json(res, 400, { error: 'unknown deps artifact' });
        }
        const filePath = join(repoRoot, 'work', id, 'architecture', 'dependencies', artifact);
        return json(res, 200, { content: readRaw(filePath) });
      }

      // GET /api/projects/:id/slices
      if (rest === '/slices') {
        const slicesDir = join(repoRoot, 'work', id, 'slices');
        let entries;
        try {
          entries = readdirSync(slicesDir, { withFileTypes: true });
        } catch {
          return json(res, 200, []);
        }
        return json(res, 200, entries.filter((e) => e.isDirectory()).map((e) => e.name));
      }

      // GET /api/projects/:id/slices/:slug/:artifact
      const slicesMatch = rest.match(/^\/slices\/([^/]+)\/([^/]+)$/);
      if (slicesMatch) {
        const slug = decodeURIComponent(slicesMatch[1]);
        const artifact = decodeURIComponent(slicesMatch[2]);
        if (!SLICE_ARTIFACTS.has(artifact)) {
          return json(res, 400, { error: 'unknown artifact' });
        }
        const filePath = join(repoRoot, 'work', id, 'slices', slug, artifact);
        let content;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          return json(res, 200, { content: null });
        }
        return json(res, 200, { content });
      }

      // GET /api/projects/:id/stage-flow
      if (rest === '/stage-flow') {
        const ledgerCsv = readRaw(ledgerPath);
        const safe = SAFE_PROJECT_ID.test(id);
        const itemsCsv = safe
          ? readRaw(join(repoRoot, 'work', id, 'items', 'items.csv'))
          : null;
        // DEFECT-004: read the buffer-stage queue CSVs so the aggregator can
        // compute current depth/wait + the coherence cross-check. `now` is
        // request time (this is a normal Node process — Date.now() is fine).
        const queues = safe
          ? Object.fromEntries(
              BUFFER_QUEUE_STAGES.map((stage) => [
                stage,
                readRaw(join(repoRoot, 'work', id, 'queues', `${stage}.csv`)),
              ]),
            )
          : null;
        // DEFECT-009: `now` governs the WIP recency horizon. Real requests use
        // Date.now(); a static FIXTURE server (e2e) pins it via OBSERVATORY_NOW
        // (ISO ts or epoch ms) so a fixed-date in-flight open stays "recent" and
        // the browser fixture renders deterministically. Unparseable → Date.now().
        return json(
          res,
          200,
          aggregateStageFlow(ledgerCsv, id, itemsCsv, { queues, now: requestNow() }),
        );
      }

      // GET /api/projects/:id/defects[?id=DEFECT-NNN] — UC-S013-1
      if (rest === '/defects') {
        const idFilter = url.searchParams.get('id');
        return json(res, 200, getDefects({ repoRoot, projectId: id, idFilter }));
      }

      // GET /api/projects/:id/ledger?item_id=...
      if (rest === '/ledger') {
        const itemId = url.searchParams.get('item_id');
        if (!itemId || itemId === '') {
          return json(res, 200, []);
        }
        const ledgerCsv = readRaw(ledgerPath);
        const rows = parseLedger(ledgerCsv)
          .filter((r) => r.project === id && r.item_id === itemId)
          .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
        return json(res, 200, rows);
      }

      // Unknown /api/projects/:id/... sub-path → 404
      return json(res, 404, { error: 'not found' });
    }

    // Unknown /api/* path → 404
    return json(res, 404, { error: 'not found' });
  };
}
