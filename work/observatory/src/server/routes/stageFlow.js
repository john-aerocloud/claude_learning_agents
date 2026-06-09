// HTTP adapter for UC-S004-1 — GET /api/projects/:id/stage-flow.
// Translates the ledger aggregator (domain) into a GET-only Express route.
// Adapter depends on domain (aggregator + file-reader); never the reverse.
// Read-only: registers ONLY a GET handler. Mounted under /api via createApp's
// extraRouters seam (the UC1/UC2/UC3 pattern) — this module does NOT edit
// app.js or compose.js; the composition root wires it.
//
// PATH SAFETY (AC1.9): the :id is used ONLY as an in-memory project FILTER on
// rows already read from the single fixed file process/dora/ledger.csv. It is
// never interpolated into a filesystem path, so a traversal-shaped id
// (`../../etc`) can never read outside the ledger — it simply matches no rows
// and the endpoint returns all-zero stages. The ledger path is a constant.
//
// RESILIENCE / FAILURE TAXONOMY (§8, CC1): readRaw fails soft to null on a
// missing/unreadable ledger; the aggregator maps null → all-zero stages. The
// endpoint therefore returns HTTP 200 with a complete (zeroed) stage list
// rather than a 500 — a missing optional artifact is not a server failure.

import { Router } from 'express';
import { join } from 'node:path';
import { readRaw } from '../parsers/file-reader.js';
import { aggregateStageFlow } from '../lib/ledgerAggregator.js';

/**
 * @param {{ repoRoot: string }} deps
 * @returns {import('express').Router}
 */
export function createStageFlowRouter({ repoRoot }) {
  const router = Router();
  const ledgerPath = join(repoRoot, 'process', 'dora', 'ledger.csv');

  // GET /api/projects/:id/stage-flow → per-stage value-stream array (200 always).
  router.get('/projects/:id/stage-flow', (req, res) => {
    const ledgerCsv = readRaw(ledgerPath); // null when absent → all-zero stages
    const flow = aggregateStageFlow(ledgerCsv, req.params.id);
    res.json(flow);
  });

  return router;
}
