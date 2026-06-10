// UC-S005-2 — TreeNode: one work item in the tree.
//
// HEXAGONAL ROLE: pure presentational. Given a built tree node (item + depth +
// children + hasChildren) and the interaction callbacks, it renders one
// role=treeitem row — disclosure toggle, type glyph, name/job, a state badge
// (REDUNDANT: data-state + visible text + colour class — never colour-only,
// AC-S005-2-6), a value/cost badge (AC-S005-2-7), and the SpaceTagBadge — then
// recurses for its (visible) children.
//
// A11Y (A11Y-S005-1/2):
//   - role=treeitem, aria-level=depth+1, aria-expanded (branches only),
//     aria-selected, roving tabindex (one node tabbable: the active node).
//   - accessible name (aria-label) carries id + type + state + value/cost so a
//     screen-reader user hears the full node identity, not just the job text.
//   - GEO-S005-1: the row content is indented via padding-left = depth *
//     --tree-indent so a child's content left offset strictly exceeds its
//     parent's (an indented hierarchy, not a flat list).
//
// The detail-pane (UC-S005-3) seam is `onSelect(id)` — fired on row click and on
// Enter/Space. Toggling a branch (onToggle) is kept SEPARATE from selection so
// clicking the disclosure chevron expands/collapses WITHOUT drilling.

import { SpaceTagBadge } from './SpaceTagBadge.jsx';
import { SteerMenu } from './SteerMenu.jsx';
import { deriveSpace } from '../state/workItemTree.js';

// Type → short glyph (decorative; the type also rides the accessible name as text).
const TYPE_GLYPH = {
  requirement: '◎',
  chunk: '▣',
  'use-case': '▸',
  slice: '▤',
  defect: '⚠',
};

// Map the raw items.csv state string to display text + a colour-band class.
// State text is AUTHORITATIVE; the class only carries the (redundant) colour.
const STATE_CLASS = {
  done: 'done',
  'in-progress': 'active',
  active: 'active',
  ready: 'backlog',
  backlog: 'backlog',
  planned: 'backlog',
  blocked: 'blocked',
  dropped: 'backlog',
};

function typeWord(type) {
  return type === 'use-case' ? 'use-case' : (type || 'item');
}

/**
 * @param {object} props
 * @param {object} props.node  - { item, depth, children, hasChildren }
 * @param {Set<string>} props.expandedIds
 * @param {string|null} props.selectedId
 * @param {string|null} props.activeId   - the roving-tabindex active node id
 * @param {(id:string)=>void} props.onSelect
 * @param {(id:string)=>void} props.onToggle
 * @param {(itemId:string, actionType:string)=>void} [props.onSteer]
 *   - UC-S014-1 read-only prop slot for the row's SteerMenu (no logic change;
 *     UC-S014-2 wires the steer-panel consumer)
 */
export function TreeNode({ node, expandedIds, selectedId, activeId, onSelect, onToggle, onSteer }) {
  const { item, depth, children, hasChildren } = node;
  const space = deriveSpace(item);
  const isExpanded = hasChildren && expandedIds && expandedIds.has(item.id);
  const isSelected = selectedId === item.id;
  const isActive = activeId === item.id;
  const stateClass = STATE_CLASS[item.state] || 'backlog';

  // Accessible name (A11Y-S005-2): id, type, job, state, value/cost.
  const ariaLabel = [
    item.id,
    typeWord(item.type),
    item.job ? item.job : null,
    `state ${item.state}`,
    `value ${item.value}`,
    `cost ${item.cost}`,
  ]
    .filter(Boolean)
    .join(', ');

  const select = () => onSelect && onSelect(item.id);
  const toggle = (e) => {
    if (e) e.stopPropagation();
    if (hasChildren && onToggle) onToggle(item.id);
  };

  return (
    <li
      class={`tree-node tree-node--${stateClass}${isSelected ? ' tree-node--selected' : ''}`}
      data-testid="tree-node"
      role="treeitem"
      data-item-id={item.id}
      data-type={item.type}
      data-state={item.state}
      data-space={space}
      data-value={item.value}
      data-cost={item.cost}
      aria-level={depth + 1}
      aria-selected={isSelected ? 'true' : 'false'}
      aria-label={ariaLabel}
      {...(hasChildren ? { 'aria-expanded': isExpanded ? 'true' : 'false' } : {})}
      tabindex={isActive ? 0 : -1}
    >
      <div
        class="tree-node__row"
        style={`padding-left: calc(${depth} * var(--tree-indent))`}
        onClick={select}
      >
        {hasChildren ? (
          <button
            type="button"
            class="disclosure-toggle"
            data-testid="disclosure-toggle"
            aria-label={isExpanded ? `Collapse ${item.id}` : `Expand ${item.id}`}
            tabindex="-1"
            onClick={toggle}
          >
            <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span class="disclosure-spacer" aria-hidden="true" />
        )}

        <span class="tree-node__glyph" aria-hidden="true">{TYPE_GLYPH[item.type] || '·'}</span>

        <span class="tree-node__id">{item.id}</span>
        <span class="tree-node__job" title={item.job}>{item.job}</span>

        <span class={`state-badge state-badge--${stateClass}`} data-testid="state-badge">
          {item.state}
        </span>

        <span class="vc-badge" data-testid="vc-badge" title="value / cost">
          <span class="vc-badge__v">{item.value}</span>
          <span class="vc-badge__sep" aria-hidden="true">/</span>
          <span class="vc-badge__c">{item.cost}</span>
        </span>

        <SpaceTagBadge space={space} />

        {/* UC-S014-1 — trailing steer action on every item-bearing row. The
            SteerMenu stops its own click/keydown propagation, so the row's
            drill (onClick=select) and the tree's roving-keydown are untouched. */}
        <SteerMenu itemId={item.id} itemLabel={item.job} onSteer={onSteer} />
      </div>

      {hasChildren && isExpanded ? (
        <ul class="tree-children" role="group">
          {children.map((child) => (
            <TreeNode
              node={child}
              expandedIds={expandedIds}
              selectedId={selectedId}
              activeId={activeId}
              onSelect={onSelect}
              onToggle={onToggle}
              onSteer={onSteer}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
