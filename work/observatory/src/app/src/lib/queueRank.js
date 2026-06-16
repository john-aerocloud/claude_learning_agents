// UC-S018-3 — the deterministic directional queue-rank fn.
//
// HEXAGONAL ROLE: pure DOMAIN logic. No DOM, no fetch, no SDK — a TOTAL pure
// function defined for every input (including nulls/garbage/blank tiers);
// never throws.
//
// THE CROSS-UC CONTRACT (ui-design.md §queueRank — UC-S018-3 renders it,
// UC-S018-4 reads the SAME object into the intake prompt):
//   rankPreview({ token, items }) ->
//     { complete, total, ahead, behind, alongside, token, sentence, empty }
//   - token: 'HIGH'|'MED'|'LOW'|null — the wizard item's tier (codScore.token).
//     null = CoD step incomplete → gated (no fabricated rank).
//   - the comparison set = the live items.csv NON-terminal backlog (queued work
//     the new item would join): planned|unconfirmed|in-flight|active. done and
//     dropped are terminal and EXCLUDED (RANK-S018-3-5).
//   - tiers order HIGH > MED > LOW; the real backlog carries intermediate/blank
//     tiers, so each record's raw `value` is normalised to a coarse ordinal:
//     HIGH=3, MED-HIGH=2.5, MED=2, LOW=1, blank/unknown=2 (MED-equivalent — NOT
//     dropped, NOT 0; RANK-S018-3-6).
//   - sentence: the ONE authored human directional line — the live step-3
//     readout AND the UC-S018-4 prompt rank line read it verbatim (author-once,
//     the same discipline codScorer.reason uses).

/** Non-terminal backlog states — the comparison set (the queue the new item
 * would join). Terminal (done/dropped) are out of the ranking. */
const NON_TERMINAL_STATES = new Set(['planned', 'unconfirmed', 'in-flight', 'active']);

/** Tier → coarse ordinal (HIGH > MED > LOW). MED-HIGH sits between; blank/unknown
 * defaults to the MED-equivalent ordinal (counted, never dropped, never 0). */
const TIER_ORDINAL = { HIGH: 3, 'MED-HIGH': 2.5, MED: 2, LOW: 1 };
const MED_EQUIVALENT = 2;

/**
 * Is this record part of the rank comparison set (a non-terminal backlog item)?
 * Total: null/garbage → false; never throws. Exported so the test pins it.
 * @param {{state?:string}|null} record
 * @returns {boolean}
 */
export function isComparisonItem(record) {
  const state = typeof record?.state === 'string' ? record.state.trim().toLowerCase() : '';
  return NON_TERMINAL_STATES.has(state);
}

/**
 * Map a raw items.csv `value` string to a coarse rank ordinal. Total: blank /
 * unknown / null → MED-equivalent (2); case-insensitive; never throws.
 * Exported so the test pins the real-data normalisation.
 * @param {string|null|undefined} value
 * @returns {number}
 */
export function normaliseTier(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return Object.prototype.hasOwnProperty.call(TIER_ORDINAL, key) ? TIER_ORDINAL[key] : MED_EQUIVALENT;
}

/** Plain-language placement hint from the ahead/total ratio (FIG-S018-3-1). */
function placementHint(ahead, total) {
  if (total === 0) return '';
  const ratio = ahead / total;
  if (ratio <= 1 / 3) return ' — placing it near the top of the queue';
  if (ratio >= 2 / 3) return ' — placing it near the bottom of the queue';
  return ' — placing it around the middle of the queue';
}

/** Pluralise the unit so the sentence reads naturally ("1 item" / "2 items"). */
function items(n) {
  return n === 1 ? '1 item' : `${n} items`;
}

const EMPTY_SENTENCE = 'The queue is currently empty — your item would be next.';

/** Compose the directional sentence (FIG-S018-3-1/2/4 — tier WORDS, the unit
 * "items", same-tier peers surfaced as "alongside N", no raw ids). */
function composeSentence({ token, total, ahead, behind, alongside, empty }) {
  if (empty) return EMPTY_SENTENCE;
  const peers = alongside > 0 ? `, alongside ${alongside} at the same priority` : '';
  return (
    `Your item (${token} value) would rank ahead of ${items(ahead)} ` +
    `and behind ${items(behind)}${peers}${placementHint(ahead, total)}.`
  );
}

/**
 * Directional rank of the wizard item against the live non-terminal backlog.
 * Pure, total — defined for token===null, items===[], unknown/blank values;
 * never throws; no side effects.
 * @param {object} [input]
 * @param {'HIGH'|'MED'|'LOW'|null} [input.token] - codScore.token (lifted)
 * @param {Array|null} [input.items] - raw items.csv ItemRecord[]
 * @returns {{complete:boolean,total:number,ahead:number,behind:number,
 *            alongside:number,token:('HIGH'|'MED'|'LOW'|null),sentence:string,
 *            empty:boolean}}
 */
export function rankPreview(input) {
  const token =
    input && (input.token === 'HIGH' || input.token === 'MED' || input.token === 'LOW')
      ? input.token
      : null;

  // Gated: the CoD step is incomplete → no fabricated rank (RANK-S018-3-3).
  if (token === null) {
    return { complete: false, total: 0, ahead: 0, behind: 0, alongside: 0, token: null, sentence: '', empty: true };
  }

  const records = Array.isArray(input.items) ? input.items : [];
  const ordinals = records.filter(isComparisonItem).map((r) => normaliseTier(r.value));
  const total = ordinals.length;
  const self = normaliseTier(token);

  let ahead = 0;
  let behind = 0;
  let alongside = 0;
  for (const o of ordinals) {
    if (o > self) ahead += 1;
    else if (o < self) behind += 1;
    else alongside += 1;
  }

  const empty = total === 0;
  return {
    complete: true,
    total,
    ahead,
    behind,
    alongside,
    token,
    empty,
    sentence: composeSentence({ token, total, ahead, behind, alongside, empty }),
  };
}
