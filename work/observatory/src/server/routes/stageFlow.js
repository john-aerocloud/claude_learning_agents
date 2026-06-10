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
// A safe project id is a single path segment of name characters — no slashes,
// no '..'. Anything else can never become an items.csv path (AC1.9 path safety):
// reconciliation is simply skipped (null itemsCsv → fail-soft, raw open-enter).
const SAFE_PROJECT_ID = /^[A-Za-z0-9._-]+$/;

export function createStageFlowRouter({ repoRoot }) {
  const router = Router();
  const ledgerPath = join(repoRoot, 'process', 'dora', 'ledger.csv');

  // GET /api/projects/:id/stage-flow → per-stage value-stream array (200 always).
  // DEFECT-002: WIP is reconciled against the project's authoritative item
  // registry (items.csv) so phantom open-enters from held/dropped work do not
  // count as in-flight forever. The :id is a project name used ONLY to locate
  // work/<id>/items/items.csv via path.join — a traversal-shaped id resolves to
  // a non-existent file → readRaw null → fail-soft (no reconciliation), and the
  // ledger filter already matches no rows for such an id (all-zero stages).
  router.get('/projects/:id/stage-flow', (req, res) => {
    const ledgerCsv = readRaw(ledgerPath); // null when absent → all-zero stages
    const id = req.params.id;
    // Only a safe, single-segment id ever becomes a filesystem path (AC1.9).
    const itemsCsv = SAFE_PROJECT_ID.test(id)
      ? readRaw(join(repoRoot, 'work', id, 'items', 'items.csv')) // null when absent → no reconciliation
      : null;
    const flow = aggregateStageFlow(ledgerCsv, id, itemsCsv);
    res.json(flow);
  });

  return router;
}
