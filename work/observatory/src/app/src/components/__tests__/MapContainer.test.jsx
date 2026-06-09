// @covers MapContainer
// UC-S002-3 — the container wires the UC2 domain (initQueueState) to the pure
// PipelineMap render. main.jsx mounts <MapContainer/> as the App child; this is
// the one seam that bridges data → render, so the live path is unit-pinned here
// (jsdom, fake state loader) rather than only proven in a browser.
//
// UC-S002-6 — this container ALSO subscribes to the SSE change channel
// (subscribeEvents) on mount and re-runs the loaders on a relevant change frame
// (debounced/coalesced), so the map refreshes live without a manual reload. The
// subscribe is injectable so jsdom (no EventSource) drives it with a fake; the
// real EventSource path is proven by the Playwright live spec. Unsubscribe on
// unmount is pinned here (no leak). A LiveStatusDot reflects connection state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { MapContainer } from '../MapContainer.jsx';

const sample = [
  { name: 'intake', length: 4, status: 'ok' },
  { name: 'ready', length: 1, min_items: 3, status: 'starving' },
  { name: 'deploy', length: 0, status: 'ok' },
  { name: 'rework', length: 2, status: 'ok' },
];

describe('MapContainer (UC-S002-3 data→render wiring)', () => {
  it('loads queue state and renders the pipeline map with live counts', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    render(<MapContainer load={load} />);
    await waitFor(() =>
      expect(screen.getByTestId('queue-intake')).toBeInTheDocument(),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: /pipeline map/i })).toBeInTheDocument();
    expect(screen.getByTestId('queue-ready').querySelector('[data-testid="queue-count"]')).toHaveTextContent('1');
  });

  it('renders the empty state when no active project (load → [])', async () => {
    const load = vi.fn().mockResolvedValue([]);
    render(<MapContainer load={load} />);
    await waitFor(() =>
      expect(screen.getByText(/no active project/i)).toBeInTheDocument(),
    );
  });

  it('does not crash if the loader rejects (fail-soft → empty state)', async () => {
    const load = vi.fn().mockRejectedValue(new Error('network down'));
    render(<MapContainer load={load} />);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /pipeline map/i })).toBeInTheDocument(),
    );
    // degraded to the empty state, not a blank page or thrown error
    expect(screen.getByText(/no active project/i)).toBeInTheDocument();
  });

  // ── UC-S002-5: container also loads + matches the ToC constraint ─────────────
  it('loads the constraint queue and highlights the matched box (UC-S002-5)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const loadConstraint = vi.fn().mockResolvedValue('ready'); // already matched to a queue
    render(<MapContainer load={load} loadConstraint={loadConstraint} />);
    await waitFor(() =>
      expect(screen.getByTestId('queue-ready')).toHaveAttribute('data-constraint', 'true'),
    );
    expect(loadConstraint).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('queue-ready').querySelector('[data-testid="constraint-badge"]'),
    ).not.toBeNull();
    // no other box is marked
    expect(screen.getByTestId('queue-intake')).toHaveAttribute('data-constraint', 'false');
  });

  it('highlights NO box when the constraint is not a queue / absent (loadConstraint → null)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const loadConstraint = vi.fn().mockResolvedValue(null); // e.g. live baseline names "tester"
    render(<MapContainer load={load} loadConstraint={loadConstraint} />);
    await waitFor(() =>
      expect(screen.getByTestId('queue-ready')).toBeInTheDocument(),
    );
    for (const name of ['intake', 'ready', 'deploy', 'rework']) {
      expect(screen.getByTestId(`queue-${name}`)).toHaveAttribute('data-constraint', 'false');
    }
  });

  it('does not crash if the constraint loader rejects (fail-soft → no highlight)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const loadConstraint = vi.fn().mockRejectedValue(new Error('baseline down'));
    render(<MapContainer load={load} loadConstraint={loadConstraint} />);
    await waitFor(() =>
      expect(screen.getByTestId('queue-ready')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('queue-ready')).toHaveAttribute('data-constraint', 'false');
  });
});

