import { describe, it, expect } from 'vitest';
import { normaliseName, NAME_STRIP_REGEX } from './name';

// @covers domain-name-normalise (server-side arm)
// R1.5/R1.6 — the write-side half of the stored-XSS control (§8). The name is
// normalised ONCE, server-side, at the API boundary on BOTH paths (game-fn
// create, ws-fn join) BEFORE it reaches the durable store. Pins the exact
// regex (T-LB-2). Play is NEVER blocked over a name — violations are
// stripped/truncated, never rejected (arcade UX, SM-3).

describe('normaliseName — happy + default (T-LB-2, SM-3)', () => {
  it('passes a clean short name through unchanged', () => {
    expect(normaliseName('ACE')).toBe('ACE');
  });

  it('empty -> AAA', () => {
    expect(normaliseName('')).toBe('AAA');
  });

  it('whitespace-only -> AAA', () => {
    expect(normaliseName('   ')).toBe('AAA');
  });

  it('undefined/omitted -> AAA', () => {
    expect(normaliseName(undefined)).toBe('AAA');
  });

  it('non-string -> AAA (defensive — a planted number/object is not a name)', () => {
    expect(normaliseName(42 as unknown as string)).toBe('AAA');
    expect(normaliseName({} as unknown as string)).toBe('AAA');
  });
});

describe('normaliseName — length bound <=10 (T-LB-2)', () => {
  it('truncates a >10-char name to 10 chars', () => {
    expect(normaliseName('TOOLONGNAME123')).toBe('TOOLONGNAM');
  });

  it('keeps exactly 10 chars', () => {
    expect(normaliseName('ABCDEFGHIJ')).toBe('ABCDEFGHIJ');
  });
});

describe('normaliseName — charset bound strips injection chars (§8 write-side, T-LB-2)', () => {
  it('strips < > & " \' and the result has none of them', () => {
    const out = normaliseName('<img src=x>');
    for (const ch of ['<', '>', '&', '"', "'"]) {
      expect(out).not.toContain(ch);
    }
  });

  it('strips control chars (tab/newline are not in the safe set)', () => {
    const out = normaliseName('A\tB\nC');
    expect(out).toBe('ABC');
  });

  it('keeps the safe set and applies strip->trim-><=10->blank order', () => {
    // strip removes the markup; trim removes the leading/trailing space; result
    // is "imgsrc x" (<= 10), not blank -> not defaulted.
    expect(normaliseName('  <img>src x  ')).toBe('imgsrc x');
  });

  it('a name that is ALL disallowed chars -> stripped to blank -> AAA', () => {
    expect(normaliseName('<<<>>>')).toBe('AAA');
  });

  it('pins the exact strip regex', () => {
    expect(NAME_STRIP_REGEX.source).toBe('[^A-Za-z0-9 ._-]');
    expect(NAME_STRIP_REGEX.flags).toBe('g');
  });
});
