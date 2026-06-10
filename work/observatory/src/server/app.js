// Base Express app for the observatory read layer.
//
// READ-ONLY POSTURE BY CONSTRUCTION:
//   - No body parser is mounted (the server has no use for request bodies).
//   - Only GET routers are mounted. UC6 adds the route-table assertion that no
//     POST/PUT/PATCH/DELETE handler is ever registered.
//
// TOPOLOGY (consolidated single-server): the SPA is served by the same Express
// process (via Vite middleware in dev, or static dist/ in prod). CORS is
// therefore removed — same-origin requests never need ACAO headers.
//
// EXTENSIBILITY SEAM for UC2–UC5:
//   createApp({ repoRoot, extraRouters }) mounts UC1's projects router under
//   /api, then mounts every router supplied in `extraRouters` under /api too.
//   Later UCs add their router module and pass it via `extraRouters` from the
//   composition point (dev.js / server.js) — they MUST NOT edit this file's own
//   route registrations.

import express from 'express';
import { createProjectsRouter } from './routes/projects.js';
import { resolveRepoRoot } from './repoRoot.js';

const SHA = process.env.OBSERVATORY_SHA || process.env.GIT_SHA || 'dev';

// Read methods the server permits. Everything else is rejected app-wide (F7 /
// T-READ-10): the read layer never mutates the repo, so write verbs cannot even
// reach a router. OPTIONS is kept for completeness.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @param {{
 *   repoRoot?: string,
 *   extraRouters?: import('express').Router[],
 * }} [opts]
 */
export function createApp(opts = {}) {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot();
  const extraRouters = opts.extraRouters ?? [];

  const app = express();
  app.disable('x-powered-by');

  // Build identity on the serving surface (principles/01): every response
  // carries the commit sha so a consumer can tell which build answered.
  app.use((_req, res, next) => {
    res.set('X-Observatory-Sha', SHA);
    next();
  });

  // App-level read-only guard (F7/AC6.2/AC6.3/T-READ-10): reject any non-read
  // method before it can reach a router, with 405 + an Allow header naming the
  // permitted verbs. A 4xx on the method of an incoming request is a caller-side
  // data problem (failure taxonomy: reject clean as 4xx, do not retry). OPTIONS
  // short-circuits to 204 so it never reaches a router.
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
