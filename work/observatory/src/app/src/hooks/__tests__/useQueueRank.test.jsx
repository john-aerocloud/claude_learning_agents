// @covers uc-s018-3
// @covers useQueueRank
// UC-S018-3 — useQueueRank: the slice's ONLY read call. Resolves the active
// project (getActive idiom) then getItems ONCE on the hook's MOUNT (= step-3
// entry), exposing {status:'loading'|'ready'|'error', items}. Fail-soft on a
// null project or a throw → error (never a throw, never a fabricated rank).
// NO write call, ever. NO re-fetch on a re-render (the tier change re-derives
// the rank from the already-fetched items — AC-S018-3-3 / NOWRITE-S018-3-1).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { useQueueRank } from '../useQueueRank.js';

const ITEMS = [
  { id: 'A', state: 'planned', value: 'HIGH' },
  { id: 'B', state: 'done', value: 'LOW' },
];

/** A probe that renders the hook's state for assertion. */
function Probe({ opts }) {
  const { status, items } = useQueueRank(opts || {});
  return (
    <div data-testid="probe" data-status={status} data-count={items.length}>
      {status}
    </div>
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useQueueRank — the slice read call (UC-S018-3)', () => {
  it('starts loading, then resolves active → getItems ONCE → status ready with items', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    render(<Probe opts={{ loadActive, loadItems }} />);

    // loading before the promise resolves
    expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('loading');

    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('ready'),
    );
    expect(screen.getByTestId('probe').getAttribute('data-count')).toBe('2');
    expect(loadActive).toHaveBeenCalledTimes(1);
    expect(loadItems).toHaveBeenCalledTimes(1);
    expect(loadItems).toHaveBeenCalledWith('demo');
  });

  it('AC-S018-3-4: an empty/header-only items.csv ([]) is a VALID ready state, NOT an error', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue([]);
    render(<Probe opts={{ loadActive, loadItems }} />);
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('ready'),
    );
    expect(screen.getByTestId('probe').getAttribute('data-count')).toBe('0');
  });

  it('fail-soft: a null active project → status error (never throws, never a rank)', async () => {
    const loadActive = vi.fn().mockResolvedValue(null);
    const loadItems = vi.fn();
    render(<Probe opts={{ loadActive, loadItems }} />);
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('error'),
    );
    expect(loadItems).not.toHaveBeenCalled();
  });

  it('fail-soft: getItems returning null (unreachable endpoint) → status error', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(null);
    render(<Probe opts={{ loadActive, loadItems }} />);
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('error'),
    );
  });

  it('fail-soft: a throwing loader → status error, no unhandled rejection', async () => {
    const loadActive = vi.fn().mockRejectedValue(new Error('network down'));
    const loadItems = vi.fn();
    render(<Probe opts={{ loadActive, loadItems }} />);
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('error'),
    );
  });

  it('NOWRITE-S018-3-1: the hook issues exactly ONE getItems and ZERO direct fetch calls of its own', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    const { rerender } = render(<Probe opts={{ loadActive, loadItems }} />);
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('ready'),
    );
    // a re-render (tier change upstream) must NOT trigger a second load
    rerender(<Probe opts={{ loadActive, loadItems }} />);
    await flush();
    expect(loadItems).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled(); // injected loaders carry the IO
    vi.unstubAllGlobals();
  });

  it('enabled gate: while enabled:false the hook stays loading and issues NO load; it fetches ONCE when first enabled (the shell-lift seam — NOWRITE-S018-3-2 / AC-S018-3-3)', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    // start disabled (steps 1–2)
    const { rerender } = render(<Probe opts={{ enabled: false, loadActive, loadItems }} />);
    await flush();
    expect(loadActive).not.toHaveBeenCalled();
    expect(loadItems).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('loading');

    // enable (step-3 entry) → exactly one load
    rerender(<Probe opts={{ enabled: true, loadActive, loadItems }} />);
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('ready'),
    );
    expect(loadItems).toHaveBeenCalledTimes(1);

    // toggling enabled off (Back to step 2) then on (return to step 3) must NOT
    // re-fetch — the items are cached for the wizard session.
    rerender(<Probe opts={{ enabled: false, loadActive, loadItems }} />);
    await flush();
    rerender(<Probe opts={{ enabled: true, loadActive, loadItems }} />);
    await flush();
    expect(loadItems).toHaveBeenCalledTimes(1);
  });

  it('enabled defaults to true (the standalone hook fetches on mount)', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    render(<Probe opts={{ loadActive, loadItems }} />);
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('ready'),
    );
    expect(loadItems).toHaveBeenCalledTimes(1);
  });
});
