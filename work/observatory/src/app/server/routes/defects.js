// UC-S013-1 — defects route (ADAPTER).
//
// fs adapter for GET /api/projects/:id/defects: reads the project's
// work/<project>/defects/DEFECT-*.md files plus the global DORA ledger and
// delegates to the pure domain aggregator (lib/defectsAggregator.js).
//
// PATH SAFETY: the caller (apiMiddleware) validates :id with isSafeSegment
// before this runs; filenames are taken from readdirSync of the fixed dir
// (never from the request), so no request-derived path joins happen here.
//
// §8 RESILIENCE: never throws — a missing defects dir, unreadable file, or
// missing ledger degrades to an empty/partial result, not a 5xx.
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { aggregateDefects } from '../lib/defectsAggregator.js';

const DEFECT_FILE_RE = /^DEFECT-\d+.*\.md$/;

/**
 * Read + aggregate the project's defect records.
 * @param {{ repoRoot: string, projectId: string, idFilter?: string|null }} opts
 * @returns {Array<object>} defect records sorted ascending by id (never throws)
 */
export function getDefects({ repoRoot, projectId, idFilter = null }) {
  const files = [];
  const defectsDir = join(repoRoot, 'work', projectId, 'defects');
  let entries = [];
  try {
    entries = readdirSync(defectsDir, { withFileTypes: true });
  } catch {
    entries = []; // no defects dir — ledger-only defects can still appear
  }
  for (const entry of entries) {
    if (!entry.isFile() || !DEFECT_FILE_RE.test(entry.name)) continue;
    try {
      files.push({ name: entry.name, text: readFileSync(join(defectsDir, entry.name), 'utf8') });
    } catch {
      // unreadable file — skip soft; the ledger pairing may still surface the id
    }
  }

  let ledgerCsv = null;
  try {
    ledgerCsv = readFileSync(join(repoRoot, 'process', 'dora', 'ledger.csv'), 'utf8');
  } catch {
    ledgerCsv = null; // no ledger — md records appear without MTTR figures
  }

  return aggregateDefects({ files, ledgerCsv, projectId, idFilter });
}
