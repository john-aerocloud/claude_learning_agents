// @covers workItemTree
// UC-S005-2 — DOMAIN logic for the work-item tree (pure; no fetch/DOM). Builds
// the REQ→CHK→SLC→UC hierarchy from flat ItemRecord[] (parent/children fields)
// and derives the /work-vs-/process `space` per requirements §6/§8/§175.
//
// Pins:
//   buildTree — REQ at root; CHK under REQ; UC under CHK; depth correct.
//   forest — multiple roots (no parent) handled; orphans surface, never lost.
//   countNodes — total node count == input row count (AC-S005-2-1 invariant).
//   deriveSpace — observatory items default to "work"; /process origin → "process".
import { describe, it, expect } from 'vitest';
import { buildTree, countNodes, deriveSpace } from '../workItemTree.js';

const ITEMS = [
  { id: 'REQ-OBSERVATORY', type: 'requirement', parent: '', children: 'CHK-1|CHK-4', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-OBSERVATORY', children: 'UC-S001-1', state: 'done', value: 'HIGH', cost: 'M' },
  { id: 'UC-S001-1', type: 'use-case', parent: 'CHK-1', children: '', state: 'done', value: 'HIGH', cost: '2' },
  { id: 'CHK-4', type: 'chunk', parent: 'REQ-OBSERVATORY', children: 'UC-S005-2', state: 'in-progress', value: 'HIGH', cost: 'M' },
  { id: 'UC-S005-2', type: 'use-case', parent: 'CHK-4', children: '', state: 'ready', value: 'HIGH', cost: '3' },
];

describe('buildTree (UC-S005-2)', () => {
  it('places REQ at the root (no parent)', () => {
    const roots = buildTree(ITEMS);
    expect(roots).toHaveLength(1);
    expect(roots[0].item.id).toBe('REQ-OBSERVATORY');
    expect(roots[0].depth).toBe(0);
  });

  it('nests CHK under REQ and UC under CHK with increasing depth', () => {
    const [req] = buildTree(ITEMS);
    const chk1 = req.children.find((n) => n.item.id === 'CHK-1');
    expect(chk1).toBeTruthy();
    expect(chk1.depth).toBe(1);
    const uc = chk1.children.find((n) => n.item.id === 'UC-S001-1');
    expect(uc).toBeTruthy();
    expect(uc.depth).toBe(2);
  });

  it('marks branch nodes (hasChildren) vs leaves', () => {
    const [req] = buildTree(ITEMS);
    expect(req.hasChildren).toBe(true);
    const chk4 = req.children.find((n) => n.item.id === 'CHK-4');
    const uc = chk4.children[0];
    expect(uc.hasChildren).toBe(false);
  });

  it('orders children by the parent.children pipe-list, not input order', () => {
    const shuffled = [ITEMS[0], ITEMS[3], ITEMS[1], ITEMS[4], ITEMS[2]];
    const [req] = buildTree(shuffled);
    expect(req.children.map((n) => n.item.id)).toEqual(['CHK-1', 'CHK-4']);
  });

  it('surfaces an orphan (parent id not present) as a root so no node is lost', () => {
    const withOrphan = [...ITEMS, { id: 'ORPHAN-1', type: 'use-case', parent: 'GHOST', children: '', state: 'ready', value: 'LOW', cost: '1' }];
    const roots = buildTree(withOrphan);
    const ids = roots.map((n) => n.item.id);
    expect(ids).toContain('ORPHAN-1');
  });

  it('returns [] for null/empty input (fail-soft)', () => {
    expect(buildTree(null)).toEqual([]);
    expect(buildTree([])).toEqual([]);
  });
});

describe('countNodes (AC-S005-2-1 invariant)', () => {
  it('counts every node in the forest == input row count', () => {
    expect(countNodes(buildTree(ITEMS))).toBe(ITEMS.length);
  });

  it('counts orphans too (no node dropped)', () => {
    const withOrphan = [...ITEMS, { id: 'ORPHAN-1', type: 'use-case', parent: 'GHOST', children: '', state: 'ready', value: 'LOW', cost: '1' }];
    expect(countNodes(buildTree(withOrphan))).toBe(withOrphan.length);
  });
});

describe('deriveSpace (/work vs /process — §6/§8/§175)', () => {
  it('defaults to "work" for observatory project items (no space field)', () => {
    expect(deriveSpace({ id: 'CHK-1', type: 'chunk' })).toBe('work');
  });

  it('honours an explicit space field when present', () => {
    expect(deriveSpace({ id: 'X', space: 'process' })).toBe('process');
    expect(deriveSpace({ id: 'Y', space: 'work' })).toBe('work');
  });

  it('derives "process" from a /process origin path', () => {
    expect(deriveSpace({ id: 'P', path: 'process/dora/ledger.csv' })).toBe('process');
    expect(deriveSpace({ id: 'W', path: 'work/observatory/items/items.csv' })).toBe('work');
  });
});
