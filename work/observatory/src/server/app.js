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

/**
 * @param {{ repoRoot?: string, extraRouters?: import('express').Router[] }} [opts]
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

  // UC1 routes (this UC). Mounted under /api.
  app.use('/api', createProjectsRouter({ repoRoot }));

  // Extension seam: UC2–UC5 routers, mounted under /api without editing above.
  for (const r of extraRouters) app.use('/api', r);

  return app;
}
