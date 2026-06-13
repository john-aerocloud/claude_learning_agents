// @covers uc-s018-2
// @covers CodScorer
// UC-S018-2 — lib/codScorer.js: the PURE TOTAL deterministic value-token fn.
// AC-S018-2-4 + SCORE-S018-2-1..3. Authored FIRST (red→green), no DOM.
//
// Rule (verbatim from slice.md §2):
//   value===HIGH && timeCritical===true  → HIGH
//   value===LOW  && timeCritical===false → LOW
//   every other combination of CHOSEN values → MED
//   value===null OR timeCritical===null  → {token:null, band:null,
//                                            complete:false, reason:''}
//   (incomplete is NOT a defaulted MED — the FIG empty≠score guarantee at
//    the source; UC-S018-3 gates the rank preview on `complete`.)
import { describe, it, expect, vi } from 'vitest';
import { scoreCod } from '../codScorer.js';

describe('scoreCod (UC-S018-2 — pure total deterministic scorer)', () => {
  // ---- AC-S018-2-4: the full truth table over CHOSEN inputs ----------------
  it('HIGH value AND time-critical → token HIGH', () => {
    const s = scoreCod({ value: 'HIGH', timeCritical: true });
    expect(s.token).toBe('HIGH');
    expect(s.band).toBe('HIGH');
    expect(s.complete).toBe(true);
  });

  it('LOW value AND not time-critical → token LOW', () => {
    const s = scoreCod({ value: 'LOW', timeCritical: false });
    expect(s.token).toBe('LOW');
    expect(s.band).toBe('LOW');
    expect(s.complete).toBe(true);
  });

  it('every OTHER chosen combination → token MED (the four mixed cells)', () => {
    const medCells = [
      { value: 'HIGH', timeCritical: false },
      { value: 'MED', timeCritical: true },
      { value: 'MED', timeCritical: false },
      { value: 'LOW', timeCritical: true },
    ];
    for (const cell of medCells) {
      const s = scoreCod(cell);
      expect(s.token, JSON.stringify(cell)).toBe('MED');
      expect(s.band, JSON.stringify(cell)).toBe('MED');
      expect(s.complete, JSON.stringify(cell)).toBe(true);
    }
  });

  // ---- SCORE-S018-2-3: incomplete is null, never a defaulted MED -----------
  it('any null input → {token:null, band:null, complete:false, reason:""} — NOT MED', () => {
    const incompleteCells = [
      { value: null, timeCritical: null },
      { value: null, timeCritical: true },
      { value: null, timeCritical: false },
      { value: 'HIGH', timeCritical: null },
      { value: 'MED', timeCritical: null },
      { value: 'LOW', timeCritical: null },
    ];
    for (const cell of incompleteCells) {
      const s = scoreCod(cell);
      expect(s, JSON.stringify(cell)).toEqual({
        token: null,
        band: null,
        complete: false,
        reason: '',
      });
    }
  });

  // ---- SCORE-S018-2-1: the output shape (the UC-S018-3/4 contract) ---------
  it('SCORE-S018-2-1: returns exactly {token, band, complete, reason}; band === token; reason is a human sentence', () => {
    const scored = scoreCod({ value: 'HIGH', timeCritical: true });
    expect(Object.keys(scored).sort()).toEqual(['band', 'complete', 'reason', 'token']);
    expect(scored.band).toBe(scored.token);
    expect(typeof scored.reason).toBe('string');
    // reason carries the tier in operator language (the FIG readout + the
    // UC-S018-4 "value: … with reasoning" line read this verbatim)
    expect(scoreCod({ value: 'HIGH', timeCritical: true }).reason).toMatch(/top tier/i);
    expect(scoreCod({ value: 'LOW', timeCritical: false }).reason).toMatch(/bottom tier/i);
    expect(scoreCod({ value: 'MED', timeCritical: true }).reason).toMatch(/middle tier/i);
    // no enum jargon / broken values in any reason
    for (const cell of [
      { value: 'HIGH', timeCritical: true },
      { value: 'MED', timeCritical: false },
      { value: 'LOW', timeCritical: false },
    ]) {
      expect(scoreCod(cell).reason).not.toMatch(/undefined|null|NaN/);
    }
  });

  // ---- SCORE-S018-2-2: totality + purity ------------------------------------
  it('SCORE-S018-2-2: total — never throws, even for undefined/missing/garbage inputs', () => {
    expect(() => scoreCod({})).not.toThrow();
    expect(() => scoreCod({ value: undefined, timeCritical: undefined })).not.toThrow();
    expect(() => scoreCod({ value: 'BANANA', timeCritical: 'soon' })).not.toThrow();
    // undefined/garbage are NOT chosen values → incomplete, never a band
    expect(scoreCod({}).complete).toBe(false);
    expect(scoreCod({}).token).toBeNull();
    expect(scoreCod({ value: 'BANANA', timeCritical: true }).token).toBeNull();
  });

  it('SCORE-S018-2-2: pure — issues NO network call and touches no DOM', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    scoreCod({ value: 'HIGH', timeCritical: true });
    scoreCod({ value: null, timeCritical: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    // deterministic: same input → same (equal) output
    expect(scoreCod({ value: 'MED', timeCritical: true })).toEqual(
      scoreCod({ value: 'MED', timeCritical: true }),
    );
  });
});
