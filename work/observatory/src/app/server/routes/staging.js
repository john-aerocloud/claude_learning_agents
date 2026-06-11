// DEFECT-012 — staging buffer route ADAPTER.
//
// GET /api/projects/:id/queues/staging → { queue:'staging', depth, rows }
//
// Between product's decompose completion and the flow-manager's triage sweep,
// produced items sit in work/<project>/queues/staging.csv (header:
// item_id,parent,job,value,cost,produced_ts,producer_ref). That handoff is a
// REAL buffer (lean rule: every handoff is a buffer, and buffers are visible),
// so the read layer serves it with an explicit DEPTH the board can render.
//
// Shape difference from the other queue routes (bare array): staging returns
// an envelope { queue, depth, rows } because EMPTY IS THE HAPPY STATE — the
// board must distinguish "0 awaiting triage" (drained, good) from "no data".
// A missing or header-only staging.csv is therefore depth 0 + rows [], never
// null and never an error (fail-soft like the rest of the read layer).
//
// HEXAGONAL ROLE: adapter over the filesystem; reuses the §4 CSV parser
// (raw-string records, header-defined columns) from parsers/csv.js.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../parsers/csv.js';

/**
 * Read + parse the staging buffer for a project.
 * @param {{ repoRoot: string, projectId: string }} opts
 * @returns {{ queue: 'staging', depth: number, rows: Record<string,string>[] }}
 */
export function getStagingQueue({ repoRoot, projectId }) {
  let rows = [];
  try {
    const text = readFileSync(
      join(repoRoot, 'work', projectId, 'queues', 'staging.csv'),
      'utf8',
    );
    rows = parseCsv(text);
  } catch {
    rows = []; // missing file/project → empty buffer (the happy state), not an error
  }
  return { queue: 'staging', depth: rows.length, rows };
}
