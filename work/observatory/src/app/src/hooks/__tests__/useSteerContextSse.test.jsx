// @covers uc-s014-4
// @covers useSteerContext
// UC-S014-4 — useSteerContext SSE extension (S14-4-SSE-1/2): the hook gains a
// debounced subscribeEvents → refresh, mirroring the delivered useWipItems
// pattern. Pins:
//   - S14-4-SSE-1: a relevant change frame (items.csv) re-fetches and the
//     context reflects the new row values;
//   - the refresh is IN-PLACE: status stays 'ready' with the OLD context while
//     the re-fetch is in flight (no loading-skeleton flash — GEO-S014-4-4
//     upstream guard); a `refreshing` flag is exposed for the ContextRefreshCue;
//   - a burst of frames debounces into ONE re-fetch (A11Y-8 announce-once
//     data path);
//   - an irrelevant path (ledger.csv, slice.md) does NOT re-fetch — the steer
//     context reads items.csv only;
//   - S14-4-SSE-2 fail-soft: subscribe throwing (jsdom has no EventSource)
//     leaves the hook on static data, no crash;
//   - unsubscribe is called on unmount (no orphan SSE listeners).
// The returned contract stays {status, context} + the ADDITIVE `refreshing`
// flag (ui-design state-shape note: shape unchanged, derived flag allowed).
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { useSteerContext } from '../useSteerContext.js';

const ROW_V1 = {
  id: 'CHK-5',
  job: 'Compose a structured preview-first prompt',
  state: 'planned',
  value: 'HIGH',
  cost: 'M',
};
const ROW_V2 = { ...ROW_V1, state: 'in-progress', value: 'MED' };

/** Mount the hook with injected loaders/subscribe; expose the latest return. */
function mountHook(opts) {
  const out = { current: null };
  function Probe() {
    out.current = useSteerContext('CHK-5', opts);
    return null;
  }
  const utils = render(<Probe />);
  return { out, utils };
}

describe('useSteerContext — SSE refresh (UC-S014-4, S14-4-SSE-1)', () => {
  it('re-fetches on a relevant items.csv change frame and surfaces the new context', async () => {
    let onChange;
    let rows = [ROW_V1];
    const loadItems = vi.fn(() => Promise.resolve(rows));
    const { out } = mountHook({
      project: 'demo',
      loadItems,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.context.state).toBe('planned');

    rows = [ROW_V2];
    onChange({ type: 'change', path: 'work/demo/items/items.csv' });
    await waitFor(() => expect(out.current.context.state).toBe('in-progress'));
    expect(out.current.context.value).toBe('MED');
    expect(loadItems).toHaveBeenCalledTimes(2);
  });

  it('refreshes IN PLACE: status stays ready with the old context while the re-fetch is in flight, and `refreshing` is exposed', async () => {
    let onChange;
    let resolveSecond;
    let call = 0;
    const loadItems = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve([ROW_V1]);
      return new Promise((res) => { resolveSecond = res; });
    });
    const { out } = mountHook({
      project: 'demo',
      loadItems,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.refreshing).toBe(false);

    onChange({ type: 'change', path: 'work/demo/items/items.csv' });
    // in-flight: NO loading flash — old context still displayed, flagged refreshing
    await waitFor(() => expect(out.current.refreshing).toBe(true));
    expect(out.current.status).toBe('ready');
    expect(out.current.context.state).toBe('planned');

    resolveSecond([ROW_V2]);
    await waitFor(() => expect(out.current.refreshing).toBe(false));
    expect(out.current.context.state).toBe('in-progress');
  });

  it('debounces a burst of frames into ONE re-fetch (A11Y-8 data path)', async () => {
    let onChange;
    const loadItems = vi.fn(() => Promise.resolve([ROW_V1]));
    const { out } = mountHook({
      project: 'demo',
      loadItems,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 10,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    onChange({ type: 'change', path: 'work/demo/items/items.csv' });
    onChange({ type: 'change', path: 'work/demo/items/items.csv' });
    onChange({ type: 'change', path: 'work/demo/items/items.csv' });
    await new Promise((r) => setTimeout(r, 40));
    expect(loadItems).toHaveBeenCalledTimes(2); // initial + ONE debounced refresh
  });

  it('ignores irrelevant change frames (ledger.csv / slice.md) — items.csv only', async () => {
    let onChange;
    const loadItems = vi.fn(() => Promise.resolve([ROW_V1]));
    const { out } = mountHook({
      project: 'demo',
      loadItems,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    onChange({ type: 'change', path: 'process/dora/ledger.csv' });
    onChange({ type: 'change', path: 'work/demo/slices/s004/slice.md' });
    onChange(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(loadItems).toHaveBeenCalledTimes(1);
  });

  it('a refresh that finds the row GONE transitions to not-found (registry reconciliation)', async () => {
    let onChange;
    let rows = [ROW_V1];
    const loadItems = vi.fn(() => Promise.resolve(rows));
    const { out } = mountHook({
      project: 'demo',
      loadItems,
      subscribe: (cb) => { onChange = cb; return () => {}; },
      debounceMs: 0,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    rows = []; // item deleted from items.csv while the panel is open
    onChange({ type: 'change', path: 'work/demo/items/items.csv' });
    await waitFor(() => expect(out.current.status).toBe('not-found'));
    expect(out.current.context).toBeNull();
  });
});

describe('useSteerContext — SSE fail-soft (S14-4-SSE-2)', () => {
  it('subscribe throwing (no EventSource in jsdom) → static data, no crash', async () => {
    const loadItems = vi.fn(() => Promise.resolve([ROW_V1]));
    const { out } = mountHook({
      project: 'demo',
      loadItems,
      subscribe: () => { throw new Error('EventSource is not defined'); },
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.context.id).toBe('CHK-5');
    expect(out.current.refreshing).toBe(false);
  });

  it('unsubscribes on unmount (no orphan SSE listener)', async () => {
    const unsubscribe = vi.fn();
    const { out, utils } = mountHook({
      project: 'demo',
      loadItems: () => Promise.resolve([ROW_V1]),
      subscribe: () => unsubscribe,
    });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    utils.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
