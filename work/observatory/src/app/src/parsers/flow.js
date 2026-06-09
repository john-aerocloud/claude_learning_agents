// UC-S003-1 — flow.md time-thief + queue table parser.
//
// HEXAGONAL ROLE: pure domain logic. parseFlow takes the RAW flow.md string from
// the SPA API adapter (getFlow()) and returns a typed FlowParsed record the
// render UC (UC4 TimeThiefView) consumes — it never touches raw markdown.
//
// The flow.md file contains SEVERAL adjacent tables (queues, time thieves,
// collisions, per-item lead time). We pick out exactly the two we need by their
// HEADER cells, so a reordered file or extra tables do not contaminate the
// result: a thief table is the one whose header row reads | Thief | Value |
// Source |; a queue table is the one whose first header cell is "Queue".
//
// FIDELITY (§8 F3): every value is the raw trimmed cell string — no rounding /
// reformatting. FAIL SOFT (§8 R2): null / non-string / absent-table → empty
// arrays; never throws.
import { tableRows } from './markdown-table.js';

export const FLOW_SOURCE_REF = 'work/observatory/dora/flow.md';

/**
 * Parse a raw flow.md string into a typed record.
 * @param {string|null|undefined} raw
 * @returns {{
 *   timeThieves: Array<{name: string, value: string, source: string}>,
 *   queues: Array<{
 *     queue: string, minItems: string, wipLimit: string, length: string,
 *     throughput: string, dwellMedian: string, reworkRate: string, itemsThrough: string,
 *   }>,
 *   sourceRef: string,
 * }}
 */
export function parseFlow(raw) {
  const result = { timeThieves: [], queues: [], sourceRef: FLOW_SOURCE_REF };
  if (typeof raw !== 'string') return result;

  const rows = tableRows(raw);
  let inThieves = false;
  let inQueues = false;

  for (const cells of rows) {
    const head = cells[0].toLowerCase();

    // A header row switches which table we are reading. Each header also resets
    // the other flag so we never bleed rows from one table into another.
    if (head === 'thief') { inThieves = true; inQueues = false; continue; }
    if (head === 'queue') { inQueues = true; inThieves = false; continue; }
    // Any other header-shaped row (e.g. "when", "item") ends both tables.
    if (head === 'when' || head === 'item') { inThieves = false; inQueues = false; continue; }

    if (inThieves && cells.length >= 3) {
      result.timeThieves.push({
        name: cells[0],
        value: cells[1],
        source: cells[2],
      });
    } else if (inQueues && cells.length >= 8) {
      result.queues.push({
        queue: cells[0],
        minItems: cells[1],
        wipLimit: cells[2],
        length: cells[3],
        throughput: cells[4],
        dwellMedian: cells[5],
        reworkRate: cells[6],
        itemsThrough: cells[7],
      });
    }
  }

  return result;
}
