// @covers DetailPane
// UC-S005-3 — DetailPane shell + artifact-render specs (jsdom).
//
// The DetailPane is the right-anchored NON-MODAL labelled region opened on a
// tree-node drill. It is a (mostly) pure render of resolved props: the selected
// item record, the resolved slice slug + the artifact text already fetched by
// the container, the available-artifact list, and onClose. These pins fix:
//   - closed when item is null (AC: no pane until a node is selected)
//   - open as role=region with aria-label "Item detail: <id>" (A11Y-S005-3)
//   - identity row shows id/type/state/value/cost (AC-S005-3-1 shell)
//   - breadcrumb text includes the item id (AC-S005-3-5)
//   - a slice node lists its artifacts + shows the chosen one as RAW text
//     (UC-S005-3 scope: <pre> placeholder; ArtifactView slot for UC-S005-4)
//   - absent artifact → "not yet available" placeholder, no crash (AC-S005-3-4)
//   - an empty labelled slot for ItemHistoryPanel (UC-S005-5)
//   - Esc and the close affordance call onClose
//   - on open focus moves into the pane (A11Y-S005-3 managed focus)
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import { DetailPane } from '../DetailPane.jsx';

const UC_ITEM = {
  id: 'UC-S001-1',
  type: 'use-case',
  state: 'done',
  value: 'HIGH',
  cost: '2',
  job: 'Project registry',
};

