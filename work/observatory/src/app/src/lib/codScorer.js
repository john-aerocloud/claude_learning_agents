// UC-S018-2 — the deterministic cost-of-delay value-token scorer.
//
// HEXAGONAL ROLE: pure DOMAIN logic. No DOM, no fetch, no SDK — a TOTAL pure
// function defined for every input (including nulls/garbage); never throws.
//
// THE CROSS-UC CONTRACT (ui-design.md §scorer — UC-S018-3/4 consume this):
//   scoreCod({ value, timeCritical }) -> { token, band, complete, reason }
//   - token: 'HIGH'|'MED'|'LOW'|null — the coarse tier UC-S018-3's
//     useQueueRank compares against the Intake-queue items (HIGH > MED > LOW).
//   - band: === token THIS slice; kept as a SEPARATE field so a future graded
//     WSJF/CD3 score can widen `band` without breaking consumers that read it.
//   - complete: true iff BOTH signals are chosen — UC-S018-3 holds the rank
//     preview and UC-S018-4 gates "Generate" on this.
//   - reason: the ONE authored human sentence — the live readout (this UC) and
//     the UC-S018-4 prompt "value: … with reasoning" line read it verbatim.
//
// RULE (verbatim from slice.md §2 / AC-S018-2-4):
//   HIGH & time-critical      → HIGH   (top tier)
//   LOW  & not time-critical  → LOW    (bottom tier)
//   every other CHOSEN combo  → MED    (middle tier)
//   either signal unchosen    → token/band null, complete false, reason '' —
//   incomplete is NOT a defaulted MED (FIG empty-inputs≠score, at the source).

const VALUE_TOKENS = ['HIGH', 'MED', 'LOW'];

const REASONS = {
  HIGH: 'High value and time-critical — ranks with the top tier.',
  LOW: 'Low value and not time-sensitive — ranks in the bottom tier.',
  MED: 'Mixed signals — ranks in the middle tier.',
};

/**
 * @param {object} signals
 * @param {'HIGH'|'MED'|'LOW'|null} [signals.value] - the Value radio choice
 * @param {boolean|null} [signals.timeCritical] - the Urgency yes/no choice
 * @returns {{ token: 'HIGH'|'MED'|'LOW'|null, band: 'HIGH'|'MED'|'LOW'|null,
 *             complete: boolean, reason: string }}
 */
export function scoreCod(signals) {
  const value = signals && VALUE_TOKENS.includes(signals.value) ? signals.value : null;
  const timeCritical =
    signals && typeof signals.timeCritical === 'boolean' ? signals.timeCritical : null;

  if (value === null || timeCritical === null) {
    return { token: null, band: null, complete: false, reason: '' };
  }

  const token =
    value === 'HIGH' && timeCritical === true
      ? 'HIGH'
      : value === 'LOW' && timeCritical === false
        ? 'LOW'
        : 'MED';

  return { token, band: token, complete: true, reason: REASONS[token] };
}
