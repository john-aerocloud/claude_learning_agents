// @covers uc-s018-1
// @covers JobSentencePreview
// UC-S018-1 — composeJobSentence: the PURE domain rule that assembles the live
// job sentence from the three JTBD fields (FIG-S018-1-1/2/3 contract).
//
// HEXAGONAL: domain logic, zero DOM/SDK imports. The JobSentencePreview render
// layer consumes the segment list verbatim; these tests pin the grammar rules
// so the preview can never read "undefined" or a broken skeleton.
import { describe, it, expect } from 'vitest';
import {
  composeJobSentence,
  EMPTY_SENTENCE_PROMPT,
} from '../jobSentence.js';

describe('composeJobSentence (UC-S018-1 FIG contract)', () => {
  it('FIG-S018-1-1: all three filled → the exact human template, no raw concat artifacts', () => {
    const r = composeJobSentence({
      situation: 'the loop starves because no UI work is queued',
      motivation: 'see which queue is empty at a glance',
      outcome: 'replenish before the constraint goes idle',
    });
    expect(r.allEmpty).toBe(false);
    expect(r.text).toBe(
      'When the loop starves because no UI work is queued, I want to see which queue is empty at a glance, so I can replenish before the constraint goes idle.',
    );
    expect(r.text).not.toMatch(/undefined|null|\[object Object\]/);
  });

  it('FIG-S018-1-2: one field empty → grammatical sentence with a readable placeholder slot (never "undefined", never "When ,")', () => {
    const r = composeJobSentence({
      situation: '',
      motivation: 'see which queue is empty',
      outcome: 'replenish in time',
    });
    expect(r.allEmpty).toBe(false);
    expect(r.text).not.toMatch(/undefined|null/);
    expect(r.text).not.toMatch(/When\s*,/); // no grammar-breaking empty gap
    // the empty slot renders as a marked placeholder segment
    const placeholders = r.segments.filter((s) => s.kind === 'placeholder');
    expect(placeholders.length).toBe(1);
    expect(placeholders[0].text.length).toBeGreaterThan(0);
    // filled slots are marked filled
    expect(r.segments.filter((s) => s.kind === 'filled').length).toBe(2);
    // still the full template shape
    expect(r.text).toMatch(/^When .*, I want to .*, so I can .*\.$/);
  });

  it('FIG-S018-1-2: two fields empty → still a readable sentence, two placeholder slots', () => {
    const r = composeJobSentence({ situation: 'a build fails', motivation: '', outcome: '' });
    expect(r.text).not.toMatch(/undefined|null/);
    expect(r.segments.filter((s) => s.kind === 'placeholder').length).toBe(2);
    expect(r.text).toMatch(/^When a build fails, I want to .*, so I can .*\.$/);
  });

  it('FIG-S018-1-3: all empty → allEmpty (the render layer shows the neutral starter line, not a skeleton)', () => {
    const r = composeJobSentence({ situation: '', motivation: '', outcome: '' });
    expect(r.allEmpty).toBe(true);
    expect(EMPTY_SENTENCE_PROMPT).toMatch(/start typing/i);
  });

  it('whitespace-only input counts as empty (trimmed)', () => {
    const r = composeJobSentence({ situation: '   ', motivation: '\t', outcome: ' ' });
    expect(r.allEmpty).toBe(true);
  });

  it('is total: undefined/missing fields never leak the literal "undefined"', () => {
    const r = composeJobSentence({});
    expect(r.allEmpty).toBe(true);
    const r2 = composeJobSentence({ motivation: 'do x' });
    expect(r2.text).not.toMatch(/undefined/);
    expect(r2.text).toMatch(/I want to do x/);
  });
});
