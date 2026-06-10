// @covers WorkItemTree
// @covers TreeNode
// @covers SpaceTagBadge
// @covers workItemTree
// UC-S005-2 — Work-item tree render specs (jsdom). Drives the left-rail
// keyboard-navigable REQ→CHK→SLC→UC tree, the per-node state + value/cost
// badges, and the /work-vs-/process non-colour-redundant cues.
//
// Pins (acceptance.md UC-S005-2 + A11Y-S005-1/2/6 + the node-click hook for
// UC-S005-3):
//   AC-S005-2-2 — REQ root; CHK under REQ; UC under CHK.
//   AC-S005-2-4 — every tree-node has a non-empty data-space.
//   AC-S005-2-5 — distinct data-space → distinct space-tag class (visual distinct).
//   AC-S005-2-6 — state is never colour-only: data-state + visible state text.
//   AC-S005-2-7 — value + cost visible (data-value/data-cost non-empty).
//   A11Y-S005-1 — role=tree/treeitem; roving tabindex (one tabbable); arrows move
//                 focus; → expands, ← collapses; Enter selects (drill hook).
//   A11Y-S005-2 — accessible name carries type + state + value/cost.
//   node-click hook — onSelect(id) fires on click AND Enter (UC-S005-3 seam).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/preact';
import { WorkItemTree } from '../WorkItemTree.jsx';

const ITEMS = [
  { id: 'REQ-OBSERVATORY', type: 'requirement', parent: '', children: 'CHK-1|CHK-4', job: 'Observe the pipeline', state: 'active', value: 'HIGH', cost: 'XL', vc_ratio: 'HIGH/XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-OBSERVATORY', children: 'UC-S001-1', job: 'Read layer', state: 'done', value: 'HIGH', cost: 'M', vc_ratio: 'HIGH/M' },
  { id: 'UC-S001-1', type: 'use-case', parent: 'CHK-1', children: '', job: 'Project registry', state: 'done', value: 'HIGH', cost: '2', vc_ratio: '1.50' },
  { id: 'CHK-4', type: 'chunk', parent: 'REQ-OBSERVATORY', children: 'UC-S005-2', job: 'Tree & zoom', state: 'in-progress', value: 'HIGH', cost: 'M', vc_ratio: 'HIGH/M' },
  { id: 'UC-S005-2', type: 'use-case', parent: 'CHK-4', children: '', job: 'Tree render', state: 'ready', value: 'HIGH', cost: '3', vc_ratio: '1.00' },
];

// All nodes expanded so deep nodes are queryable without first driving toggles.
const ALL_IDS = new Set(ITEMS.map((i) => i.id));

// The treeitem is the <li>; its OWN row (badges, glyph) is .tree-node__row —
// scoping to the row excludes descendant nodes' badges in a subtree.
function ownRow(id) {
  return document.querySelector(`[data-item-id="${id}"] > .tree-node__row`);
}

function renderTree(props = {}) {
  return render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} {...props} />);
}

