// @covers uc-s015-3
// @covers UseReslicePreview
// UC-S015-3 — useReslicePreview(): PURE LOCAL state for the After column of
// the ReslicePreviewPanel (ui-design.md state-shape contract, consumed by
// UC-S015-4's enriched buildPrompt).
//
// Pins:
//   - initial state: partAJob / partBJob / intentNote all '' (empty)
//   - setters update their field and nothing else
//   - canGenerate flips TRUE only when ALL THREE fields are non-empty
//     (F-S3-4 / S15-3-A11Y-3 guard — stricter than the s014 one-field guard)
//   - costNote is null until BOTH parts are non-empty, then the directional
//     sentence (S15-3-FIG-3: an unfilled split is NOT a generated proposal)
//   - NO server calls: the hook touches no fetch/EventSource — pure local
//     state (RESLICE-PREVIEW-1 upstream guard)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/preact';
import { useReslicePreview, RESLICE_COST_NOTE } from '../useReslicePreview.js';

/** Harness: render the hook and expose its state via the DOM + a probe ref. */
function Harness({ probe }) {
  const state = useReslicePreview();
  probe.current = state;
  return (
    <div>
      <output data-testid="can-generate">{String(state.canGenerate)}</output>
      <output data-testid="cost-note">{state.costNote === null ? 'NULL' : state.costNote}</output>
    </div>
  );
}

function setup() {
  const probe = { current: null };
  render(<Harness probe={probe} />);
  /** Apply a mutation to the CURRENT hook state inside act (sync re-render). */
  const apply = (fn) => act(() => { fn(probe.current); });
  return { probe, apply };
}

describe('useReslicePreview (UC-S015-3)', () => {
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('starts empty: parts + intent are "", canGenerate false, costNote null', () => {
    const { probe } = setup();
    expect(probe.current.partAJob).toBe('');
    expect(probe.current.partBJob).toBe('');
    expect(probe.current.intentNote).toBe('');
    expect(probe.current.canGenerate).toBe(false);
    expect(probe.current.costNote).toBeNull();
  });

  it('setters update exactly their own field', () => {
    const { probe, apply } = setup();
    apply((s) => s.setPartAJob('Part A delivers the read path'));
    expect(probe.current.partAJob).toBe('Part A delivers the read path');
    expect(probe.current.partBJob).toBe('');
    expect(probe.current.intentNote).toBe('');

    apply((s) => s.setPartBJob('Part B delivers the write path'));
    expect(probe.current.partBJob).toBe('Part B delivers the write path');
    expect(probe.current.partAJob).toBe('Part A delivers the read path');

    apply((s) => s.setIntentNote('too big for one slice'));
    expect(probe.current.intentNote).toBe('too big for one slice');
  });

  it('canGenerate is FALSE for every partial fill — flips TRUE only when all three are non-empty (F-S3-4)', () => {
    const { probe, apply } = setup();
    const cases = [
      ['a', '', ''],
      ['', 'b', ''],
      ['', '', 'c'],
      ['a', 'b', ''],
      ['a', '', 'c'],
      ['', 'b', 'c'],
    ];
    for (const [a, b, i] of cases) {
      apply((s) => s.setPartAJob(a));
      apply((s) => s.setPartBJob(b));
      apply((s) => s.setIntentNote(i));
      expect(probe.current.canGenerate, `a="${a}" b="${b}" i="${i}"`).toBe(false);
    }
    apply((s) => s.setPartAJob('a'));
    apply((s) => s.setPartBJob('b'));
    apply((s) => s.setIntentNote('c'));
    expect(probe.current.canGenerate).toBe(true);
    expect(screen.getByTestId('can-generate').textContent).toBe('true');
    // emptying ANY field re-guards
    apply((s) => s.setIntentNote(''));
    expect(probe.current.canGenerate).toBe(false);
  });

  it('costNote is null until BOTH parts are non-empty; intent does not gate it (S15-3-FIG-3)', () => {
    const { probe, apply } = setup();
    expect(probe.current.costNote).toBeNull();
    apply((s) => s.setPartAJob('only part A'));
    expect(probe.current.costNote).toBeNull();
    apply((s) => s.setPartAJob(''));
    apply((s) => s.setPartBJob('only part B'));
    expect(probe.current.costNote).toBeNull();
    apply((s) => s.setPartAJob('part A'));
    expect(probe.current.costNote).toBe(RESLICE_COST_NOTE);
    expect(screen.getByTestId('cost-note').textContent).toBe(RESLICE_COST_NOTE);
    // the note is directional human text, not a number/placeholder
    expect(RESLICE_COST_NOTE).toMatch(/smaller than the original/i);
  });

  it('makes NO server calls — pure local state (RESLICE-PREVIEW-1)', () => {
    const { apply } = setup();
    apply((s) => s.setPartAJob('a'));
    apply((s) => s.setPartBJob('b'));
    apply((s) => s.setIntentNote('c'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