describe('DetailPane (UC-S005-3)', () => {
  it('renders nothing when no item is selected (pane closed)', () => {
    render(<DetailPane item={null} onClose={() => {}} />);
    expect(screen.queryByTestId('detail-pane')).toBeNull();
  });

  it('opens as a labelled region named "Item detail: <id>" (A11Y-S005-3)', () => {
    render(<DetailPane item={UC_ITEM} onClose={() => {}} />);
    const pane = screen.getByTestId('detail-pane');
    expect(pane.getAttribute('role')).toBe('region');
    expect(pane.getAttribute('aria-label')).toBe('Item detail: UC-S001-1');
  });

  it('shows the item identity: id, type, state, value, cost (AC-S005-3-1 shell)', () => {
    render(<DetailPane item={UC_ITEM} onClose={() => {}} />);
    const pane = screen.getByTestId('detail-pane');
    expect(pane).toHaveTextContent('UC-S001-1');
    expect(pane).toHaveTextContent('use-case');
    expect(pane).toHaveTextContent('done');
    expect(pane).toHaveTextContent('HIGH');
    expect(pane).toHaveTextContent('2');
  });

  it('breadcrumb text includes the selected item id (AC-S005-3-5)', () => {
    render(<DetailPane item={UC_ITEM} onClose={() => {}} />);
    expect(screen.getByTestId('breadcrumb')).toHaveTextContent('UC-S001-1');
  });

  it('renders the full ancestry path in the breadcrumb when a path is given (AC-S005-6-1)', () => {
    render(
      <DetailPane
        item={UC_ITEM}
        crumbPath={[
          { id: 'REQ-OBSERVATORY', type: 'requirement' },
          { id: 'CHK-1', type: 'chunk' },
          { id: 'UC-S001-1', type: 'use-case' },
        ]}
        onClose={() => {}}
      />,
    );
    const nav = screen.getByTestId('breadcrumb');
    expect(nav).toHaveTextContent('REQ-OBSERVATORY');
    expect(nav).toHaveTextContent('CHK-1');
    // current crumb (selected) is marked
    const current = within(nav).getAllByTestId('crumb').at(-1);
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.getAttribute('data-crumb-id')).toBe('UC-S001-1');
  });

  it('clicking an ancestor crumb zooms out via onZoomTo (AC-S005-6-1)', () => {
    const onZoomTo = vi.fn();
    render(
      <DetailPane
        item={UC_ITEM}
        crumbPath={[
          { id: 'REQ-OBSERVATORY', type: 'requirement' },
          { id: 'CHK-1', type: 'chunk' },
          { id: 'UC-S001-1', type: 'use-case' },
        ]}
        onZoomTo={onZoomTo}
        onClose={() => {}}
      />,
    );
    const chk = within(screen.getByTestId('breadcrumb'))
      .getAllByTestId('crumb')
      .find((c) => c.getAttribute('data-crumb-id') === 'CHK-1');
    fireEvent.click(within(chk).getByRole('button'));
    expect(onZoomTo).toHaveBeenCalledWith('CHK-1');
  });

  it('for a slice-backed node lists its artifacts and renders the chosen one as markdown HTML (UC-S005-4)', () => {
    render(
      <DetailPane
        item={UC_ITEM}
        slug="s001-read-layer"
        artifacts={['slice.md', 'acceptance.md']}
        artifactName="slice.md"
        artifactText={'# Slice 001\nThe read layer.'}
        onClose={() => {}}
      />,
    );
    const view = screen.getByTestId('artifact-view');
    // UC-S005-4: markdown is rendered as semantic HTML (a heading), NOT raw <pre>
    expect(view.querySelector('h1')).toBeTruthy();
    expect(view.querySelector(':scope > pre')).toBeNull();
    expect(view).toHaveTextContent('The read layer.');
    // the artifact list is offered as switchable controls
    expect(screen.getByTestId('artifact-list')).toHaveTextContent('acceptance.md');
    // data-source carries the artifact path for traceability
    expect(view.getAttribute('data-source')).toContain('s001-read-layer/slice.md');
  });

  it('renders a "not yet available" placeholder for a node with no slice artifact (AC-S005-3-4)', () => {
    const errSpy = vi.spyOn(console, 'error');
    render(
      <DetailPane
        item={{ id: 'REQ-OBSERVATORY', type: 'requirement', state: 'active', value: 'HIGH', cost: 'XL' }}
        slug={null}
        artifacts={[]}
        artifactText={null}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('artifact-view')).toHaveTextContent(/not yet available/i);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('mounts the ItemHistoryPanel into the history slot with the passed rows (UC-S005-5)', () => {
    render(
      <DetailPane
        item={UC_ITEM}
        historyRows={[
          { timestamp: '2026-06-09T15:10:00Z', agent: 'engineer', event: 'task_end', outcome: 'success' },
          { timestamp: '2026-06-09T14:36:00Z', agent: 'engineer', event: 'task_start', outcome: 'na' },
        ]}
        onClose={() => {}}
      />,
    );
    const slot = screen.getByTestId('item-history-slot');
    const panel = within(slot).getByTestId('item-history');
    expect(within(panel).getAllByTestId('history-row')).toHaveLength(2);
    expect(panel).toHaveTextContent('task_end');
  });

  it('history slot shows "no history" when the item has no rows (UC-S005-5)', () => {
    render(<DetailPane item={UC_ITEM} historyRows={[]} onClose={() => {}} />);
    const slot = screen.getByTestId('item-history-slot');
    expect(within(slot).getByTestId('item-history')).toHaveTextContent(/no history/i);
  });

  it('calls onClose when the × close control is clicked', () => {
    const onClose = vi.fn();
    render(<DetailPane item={UC_ITEM} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('detail-pane-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when "Back to map" is clicked (AC-S005-3-6)', () => {
    const onClose = vi.fn();
    render(<DetailPane item={UC_ITEM} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('back-to-map'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Esc is pressed inside the pane (zoom-out)', () => {
    const onClose = vi.fn();
    render(<DetailPane item={UC_ITEM} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('detail-pane'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the pane on open (managed focus — A11Y-S005-3)', () => {
    render(<DetailPane item={UC_ITEM} onClose={() => {}} />);
    const heading = screen.getByTestId('detail-pane-heading');
    expect(document.activeElement).toBe(heading);
  });
});
