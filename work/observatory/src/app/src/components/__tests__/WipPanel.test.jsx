// @covers SPA_WIPPANEL
// @covers SPA_WIPROW
// @covers uc-s015-1
// UC-S015-1 — WipPanel/WipRow: the in-flight WIP list, presentational.
// F-2..F-5, S15-1-A11Y-2/3/5/6/7, S15-1-FIG-1..4, S15-1-WIP-2 (render side).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/preact';
import { WipPanel, WipPanelContainer } from '../WipPanel.jsx';

const HORIZON = 2 * 60 * 60 * 1000;

const FRESH = {
  id: 'CHK-4',
  job: 'Tree and zoom chunk',
  stage: 'engineer',
  stageLabel: 'Build / TDD (engineer)',
  value: 'HIGH',
  cost: 'M',
  dwellMs: 15 * 60_000,
  dwellText: '15 min',
  isStale: false,
};

const STALE = {
  id: 'UC-9',
  job: 'Validate the build',
  stage: 'validate',
  stageLabel: 'Validate (tester)',
  value: 'MED',
  cost: '2',
  dwellMs: 5 * 60 * 60_000,
  dwellText: '5 h',
  isStale: true,
};

const UNKNOWN = {
  id: 'GHOST-1',
  job: 'No start timestamp',
  stage: 'engineer',
  stageLabel: 'Build / TDD (engineer)',
  value: '—',
  cost: '—',
  dwellMs: null,
  dwellText: '—',
  isStale: false,
};

function renderPanel(over = {}) {
  return render(
    <WipPanel
      items={[STALE, FRESH]}
      status="ready"
      horizonMs={HORIZON}
      sourceRef="process/dora/ledger.csv"
      {...over}
    />,
  );
}

