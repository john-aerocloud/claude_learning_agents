// UC-S005-2 — WorkItemTree: the left-rail landmark holding the full
// REQ→CHK→SLC→UC keyboard-navigable tree.
//
// HEXAGONAL ROLE: render layer. It consumes a flat ItemRecord[] (the API adapter
// loads it), builds the forest via the pure domain (buildTree) and renders the
// WAI-ARIA `tree` pattern. It owns NO fetch — the container does the loading and
// passes items + the expanded/selected state down (so the tree is a pure
// function of props and unit-testable without network).
//
// WAI-ARIA tree (A11Y-S005-1):
//   - role=tree with role=treeitem children; ONE treeitem tabbable at a time
//     (roving tabindex). The active (tabbable) node is internal state, seeded to
//     the first visible node.
//   - ArrowDown/ArrowUp move the active node across VISIBLE nodes (respecting
//     collapse); ArrowRight expands a collapsed branch; ArrowLeft collapses an
//     expanded one; Enter/Space selects (the UC-S005-3 drill hook). After an
//     arrow move we focus the new active node's DOM element.
//
// THE DETAIL-PANE SEAM (UC-S005-3): `onSelect(id)` is the drill hook — fired on
// click/Enter. This component does NOT build the pane (out of scope); UC-S005-3
// owns the pane and consumes onSelect + selectedId. `expandedIds`/`onToggle` are
// likewise controlled by the parent so SSE re-render (UC-S005-6) preserves
// expand state across re-fetch.

import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import './work-item-tree.css';
import { TreeNode } from './TreeNode.jsx';
import { buildTree, visibleNodes } from '../state/workItemTree.js';

/**
 * @param {object} props
 * @param {Array|null} props.items        - flat ItemRecord[] from /api/.../items
 * @param {Set<string>} [props.expandedIds] - controlled expanded set
 * @param {string|null} [props.selectedId]  - currently drilled node (UC-S005-3)
 * @param {(id:string)=>void} [props.onSelect] - drill hook (UC-S005-3 detail pane)
 * @param {(id:string)=>void} [props.onToggle] - expand/collapse a branch
 * @param {(itemId:string, actionType:string)=>void} [props.onSteer]
 *   - UC-S014-1 read-only prop slot threaded to every row's SteerMenu
 * @param {string} [props.sourceRef]       - traceability source path
 */
export function WorkItemTree({
  items,
  expandedIds,
  selectedId = null,
  onSelect,
  onToggle,
  onSteer,
  sourceRef = 'work/observatory/items/items.csv',
}) {
  const expanded = expandedIds || new Set();
  const forest = buildTree(items);
  const flat = visibleNodes(forest, expanded);
  const flatIds = flat.map((n) => n.item.id);

  // Roving tabindex: which node is the single tabbable one. Default = first.
  const [activeId, setActiveId] = useState(flatIds[0] || null);
  const treeRef = useRef(null);

  // Keep activeId valid as the visible set changes (collapse/SSE re-fetch).
  useEffect(() => {
    if (flatIds.length === 0) return;
    if (!flatIds.includes(activeId)) setActiveId(flatIds[0]);
  }, [flatIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the DOM node for the active id after an arrow move.
  const focusNode = useCallback((id) => {
    const el = treeRef.current && treeRef.current.querySelector(`[data-item-id="${id}"]`);
    if (el) el.focus();
  }, []);

  const moveActive = useCallback(
    (id) => {
      setActiveId(id);
      focusNode(id);
    },
    [focusNode],
  );

  const onKeyDown = useCallback(
    (e) => {
      const node = e.target.closest('[role="treeitem"]');
      if (!node) return;
      const id = node.getAttribute('data-item-id');
      const idx = flatIds.indexOf(id);
      const treeNode = flat[idx];

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = flatIds[Math.min(idx + 1, flatIds.length - 1)];
          if (next) moveActive(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = flatIds[Math.max(idx - 1, 0)];
          if (prev) moveActive(prev);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (treeNode && treeNode.hasChildren && !expanded.has(id)) {
            onToggle && onToggle(id); // expand
          } else if (treeNode && treeNode.hasChildren) {
            // already expanded → move to first child
            const child = flatIds[idx + 1];
            if (child) moveActive(child);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (treeNode && treeNode.hasChildren && expanded.has(id)) {
            onToggle && onToggle(id); // collapse
          }
          break;
        }
        case 'Enter':
        case ' ':
        case 'Spacebar': {
          e.preventDefault();
          onSelect && onSelect(id);
          break;
        }
        default:
          break;
      }
    },
    [flatIds.join('|'), expanded, moveActive, onToggle, onSelect], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const isEmpty = forest.length === 0;

  return (
    <section
      class="work-item-tree-rail"
      role="region"
      aria-label="Work items"
      data-testid="work-item-tree-rail"
    >
      <h2 class="work-item-tree__h">Work items</h2>
      <ul
        ref={treeRef}
        class="work-item-tree"
        data-testid="work-item-tree"
        role="tree"
        aria-label="Work items"
        data-source={sourceRef}
        onKeyDown={onKeyDown}
      >
        {isEmpty ? (
          <li class="work-item-tree__empty" role="none">No work items</li>
        ) : (
          forest.map((node) => (
            <TreeNode
              node={node}
              expandedIds={expanded}
              selectedId={selectedId}
              activeId={activeId}
              onSelect={onSelect}
              onToggle={onToggle}
              onSteer={onSteer}
            />
          ))
        )}
      </ul>
    </section>
  );
}
