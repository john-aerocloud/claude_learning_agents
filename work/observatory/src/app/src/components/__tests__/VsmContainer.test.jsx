// @covers VsmContainer
// UC-S004-2/6 — the data→render container for the value-stream map. Bridges the
// API adapter (getActive → getStageFlow) to the pure ValueStreamMap on mount,
// and re-fetches on a relevant SSE change frame (ledger.csv append). Loaders are
// injected so jsdom (no EventSource) drives them with fakes; the real
// EventSource path is proven by the Playwright live spec.
//
// Pins: the container loads REAL stage-flow data and passes it to the map (the
// DEFECT-001 fix — non-zero data reaches the surface); fail-soft to the zero
// skeleton on a null load; SSE re-fetch on a ledger change.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/preact';
import { VsmContainer } from '../VsmContainer.jsx';

const flow = [
  { stage: 'intake', label: 'Intake (gate)', throughput: 5, dwell_median_s: 30, wip: 0, rework: 0, source_rows: ['r1'] },
  { stage: 'decompose', label: 'Decompose', throughput: 4, dwell_median_s: 120, wip: 0, rework: 0, source_rows: ['r2'] },
  { stage: 'ready', label: 'Ready', throughput: 4, dwell_median_s: 0, wip: 0, rework: 0, source_rows: ['r3'] },
  { stage: 'capabilities', label: 'Capabilities', throughput: 3, dwell_median_s: 0, wip: 0, rework: 0, source_rows: ['r4'] },
  { stage: 'ui-design', label: 'UI-Design', throughput: 3, dwell_median_s: 0, wip: 0, rework: 0, source_rows: ['r5'] },
  { stage: 'engineer', label: 'Build / TDD', throughput: 7, dwell_median_s: 720, wip: 2, rework: 3, source_rows: ['r6'] },
  { stage: 'ui-validate', label: 'UI-Validate', throughput: 2, dwell_median_s: 0, wip: 0, rework: 0, source_rows: ['r8'] },
  { stage: 'deploy', label: 'Deploy (gate)', throughput: 6, dwell_median_s: 0, wip: 0, rework: 0, source_rows: ['r9'] },
  { stage: 'validate', label: 'Validate', throughput: 5, dwell_median_s: 0, wip: 1, rework: 0, source_rows: ['r10'] },
  { stage: 'done', label: 'Done', throughput: 5, dwell_median_s: 0, wip: 0, rework: 0, source_rows: ['r11'] },
  { stage: 'rework', label: 'Rework', throughput: 0, dwell_median_s: 0, wip: 0, rework: 6, source_rows: ['r12'] },
];

