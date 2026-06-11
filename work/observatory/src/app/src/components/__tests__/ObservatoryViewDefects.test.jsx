// @covers SPA_OBSVIEW
// @covers SPA_VIEWSWITCH
// @covers SPA_DEFECTSPANEL
// @covers uc-s013-2
// UC-S013-2 — ObservatoryView third-tab wiring (STRUCTURAL change only): the
// existing ViewSwitch tablist gains a "Defects" tab whose tabpanel mounts the
// DefectsPanelContainer; the VSM is genuinely UNMOUNTED while the Defects view
// is active (GEO-S013-2-1 structural half) and the tree rail persists
// (GEO-S013-2-3 structural half). Kept SEPARATE from ObservatoryView.test.jsx /
// ObservatoryViewSteer.test.jsx / ObservatoryViewWip.test.jsx (parallel-UC
// file isolation — UC-S015-2 owns the steer/WIP wiring surfaces).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { ObservatoryView } from '../ObservatoryView.jsx';

const ITEMS = [
  { id: 'REQ-DEMO', type: 'requirement', parent: '', children: 'CHK-1', job: 'r', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: '', job: 'c', state: 'done', value: 'HIGH', cost: 'M' },
];

const DEFECTS = [
  {
    id: 'DEFECT-001',
    title: 'UI shows 0 for everything while work is happening',
    status: 'CLOSED',
    severity: 'HIGH',
    mttr_s: 815,
    mttr_units: 's',
  },
  {
    id: 'DEFECT-012',
    title: 'Decomposed work is invisible between product completion and triage',
    status: 'CONFIRMED',
    severity: null,
    mttr_s: null,
    mttr_units: 's',
  },
];

beforeEach(() => {
  // The DefectsPanelContainer uses the real api adapter defaults; stub fetch
  // so /api/active + /api/projects/:id/defects resolve in jsdom.
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const body = String(url).endsWith('/defects') ? DEFECTS : { active: 'demo' };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  );
});

const deps = () => ({
  loadItems: vi.fn().mockResolvedValue(ITEMS),
  loadActiveProject: vi.fn().mockResolvedValue('demo'),
});

async function renderView() {
  render(<ObservatoryView {...deps()} />);
  await waitFor(() => expect(screen.getByTestId('work-item-tree')).toBeTruthy());
}

describe('ObservatoryView ⨯ Defects tab (UC-S013-2)', () => {
  it('the Pipeline default is unchanged: VSM mounted, Defects panel absent, three tabs present', async () => {
    await renderView();
    expect(screen.getByTestId('value-stream-map')).toBeTruthy();
    expect(screen.queryByTestId('defects-panel')).toBeNull();
    expect(screen.getByTestId('view-tab-defects').getAttribute('aria-selected')).toBe('false');
  });

  it('clicking "Defects" swaps the main column: panel in, VSM genuinely UNMOUNTED (GEO-S013-2-1 structural half)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-defects'));
    await waitFor(() => expect(screen.getByTestId('defects-panel')).toBeTruthy());
    expect(screen.queryByTestId('value-stream-map')).toBeNull(); // unmounted, not hidden
    expect(screen.getByTestId('view-tab-defects').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('aria-selected')).toBe('false');
  });

  it('the panel renders the live rows grouped open-first (data path through the real adapter seam)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-defects'));
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('defect-row');
    expect(rows[0].getAttribute('data-defect-id')).toBe('DEFECT-012'); // open leads
    expect(rows[1].getAttribute('data-defect-id')).toBe('DEFECT-001');
    expect(screen.getByTestId('defects-count').textContent).toMatch(/2 defects, 1 open/);
  });

  it('the tree rail persists across the switch (GEO-S013-2-3 structural half)', async () => {
    await renderView();
    const rail = screen.getByTestId('work-item-tree');
    fireEvent.click(screen.getByTestId('view-tab-defects'));
    await waitFor(() => expect(screen.getByTestId('defects-panel')).toBeTruthy());
    expect(screen.getByTestId('work-item-tree')).toBe(rail); // same node, not remounted
  });

  it('"Pipeline" returns to the map in 1 click; the Defects panel unmounts (back path)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-defects'));
    await waitFor(() => expect(screen.getByTestId('defects-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('view-tab-pipeline'));
    await waitFor(() => expect(screen.getByTestId('value-stream-map')).toBeTruthy());
    expect(screen.queryByTestId('defects-panel')).toBeNull();
  });

  it('switching to Defects moves focus to the panel heading (S13-2-A11Y-2)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-defects'));
    await waitFor(() => expect(screen.getByTestId('defects-panel')).toBeTruthy());
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 2, name: 'Defects' }),
    );
  });

  it('exactly one h2 "Defects"; group headings are h3 — no skipped levels (S13-2-A11Y-6)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('view-tab-defects'));
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(2));
    const defHeadings = screen.getAllByRole('heading', { name: 'Defects' });
    expect(defHeadings).toHaveLength(1);
    expect(defHeadings[0].tagName).toBe('H2');
    expect(screen.getByTestId('defects-group-open').tagName).toBe('H3');
  });

  it('the Defects content mounts inside its labelled tabpanel; inactive tabpanel is hidden AND empty', async () => {
    await renderView();
    const host = document.getElementById('view-panel-defects');
    expect(host).not.toBeNull();
    expect(host.getAttribute('role')).toBe('tabpanel');
    expect(host.getAttribute('aria-labelledby')).toBe('view-tab-defects');
    expect(host.hasAttribute('hidden')).toBe(true);
    expect(host.children.length).toBe(0); // genuinely empty while inactive
    fireEvent.click(screen.getByTestId('view-tab-defects'));
    await waitFor(() => expect(screen.getByTestId('defects-panel')).toBeTruthy());
    expect(document.getElementById('view-panel-defects').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('view-panel-pipeline').hasAttribute('hidden')).toBe(true);
  });
});
