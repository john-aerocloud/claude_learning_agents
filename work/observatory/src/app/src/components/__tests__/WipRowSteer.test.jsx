// @covers uc-s015-2
// @covers SPA_WIPPANEL
// @covers SPA_WIPROW
// @covers SteerMenu
// UC-S015-2 — SteerMenu COMPOSITION into WipRow (the s014 read-only reuse, the
// same idiom as TreeNode/StageNode hosts): a trailing per-row trigger, the
// onSteer prop threaded WipPanelContainer → WipPanel → WipRow → SteerMenu.
// Kept SEPARATE from WipPanel.test.jsx (UC-S015-1's file) — parallel-UC file
// isolation; this file owns only the steer-composition pins.
//
// Pins (jsdom half; geometry/axe in e2e/wip-steer.spec.js):
//   - F-S2-1 / S15-2-A11Y-1: exactly ONE steer-btn per wip-row, named for ITS
//     item (id + job — S15-2-FIG-1), data-steer-item-id = the live id
//   - trailing placement: the trigger FOLLOWS the <dl> figures in DOM order
//   - data-item-id stays the row's UNIQUE contract (never duplicated on the
//     trigger — the strict-mode lesson recorded in SteerMenu.jsx)
//   - S15-2-FIG-2: menu shows the four HUMAN labels, never the enum as text
//   - threading: selection reports (itemId, actionType) through the prop chain
//   - onSteer is optional: composition renders + selection does not crash
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/preact';
import { WipPanel, WipRow, WipPanelContainer } from '../WipPanel.jsx';

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

const HUMAN_LABELS = ['Raise defect', 'Re-prioritise', 'Request re-slice / split', 'Custom steer'];
const ENUMS = ['raise-defect', 're-prioritise', 're-slice', 'custom'];

function renderPanel(over = {}) {
  return render(
    <WipPanel items={[STALE, FRESH]} status="ready" horizonMs={HORIZON} {...over} />,
  );
}

function rowOf(id) {
  return document.querySelector(`[data-testid="wip-row"][data-item-id="${id}"]`);
}

describe('WipRow hosts SteerMenu (UC-S015-2 F-S2-1 / S15-2-A11Y-1 / S15-2-FIG-1)', () => {
  it('renders EXACTLY one steer trigger per WIP row, named for ITS item id + job', () => {
    renderPanel({ onSteer: () => {} });
    expect(screen.getAllByTestId('steer-btn')).toHaveLength(2);
    for (const item of [STALE, FRESH]) {
      const row = rowOf(item.id);
      const btns = within(row).getAllByTestId('steer-btn');
      expect(btns).toHaveLength(1);
      const name = btns[0].getAttribute('aria-label');
      expect(name).toMatch(new RegExp(`^Steer ${item.id}`));
      expect(name).toContain(item.job); // S15-2-FIG-1: human reference, id + job
      expect(name).not.toMatch(/row:\d+/i);
      expect(btns[0].getAttribute('data-steer-item-id')).toBe(item.id);
    }
  });

  it('places the trigger TRAILING — after the <dl> figures in DOM order (GEO-S015-2-WIP-2 structural half)', () => {
    renderPanel({ onSteer: () => {} });
    const row = rowOf('CHK-4');
    const dl = row.querySelector('dl.wip-row__figures');
    const btn = within(row).getByTestId('steer-btn');
    expect(dl).not.toBeNull();
    // the trigger follows the figures: "figures … steer", never interrupting the band
    expect(dl.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps data-item-id UNIQUE to the row — the trigger carries data-steer-item-id only', () => {
    renderPanel({ onSteer: () => {} });
    // strict-mode contract: [data-item-id="X"] must keep selecting exactly ONE node
    expect(document.querySelectorAll('[data-item-id="CHK-4"]')).toHaveLength(1);
    const btn = within(rowOf('CHK-4')).getByTestId('steer-btn');
    expect(btn.hasAttribute('data-item-id')).toBe(false);
  });

  it('WipRow alone (no onSteer) still renders the trigger and selection does not crash', () => {
    render(
      <ul>
        <WipRow item={FRESH} horizonMs={HORIZON} />
      </ul>,
    );
    const btn = screen.getByTestId('steer-btn');
    fireEvent.click(btn);
    fireEvent.click(screen.getByTestId('steer-action-custom')); // no handler → no throw
    expect(screen.queryByTestId('steer-menu')).toBeNull(); // menu closed after selection
  });
});

describe('WIP-row steer menu content (S15-2-FIG-2)', () => {
  it('lists EXACTLY the four human-labelled actions; the enum rides data-action only', () => {
    renderPanel({ onSteer: () => {} });
    fireEvent.click(within(rowOf('UC-9')).getByTestId('steer-btn'));
    const menu = screen.getByTestId('steer-menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent.trim())).toEqual(HUMAN_LABELS);
    ENUMS.forEach((enumValue, i) => {
      expect(items[i].getAttribute('data-action')).toBe(enumValue);
      expect(items[i].textContent.trim()).not.toBe(enumValue);
    });
  });
});

describe('onSteer threads through the WIP chain (UC-S015-2 wiring)', () => {
  it('WipPanel → WipRow → SteerMenu: selection reports (itemId, actionType)', () => {
    const onSteer = vi.fn();
    renderPanel({ onSteer });
    fireEvent.click(within(rowOf('CHK-4')).getByTestId('steer-btn'));
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onSteer).toHaveBeenCalledWith('CHK-4', 're-slice');
  });

  it('each of the four actions reports its own enum from a WIP row', () => {
    for (const enumValue of ENUMS) {
      const onSteer = vi.fn();
      const { unmount } = renderPanel({ onSteer });
      fireEvent.click(within(rowOf('UC-9')).getByTestId('steer-btn'));
      fireEvent.click(screen.getByTestId(`steer-action-${enumValue}`));
      expect(onSteer).toHaveBeenCalledWith('UC-9', enumValue);
      unmount();
    }
  });

  it('WipPanelContainer passes onSteer down to the rows (pass-through, no logic)', async () => {
    const onSteer = vi.fn();
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
        onSteer={onSteer}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('wip-row')).toBeTruthy());
    fireEvent.click(screen.getByTestId('steer-btn'));
    fireEvent.click(screen.getByTestId('steer-action-raise-defect'));
    expect(onSteer).toHaveBeenCalledWith('CHK-4', 'raise-defect');
  });
});
