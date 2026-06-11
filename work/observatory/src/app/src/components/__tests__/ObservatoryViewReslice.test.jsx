// @covers uc-s015-3
// @covers SPA_OBSVIEW
// @covers ReslicePreviewPanel
// @covers SteerPanel
// UC-S015-3 — the ONE-line dispatch re-point (RESLICE-DISPATCH-1): the
// `re-slice` action now mounts ReslicePreviewPanelContainer; the OTHER THREE
// actions still mount SteerPanelContainer. The WipRow/SteerMenu and the
// onSteer threading are UNTOUCHED — only the destination of the one branch
// changed (the UC-S015-2 seam note made real).
//
// SEPARATE file from ObservatoryViewSteer/ObservatoryViewWipSteer on purpose
// (parallel-UC file isolation — UC-S013-3 is in flight on its own surfaces).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import { ObservatoryView } from '../ObservatoryView.jsx';

const HORIZON = 2 * 60 * 60 * 1000;

const ITEMS = [
  { id: 'REQ-DEMO', type: 'requirement', parent: '', children: 'CHK-1', job: 'Demo requirement for the tree', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: '', job: 'First demo chunk', state: 'in-progress', value: 'HIGH', cost: 'M' },
];

const FLOW = [
  {
    stage: 'engineer',
    label: 'Build / TDD (engineer)',
    wip_horizon_ms: HORIZON,
    open_items: [
      { item_id: 'CHK-1', note: 'build', opened_at: 't', dwell_ms: 900_000, stale: false },
    ],
  },
];

const deps = () => ({
  loadItems: vi.fn().mockResolvedValue(ITEMS),
  loadActiveProject: vi.fn().mockResolvedValue('demo'),
  loadSlices: vi.fn().mockResolvedValue([]),
  loadArtifact: vi.fn().mockResolvedValue(null),
  wipLoaders: {
    loadActive: () => Promise.resolve('demo'),
    loadFlow: () => Promise.resolve(FLOW),
    loadItems: () => Promise.resolve(ITEMS),
    subscribe: () => () => {},
  },
});

async function openWipRowMenu() {
  fireEvent.click(screen.getByTestId('view-tab-wip'));
  await waitFor(() => expect(screen.getByTestId('wip-row')).toBeTruthy());
  const row = screen.getByTestId('wip-row');
  const trigger = within(row).getByTestId('steer-btn');
  fireEvent.click(trigger);
  return trigger;
}

describe('ObservatoryView ⨯ re-slice dispatch re-point (UC-S015-3)', () => {
  it('RESLICE-DISPATCH-1: "Request re-slice / split" opens the ReslicePreviewPanel, NOT the SteerPanel', async () => {
    render(<ObservatoryView {...deps()} />);
    await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    const panel = await screen.findByTestId('reslice-preview-panel');
    expect(panel.getAttribute('data-item-id')).toBe('CHK-1');
    expect(screen.queryByTestId('steer-panel')).toBeNull();
    // the Before column pre-loads the SAME six-field contract SteerPanel shows
    await waitFor(() =>
      expect(screen.getByTestId('reslice-before-id').textContent).toBe('CHK-1 — First demo chunk'));
    expect(screen.getByRole('dialog', { name: /re-slice.*: CHK-1/i })).toBeTruthy();
  });

  it('RESLICE-DISPATCH-1: the other three actions STILL open the SteerPanel (scoped re-point)', async () => {
    for (const actionType of ['raise-defect', 're-prioritise', 'custom']) {
      const { unmount } = render(<ObservatoryView {...deps()} />);
      await openWipRowMenu();
      fireEvent.click(screen.getByTestId(`steer-action-${actionType}`));
      const panel = await screen.findByTestId('steer-panel');
      expect(panel.getAttribute('data-action')).toBe(actionType);
      expect(screen.queryByTestId('reslice-preview-panel')).toBeNull();
      unmount();
    }
  });

  it('the re-point holds from a TREE row too (the dispatch is per-action, not per-origin)', async () => {
    render(<ObservatoryView {...deps()} />);
    await waitFor(() => expect(screen.getAllByTestId('tree-node').length).toBe(2));
    const row = document.querySelector('[data-item-id="CHK-1"] > .tree-node__row');
    fireEvent.click(row.querySelector('[data-testid="steer-btn"]'));
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    const panel = await screen.findByTestId('reslice-preview-panel');
    expect(panel.getAttribute('data-item-id')).toBe('CHK-1');
    expect(screen.queryByTestId('steer-panel')).toBeNull();
  });

  it('F-S3-5: Cancel closes the preview WITHOUT generating; the WIP panel is intact behind it', async () => {
    render(<ObservatoryView {...deps()} />);
    await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    await screen.findByTestId('reslice-preview-panel');
    // overlay, not a route swap — the list stays mounted behind the drawer
    expect(screen.getByTestId('wip-row')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reslice-cancel'));
    await waitFor(() => expect(screen.queryByTestId('reslice-preview-panel')).toBeNull());
    expect(screen.queryByTestId('prompt-output')).toBeNull(); // nothing generated
    expect(screen.getByTestId('wip-row')).toBeTruthy();
    expect(screen.getByTestId('wip-panel')).toBeTruthy();
  });

  it('S15-3-A11Y-2: closing the preview returns focus to the originating WIP-row trigger', async () => {
    render(<ObservatoryView {...deps()} />);
    const trigger = await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    await screen.findByTestId('reslice-preview-panel');
    fireEvent.click(screen.getByTestId('reslice-cancel'));
    await waitFor(() => expect(screen.queryByTestId('reslice-preview-panel')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('F-S3-3 (jsdom half): typing into Part A/Part B triggers NO write traffic through the loaders', async () => {
    const d = deps();
    render(<ObservatoryView {...d} />);
    await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    await screen.findByTestId('reslice-preview-panel');
    await waitFor(() => expect(screen.getByTestId('part-a-job').disabled).toBe(false));
    const callsBefore = d.loadItems.mock.calls.length;
    fireEvent.input(screen.getByTestId('part-a-job'), { target: { value: 'Part A free text' } });
    fireEvent.input(screen.getByTestId('part-b-job'), { target: { value: 'Part B free text' } });
    expect(screen.getByTestId('part-a-job').value).toBe('Part A free text');
    expect(screen.getByTestId('part-b-job').value).toBe('Part B free text');
    expect(d.loadItems.mock.calls.length).toBe(callsBefore); // read-only — no re-fetch, no write
  });
});
