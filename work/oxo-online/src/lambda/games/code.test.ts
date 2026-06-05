import { describe, it, expect } from 'vitest';
import { generateCode } from './code';

// Unambiguous (Crockford-style) alphabet: uppercase A-Z and 0-9 minus O,0,1,I,L.
const FORBIDDEN = ['O', '0', '1', 'I', 'L'];
const ALLOWED = /^[A-Z0-9]{6}$/;

describe('generateCode — share-code format (F2, S1)', () => {
  it('produces a 6-character uppercase alphanumeric code with no ambiguous chars', () => {
    for (let i = 0; i < 1000; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(ALLOWED);
      for (const ch of FORBIDDEN) {
        expect(code).not.toContain(ch);
      }
    }
  });

  it('only ever emits characters from the unambiguous alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      for (const ch of generateCode()) seen.add(ch);
    }
    for (const ch of seen) {
      expect(FORBIDDEN).not.toContain(ch);
      expect(/[A-Z0-9]/.test(ch)).toBe(true);
    }
  });
});
