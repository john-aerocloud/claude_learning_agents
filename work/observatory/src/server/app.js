// Base Express app for the observatory read layer (CHK-1 scaffold seam).
//
// READ-ONLY POSTURE BY CONSTRUCTION:
//   - No body parser is mounted (the server has no use for request bodies).
//   - Only GET routers are mounted. UC6 adds the route-table assertion that no
//     POST/PUT/PATCH/DELETE handler is ever registered.
//
// EXTENSIBILITY SEAM for UC2–UC5:
//   createApp({ repoRoot, extraRouters }) mounts UC1's projects router under
//   /api, then mounts every router supplied in `extraRouters` under /api too.
//   Later UCs add their router module and pass it via `extraRouters` from the
//   composition point (server.js / a future index.js) — they MUST NOT edit this
//   file's own route registrations. CORS + the read-only route-table guard are
//   UC6's job; the seam is here now so UC6 wires without rework.

import express from 'express';
import { createProjectsRouter } from './routes/projects.js';
import { resolveRepoRoot } from './repoRoot.js';

const SHA = process.env.OBSERVATORY_SHA || process.env.GIT_SHA || 'dev';

// CORS posture (UC6 / capabilities.md): the read layer serves exactly ONE
// browser origin — the Vite SPA dev server. Never a wildcard. A test may
// override the allowed origin to drive AC6.4/AC6.5 against a synthetic origin.
const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:5173';

// Read methods the server permits. Everything else is rejected app-wide (F7 /
// T-READ-10): the read layer never mutates the repo, so write verbs cannot even
// reach a router. OPTIONS is kept so a CORS preflight is answerable.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @param {{
 *   repoRoot?: string,
 *   extraRouters?: import('express').Router[],
 *   allowedOrigin?: string,
 * }} [opts]
 */
export function createApp(opts = {}) {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot();
  const extraRouters = opts.extraRouters ?? [];
  const allowedOrigin = opts.allowedOrigin ?? DEFAULT_ALLOWED_ORIGIN;

  const app = express();
  app.disable('x-powered-by');

  // Build identity on the serving surface (principles/01): every response
  // carries the commit sha so a consumer can tell which build answered.
  app.use((_req, res, next) => {
    res.set('X-Observatory-Sha', SHA);
    next();
  });

  // CORS (AC6.4/AC6.5/T-READ-11): echo Access-Control-Allow-Origin ONLY when the
  // request Origin matches the single allowed SPA origin. Any other origin (or no
  // Origin) gets no ACAO header — never `*`. Vary: Origin so caches don't serve a
  // grant to the wrong origin.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.set('Vary', 'Origin');
    if (origin && origin === allowedOrigin) {
      res.set('Access-Control-Allow-Origin', allowedOrigin);
      res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    }
    next();
  });

  // App-level read-only guard (F7/AC6.2/AC6.3/T-READ-10): reject any non-read
  // method before it can reach a router, with 405 + an Allow header naming the
  // permitted verbs. A 4xx on the method of an incoming request is a caller-side
  // data problem (failure taxonomy: reject clean as 4xx, do not retry). OPTIONS
  // (CORS preflight) short-circuits to 204 — it is a read method, never a write.
  app.use((req, res, next) => {
    if (READ_METHODS.has(req.method)) {
      if (req.method === 'OPTIONS') {
        res.set('Allow', 'GET, HEAD, OPTIONS');
        return res.status(204).end();
      }
      return next();
    }
    res.set('Allow', 'GET, HEAD, OPTIONS');
    return res.status(405).json({ error: 'read-only: method not allowed', method: req.method });
  });

  // UC1 routes (this UC). Mounted under /api.
  app.use('/api', createProjectsRouter({ repoRoot }));

  // Extension seam: UC2–UC5 routers, mounted under /api without editing above.
  for (const r of extraRouters) app.use('/api', r);

  return app;
}
