// @covers uc-s015-2
// @covers SPA_OBSVIEW
// @covers SPA_WIPPANEL
// @covers SteerPanel
// UC-S015-2 — ObservatoryView steer-routing from WIP rows: the EXISTING
// onSteer dispatch (s014/UC-S014-2: every action → SteerPanelContainer) is
// threaded ObservatoryView → WipPanelContainer → WipPanel → WipRow → SteerMenu.
// NO new routing logic — the re-slice branch stays on SteerPanel until
// UC-S015-3 re-points it (the explicit no-dead-end directive, F-S2-3).
//
// SEPARATE file from ObservatoryView.test.jsx / ObservatoryViewSteer.test.jsx /
// ObservatoryViewWip.test.jsx on purpose (parallel-UC file isolation: the
// Defects third-tab UC owns its own ObservatoryView spec surface).
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
  expect(row.getAttribute('data-item-id')).toBe('CHK-1');
  const trigger = within(row).getByTestId('steer-btn');
  fireEvent.click(trigger);
  return trigger;
}

describe('ObservatoryView ⨯ WIP-row steer routing (UC-S015-2)', () => {
  it('"Raise defect" from a WIP row opens the SteerPanel with that item pre-loaded (F-S2-2)', async () => {
    render(<ObservatoryView {...deps()} />);
    await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-raise-defect'));
    const panel = await screen.findByTestId('steer-panel');
    expect(panel.getAttribute('data-item-id')).toBe('CHK-1');
    expect(panel.getAttribute('data-action')).toBe('raise-defect');
    await waitFor(() =>
      expect(screen.getByTestId('steer-ctx-id').textContent).toBe('CHK-1 — First demo chunk'));
  });

  it('"Request re-slice / split" does NOT dead-end: it opens the ReslicePreviewPanel (F-S2-3, UC-S015-3 re-point)', async () => {
    // UC-S015-3 re-pointed the re-slice branch (the acceptance re-point note):
    // the no-dead-end condition is preserved by the NEW destination — the
    // two-column preview drawer pre-loaded with the same item.
    render(<ObservatoryView {...deps()} />);
    await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    const panel = await screen.findByTestId('reslice-preview-panel');
    expect(panel.getAttribute('data-item-id')).toBe('CHK-1');
    expect(screen.queryByTestId('steer-panel')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('reslice-before-id').textContent).toBe('CHK-1 — First demo chunk'));
  });

  it('every one of the four actions routes to a steer destination (nothing no-ops)', async () => {
    for (const actionType of ['raise-defect', 're-prioritise', 're-slice', 'custom']) {
      const { unmount } = render(<ObservatoryView {...deps()} />);
      await openWipRowMenu();
      fireEvent.click(screen.getByTestId(`steer-action-${actionType}`));
      // UC-S015-3: re-slice routes to the preview drawer; the rest to SteerPanel
      if (actionType === 're-slice') {
        const panel = await screen.findByTestId('reslice-preview-panel');
        expect(panel.getAttribute('data-item-id')).toBe('CHK-1');
      } else {
        const panel = await screen.findByTestId('steer-panel');
        expect(panel.getAttribute('data-action')).toBe(actionType);
      }
      unmount();
    }
  });

  it('the WIP rows REMAIN rendered while the drawer is open; Cancel closes it and the list is intact (F-S2-4)', async () => {
    render(<ObservatoryView {...deps()} />);
    await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-custom'));
    await screen.findByTestId('steer-panel');
    // overlay, not a route swap — the list stays mounted behind the drawer
    expect(screen.getByTestId('wip-row')).toBeTruthy();
    fireEvent.click(screen.getByTestId('steer-cancel'));
    await waitFor(() => expect(screen.queryByTestId('steer-panel')).toBeNull());
    expect(screen.getByTestId('wip-row')).toBeTruthy();
    expect(screen.getByTestId('wip-panel')).toBeTruthy();
  });

  it('closing the drawer returns focus to the originating WIP-row trigger (S15-2-A11Y-5 jsdom half)', async () => {
    render(<ObservatoryView {...deps()} />);
    const trigger = await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-re-prioritise'));
    await screen.findByTestId('steer-panel');
    fireEvent.click(screen.getByTestId('steer-cancel'));
    await waitFor(() => expect(screen.queryByTestId('steer-panel')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('steer from a WIP row never opens the DetailPane (distinct affordances)', async () => {
    render(<ObservatoryView {...deps()} />);
    await openWipRowMenu();
    fireEvent.click(screen.getByTestId('steer-action-raise-defect'));
    await screen.findByTestId('steer-panel');
    expect(screen.queryByTestId('detail-pane')).toBeNull();
  });
});
