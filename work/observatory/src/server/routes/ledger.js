// HTTP adapter for UC-S005-1 — GET /api/projects/:id/ledger?item_id=<id>.
// Returns the ledger rows for one work item, newest-first, so the work-item
// tree's item-history panel (UC-S005-5) can show real event history.
//
// HEXAGONAL ROLE: adapter. It reads the single fixed ledger file (file-reader
// port) and parses it with the SHARED tolerant parseLedger (domain, from
// lib/ledgerAggregator.js). It does NOT introduce a second ledger parser and
// does NOT use the strict RFC-4180 csv parser (OI-S004: a strict csv parser
// swallows rows whose `note` carries an unescaped comma/quote, undercounting
// history).
// Mounted under /api via createApp's extraRouters seam (the UC1..UC-S004-1
// pattern) — wiring lives in compose.js, not here.
//
// PATH SAFETY: :id is used ONLY as an in-memory project filter on rows already
// read from the constant path process/dora/ledger.csv. It is never interpolated
// into a filesystem path, so a traversal-shaped id simply matches no rows.
//
// RESILIENCE / FAILURE TAXONOMY (§8): read-only GET. readRaw fails soft to null
// on a missing/unreadable ledger; parseLedger maps null/empty → []. An unknown
// item_id, an absent item_id query param, a header-only ledger, and malformed
// rows all yield HTTP 200 with a (possibly empty) JSON array — never a 4xx/5xx.
// A missing optional artifact is not a server failure.

import { Router } from 'express';
import { join } from 'node:path';
import { readRaw } from '../parsers/file-reader.js';
import { parseLedger } from '../lib/ledgerAggregator.js';

/**
 * @param {{ repoRoot: string }} deps
 * @returns {import('express').Router}
 */
export function createLedgerRouter({ repoRoot }) {
  const router = Router();
  const ledgerPath = join(repoRoot, 'process', 'dora', 'ledger.csv');

  // GET /api/projects/:id/ledger?item_id=<id> → array of rows, newest-first (200 always).
  router.get('/projects/:id/ledger', (req, res) => {
    const itemId = req.query.item_id;
    // No item_id selected → nothing to show. Empty array, not an error.
    if (typeof itemId !== 'string' || itemId === '') {
      res.json([]);
      return;
    }

    const ledgerCsv = readRaw(ledgerPath); // null when absent → [] from parseLedger
    const rows = parseLedger(ledgerCsv)
      .filter((r) => r.project === req.params.id && r.item_id === itemId)
      // newest-first: descending by timestamp. Unparseable timestamps sort last.
      .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));

    res.json(rows);
  });

  return router;
}
