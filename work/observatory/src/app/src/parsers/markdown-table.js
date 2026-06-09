// UC-S003-1 — shared markdown GFM-table cell extractor (pure, fail-soft).
//
// HEXAGONAL ROLE: pure domain helper used by baseline.js and flow.js to turn the
// raw markdown the API adapter hands over into rows of trimmed cell strings.
// It is deliberately format-tolerant and column-agnostic: callers identify the
// table they want by inspecting the cell shape (column count + cell content),
// because the baseline/flow markdown contains several adjacent tables and we
// must not couple to heading text that may be reformatted (§8 fail-soft).
//
// FIDELITY: cells are only `.trim()`-ed of surrounding whitespace — interior
// content (numbers, units, dashes "—", prose) passes through verbatim so the
// render UCs can assert string-equality against the source.
// FAIL SOFT: non-string input → []. A line that is not a table row → skipped.
// Header separator rows (| --- | --- |) → skipped.

/**
 * Extract every GFM-style table row from a markdown string as an array of
 * trimmed cell-string arrays. Header-name rows are RETURNED (callers skip them
 * by inspecting content); only the `|---|---|` separator rows are dropped.
 * @param {string|null|undefined} raw
 * @returns {string[][]} one entry per table row; each is its trimmed cells
 */
export function tableRows(raw) {
  if (typeof raw !== 'string') return [];
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    // a table row starts with a pipe and contains at least one more pipe
    if (!trimmed.startsWith('|') || trimmed.indexOf('|', 1) === -1) continue;
    const cells = splitRow(trimmed);
    if (cells.length === 0) continue;
    // drop the separator row: every cell is only dashes/colons (|---|:--:|)
    if (cells.every((c) => /^:?-{1,}:?$/.test(c) || c === '')) continue;
    rows.push(cells);
  }
  return rows;
}

/** Split a `| a | b | c |` row into trimmed inner cells (drops outer empties). */
function splitRow(line) {
  const parts = line.split('|');
  // a leading/trailing pipe yields empty first/last segments — drop them
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map((c) => c.trim());
}
