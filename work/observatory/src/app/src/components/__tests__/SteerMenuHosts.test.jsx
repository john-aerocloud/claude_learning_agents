// @covers uc-s014-1
// @covers SteerMenu
// @covers StageNode
// @covers ValueStreamMap
// @covers VsmContainer
// @covers WorkItemTree
// @covers TreeNode
// UC-S014-1 — SteerMenu COMPOSITION into the two host surfaces (read-only
// onSteer prop-slot threading; NO host logic change):
//   chip path: VsmContainer → ValueStreamMap → StageNode → queue chip <li>
//   row  path: WorkItemTree → TreeNode → .tree-node__row
// Pins:
//   - F-1: steer-btn present on every shown WIP/queue chip and every tree row
//   - F-4 / S14-1-A11Y-7: item-bearing elements ONLY — exactly one trigger per
//     chip/row; none on stage heads, region headings, lane labels, "+N more"
//   - STEER-FIG-1: each trigger's accessible name carries ITS item's id
//   - F-3: selection threads (itemId, actionType) up through the host prop slot
//   - drill unchanged: a steer click neither selects the tree row (UC-S005-3
//     drill) nor toggles the StageNode source reveal
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import { StageNode } from '../StageNode.jsx';
import { ValueStreamMap } from '../ValueStreamMap.jsx';
import { VsmContainer } from '../VsmContainer.jsx';
import { WorkItemTree } from '../WorkItemTree.jsx';

const readyStage = {
  stage: 'ready',
  label: 'Ready (queue)',
  throughput: 3,
  active_days: 3,
  throughput_per_active_day: 1,
  dwell_median_s: 0,
  dwell_pairs: 0,
  wip: 0,
  rework: 0,
  source_rows: ['row:10'],
  queue_depth: 5,
  queue_items: [1, 2, 3, 4, 5].map((n) => ({
    item_id: `UC-Q${n}`,
    enqueued_at: '2026-06-10T08:00:00Z',
    wait_s: 60 * n,
  })),
  coherence_warning: false,
};

const ITEMS = [
  { id: 'REQ-OBSERVATORY', type: 'requirement', parent: '', children: 'CHK-5', job: 'Observe the pipeline', state: 'active', value: 'HIGH', cost: 'XL', vc_ratio: 'HIGH/XL' },
  { id: 'CHK-5', type: 'chunk', parent: 'REQ-OBSERVATORY', children: '', job: 'Steer prompt handoff', state: 'in-progress', value: 'HIGH', cost: 'M', vc_ratio: 'HIGH/M' },
];
const ALL_IDS = new Set(ITEMS.map((i) => i.id));

describe('StageNode queue chips host SteerMenu (UC-S014-1 F-1/F-4)', () => {
  it('renders EXACTLY one steer-btn per shown queued-item chip, named for ITS item', () => {
    render(<StageNode data={readyStage} />);
    // 5 queued, 3 shown (MAX_QUEUE_ITEMS_SHOWN) → 3 triggers
    expect(screen.getAllByTestId('steer-btn')).toHaveLength(3);
    ['UC-Q1', 'UC-Q2', 'UC-Q3'].forEach((id) => {
      const chip = screen.getByTestId(`queued-item-ready-${id}`);
      const btns = within(chip).getAllByTestId('steer-btn');
      expect(btns).toHaveLength(1);
      expect(btns[0].getAttribute('aria-label')).toContain(id);
    });
  });

  it('puts NO steer-btn on the "+N more" chip, the stage head, or the depth figure (F-4)', () => {
    render(<StageNode data={readyStage} />);
    expect(within(screen.getByTestId('queue-more-ready')).queryByTestId('steer-btn')).toBeNull();
    const head = document.querySelector('.stage-node__head');
    expect(head.querySelector('[data-testid="steer-btn"]')).toBeNull();
    const depthValue = screen.getByTestId('metric-value-ready-depth');
    expect(depthValue.querySelector('[data-testid="steer-btn"]')).toBeNull();
  });

  it('renders no steer-btn at all on a non-queue work stage (no item-bearing chips)', () => {
    render(
      <StageNode
        data={{ ...readyStage, stage: 'engineer', label: 'Build', queue_depth: null, queue_items: null, wip: 2 }}
      />,
    );
    expect(screen.queryAllByTestId('steer-btn')).toHaveLength(0);
  });

  it('threads onSteer: selecting an action reports (itemId, actionType) from the chip', () => {
    const onSteer = vi.fn();
    render(<StageNode data={readyStage} onSteer={onSteer} />);
    const chip = screen.getByTestId('queued-item-ready-UC-Q2');
    fireEvent.click(within(chip).getByTestId('steer-btn'));
    fireEvent.click(screen.getByTestId('steer-action-re-prioritise'));
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onSteer).toHaveBeenCalledWith('UC-Q2', 're-prioritise');
  });

  it('a steer click does NOT toggle the StageNode source reveal (host behaviour unchanged)', () => {
    render(<StageNode data={readyStage} onSteer={() => {}} />);
    const node = screen.getByTestId('stage-ready');
    expect(node.getAttribute('data-source-open')).toBe('false');
    const chip = screen.getByTestId('queued-item-ready-UC-Q1');
    fireEvent.keyDown(within(chip).getByTestId('steer-btn'), { key: 'Enter' });
    fireEvent.click(within(chip).getByTestId('steer-btn'));
    expect(node.getAttribute('data-source-open')).toBe('false');
  });
});

