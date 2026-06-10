// @covers ObservatoryView
// UC-S005-3 — ObservatoryView composition specs (jsdom).
//
// ObservatoryView is the ONE composition edit that joins the existing tree rail
// + value-stream map with the new detail pane. It lifts the tree's selection
// (selectedId) and the loaded item rows so it can resolve the selected ItemRecord
// and feed it to the DetailPaneContainer. Loaders are injected.
//
// Pins:
//   - the value-stream map renders beside the tree (composition not broken).
//   - no pane until a node is selected.
//   - clicking a tree node opens the pane for that item (open-on-click — AC-S005-3-1).
//   - "Back to map" closes the pane (AC-S005-3-6).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { ObservatoryView } from '../ObservatoryView.jsx';

const ITEMS = [
  { id: 'REQ-DEMO', type: 'requirement', parent: '', children: 'CHK-1', job: 'r', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: 'UC-S001-1', job: 'c', state: 'done', value: 'HIGH', cost: 'M' },
  { id: 'UC-S001-1', type: 'use-case', parent: 'CHK-1', children: '', job: 'u', state: 'done', value: 'HIGH', cost: '2' },
];

const deps = (over = {}) => ({
  loadItems: vi.fn().mockResolvedValue(ITEMS),
  loadActiveProject: vi.fn().mockResolvedValue('observatory'),
  loadSlices: vi.fn().mockResolvedValue(['s001-read-layer']),
  loadArtifact: vi.fn().mockResolvedValue('# Read layer\nbody'),
  ...over,
});

describe('ObservatoryView (UC-S005-3)', () => {
  it('renders the value-stream map beside the tree (composition intact)', async () => {
    render(<ObservatoryView {...deps()} />);
    await waitFor(() => expect(screen.getByTestId('work-item-tree')).toBeTruthy());
    expect(screen.getByTestId('value-stream-map')).toBeTruthy();
  });

  it('opens no pane until a node is selected', async () => {
    render(<ObservatoryView {...deps()} />);
    await waitFor(() => expect(screen.getAllByTestId('tree-node').length).toBe(3));
    expect(screen.queryByTestId('detail-pane')).toBeNull();
  });

  it('opens the detail pane for the clicked node (AC-S005-3-1) showing its artifact', async () => {
    const d = deps();
    render(<ObservatoryView {...d} />);
    await waitFor(() => expect(screen.getAllByTestId('tree-node').length).toBe(3));
    fireEvent.click(document.querySelector('[data-item-id="UC-S001-1"] > .tree-node__row'));
    await waitFor(() => expect(screen.getByTestId('detail-pane')).toBeTruthy());
    expect(screen.getByTestId('detail-pane').getAttribute('aria-label')).toBe('Item detail: UC-S001-1');
    await waitFor(() => expect(screen.getByTestId('artifact-view')).toHaveTextContent('Read layer'));
    // selected node visually linked to the open pane (GEO-S005-4)
    expect(document.querySelector('[data-item-id="UC-S001-1"]').getAttribute('aria-selected')).toBe('true');
  });

  it('closes the pane on "Back to map" (AC-S005-3-6)', async () => {
    render(<ObservatoryView {...deps()} />);
    await waitFor(() => expect(screen.getAllByTestId('tree-node').length).toBe(3));
    fireEvent.click(document.querySelector('[data-item-id="UC-S001-1"] > .tree-node__row'));
    await waitFor(() => expect(screen.getByTestId('detail-pane')).toBeTruthy());
    fireEvent.click(screen.getByTestId('back-to-map'));
    await waitFor(() => expect(screen.queryByTestId('detail-pane')).toBeNull());
    // map still present after zoom-out
    expect(screen.getByTestId('value-stream-map')).toBeTruthy();
  });
});
