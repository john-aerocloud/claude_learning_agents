// @covers uc-s014-2
// @covers ObservatoryView
// @covers SteerPanel
// UC-S014-2 — composition wiring: the SteerMenu's onSteer(itemId, actionType)
// callback (a stub in UC-S014-1) now OPENS the SteerPanel. A separate spec file
// from ObservatoryView.test.jsx on purpose: UC-S015-1 owns edits to that file's
// surface this iteration (collision discipline — distinct files, no shared WIP).
//
// Pins (jsdom; loaders injected):
//   - selecting a steer action on a TREE ROW opens the panel for that item with
//     its job sentence + the chosen action label (F-1, AC-1)
//   - the panel resolves context through the SAME injected items loader
//   - Cancel closes the panel and the dashboard is untouched (F-5)
//   - steer does NOT open the DetailPane (drill unchanged — distinct triggers)
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { ObservatoryView } from '../ObservatoryView.jsx';

const ITEMS = [
  { id: 'REQ-DEMO', type: 'requirement', parent: '', children: 'CHK-1', job: 'Demo requirement for the tree', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: '', job: 'First demo chunk', state: 'done', value: 'HIGH', cost: 'M' },
];

const deps = () => ({
  loadItems: vi.fn().mockResolvedValue(ITEMS),
  loadActiveProject: vi.fn().mockResolvedValue('demo'),
  loadSlices: vi.fn().mockResolvedValue([]),
  loadArtifact: vi.fn().mockResolvedValue(null),
});

// UC-S015-3 re-pointed the `re-slice` action to the ReslicePreviewPanel, so
// this suite's SteerPanel pins now drive a SteerPanel-routed action ('custom')
// — the wiring under test (onSteer → drawer with item context) is unchanged.
async function openSteerPanel(actionTestId = 'steer-action-custom') {
  await waitFor(() => expect(screen.getAllByTestId('tree-node').length).toBe(2));
  const row = document.querySelector('[data-item-id="CHK-1"] > .tree-node__row');
  fireEvent.click(row.querySelector('[data-testid="steer-btn"]'));
  fireEvent.click(screen.getByTestId(actionTestId));
}

describe('ObservatoryView ⨯ steer wiring (UC-S014-2)', () => {
  it('selecting a steer action on a tree row opens the panel with that item context (AC-1)', async () => {
    render(<ObservatoryView {...deps()} />);
    await openSteerPanel();
    const panel = await screen.findByTestId('steer-panel');
    expect(panel.getAttribute('data-item-id')).toBe('CHK-1');
    expect(panel.getAttribute('data-action')).toBe('custom');
    await waitFor(() =>
      expect(screen.getByTestId('steer-ctx-id').textContent).toBe('CHK-1 — First demo chunk'));
    expect(screen.getByTestId('steer-ctx-action').textContent).toBe('Custom steer');
  });

  it('steer never drills: the DetailPane stays closed while the SteerPanel opens', async () => {
    render(<ObservatoryView {...deps()} />);
    await openSteerPanel();
    await screen.findByTestId('steer-panel');
    expect(screen.queryByTestId('detail-pane')).toBeNull();
  });

  it('Cancel closes the panel; tree + map remain (F-5)', async () => {
    render(<ObservatoryView {...deps()} />);
    await openSteerPanel();
    await screen.findByTestId('steer-panel');
    fireEvent.click(screen.getByTestId('steer-cancel'));
    await waitFor(() => expect(screen.queryByTestId('steer-panel')).toBeNull());
    expect(screen.getByTestId('work-item-tree')).toBeTruthy();
    expect(screen.getByTestId('value-stream-map')).toBeTruthy();
  });

  it('typing the intent note writes nothing: the injected loader is read-only traffic (AC-3)', async () => {
    const d = deps();
    render(<ObservatoryView {...d} />);
    await openSteerPanel();
    await screen.findByTestId('steer-panel');
    await waitFor(() => expect(screen.getByTestId('intent-note').disabled).toBe(false));
    const callsBefore = d.loadItems.mock.calls.length;
    fireEvent.input(screen.getByTestId('intent-note'), { target: { value: 'free text intent' } });
    expect(screen.getByTestId('intent-note').value).toBe('free text intent');
    expect(d.loadItems.mock.calls.length).toBe(callsBefore); // no re-fetch, no write
  });
});
