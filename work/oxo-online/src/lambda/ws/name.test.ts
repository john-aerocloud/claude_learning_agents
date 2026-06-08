import { describe, it, expect } from 'vitest';
import { normaliseName, NAME_STRIP_REGEX } from './name';

// @covers domain-name-normalise (ws guest arm) — MUST stay identical to the
// games/ host arm (T-LB-2). The regex pin below guards against divergence.

describe('ws normaliseName — same contract as the host path (T-LB-2)', () => {
  it('clean name passes through', () => {
    expect(normaliseName('BEE')).toBe('BEE');
  });
  it('blank/omitted/non-string -> AAA (SM-3)', () => {
    expect(normaliseName('')).toBe('AAA');
    expect(normaliseName('   ')).toBe('AAA');
    expect(normaliseName(undefined)).toBe('AAA');
    expect(normaliseName(99 as unknown as string)).toBe('AAA');
  });
  it('truncates to 10 chars', () => {
    expect(normaliseName('TOOLONGNAME123')).toBe('TOOLONGNAM');
  });
  it('strips < > & " \' and control chars', () => {
    const out = normaliseName('<b>x</b>');
    for (const ch of ['<', '>', '&', '"', "'"]) expect(out).not.toContain(ch);
    expect(normaliseName('A\tB\nC')).toBe('ABC');
  });
  it('all-disallowed -> AAA', () => {
    expect(normaliseName('<<<>>>')).toBe('AAA');
  });
  it('pins the exact strip regex (must equal the host path)', () => {
    expect(NAME_STRIP_REGEX.source).toBe('[^A-Za-z0-9 ._-]');
    expect(NAME_STRIP_REGEX.flags).toBe('g');
  });
});
