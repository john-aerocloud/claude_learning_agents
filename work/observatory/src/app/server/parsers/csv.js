// CSV parser (UC2 — domain). Pure functions over a repo root path; imports only
// node:fs/node:path + csv-parse. No transport, no SDK — domain depends on no
// adapter (hexagonal: adapters depend on domain, never the reverse).
//
// §4 contract: values are RAW STRINGS. csv-parse default output is string —
// we deliberately add NO numeric casts (vc_ratio "0.75", cost "4" stay strings).
// The record shape is defined by each file's own header row (columns:true), so
// every §4 column is preserved and extra columns are kept (never invented).
//
// §8 resilience: a header-only CSV yields [] (zero data rows, no crash); a
// missing file or missing project yields null (the route maps that to HTTP 200
// + JSON null). Nothing here throws on partial repo state.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

// Queue CSVs the read layer serves (§4.3). An unknown queue name is rejected
// (returns null) — this is also the path-safety guard: only allowlisted, simple
// names ever become a filename, so `../../etc/passwd` can never be read.
const QUEUE_NAMES = new Set(['intake', 'ready', 'deploy', 'rework', 'policy']);

/**
 * Parse a CSV string to an array of records keyed by the header row.
 * Header-only (or empty) input → []. Raw string values, no casting.
 * @param {string} text
 * @returns {Record<string,string>[]}
 */
export function parseCsv(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  return parse(text, {
    columns: true, // first row is the header → object keys
    skip_empty_lines: true,
    trim: false, // preserve field content exactly (raw §4 strings)
    relax_column_count: true, // tolerate ragged rows rather than throwing
  });
}

/** Read + parse work/<project>/items/items.csv. Missing file/project → null. */
export function readItems(repoRoot, project) {
  return readCsvFile(join(repoRoot, 'work', project, 'items', 'items.csv'));
}

/**
 * Read + parse work/<project>/queues/<queue>.csv for an allowlisted queue.
 * Unknown queue name, missing file, or missing project → null.
 */
export function readQueue(repoRoot, project, queue) {
  if (!QUEUE_NAMES.has(queue)) return null;
  return readCsvFile(join(repoRoot, 'work', project, 'queues', `${queue}.csv`));
}

/** Read a file and parse as CSV; ENOENT (or any read failure) → null (fail soft). */
function readCsvFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null; // missing optional file → null (HTTP 200 null at the route)
  }
  return parseCsv(text);
}
