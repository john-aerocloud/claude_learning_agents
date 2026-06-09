// HTTP adapter for UC2 — translates the CSV parser (domain) into GET-only
// Express routes. Adapter depends on domain (parser); never the reverse.
// Read-only: this router registers ONLY GET handlers.
//
// Mounting (UC6): this module exports createItemsQueuesRouter({ repoRoot }) and
// is mounted under /api alongside UC1's router, e.g.
//   app.use('/api', createItemsQueuesRouter({ repoRoot }))
// In tests it is injected via createApp({ repoRoot, extraRouters: [router] }) so
// UC2 stays independent of server.js (the shared UC6 mount seam).

import { Router } from 'express';
import { readItems, readQueue } from '../parsers/csv.js';

// §4.3 queue allowlist. An unknown name is a client error (404) — distinct from
// an allowlisted-but-absent file (200 + null). This is also the path guard: only
// these literal names ever reach the parser, so traversal can never read out.
const QUEUE_NAMES = new Set(['intake', 'ready', 'deploy', 'rework', 'policy']);

/**
 * @param {{ repoRoot: string }} deps
 * @returns {import('express').Router}
 */
export function createItemsQueuesRouter({ repoRoot }) {
  const router = Router();

  // GET /api/projects/:id/items → ItemRecord[] | null (200; null = missing file)
  router.get('/projects/:id/items', (req, res) => {
    res.json(readItems(repoRoot, req.params.id));
  });

  // GET /api/projects/:id/queues/:queue → QueueRecord[]|PolicyRecord[]|null (200)
  router.get('/projects/:id/queues/:queue', (req, res) => {
    const { queue } = req.params;
    if (!QUEUE_NAMES.has(queue)) {
      return res.status(404).json({ error: 'unknown queue', queue });
    }
    res.json(readQueue(repoRoot, req.params.id, queue));
  });

  return router;
}
