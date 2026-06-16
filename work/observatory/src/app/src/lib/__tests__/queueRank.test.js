// @covers uc-s018-3
// @covers queueRank
// @covers rankPreview
// @covers isComparisonItem
// @covers normaliseTier
// UC-S018-3 — the pure directional-rank domain fn. No DOM, no fetch, total,
// never throws. Pins the RANK-S018-3-1..6 output contract + the FIG sentence
// composer + the exported comparison-set predicate and tier normaliser.
import { describe, it, expect, vi } from 'vitest';
import { rankPreview, isComparisonItem, normaliseTier } from '../queueRank.js';

// A fixed backlog fixture in the live items.csv §4 string shape. Six non-terminal
// rows (2 HIGH, 1 MED-HIGH, 1 MED, 1 blank-value, 1 LOW) + 2 terminal that must
// NEVER count (1 done, 1 dropped).
const BACKLOG = [
  { id: 'A', state: 'planned', value: 'HIGH' },
  { id: 'B', state: 'in-flight', value: 'HIGH' },
  { id: 'C', state: 'active', value: 'MED-HIGH' },
  { id: 'D', state: 'unconfirmed', value: 'MED' },
  { id: 'E', state: 'planned', value: '' }, // blank → MED-equivalent (2)
  { id: 'F', state: 'planned', value: 'LOW' },
  { id: 'G', state: 'done', value: 'HIGH' }, // terminal — excluded
  { id: 'H', state: 'dropped', value: 'LOW' }, // terminal — excluded
];

describe('normaliseTier (RANK-S018-3-6 — total tier→ordinal map)', () => {
  it('maps the canonical tiers HIGH=3 / MED=2 / LOW=1', () => {
    expect(normaliseTier('HIGH')).toBe(3);
    expect(normaliseTier('MED')).toBe(2);
    expect(normaliseTier('LOW')).toBe(1);
  });
  it('maps the real-data MED-HIGH intermediate to 2.5 (between MED and HIGH)', () => {
    expect(normaliseTier('MED-HIGH')).toBe(2.5);
    expect(normaliseTier('MED-HIGH')).toBeGreaterThan(normaliseTier('MED'));
    expect(normaliseTier('MED-HIGH')).toBeLessThan(normaliseTier('HIGH'));
  });
  it('maps blank/unknown to the MED-equivalent ordinal (2) — NOT 0, NOT dropped', () => {
    expect(normaliseTier('')).toBe(2);
    expect(normaliseTier(undefined)).toBe(2);
    expect(normaliseTier(null)).toBe(2);
    expect(normaliseTier('WHATEVER')).toBe(2);
  });
  it('is case-insensitive on the canonical tiers (real csv is upper, be defensive)', () => {
    expect(normaliseTier('high')).toBe(3);
    expect(normaliseTier('med-high')).toBe(2.5);
  });
});

describe('isComparisonItem (RANK-S018-3-5 — non-terminal predicate)', () => {
  it('INCLUDES planned|unconfirmed|in-flight|active', () => {
    for (const state of ['planned', 'unconfirmed', 'in-flight', 'active']) {
      expect(isComparisonItem({ state })).toBe(true);
    }
  });
  it('EXCLUDES done and dropped (terminal)', () => {
    expect(isComparisonItem({ state: 'done' })).toBe(false);
    expect(isComparisonItem({ state: 'dropped' })).toBe(false);
  });
  it('is total — null/garbage record is not a comparison item, never throws', () => {
    expect(isComparisonItem(null)).toBe(false);
    expect(isComparisonItem({})).toBe(false);
    expect(isComparisonItem({ state: 'WHO-KNOWS' })).toBe(false);
  });
});

describe('rankPreview shape + totality (RANK-S018-3-1/2)', () => {
  it('returns the full RankPreview shape with correct types', () => {
    const r = rankPreview({ token: 'HIGH', items: BACKLOG });
    expect(r).toEqual(
      expect.objectContaining({
        complete: expect.any(Boolean),
        total: expect.any(Number),
        ahead: expect.any(Number),
        behind: expect.any(Number),
        alongside: expect.any(Number),
        sentence: expect.any(String),
        empty: expect.any(Boolean),
      }),
    );
    expect(['HIGH', 'MED', 'LOW', null]).toContain(r.token);
  });
  it('is pure — issues NO fetch (RANK-S018-3-2)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    rankPreview({ token: 'HIGH', items: BACKLOG });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('never throws on garbage input (total)', () => {
    expect(() => rankPreview({ token: 'HIGH', items: null })).not.toThrow();
    expect(() => rankPreview({ token: 'XYZ', items: [{ junk: 1 }] })).not.toThrow();
    expect(() => rankPreview({})).not.toThrow();
    expect(() => rankPreview(null)).not.toThrow();
  });
});

describe('rankPreview gated case (RANK-S018-3-3 — token null → no rank)', () => {
  it('token===null → complete:false, sentence:"", all counts 0', () => {
    const r = rankPreview({ token: null, items: BACKLOG });
    expect(r.complete).toBe(false);
    expect(r.sentence).toBe('');
    expect(r.total).toBe(0);
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(0);
    expect(r.alongside).toBe(0);
    expect(r.token).toBe(null);
  });
});

