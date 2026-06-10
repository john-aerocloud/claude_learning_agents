// @covers DetailPaneContainer
// UC-S005-3 — DetailPaneContainer (data→render adapter) specs (jsdom).
//
// The container is the wiring seam between the API adapter (getSlices +
// getSliceArtifact) and the pure DetailPane. Given the selected item it resolves
// the slice slug (itemDetail.deriveSliceSlug), fetches the available artifacts
// and the chosen artifact's RAW text, and hands them to DetailPane. On close it
// returns focus to the value-stream map (A11Y-S005-3). Loaders are injected so
// jsdom drives them without network.
//
// Pins:
//   - no item selected → renders nothing (pane closed).
//   - a UC node → resolves its slice slug, fetches + shows the artifact text.
//   - a REQ node (no slice) → shows the "not yet available" placeholder; never fetches an artifact.
//   - on close it clears selection upward (onClose) AND invokes the injected
//     focusOnClose handler (DEFECT-006: the parent restores focus to the
//     originating tree node, not the value-stream map).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { DetailPaneContainer } from '../DetailPaneContainer.jsx';

const UC_ITEM = { id: 'UC-S001-1', type: 'use-case', state: 'done', value: 'HIGH', cost: '2' };
const REQ_ITEM = { id: 'REQ-OBSERVATORY', type: 'requirement', state: 'active', value: 'HIGH', cost: 'XL' };

const deps = (over = {}) => ({
  project: 'observatory',
  loadSlices: vi.fn().mockResolvedValue(['s001-read-layer', 's005-workitem-tree']),
  loadArtifact: vi.fn().mockResolvedValue('# Slice 001\nThe read layer.'),
  onClose: vi.fn(),
  ...over,
});

describe('DetailPaneContainer (UC-S005-3)', () => {
  it('renders nothing when no item is selected', () => {
    const d = deps();
    render(<DetailPaneContainer item={null} {...d} />);
    expect(screen.queryByTestId('detail-pane')).toBeNull();
    expect(d.loadArtifact).not.toHaveBeenCalled();
  });

  it('resolves a UC node to its slice slug and shows the fetched artifact text', async () => {
    const d = deps();
    render(<DetailPaneContainer item={UC_ITEM} {...d} />);
    await waitFor(() => expect(screen.getByTestId('detail-pane')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('artifact-view')).toHaveTextContent('The read layer.'));
    expect(d.loadArtifact).toHaveBeenCalledWith('observatory', 's001-read-layer', 'slice.md');
  });

  it('shows the "not yet available" placeholder for a REQ node (no slice) without fetching an artifact', async () => {
    const d = deps();
    render(<DetailPaneContainer item={REQ_ITEM} {...d} />);
    await waitFor(() => expect(screen.getByTestId('detail-pane')).toBeTruthy());
    expect(screen.getByTestId('artifact-view')).toHaveTextContent(/not yet available/i);
    expect(d.loadArtifact).not.toHaveBeenCalled();
  });

  it('on close calls onClose AND the injected focusOnClose handler (DEFECT-006: parent restores focus to the originating tree node)', async () => {
    const focusOnClose = vi.fn();
    const d = deps({ focusOnClose });
    render(<DetailPaneContainer item={UC_ITEM} {...d} />);
    await waitFor(() => expect(screen.getByTestId('detail-pane')).toBeTruthy());
    fireEvent.click(screen.getByTestId('detail-pane-close'));
    expect(d.onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(focusOnClose).toHaveBeenCalledTimes(1));
  });
});
