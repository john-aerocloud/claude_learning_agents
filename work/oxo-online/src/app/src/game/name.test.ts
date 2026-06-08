import { describe, it, expect } from 'vitest';
import { normaliseName, DEFAULT_NAME } from './name';

/**
 * @covers domain-name-normalise (SPA arm)
 *
 * R1.1 — the pure client-side name normaliser. Shared SHAPE with the backend
 * normaliser (the server re-normalises authoritatively, R1.5/R1.6) but the SPA
 * carries its own copy because the app tree cannot import from src/lambda. The
 * pinned transform is: charset-strip `/[^A-Za-z0-9 ._-]/g` → trim → ≤10 chars →
 * blank → "AAA". This is the WRITE-SIDE half of the stored-XSS defence (§8): the
 * value the SPA threads into POST /api/games and the WS join frame is already
 * stripped of `< > & " '` and control chars. (AC1.3, AC1.4, AC1.5, T-LB-2.)
 */
describe('normaliseName — pinned transform (R1.1)', () => {
  it('passes a clean name through unchanged', () => {
    expect(normaliseName('ACE')).toBe('ACE');
  });

  it('defaults empty to "AAA"', () => {
    expect(normaliseName('')).toBe(DEFAULT_NAME);
    expect(DEFAULT_NAME).toBe('AAA');
  });

  it('defaults all-whitespace to "AAA"', () => {
    expect(normaliseName('   ')).toBe('AAA');
  });

  it('truncates to 10 chars (after strip + trim)', () => {
    // "TOOLONGNAME123" is charset-clean → trim → first 10 chars.
    expect(normaliseName('TOOLONGNAME123')).toBe('TOOLONGNAM');
  });

  it('strips markup/control chars; keeps spaces (XSS write-side bound)', () => {
    // The pinned charset /[^A-Za-z0-9 ._-]/g removes < > & " ' = but KEEPS
    // spaces. "<img src=x>" → "img srcx" (internal space retained, ≤10).
    expect(normaliseName('<img src=x>')).toBe('img srcx');
    expect(normaliseName('<img src=x>')).not.toMatch(/[<>&"']/);
  });

  it('keeps the allowed punctuation set . _ -', () => {
    expect(normaliseName('a.b_c-d')).toBe('a.b_c-d');
  });

  it('treats a string that strips to blank as "AAA"', () => {
    expect(normaliseName('<<>>&&')).toBe('AAA');
  });

  it('strips control chars (tab/newline) but keeps a regular space', () => {
    expect(normaliseName('A\tB\nC')).toBe('ABC');
    expect(normaliseName('A B C')).toBe('A B C');
  });
});