describe('VsmContainer (UC-S004-2/6)', () => {
  it('loads stage-flow on mount and renders the real non-zero data (DEFECT-001 fix)', async () => {
    const loadFlow = vi.fn().mockResolvedValue(flow);
    render(<VsmContainer loadFlow={loadFlow} subscribe={() => () => {}} />);
    await waitFor(() => {
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-source-summary-engineer-throughput')).toHaveTextContent('7 items');
    });
    // the in-flight badge for the wip>0 stage is visible — pulled work not invisible
    expect(within(screen.getByTestId('stage-engineer')).getByTestId('inflight-engineer')).toHaveTextContent(/2 in-flight/i);
    expect(loadFlow).toHaveBeenCalled();
  });

  it('fails soft to the zero skeleton when the load returns null (never blank/crash)', async () => {
    const loadFlow = vi.fn().mockResolvedValue(null);
    render(<VsmContainer loadFlow={loadFlow} subscribe={() => () => {}} />);
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /value-stream map/i })).toBeInTheDocument();
    });
    expect(document.querySelectorAll('[data-testid^="stage-"]').length).toBe(10);
  });

  it('re-fetches on a relevant SSE change frame (ledger.csv append) — AC6.1', async () => {
    let handler;
    const subscribe = (onChange) => { handler = onChange; return () => {}; };
    const loadFlow = vi.fn()
      .mockResolvedValueOnce(flow)
      .mockResolvedValueOnce(flow.map((s) => (s.stage === 'engineer' ? { ...s, throughput: 8 } : s)));
    render(<VsmContainer loadFlow={loadFlow} subscribe={subscribe} debounceMs={0} />);
    await waitFor(() => {
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-source-summary-engineer-throughput')).toHaveTextContent('7 items');
    });
    handler({ type: 'change', path: 'process/dora/ledger.csv' });
    await waitFor(() => {
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-source-summary-engineer-throughput')).toHaveTextContent('8 items');
    });
  });

  it('ignores an irrelevant SSE change frame (does not re-fetch) — AC6.2', async () => {
    let handler;
    const subscribe = (onChange) => { handler = onChange; return () => {}; };
    const loadFlow = vi.fn().mockResolvedValue(flow);
    render(<VsmContainer loadFlow={loadFlow} subscribe={subscribe} debounceMs={0} />);
    await waitFor(() => expect(loadFlow).toHaveBeenCalledTimes(1));
    handler({ type: 'change', path: 'work/observatory/slices/s004/slice.md' });
    // give any debounce a tick; loadFlow must NOT be called again
    await new Promise((r) => setTimeout(r, 5));
    expect(loadFlow).toHaveBeenCalledTimes(1);
  });

  // ── DEFECT-012: the staging buffer reaches the board ──────────────────────
  // @covers def-012 @covers StagingQueueBox
  it('loads the staging buffer on mount and renders its depth + items between Decompose and Ready — DEFECT-012', async () => {
    const loadFlow = vi.fn().mockResolvedValue(flow);
    const loadStaging = vi.fn().mockResolvedValue({
      queue: 'staging', depth: 2,
      rows: [
        { item_id: 'UC-S015-1', job: 'WIP panel' },
        { item_id: 'UC-S015-2', job: 'Navigate views' },
      ],
    });
    render(<VsmContainer loadFlow={loadFlow} loadStaging={loadStaging} subscribe={() => () => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('staging-buffer')).toHaveAttribute('data-depth', '2');
    });
    expect(screen.getByTestId('staging-item-UC-S015-1')).toHaveTextContent(/WIP panel/);
    expect(loadStaging).toHaveBeenCalled();
  });

  it('fails soft to the drained staging box when the staging load returns null — DEFECT-012', async () => {
    const loadFlow = vi.fn().mockResolvedValue(flow);
    const loadStaging = vi.fn().mockResolvedValue(null);
    render(<VsmContainer loadFlow={loadFlow} loadStaging={loadStaging} subscribe={() => () => {}} />);
    await waitFor(() => expect(loadStaging).toHaveBeenCalled());
    expect(screen.getByTestId('staging-buffer')).toHaveAttribute('data-depth', '0');
  });

  it('re-fetches the staging buffer on a staging.csv SSE change frame (product append / triage drain) — DEFECT-012', async () => {
    let handler;
    const subscribe = (onChange) => { handler = onChange; return () => {}; };
    const loadFlow = vi.fn().mockResolvedValue(flow);
    const loadStaging = vi.fn()
      .mockResolvedValueOnce({ depth: 0, rows: [] })
      .mockResolvedValueOnce({ depth: 1, rows: [{ item_id: 'UC-NEW', job: 'fresh decompose' }] });
    render(<VsmContainer loadFlow={loadFlow} loadStaging={loadStaging} subscribe={subscribe} debounceMs={0} />);
    await waitFor(() => {
      expect(screen.getByTestId('staging-buffer')).toHaveAttribute('data-depth', '0');
    });
    handler({ type: 'change', path: 'work/observatory/queues/staging.csv' });
    await waitFor(() => {
      expect(screen.getByTestId('staging-buffer')).toHaveAttribute('data-depth', '1');
    });
    expect(screen.getByTestId('staging-item-UC-NEW')).toHaveTextContent(/fresh decompose/);
  });

  // ── DEFECT-003: stale-shown-as-live ───────────────────────────────────────
  // The subscribe seam exposes connection lifecycle via opts.onOpen/onError; the
  // container must surface a disconnected/stale state and re-fetch on reconnect.
  it('on SSE error shows the disconnected indicator and marks the figures stale — DEFECT-003', async () => {
    let opts;
    const subscribe = (_onChange, o) => { opts = o; return () => {}; };
    const loadFlow = vi.fn().mockResolvedValue(flow);
    render(<VsmContainer loadFlow={loadFlow} subscribe={subscribe} />);
    await waitFor(() => expect(loadFlow).toHaveBeenCalled());

    // connection drops
    opts.onError();

    await waitFor(() => {
      expect(screen.getByTestId('live-status')).toHaveAttribute('data-state', 'disconnected');
    });
    // a prominent, non-colour-only banner spells out the staleness
    const banner = screen.getByTestId('stale-banner');
    expect(banner).toHaveTextContent(/disconnected/i);
    expect(banner).toHaveTextContent(/stale/i);
    // figures are MARKED not-current (not silently presented as live)
    expect(screen.getByTestId('value-stream-map')).toHaveAttribute('data-stale', 'true');
  });

  it('re-fetches /stage-flow on SSE reconnect (open after error) and clears stale — DEFECT-003', async () => {
    let opts;
    const subscribe = (_onChange, o) => { opts = o; return () => {}; };
    const loadFlow = vi.fn()
      .mockResolvedValueOnce(flow)
      .mockResolvedValueOnce(flow.map((s) => (s.stage === 'engineer' ? { ...s, throughput: 9 } : s)));
    render(<VsmContainer loadFlow={loadFlow} subscribe={subscribe} />);
    await waitFor(() => {
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-source-summary-engineer-throughput')).toHaveTextContent('7 items');
    });

    // drop, then reconnect
    opts.onError();
    await waitFor(() => expect(screen.getByTestId('value-stream-map')).toHaveAttribute('data-stale', 'true'));
    opts.onOpen();

    // self-heals: re-fetch ran, numbers updated, stale cleared, dot back to live
    await waitFor(() => {
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-source-summary-engineer-throughput')).toHaveTextContent('9 items');
    });
    expect(screen.getByTestId('value-stream-map')).toHaveAttribute('data-stale', 'false');
    expect(screen.getByTestId('live-status')).toHaveAttribute('data-state', 'connected');
    expect(screen.queryByTestId('stale-banner')).toBeNull();
    expect(loadFlow).toHaveBeenCalledTimes(2);
  });

  it('the initial connected render is NOT stale and shows no banner — DEFECT-003', async () => {
    const loadFlow = vi.fn().mockResolvedValue(flow);
    render(<VsmContainer loadFlow={loadFlow} subscribe={() => () => {}} />);
    await waitFor(() => expect(loadFlow).toHaveBeenCalled());
    expect(screen.getByTestId('value-stream-map')).toHaveAttribute('data-stale', 'false');
    expect(screen.queryByTestId('stale-banner')).toBeNull();
  });
});
