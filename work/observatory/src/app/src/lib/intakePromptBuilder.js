// UC-S018-4 — intakePromptBuilder: PURE total fn composing the wizard's
// captured JTBD + CoD + rank into a copy-ready /intake slash-command prompt
// string the operator hands to Claude. New work enters through the SAME
// human-accept gate as steer actions — never written by the UI.
//
// HEXAGONAL ROLE: domain logic. No DOM, no fetch, no SDK — the template is a
// static string (templates/intake-prompt.js) and this module only substitutes
// tokens. Sibling of lib/promptBuilder.js; REUSES the {{token}}-substitution
// discipline and the dash() unknown≠blank rule, and composeJobSentence so the
// /intake argument is IDENTICAL to the step-1 JobSentencePreview (author-once).
//
// CONTRACT (consumed by PromptStep on Generate — BUILD-S018-4-1..6):
//   buildIntakePrompt({ jtbd, codScore, cod, rank }) -> string
//   - the FIRST line is the /intake command with composeJobSentence(jtbd) as
//     the argument (AC-S018-4-3 / BUILD-S018-4-4);
//   - the value line carries codScore.token + codScore.reason (author-once with
//     the CodScoreReadout — BUILD-S018-4-5); incomplete → "not stated";
//   - the urgency/risk PROSE appears verbatim; empty optional prose → the word
//     "not stated" (reads as a sentence, never a broken slot — FIG-S018-4-1/2);
//   - the rank line is GATED (BUILD-S018-4-6 / FIG-S018-4-3): omitted when
//     rank==null||!complete (no fabricated rank); the empty-queue sentence when
//     rank.empty; else rank.sentence VERBATIM (author-once with step 3).
//
// TOTALITY: defined for empty JTBD fields, codScore.complete===false,
// rank===null, empty prose, and even no argument; never throws; no side effects
// (BUILD-S018-4-2). No {{token}} residue, no undefined/null/NaN, no raw refs
// ever reach the operator (FIG-S018-4-1/4).
import { INTAKE_PROMPT_TEMPLATE } from '../templates/intake-prompt.js';
import { composeJobSentence } from './jobSentence.js';

/** A non-empty trimmed string, else null. */
function str(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Optional PROSE: present text verbatim, else the human word "not stated" so
 * the prompt reads as a sentence (FIG-S018-4-1; never undefined/null/a dash). */
function prose(v) {
  return str(v) || 'not stated';
}

/**
 * The GATED "Queue rank" block — the whole line plus its trailing blank line,
 * or "" when there is no honest rank (BUILD-S018-4-6):
 *   - rank == null OR !complete → "" (line OMITTED — no fabricated rank);
 *   - rank.empty                → the empty-queue sentence VERBATIM;
 *   - else                      → rank.sentence VERBATIM (step-3 author-once).
 * @param {{complete?:boolean, empty?:boolean, sentence?:string}|null} rank
 * @returns {string}
 */
function rankBlock(rank) {
  if (!rank || rank.complete !== true) return '';
  const line = str(rank.sentence);
  if (!line) return '';
  return `Queue rank (read-only preview): ${line}\n\n`;
}

/**
 * @param {object} [input]
 * @param {{situation?:string, motivation?:string, outcome?:string}} [input.jtbd]
 * @param {{token?:string|null, reason?:string, complete?:boolean}} [input.codScore]
 * @param {{urgencyWhy?:string, riskOfDelay?:string}} [input.cod]
 * @param {{complete?:boolean, empty?:boolean, sentence?:string}|null} [input.rank]
 * @returns {string} the filled, copy-ready /intake prompt
 */
export function buildIntakePrompt(input = {}) {
  const jtbd = input.jtbd || {};
  const codScore = input.codScore || {};
  const cod = input.cod || {};
  const rank = input.rank ?? null;

  // The /intake argument IS the step-1 sentence (author-once). composeJobSentence
  // degrades empty fields to readable bracketed placeholders — never a grammar gap.
  const composed = composeJobSentence(jtbd);
  const jobSentence = composed.allEmpty ? 'When …, I want to …, so I can ….' : composed.text;

  // The value line: token + its author-once reason; incomplete → "not stated".
  const valueToken = codScore.complete === true ? str(codScore.token) || 'not stated' : 'not stated';
  const valueReason =
    codScore.complete === true ? str(codScore.reason) || 'not stated' : 'not stated';

  const tokens = {
    job_sentence: jobSentence,
    situation: prose(jtbd.situation),
    motivation: prose(jtbd.motivation),
    outcome: prose(jtbd.outcome),
    value_token: valueToken,
    value_reason: valueReason,
    urgency_why: prose(cod.urgencyWhy),
    risk_of_delay: prose(cod.riskOfDelay),
    rank_block: rankBlock(rank),
  };

  return INTAKE_PROMPT_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : 'not stated',
  );
}