describe('rankPreview comparison set (RANK-S018-3-5 — non-terminal only)', () => {
  it('total === count of non-terminal items in the fixture (6, NOT 8)', () => {
    const r = rankPreview({ token: 'HIGH', items: BACKLOG });
    expect(r.total).toBe(6);
  });
  it('adding a done/dropped row does NOT change total', () => {
    const base = rankPreview({ token: 'MED', items: BACKLOG }).total;
    const withTerminal = rankPreview({
      token: 'MED',
      items: [...BACKLOG, { id: 'Z1', state: 'done', value: 'HIGH' }, { id: 'Z2', state: 'dropped', value: 'MED' }],
    }).total;
    expect(withTerminal).toBe(base);
  });
});

describe('rankPreview directional counts + add-up invariant (RANK-S018-3-4/6, AC-S018-3-1)', () => {
  // Comparison ordinals: A=3 B=3 C=2.5 D=2 E=2 F=1.
  it('HIGH token (3): ahead 0, behind 4 (C,D,E,F), alongside 2 (A,B)', () => {
    const r = rankPreview({ token: 'HIGH', items: BACKLOG });
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(4);
    expect(r.alongside).toBe(2);
    expect(r.ahead + r.behind + r.alongside).toBe(r.total);
  });
  it('LOW token (1): ahead 5 (A,B,C,D,E), behind 0, alongside 1 (F)', () => {
    const r = rankPreview({ token: 'LOW', items: BACKLOG });
    expect(r.ahead).toBe(5);
    expect(r.behind).toBe(0);
    expect(r.alongside).toBe(1);
    expect(r.ahead + r.behind + r.alongside).toBe(r.total);
  });
  it('MED token (2): MED-HIGH(C) AND the two HIGH(A,B) rank ahead; LOW(F) behind; the blank(E) is alongside (RANK-S018-3-6)', () => {
    const r = rankPreview({ token: 'MED', items: BACKLOG });
    // ahead: A(3) B(3) C(2.5) = 3 ; behind: F(1) = 1 ; alongside: D(2) E(2) = 2
    expect(r.ahead).toBe(3);
    expect(r.behind).toBe(1);
    expect(r.alongside).toBe(2);
    expect(r.ahead + r.behind + r.alongside).toBe(r.total);
  });
});

describe('rankPreview empty queue (RANK / AC-S018-3-4)', () => {
  it('items===[] → empty:true, total 0, the empty-queue sentence, NOT "ahead of 0"', () => {
    const r = rankPreview({ token: 'HIGH', items: [] });
    expect(r.empty).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.total).toBe(0);
    expect(r.sentence).toMatch(/queue is currently empty/i);
    expect(r.sentence).toMatch(/would be next/i);
    expect(r.sentence).not.toMatch(/ahead of 0/i);
  });
  it('a backlog of ONLY terminal items reads as empty (no competing items)', () => {
    const r = rankPreview({
      token: 'HIGH',
      items: [{ id: 'G', state: 'done', value: 'HIGH' }, { id: 'H', state: 'dropped', value: 'LOW' }],
    });
    expect(r.empty).toBe(true);
    expect(r.total).toBe(0);
    expect(r.sentence).toMatch(/queue is currently empty/i);
  });
});

describe('rankPreview sentence composer (FIG-S018-3-1/2/4)', () => {
  it('populated: tier WORD ("HIGH value"), "ahead of"/"behind", the unit "items"; no undefined/null/NaN; no raw ids', () => {
    const r = rankPreview({ token: 'MED', items: BACKLOG });
    expect(r.sentence).toMatch(/MED value/);
    expect(r.sentence).toMatch(/ahead of/i);
    expect(r.sentence).toMatch(/behind/i);
    expect(r.sentence).toMatch(/items/i);
    expect(r.sentence).not.toMatch(/undefined|null|NaN/);
    // FIG-S018-3-2: no raw machine ids in the primary sentence
    expect(r.sentence).not.toMatch(/\b[A-Z]{2,}-S?\d/); // e.g. UC-S018-x style
  });
  it('surfaces same-tier peers as "alongside N" when alongside > 0 (counts never silently dropped)', () => {
    const r = rankPreview({ token: 'HIGH', items: BACKLOG }); // alongside 2
    expect(r.alongside).toBe(2);
    expect(r.sentence).toMatch(/alongside 2/i);
  });
  it('LOW token reads with the LOW word and a near-the-bottom placement hint', () => {
    const r = rankPreview({ token: 'LOW', items: BACKLOG });
    expect(r.sentence).toMatch(/LOW value/);
    expect(r.sentence).toMatch(/bottom/i);
  });
  it('HIGH token with everything behind reads near-the-top', () => {
    const r = rankPreview({ token: 'HIGH', items: [{ id: 'F', state: 'planned', value: 'LOW' }] });
    expect(r.sentence).toMatch(/HIGH value/);
    expect(r.sentence).toMatch(/top/i);
    expect(r.sentence).toMatch(/behind 1 item/i); // singular unit reads right
  });
});
