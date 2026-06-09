// @covers MapContainer
// UC-S002-3 — the container wires the UC2 domain (initQueueState) to the pure
// PipelineMap render. main.jsx mounts <MapContainer/> as the App child; this is
// the one seam that bridges data → render, so the live path is unit-pinned here
// (jsdom, fake state loader) rather than only proven in a browser.
import { describe, it, expect, vi } from 'vitest';
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