describe('ValueStreamMap / VsmContainer thread the onSteer prop slot (UC-S014-1)', () => {
  it('ValueStreamMap passes onSteer down to StageNode chips', () => {
    const onSteer = vi.fn();
    render(<ValueStreamMap stages={[readyStage]} onSteer={onSteer} />);
    const chip = screen.getByTestId('queued-item-ready-UC-Q1');
    fireEvent.click(within(chip).getByTestId('steer-btn'));
    fireEvent.click(screen.getByTestId('steer-action-raise-defect'));
    expect(onSteer).toHaveBeenCalledWith('UC-Q1', 'raise-defect');
  });

  it('VsmContainer passes onSteer down through the loaded map', async () => {
    const onSteer = vi.fn();
    const loadFlow = () => Promise.resolve([readyStage]);
    render(<VsmContainer loadFlow={loadFlow} subscribe={() => () => {}} onSteer={onSteer} />);
    const chip = await screen.findByTestId('queued-item-ready-UC-Q1');
    fireEvent.click(within(chip).getByTestId('steer-btn'));
    fireEvent.click(screen.getByTestId('steer-action-custom'));
    expect(onSteer).toHaveBeenCalledWith('UC-Q1', 'custom');
  });
});

describe('WorkItemTree rows host SteerMenu (UC-S014-1 F-1/F-4)', () => {
  function ownRow(id) {
    return document.querySelector(`[data-item-id="${id}"] > .tree-node__row`);
  }

  it('renders EXACTLY one steer-btn per tree row, named for ITS item id', () => {
    render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} />);
    expect(screen.getAllByTestId('steer-btn')).toHaveLength(ITEMS.length);
    ITEMS.forEach(({ id }) => {
      const btns = ownRow(id).querySelectorAll(':scope > .steer > [data-testid="steer-btn"]');
      expect(btns).toHaveLength(1);
      expect(btns[0].getAttribute('aria-label')).toContain(id);
    });
  });

  it('puts NO steer-btn on the region heading or outside treeitem rows (F-4)', () => {
    render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} />);
    const heading = document.querySelector('.work-item-tree__h');
    expect(heading.querySelector('[data-testid="steer-btn"]')).toBeNull();
    document.querySelectorAll('[data-testid="steer-btn"]').forEach((btn) => {
      expect(btn.closest('[role="treeitem"]')).not.toBeNull();
    });
  });

  it('threads onSteer: selecting an action reports (itemId, actionType) from the row', () => {
    const onSteer = vi.fn();
    render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} onSteer={onSteer} />);
    fireEvent.click(within(ownRow('CHK-5')).getByTestId('steer-btn'));
    fireEvent.click(screen.getByTestId('steer-action-re-slice'));
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onSteer).toHaveBeenCalledWith('CHK-5', 're-slice');
  });

  it('steer interaction does NOT drill the row (UC-S005-3 onSelect unchanged)', () => {
    const onSelect = vi.fn();
    const onSteer = vi.fn();
    render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} onSelect={onSelect} onSteer={onSteer} />);
    const btn = within(ownRow('CHK-5')).getByTestId('steer-btn');
    fireEvent.keyDown(btn, { key: 'Enter' }); // tree ul keydown must not see it
    fireEvent.click(btn);
    fireEvent.click(screen.getByTestId('steer-action-custom'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSteer).toHaveBeenCalledWith('CHK-5', 'custom');
  });

  it('row click still drills as before (host behaviour unchanged)', () => {
    const onSelect = vi.fn();
    render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} onSelect={onSelect} onSteer={() => {}} />);
    fireEvent.click(ownRow('CHK-5'));
    expect(onSelect).toHaveBeenCalledWith('CHK-5');
  });

  it('trigger accessible name includes the human job sentence when the row has one (STEER-FIG-1)', () => {
    render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} />);
    const btn = within(ownRow('CHK-5')).getByTestId('steer-btn');
    expect(btn.getAttribute('aria-label')).toMatch(/Steer CHK-5/);
    expect(btn.getAttribute('aria-label')).toContain('Steer prompt handoff');
  });
});
