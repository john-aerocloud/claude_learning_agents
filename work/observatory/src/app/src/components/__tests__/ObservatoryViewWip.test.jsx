// @covers SPA_OBSVIEW
// @covers SPA_VIEWSWITCH
// @covers SPA_WIPPANEL
// @covers uc-s015-1
// UC-S015-1 — ObservatoryView view-switch wiring (STRUCTURAL change only):
// a tablist in the main column swaps the main-column content between the VSM
// (default) and the WipPanel. The VSM is genuinely UNMOUNTED while the WIP view
// is active (GEO-S015-1 structural half) and the tree rail persists (GEO-S015-3
// structural half). Kept SEPARATE from ObservatoryView.test.jsx /
// ObservatoryViewSteer.test.jsx (parallel-UC file isolation).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { ObservatoryView } from '../ObservatoryView.jsx';

const ITEMS = [
  { id: 'REQ-DEMO', type: 'requirement', parent: '', children: 'CHK-1', job: 'r', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: '', job: 'c', state: 'done', value: 'HIGH', cost: 'M' },
];

const deps = () => ({
  loadItems: vi.fn().mockResolvedValue(ITEMS),
  loadActiveProject: vi.fn().mockResolvedValue('demo'),
});

async function renderView() {
  render(<ObservatoryView {...deps()} />);
  await waitFor(() => expect(screen.getByTestId('work-item-tree')).toBeTruthy());
}

describe('ObservatoryView ⨯ view switch (UC-S015-1)', () => {
  it('defaults to the Pipeline view: VSM mounted, WIP panel absent, tablist present (F-1)', async () => {
    await renderView();
    expect(screen.getByRole('tablist', { name: 'Dashboard view' })).toBeTruthy();
    expect(screen.getByTestId('value-stream-map')).toBeTruthy();
    expect(screen.queryByTestId('wip-panel')).toBeNull();
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('aria-selected')).toBe('true');
  });

  it('clicking "In-flight WIP" swaps the main column: WIP panel in, VSM genuinely UNMOUNTED (F-1 / GEO-S015-1)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-wip'));
    await waitFor(() => expect(screen.getByTestId('wip-panel')).toBeTruthy());
    expect(screen.queryByTestId('value-stream-map')).toBeNull(); // unmounted, not hidden
    expect(screen.getByTestId('view-tab-wip').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('aria-selected')).toBe('false');
  });

  it('the tree rail persists across the switch (GEO-S015-3 structural half)', async () => {
    await renderView();
    const rail = screen.getByTestId('work-item-tree');
    fireEvent.click(screen.getByTestId('view-tab-wip'));
    await waitFor(() => expect(screen.getByTestId('wip-panel')).toBeTruthy());
    expect(screen.getByTestId('work-item-tree')).toBe(rail); // same node, not remounted
  });

  it('"Pipeline" returns to the map in 1 click; the WIP panel unmounts (F-1 back path)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-wip'));
    await waitFor(() => expect(screen.getByTestId('wip-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('view-tab-pipeline'));
    await waitFor(() => expect(screen.getByTestId('value-stream-map')).toBeTruthy());
    expect(screen.queryByTestId('wip-panel')).toBeNull();
  });

  it('switching to WIP moves focus to the panel heading (S15-1-A11Y-2)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-wip'));
    await waitFor(() => expect(screen.getByTestId('wip-panel')).toBeTruthy());
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 2, name: 'In-flight WIP' }),
    );
  });

  it('exactly one h2 named "In-flight WIP" in the WIP view; heading levels not skipped (S15-1-A11Y-6)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-wip'));
    await waitFor(() => expect(screen.getByTestId('wip-panel')).toBeTruthy());
    const wipHeadings = screen.getAllByRole('heading', { name: 'In-flight WIP' });
    expect(wipHeadings).toHaveLength(1);
    expect(wipHeadings[0].tagName).toBe('H2');
  });

  it('each view content mounts inside its labelled tabpanel (aria-controls targets exist)', async () => {
    await renderView();
    const pipelinePanel = document.getElementById('view-panel-pipeline');
    const wipPanelHost = document.getElementById('view-panel-wip');
    expect(pipelinePanel).not.toBeNull();
    expect(wipPanelHost).not.toBeNull();
    expect(pipelinePanel.getAttribute('role')).toBe('tabpanel');
    expect(wipPanelHost.getAttribute('role')).toBe('tabpanel');
    expect(wipPanelHost.hasAttribute('hidden')).toBe(true); // inactive panel hidden + empty
    fireEvent.click(screen.getByTestId('view-tab-wip'));
    await waitFor(() => expect(screen.getByTestId('wip-panel')).toBeTruthy());
    expect(document.getElementById('view-panel-wip').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('view-panel-pipeline').hasAttribute('hidden')).toBe(true);
  });
});
