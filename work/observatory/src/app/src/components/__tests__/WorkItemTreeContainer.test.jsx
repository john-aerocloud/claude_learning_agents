// @covers WorkItemTreeContainer
// UC-S005-2 — container (data→render adapter) specs (jsdom). The container is
// the wiring seam between the API adapter (getItems) and the pure WorkItemTree.
// It owns the expanded/selected interaction state so the tree stays pure.
//
// Pins:
//   - loads items via an injected loader and renders one node per row.
//   - defaults all branches EXPANDED so the full tree is visible on open
//     (J2 0-click overview — ui-design §1 click-path budget).
//   - toggling a branch collapses/expands it (hides/shows children).
//   - fail-soft: a null load renders the empty state, never a crash.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/preact';
import { WorkItemTreeContainer } from '../WorkItemTreeContainer.jsx';

const ITEMS = [
  { id: 'REQ-DEMO', type: 'requirement', parent: '', children: 'CHK-1', job: 'r', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: 'UC-1', job: 'c', state: 'done', value: 'HIGH', cost: 'M' },
  { id: 'UC-1', type: 'use-case', parent: 'CHK-1', children: '', job: 'u', state: 'done', value: 'HIGH', cost: '2' },
];

describe('WorkItemTreeContainer (UC-S005-2)', () => {
  it('loads items and renders one node per row, all expanded by default', async () => {
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    render(<WorkItemTreeContainer loadItems={loadItems} />);
    await waitFor(() => expect(screen.getAllByTestId('tree-node')).toHaveLength(3));
    expect(screen.getByText('UC-1')).toBeTruthy(); // deep node visible (expanded)
  });

  it('collapses a branch on disclosure toggle, hiding its descendants', async () => {
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    render(<WorkItemTreeContainer loadItems={loadItems} />);
    await waitFor(() => expect(screen.getAllByTestId('tree-node')).toHaveLength(3));
    const chk = document.querySelector('[data-item-id="CHK-1"] > .tree-node__row');
    fireEvent.click(within(chk).getByTestId('disclosure-toggle'));
    await waitFor(() => expect(screen.queryByText('UC-1')).toBeNull());
  });

  it('renders empty state when the loader returns null (fail-soft)', async () => {
    const loadItems = vi.fn().mockResolvedValue(null);
    render(<WorkItemTreeContainer loadItems={loadItems} />);
    await waitFor(() => expect(screen.getByTestId('work-item-tree')).toHaveTextContent(/no work items/i));
  });

  // UC-S005-3 — controlled selection + onItemsLoaded so a parent composition can
  // lift the selected item record into the detail pane.
  it('uses controlled selectedId/onSelect when provided and reports loaded items', async () => {
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    const onSelect = vi.fn();
    const onItemsLoaded = vi.fn();
    render(
      <WorkItemTreeContainer
        loadItems={loadItems}
        selectedId="CHK-1"
        onSelect={onSelect}
        onItemsLoaded={onItemsLoaded}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('tree-node')).toHaveLength(3));
    // controlled selection is reflected as aria-selected on the controlled node
    expect(document.querySelector('[data-item-id="CHK-1"]').getAttribute('aria-selected')).toBe('true');
    // clicking a node calls the controlled onSelect (parent owns selection)
    fireEvent.click(document.querySelector('[data-item-id="UC-1"] > .tree-node__row'));
    expect(onSelect).toHaveBeenCalledWith('UC-1');
    // loaded items are reported up so the parent can resolve the selected record
    await waitFor(() => expect(onItemsLoaded).toHaveBeenCalledWith(ITEMS));
  });
});
