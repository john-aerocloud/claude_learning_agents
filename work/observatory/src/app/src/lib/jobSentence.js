// UC-S018-1 — composeJobSentence: the pure domain rule assembling the live
// JTBD job sentence from the three intake fields.
//
// HEXAGONAL ROLE: domain logic — zero DOM / SDK / transport imports. The
// JobSentencePreview render layer (IntakeWizard.jsx) consumes the segment
// list verbatim and only adds styling.
//
// FIG contract (acceptance FIG-S018-1-1/2/3):
//   - all filled  → "When <s>, I want to <m>, so I can <o>." — the exact
//     human template, never a raw concatenation.
//   - some empty  → the sentence stays grammatical; each empty slot renders a
//     readable bracketed placeholder, NEVER "undefined"/"null"/an empty gap.
//   - all empty   → allEmpty:true; the render layer shows the neutral starter
//     line (EMPTY_SENTENCE_PROMPT), not a placeholder-filled skeleton.

/** Readable per-slot placeholders for empty fields (bracketed so the operator
 * can SEE which slots are still empty; the render layer dims them). */
export const JTBD_SLOT_PLACEHOLDERS = {
  situation: '[something happens]',
  motivation: '[do something]',
  outcome: '[reach an outcome]',
};

/** The all-empty neutral prompt line (FIG-S018-1-3). */
export const EMPTY_SENTENCE_PROMPT = 'Start typing to build your job sentence';

/**
 * @param {{situation?: string, motivation?: string, outcome?: string}} [fields]
 * @returns {{allEmpty: boolean, segments: Array<{text: string, kind: 'literal'|'filled'|'placeholder'}>, text: string}}
 */
export function composeJobSentence(fields = {}) {
  const trim = (v) => (typeof v === 'string' ? v.trim() : '');
  const s = trim(fields.situation);
  const m = trim(fields.motivation);
  const o = trim(fields.outcome);
  if (!s && !m && !o) return { allEmpty: true, segments: [], text: '' };

  const slot = (value, key) =>
    value
      ? { text: value, kind: 'filled' }
      : { text: JTBD_SLOT_PLACEHOLDERS[key], kind: 'placeholder' };
  const literal = (text) => ({ text, kind: 'literal' });

  const segments = [
    literal('When '),
    slot(s, 'situation'),
    literal(', I want to '),
    slot(m, 'motivation'),
    literal(', so I can '),
    slot(o, 'outcome'),
    literal('.'),
  ];
  return {
    allEmpty: false,
    segments,
    text: segments.map((seg) => seg.text).join(''),
  };
}