describe('WorkItemTree structure + a11y (UC-S005-2)', () => {
  it('renders a role=tree landmark labelled "Work items"', () => {
    renderTree();
    const tree = screen.getByTestId('work-item-tree');
    expect(tree).toHaveAttribute('role', 'tree');
    expect(tree).toHaveAttribute('aria-label', 'Work items');
  });

  it('renders one treeitem per item; count == input row count (AC-S005-2-1 invariant)', () => {
    renderTree();
    const nodes = screen.getAllByTestId('tree-node');
    expect(nodes).toHaveLength(ITEMS.length);
    nodes.forEach((n) => expect(n).toHaveAttribute('role', 'treeitem'));
  });

  it('REQ is the root; CHK nodes nest under it; UC nests under CHK (AC-S005-2-2)', () => {
    renderTree();
    const tree = screen.getByTestId('work-item-tree');
    // REQ is a direct child group of the tree; CHK-1 sits inside REQ's subtree.
    const req = tree.querySelector('[data-item-id="REQ-OBSERVATORY"]');
    expect(req).toBeTruthy();
    const chk1 = req.querySelector('[data-item-id="CHK-1"]');
    expect(chk1).toBeTruthy();
    const uc = chk1.querySelector('[data-item-id="UC-S001-1"]');
    expect(uc).toBeTruthy();
    // aria-level increases with depth
    expect(req.getAttribute('aria-level')).toBe('1');
    expect(chk1.getAttribute('aria-level')).toBe('2');
    expect(uc.getAttribute('aria-level')).toBe('3');
  });

  it('every tree-node carries a non-empty data-space (AC-S005-2-4)', () => {
    renderTree();
    screen.getAllByTestId('tree-node').forEach((n) => {
      expect(n.getAttribute('data-space')).toBeTruthy();
    });
  });

  it('renders a space-tag badge with visible text + aria-hidden icon (AC-S005-2-4, A11Y-S005-6)', () => {
    renderTree();
    const tag = within(ownRow('REQ-OBSERVATORY')).getByTestId('space-tag');
    expect(tag).toHaveTextContent(/work/i);
    expect(tag.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('maps distinct data-space values to distinct space-tag class (AC-S005-2-5)', () => {
    // Two records with distinct derived spaces: one /work, one /process via path.
    const mixed = [
      { id: 'W', type: 'use-case', parent: '', children: '', job: 'w', state: 'ready', value: 'HIGH', cost: '1', path: 'work/observatory/items/items.csv' },
      { id: 'P', type: 'use-case', parent: '', children: '', job: 'p', state: 'ready', value: 'HIGH', cost: '1', path: 'process/dora/ledger.csv' },
    ];
    render(<WorkItemTree items={mixed} expandedIds={new Set(['W', 'P'])} />);
    const w = document.querySelector('[data-item-id="W"]');
    const p = document.querySelector('[data-item-id="P"]');
    expect(w.getAttribute('data-space')).toBe('work');
    expect(p.getAttribute('data-space')).toBe('process');
    const wTag = within(w).getByTestId('space-tag');
    const pTag = within(p).getByTestId('space-tag');
    expect(wTag.className).not.toBe(pTag.className);
    expect(pTag).toHaveTextContent(/process/i);
  });

  it('state is never colour-only: data-state + a visible state text label (AC-S005-2-6)', () => {
    renderTree();
    const chk1 = document.querySelector('[data-item-id="CHK-1"]');
    expect(chk1.getAttribute('data-state')).toBe('done');
    expect(within(ownRow('CHK-1')).getByTestId('state-badge')).toHaveTextContent(/done/i);
    expect(within(ownRow('CHK-4')).getByTestId('state-badge')).toHaveTextContent(/in-progress/i);
  });

  it('value + cost visible on each node (AC-S005-2-7)', () => {
    renderTree();
    const uc = document.querySelector('[data-item-id="UC-S001-1"]');
    expect(uc.getAttribute('data-value')).toBeTruthy();
    expect(uc.getAttribute('data-cost')).toBeTruthy();
    const vc = within(uc).getByTestId('vc-badge');
    expect(vc).toHaveTextContent(/HIGH/);
    expect(vc).toHaveTextContent(/2/);
  });

  it('accessible name carries type + state + value/cost (A11Y-S005-2)', () => {
    renderTree();
    const chk4 = document.querySelector('[data-item-id="CHK-4"]');
    const label = chk4.getAttribute('aria-label');
    expect(label).toMatch(/CHK-4/);
    expect(label).toMatch(/chunk/i);
    expect(label).toMatch(/in-progress/i);
    expect(label).toMatch(/HIGH/);
  });
});

describe('WorkItemTree keyboard navigation (A11Y-S005-1)', () => {
  it('exactly ONE treeitem is tabbable (roving tabindex)', () => {
    renderTree();
    const tabbable = screen.getAllByTestId('tree-node').filter((n) => n.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    // and it is the first visible node (the root)
    expect(tabbable[0].getAttribute('data-item-id')).toBe('REQ-OBSERVATORY');
  });

  it('ArrowDown moves focus to the next visible node', () => {
    renderTree();
    const req = document.querySelector('[data-item-id="REQ-OBSERVATORY"]');
    req.focus();
    fireEvent.keyDown(req, { key: 'ArrowDown' });
    expect(document.activeElement.getAttribute('data-item-id')).toBe('CHK-1');
  });

  it('ArrowUp moves focus to the previous visible node', () => {
    renderTree();
    const chk1 = document.querySelector('[data-item-id="CHK-1"]');
    chk1.focus();
    fireEvent.keyDown(chk1, { key: 'ArrowUp' });
    expect(document.activeElement.getAttribute('data-item-id')).toBe('REQ-OBSERVATORY');
  });

  it('ArrowRight on a collapsed branch expands it (onToggle)', () => {
    const onToggle = vi.fn();
    render(<WorkItemTree items={ITEMS} expandedIds={new Set()} onToggle={onToggle} />);
    const req = document.querySelector('[data-item-id="REQ-OBSERVATORY"]');
    req.focus();
    fireEvent.keyDown(req, { key: 'ArrowRight' });
    expect(onToggle).toHaveBeenCalledWith('REQ-OBSERVATORY');
  });

  it('ArrowLeft on an expanded branch collapses it (onToggle)', () => {
    const onToggle = vi.fn();
    render(<WorkItemTree items={ITEMS} expandedIds={new Set(['REQ-OBSERVATORY'])} onToggle={onToggle} />);
    const req = document.querySelector('[data-item-id="REQ-OBSERVATORY"]');
    req.focus();
    fireEvent.keyDown(req, { key: 'ArrowLeft' });
    expect(onToggle).toHaveBeenCalledWith('REQ-OBSERVATORY');
  });
});

describe('WorkItemTree selection hook for UC-S005-3 detail pane', () => {
  it('fires onSelect(id) on node click (the drill hook)', () => {
    const onSelect = vi.fn();
    renderTree({ onSelect });
    fireEvent.click(ownRow('UC-S001-1'));
    expect(onSelect).toHaveBeenCalledWith('UC-S001-1');
  });

  it('fires onSelect(id) on Enter of a focused node (keyboard drill — A11Y-S005-1)', () => {
    const onSelect = vi.fn();
    renderTree({ onSelect });
    const uc = document.querySelector('[data-item-id="UC-S005-2"]');
    uc.focus();
    fireEvent.keyDown(uc, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('UC-S005-2');
  });

  it('marks the selected node aria-selected=true (GEO-S005-4 link)', () => {
    renderTree({ selectedId: 'UC-S001-1' });
    const uc = document.querySelector('[data-item-id="UC-S001-1"]');
    expect(uc).toHaveAttribute('aria-selected', 'true');
    const other = document.querySelector('[data-item-id="CHK-1"]');
    expect(other).toHaveAttribute('aria-selected', 'false');
  });

  it('toggles a branch on disclosure-toggle click without selecting (onToggle, not onSelect)', () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    render(<WorkItemTree items={ITEMS} expandedIds={ALL_IDS} onToggle={onToggle} onSelect={onSelect} />);
    const chk4 = document.querySelector('[data-item-id="CHK-4"]');
    const toggle = within(chk4).getByTestId('disclosure-toggle');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('CHK-4');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders empty-state copy when items is null/empty (fail-soft)', () => {
    render(<WorkItemTree items={[]} expandedIds={new Set()} />);
    expect(screen.getByTestId('work-item-tree')).toHaveTextContent(/no work items/i);
  });
});
