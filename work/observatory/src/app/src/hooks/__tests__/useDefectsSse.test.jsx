// @covers uc-s013-4
// @covers SPA_DEFECTSHOOK
// UC-S013-4 — useDefects SSE extension (S13-4-SSE-1/2, analogous to
// S14-4-SSE-1/2): the hook gains a debounced subscribeEvents → refresh,
// mirroring the delivered useWipItems / useSteerContext pattern. Pins:
//   - S13-4-SSE-1: a relevant change frame re-fetches and the list reflects
//     the new defect set (AC-S013-4-1 add / AC-S013-4-2 remove data paths);
//   - RELEVANT paths are defects/*.md AND ledger.csv (MTTR is a ledger join —
//     a recovery row landing must refresh the list; this differs from the
//     steer hook, which is items.csv-only);
//   - irrelevant paths (items.csv, slice.md, null) do NOT re-fetch;
//   - a burst of frames debounces into ONE re-fetch (S13-2-A11Y-7
//     announce-once data path for the polite count live region);
//   - the refresh is IN-PLACE: status stays 'ready' with the OLD list while
//     the re-fetch is in flight (no loading flash — the panel never remounts,
//     so heading focus is not stolen);
//   - S13-4-SSE-2 fail-soft: subscribe throwing (jsdom has no EventSource)
//     leaves the hook on static data, no crash;
//   - unsubscribe is called on unmount (no orphan SSE listeners).
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { useDefects } from '../useDefects.js';

const REC = (over = {}) => ({
  id: 'DEFECT-001',
  title: 'UI shows 0 for everything while work is happening',
  status: 'CLOSED',
  severity: 'HIGH',
  mttr_s: 815,
  ...over,
});

/** Mount the hook with injected loaders/subscribe; expose the latest return. */
function mountHook(opts) {
  const out = { current: null };
  function Probe() {
    out.current = useDefects(opts);
    return null;
  }
  const utils = render(<Probe />);
  return { out, utils };
}

describe('useDefects — SSE refresh (UC-S013-4, S13-4-SSE-1)', () => {
  it('re-fetches on a defects/*.md change frame; an ADDED record surfaces (AC-S013-4-1 data path)', async () => {
    let onChange;
    let rows = [REC()];
    const loadDefects = vi.fn(() => Promise.resolve(rows));
    const { out } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.defects).toHaveLength(1);

    rows = [REC(), REC({ id: 'DEFECT-011', status: 'CONFIRMED', mttr_s: null })];
    onChange({ type: 'change', path: 'work/demo/defects/DEFECT-011-test.md' });
    await waitFor(() => expect(out.current.defects).toHaveLength(2));
    expect(out.current.openCount).toBe(1);
    expect(loadDefects).toHaveBeenCalledTimes(2);
  });

  it('re-fetches on a ledger.csv frame too — MTTR is a ledger join, a recovery row must surface', async () => {
    let onChange;
    let rows = [REC({ status: 'CONFIRMED', mttr_s: null })];
    const loadDefects = vi.fn(() => Promise.resolve(rows));
    const { out } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.defects[0].mttrText).toBe('open');

    rows = [REC()]; // recovery landed: CLOSED, mttr_s 815
    onChange({ type: 'change', path: 'process/dora/ledger.csv' });
    await waitFor(() => expect(out.current.defects[0].mttrText).toBe('13 min'));
    expect(loadDefects).toHaveBeenCalledTimes(2);
  });

  it('a REMOVED record shrinks the list (AC-S013-4-2 data path — unlink frame)', async () => {
    let onChange;
    let rows = [REC(), REC({ id: 'DEFECT-011', status: 'CONFIRMED', mttr_s: null })];
    const loadDefects = vi.fn(() => Promise.resolve(rows));
    const { out } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.defects).toHaveLength(2));

    rows = [REC()];
    onChange({ type: 'change', path: 'work/demo/defects/DEFECT-011-test.md' });
    await waitFor(() => expect(out.current.defects).toHaveLength(1));
    expect(out.current.openCount).toBe(0);
  });

  it('ignores irrelevant change frames (items.csv / slice.md / null) — defects md + ledger only', async () => {
    let onChange;
    const loadDefects = vi.fn(() => Promise.resolve([REC()]));
    const { out } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    onChange({ type: 'change', path: 'work/demo/items/items.csv' });
    onChange({ type: 'change', path: 'work/demo/slices/s004/slice.md' });
    onChange({ type: 'change', path: 'work/demo/defects/notes.txt' });
    onChange(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(loadDefects).toHaveBeenCalledTimes(1);
  });

  it('debounces a burst of frames into ONE re-fetch (S13-2-A11Y-7 announce-once data path)', async () => {
    let onChange;
    const loadDefects = vi.fn(() => Promise.resolve([REC()]));
    const { out } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 10,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    onChange({ type: 'change', path: 'work/demo/defects/DEFECT-011-a.md' });
    onChange({ type: 'change', path: 'work/demo/defects/DEFECT-011-a.md' });
    onChange({ type: 'change', path: 'process/dora/ledger.csv' });
    await new Promise((r) => setTimeout(r, 40));
    expect(loadDefects).toHaveBeenCalledTimes(2); // initial + ONE debounced refresh
  });

  it('refreshes IN PLACE: status stays ready with the old list while the re-fetch is in flight (no loading flash)', async () => {
    let onChange;
    let resolveSecond;
    let call = 0;
    const loadDefects = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve([REC()]);
      return new Promise((res) => { resolveSecond = res; });
    });
    const { out } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));

    onChange({ type: 'change', path: 'work/demo/defects/DEFECT-001-x.md' });
    await waitFor(() => expect(loadDefects).toHaveBeenCalledTimes(2));
    // in-flight: NO loading flash — old list still displayed
    expect(out.current.status).toBe('ready');
    expect(out.current.defects).toHaveLength(1);

    resolveSecond([REC(), REC({ id: 'DEFECT-002' })]);
    await waitFor(() => expect(out.current.defects).toHaveLength(2));
    expect(out.current.status).toBe('ready');
  });
});

describe('useDefects — SSE fail-soft (S13-4-SSE-2)', () => {
  it('subscribe throwing (no EventSource in jsdom) → static data, no crash', async () => {
    const { out } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects: () => Promise.resolve([REC()]),
      subscribe: () => { throw new Error('EventSource is not defined'); },
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.defects[0].id).toBe('DEFECT-001');
  });

  it('unsubscribes on unmount (no orphan SSE listener)', async () => {
    const unsubscribe = vi.fn();
    const { out, utils } = mountHook({
      loadActive: () => Promise.resolve('demo'),
      loadDefects: () => Promise.resolve([REC()]),
      subscribe: () => unsubscribe,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    utils.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
