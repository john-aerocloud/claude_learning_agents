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
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-engineer-throughput')).toHaveTextContent('7');
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
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-engineer-throughput')).toHaveTextContent('7');
    });
    handler({ type: 'change', path: 'process/dora/ledger.csv' });
    await waitFor(() => {
      expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-engineer-throughput')).toHaveTextContent('8');
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
});