describe('WipPanel (UC-S015-1)', () => {
  it('renders a region named "In-flight WIP" with a visible <h2> (S15-1-A11Y-2/5/6)', () => {
    renderPanel();
    expect(screen.getByRole('region', { name: 'In-flight WIP' })).toBeInTheDocument();
    expect(screen.getByTestId('wip-panel')).toBeInTheDocument();
    const h2 = screen.getByRole('heading', { level: 2, name: 'In-flight WIP' });
    expect(h2).toBeVisible();
  });

  it('moves focus to the heading on mount (S15-1-A11Y-2 — switch lands the reader in the panel)', () => {
    renderPanel();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 2, name: 'In-flight WIP' }),
    );
  });

  it('renders one listitem per in-flight item inside a role=list (F-2)', () => {
    renderPanel();
    const list = screen.getByRole('list');
    expect(within(list).getAllByTestId('wip-row')).toHaveLength(2);
  });

  it('rows carry data-item-id (the UC-S015-2 composition hook), never a positional token (S15-1-FIG-2)', () => {
    renderPanel();
    const ids = screen.getAllByTestId('wip-row').map((r) => r.getAttribute('data-item-id'));
    expect(ids).toEqual(['UC-9', 'CHK-4']);
    for (const id of ids) expect(id).not.toMatch(/^row:\d+$/);
  });

  it('each row shows id, job sentence, human stage label, value, cost, unit-bearing dwell as labelled dt/dd pairs (F-3 / S15-1-FIG-1/2)', () => {
    renderPanel({ items: [FRESH] });
    const row = screen.getByTestId('wip-row');
    expect(within(row).getByTestId('wip-id')).toHaveTextContent('CHK-4');
    expect(within(row).getByTestId('wip-job')).toHaveTextContent('Tree and zoom chunk');
    expect(within(row).getByTestId('wip-stage')).toHaveTextContent('Build / TDD (engineer)');
    expect(within(row).getByTestId('wip-stage').textContent).not.toBe('engineer'); // not the enum key
    expect(within(row).getByTestId('wip-value')).toHaveTextContent('HIGH');
    expect(within(row).getByTestId('wip-cost')).toHaveTextContent('M');
    const dwell = within(row).getByTestId('wip-dwell');
    expect(dwell.textContent).toMatch(/\d+\s*(h|min|s)/); // unit-bearing, never bare
    // every figure is a <dd> labelled by a <dt> (never announced bare)
    const dts = row.querySelectorAll('dt');
    const dds = row.querySelectorAll('dd');
    expect(dts.length).toBe(dds.length);
    expect(dts.length).toBeGreaterThanOrEqual(6);
  });

  it('rows are rendered in the given order — sorted longest-in-stage first upstream (F-4)', () => {
    renderPanel();
    const rows = screen.getAllByTestId('wip-row');
    expect(rows[0].getAttribute('data-item-id')).toBe('UC-9'); // 5h leads 15min
  });

  it('a stale-open row is flagged with text + glyph + data-stale, never colour alone (S15-1-WIP-2 / S15-1-A11Y-3)', () => {
    renderPanel();
    const stale = screen.getAllByTestId('wip-row')[0];
    expect(stale.getAttribute('data-stale')).toBe('true');
    const badge = within(stale).getByTestId('stale-badge');
    expect(badge).toHaveTextContent('stale — over 2h'); // authoritative visible text
    const glyph = badge.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull(); // shape cue
    // fresh row carries no stale cue
    const fresh = screen.getAllByTestId('wip-row')[1];
    expect(fresh.getAttribute('data-stale')).toBe('false');
    expect(within(fresh).queryByTestId('stale-badge')).toBeNull();
  });

  it('row accessible name carries id + job + dwell (+ stale) — never bare (S15-1-A11Y-5)', () => {
    renderPanel();
    const stale = screen.getAllByTestId('wip-row')[0];
    const name = stale.getAttribute('aria-label');
    expect(name).toContain('UC-9');
    expect(name).toContain('Validate the build');
    expect(name).toContain('5 h');
    expect(name).toMatch(/stale, over 2h/);
    const fresh = screen.getAllByTestId('wip-row')[1];
    expect(fresh.getAttribute('aria-label')).not.toMatch(/stale/);
  });

  it('unknown dwell renders "—", not "0 s" (S15-1-FIG-3)', () => {
    renderPanel({ items: [UNKNOWN] });
    expect(screen.getByTestId('wip-dwell')).toHaveTextContent('—');
    expect(screen.getByTestId('wip-dwell').textContent).not.toMatch(/^0/);
  });

  it('zero-WIP shows the labelled empty state; the row list is absent; no crash (F-5 / S15-1-FIG-4)', () => {
    render(<WipPanel items={[]} status="empty" horizonMs={HORIZON} />);
    expect(screen.getByText('No items currently in flight')).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByTestId('wip-row')).toBeNull();
  });

  it('loading state renders region + heading immediately, no rows, no empty text', () => {
    render(<WipPanel items={[]} status="loading" horizonMs={null} />);
    expect(screen.getByRole('region', { name: 'In-flight WIP' })).toBeInTheDocument();
    expect(screen.queryByTestId('wip-row')).toBeNull();
    expect(screen.queryByText('No items currently in flight')).toBeNull();
  });

  it('the row count lives in a polite live region (S15-1-A11Y-7)', () => {
    renderPanel();
    const status = screen.getByTestId('wip-count');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status).toHaveTextContent('2 items in flight');
  });

  it('the panel carries the ledger sourceRef (traceability convention)', () => {
    renderPanel();
    expect(screen.getByTestId('wip-panel').getAttribute('data-source')).toBe(
      'process/dora/ledger.csv',
    );
  });
});

describe('WipPanelContainer (hook → panel wiring)', () => {
  it('fetches via injected loaders and renders the composed rows', async () => {
    const flow = [
      {
        stage: 'engineer',
        label: 'Build / TDD (engineer)',
        wip_horizon_ms: HORIZON,
        open_items: [
          { item_id: 'CHK-4', note: 'build c', opened_at: 't', dwell_ms: 900_000, stale: false },
        ],
      },
    ];
    render(
      <WipPanelContainer
        loadActive={() => Promise.resolve('demo')}
        loadFlow={() => Promise.resolve(flow)}
        loadItems={() =>
          Promise.resolve([{ id: 'CHK-4', job: 'Tree and zoom chunk', value: 'HIGH', cost: 'M' }])
        }
        subscribe={() => () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('wip-row')).toBeInTheDocument());
    expect(screen.getByTestId('wip-job')).toHaveTextContent('Tree and zoom chunk');
  });

  it('fails soft to the empty state when the API is unreachable (F-5)', async () => {
    render(
      <WipPanelContainer
        loadActive={() => Promise.resolve(null)}
        loadFlow={() => Promise.resolve(null)}
        loadItems={() => Promise.resolve(null)}
        subscribe={() => {
          throw new Error('no EventSource');
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('No items currently in flight')).toBeInTheDocument(),
    );
  });
});