// ── UC-S002-6: SSE live refresh wired through this container ──────────────────
// subscribe(onChange) is injected (default subscribeEvents). On a change frame
// whose path is relevant (a queue/policy CSV or baseline.md), both loaders re-run
// — debounced/coalesced — so the map updates live. Unrelated paths do not re-run.
// Unsubscribe is called on unmount (no leak). A LiveStatusDot reflects state.
describe('MapContainer (UC-S002-6 SSE live refresh)', () => {
  /** A fake subscribe that captures onChange and records unsubscribe calls. */
  function makeFakeSubscribe() {
    const unsubscribe = vi.fn();
    let handler = null;
    const subscribe = vi.fn((onChange) => {
      handler = onChange;
      return unsubscribe;
    });
    return {
      subscribe,
      unsubscribe,
      fire(evt) {
        handler?.(evt);
      },
    };
  }

  const updated = [
    { name: 'intake', length: 4, status: 'ok' },
    { name: 'ready', length: 3, min_items: 3, status: 'ok' }, // was 1/starving
    { name: 'deploy', length: 0, status: 'ok' },
    { name: 'rework', length: 2, status: 'ok' },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to the change channel on mount and renders a connected live-status', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const fake = makeFakeSubscribe();
    render(<MapContainer load={load} loadConstraint={vi.fn().mockResolvedValue(null)} subscribe={fake.subscribe} />);
    await waitFor(() => expect(screen.getByTestId('queue-ready')).toBeInTheDocument());
    expect(fake.subscribe).toHaveBeenCalledTimes(1);
    const dot = screen.getByTestId('live-status');
    expect(dot).toHaveAttribute('role', 'status');
    expect(dot).toHaveAccessibleName(/live updates: connected/i);
  });

  it('re-runs both loaders when a relevant queue-CSV change frame arrives (AC6.1)', async () => {
    const load = vi.fn().mockResolvedValueOnce(sample).mockResolvedValue(updated);
    const loadConstraint = vi.fn().mockResolvedValue(null);
    const fake = makeFakeSubscribe();
    render(<MapContainer load={load} loadConstraint={loadConstraint} subscribe={fake.subscribe} debounceMs={50} />);
    await waitFor(() =>
      expect(screen.getByTestId('queue-ready').querySelector('[data-testid="queue-count"]')).toHaveTextContent('1'),
    );
    expect(load).toHaveBeenCalledTimes(1);

    fake.fire({ type: 'change', path: 'work/demo/queues/ready.csv' });
    await vi.advanceTimersByTimeAsync(60);

    await waitFor(() =>
      expect(screen.getByTestId('queue-ready').querySelector('[data-testid="queue-count"]')).toHaveTextContent('3'),
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect(loadConstraint).toHaveBeenCalledTimes(2); // constraint re-evaluated too
  });

  it('does NOT re-run loaders for an unrelated file change (AC6.2 path filtering)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const loadConstraint = vi.fn().mockResolvedValue(null);
    const fake = makeFakeSubscribe();
    render(<MapContainer load={load} loadConstraint={loadConstraint} subscribe={fake.subscribe} debounceMs={50} />);
    await waitFor(() => expect(screen.getByTestId('queue-ready')).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(1);

    fake.fire({ type: 'change', path: 'work/observatory/slices/s001-read-layer/slice.md' });
    await vi.advanceTimersByTimeAsync(200);

    expect(load).toHaveBeenCalledTimes(1); // no re-run
    expect(loadConstraint).toHaveBeenCalledTimes(1);
  });

  it('re-runs loaders on a baseline.md change frame (AC6.3)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const loadConstraint = vi.fn().mockResolvedValue(null);
    const fake = makeFakeSubscribe();
    render(<MapContainer load={load} loadConstraint={loadConstraint} subscribe={fake.subscribe} debounceMs={50} />);
    await waitFor(() => expect(screen.getByTestId('queue-ready')).toBeInTheDocument());

    fake.fire({ type: 'change', path: 'process/dora/baseline.md' });
    await vi.advanceTimersByTimeAsync(60);

    expect(loadConstraint).toHaveBeenCalledTimes(2);
  });

  it('coalesces a burst of change frames into a single re-load (debounce)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const fake = makeFakeSubscribe();
    render(<MapContainer load={load} loadConstraint={vi.fn().mockResolvedValue(null)} subscribe={fake.subscribe} debounceMs={50} />);
    await waitFor(() => expect(screen.getByTestId('queue-ready')).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(1);

    // five rapid relevant changes within the debounce window
    for (let i = 0; i < 5; i++) fake.fire({ type: 'change', path: 'work/demo/queues/ready.csv' });
    await vi.advanceTimersByTimeAsync(60);

    expect(load).toHaveBeenCalledTimes(2); // one coalesced re-load, not five
  });

  it('unsubscribes on unmount (no leaked EventSource)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    const fake = makeFakeSubscribe();
    const { unmount } = render(
      <MapContainer load={load} loadConstraint={vi.fn().mockResolvedValue(null)} subscribe={fake.subscribe} />,
    );
    await waitFor(() => expect(screen.getByTestId('queue-ready')).toBeInTheDocument());
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not crash and keeps last-known state if the subscribe channel errors (AC6.6)', async () => {
    const load = vi.fn().mockResolvedValue(sample);
    // subscribe that throws synchronously must not blank the page
    const subscribe = vi.fn(() => {
      throw new Error('EventSource unavailable');
    });
    render(<MapContainer load={load} loadConstraint={vi.fn().mockResolvedValue(null)} subscribe={subscribe} />);
    await waitFor(() => expect(screen.getByTestId('queue-ready')).toBeInTheDocument());
    // last-known counts remain; status dot degrades, not the map
    expect(screen.getByTestId('queue-ready').querySelector('[data-testid="queue-count"]')).toHaveTextContent('1');
  });
});
