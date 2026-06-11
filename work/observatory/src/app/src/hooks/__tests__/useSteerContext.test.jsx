// @covers uc-s014-2
// @covers useSteerContext
// UC-S014-2 — useSteerContext(itemId): fetches the item's context from the
// existing /items endpoint (READ-ONLY) and returns the EXACT state shape that
// UC-S014-3 (promptBuilder) and UC-S015-3 (ReslicePreviewPanel) consume:
//   { status: "loading"|"ready"|"not-found"|"error",
//     context: { id, job, state, value, cost, sourceRef } | null }
//
// Pins (jsdom; loaders injected — no fetch):
//   - loading first, then ready with all six context fields mapped from the row
//   - sourceRef carries the REAL items.csv path + id anchor (traceability §8)
//   - id absent from the rows → not-found, context null (S14-2-FIG-4 resilience)
//   - loader null / non-array / throws → error, context null (fail-soft)
//   - context is null in every non-ready state (the UC-S014-3 contract)
//   - itemId change re-derives (re-fetches for the new id)
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { useSteerContext } from '../useSteerContext.js';

const ROWS = [
  {
    id: 'CHK-5',
    type: 'chunk',
    job: 'Compose a structured preview-first prompt',
    state: 'planned',
    value: 'HIGH',
    cost: 'M',
    vc_ratio: 'HIGH/M',
    done_ts: '',
  },
  { id: 'REQ-1', type: 'requirement', job: 'Root req', state: 'active', value: 'HIGH', cost: 'XL' },
];

/** Mount the hook and expose its latest return value. */
function mountHook(itemId, opts) {
  const out = { current: null };
  function Probe({ id }) {
    out.current = useSteerContext(id, opts);
    return null;
  }
  const utils = render(<Probe id={itemId} />);
  return { out, utils, Probe };
}

describe('useSteerContext (UC-S014-2) — ready path', () => {
  it('is loading (context null) before the rows resolve', () => {
    const { out } = mountHook('CHK-5', {
      project: 'demo',
      loadItems: () => new Promise(() => {}), // never resolves
    });
    expect(out.current).toEqual({ status: 'loading', context: null });
  });

  it('maps the found row onto the six-field context contract', async () => {
    const loadItems = vi.fn().mockResolvedValue(ROWS);
    const { out } = mountHook('CHK-5', { project: 'demo', loadItems });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.context).toEqual({
      id: 'CHK-5',
      job: 'Compose a structured preview-first prompt',
      state: 'planned',
      value: 'HIGH',
      cost: 'M',
      sourceRef: 'work/demo/items/items.csv#id=CHK-5',
    });
    // the raw CSV row keys do NOT leak into the contract (FIG-2 upstream guard)
    expect('vc_ratio' in out.current.context).toBe(false);
    expect('done_ts' in out.current.context).toBe(false);
    expect(loadItems).toHaveBeenCalledWith('demo');
  });

  it('humanises an enum-ish state (underscores → spaces) and blanks missing fields', async () => {
    const rows = [{ id: 'X-1', job: 'j', state: 'in_progress' }]; // value/cost absent
    const { out } = mountHook('X-1', { project: 'demo', loadItems: () => Promise.resolve(rows) });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(out.current.context.state).toBe('in progress');
    expect(out.current.context.value).toBe(''); // render layer shows "—" (FIG-3)
    expect(out.current.context.cost).toBe('');
  });

  it('resolves the project itself when none is supplied (loadProject seam)', async () => {
    const loadProject = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(ROWS);
    const { out } = mountHook('CHK-5', { loadProject, loadItems });
    await waitFor(() => expect(out.current.status).toBe('ready'));
    expect(loadProject).toHaveBeenCalled();
    expect(out.current.context.sourceRef).toBe('work/demo/items/items.csv#id=CHK-5');
  });
});

describe('useSteerContext — not-found / error (fail-soft, S14-2-FIG-4)', () => {
  it('id absent from the rows → not-found, context null', async () => {
    const { out } = mountHook('GHOST-9', { project: 'demo', loadItems: () => Promise.resolve(ROWS) });
    await waitFor(() => expect(out.current.status).toBe('not-found'));
    expect(out.current.context).toBeNull();
  });

  it('loader resolves null (endpoint unreachable) → error, context null', async () => {
    const { out } = mountHook('CHK-5', { project: 'demo', loadItems: () => Promise.resolve(null) });
    await waitFor(() => expect(out.current.status).toBe('error'));
    expect(out.current.context).toBeNull();
  });

  it('loader throws → error, never an unhandled crash', async () => {
    const { out } = mountHook('CHK-5', {
      project: 'demo',
      loadItems: () => Promise.reject(new Error('boom')),
    });
    await waitFor(() => expect(out.current.status).toBe('error'));
    expect(out.current.context).toBeNull();
  });
});

describe('useSteerContext — re-derivation', () => {
  it('re-fetches when the itemId changes (new item → new context)', async () => {
    const loadItems = vi.fn().mockResolvedValue(ROWS);
    const out = { current: null };
    function Probe({ id }) {
      out.current = useSteerContext(id, { project: 'demo', loadItems });
      return null;
    }
    const { rerender } = render(<Probe id="CHK-5" />);
    await waitFor(() => expect(out.current.status).toBe('ready'));
    rerender(<Probe id="REQ-1" />);
    await waitFor(() => expect(out.current.context?.id).toBe('REQ-1'));
    expect(out.current.context.job).toBe('Root req');
    expect(loadItems).toHaveBeenCalledTimes(2);
  });
});
