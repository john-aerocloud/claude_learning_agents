// UC-S005-2 — data→render container for the work-item tree.
//
// HEXAGONAL ROLE: the wiring seam between the API adapter (api/client.js:
// getActive + getItems) and the pure WorkItemTree. It resolves the active
// project, fetches the /items array, and owns the INTERACTION state the tree
// needs but should not itself fetch/persist: the `expanded` Set (which branches
// are open) and the `selectedId` (the drilled node). WorkItemTree stays a pure
// function of props (unit-testable without fetch).
//
// DEFAULT EXPANDED (ui-design §1 — J2 0-click overview): on first load every
// branch is expanded so the operator sees the WHOLE tree without clicking. The
// expanded Set is preserved across SSE re-fetch (UC-S005-6 will drive that);
// for UC-S005-2 the initial one-shot load is enough.
//
// THE DRILL SEAM (UC-S005-3): `selectedId` + `onSelect` are exposed here so the
// future DetailPane (UC-S005-3) composes in WITHOUT editing the tree. For
// UC-S005-2 selection just marks the node aria-selected (visible affordance);
// no pane is built (out of scope).
//
// FAIL-SOFT: getItems returns null on any failure; the container maps null →
// the WorkItemTree empty state (never a blank/crash).

import { useEffect, useState } from 'preact/hooks';
import { getActive, getItems } from '../api/client.js';
import { WorkItemTree } from './WorkItemTree.jsx';
import { buildTree } from '../state/workItemTree.js';

/** Default loader: resolve the active project, then fetch its items array. */
async function loadActiveItems() {
  const project = await getActive();
  if (!project) return null;
  return getItems(project);
}

/** Collect every branch (hasChildren) id in the forest → the default expanded set. */
function allBranchIds(forest) {
  const ids = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.hasChildren) {
        ids.add(n.item.id);
        walk(n.children);
      }
    }
  };
  walk(forest);
  return ids;
}

/**
 * @param {object} [props]
 * @param {() => Promise<Array|null>} [props.loadItems] - items loader (injectable for tests)
 * @param {string|null} [props.selectedId] - CONTROLLED selection (UC-S005-3 lifts it)
 * @param {(id:string)=>void} [props.onSelect] - CONTROLLED select handler
 * @param {(items:Array)=>void} [props.onItemsLoaded] - report the loaded item rows up
 */
export function WorkItemTreeContainer({
  loadItems = loadActiveItems,
  selectedId: controlledSelectedId,
  onSelect: controlledOnSelect,
  onItemsLoaded,
}) {
  const [items, setItems] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [internalSelectedId, setInternalSelectedId] = useState(null);
  const [didInitExpand, setDidInitExpand] = useState(false);

  // Selection is CONTROLLED when the parent passes onSelect (UC-S005-3 lifts the
  // selected item into the detail pane); otherwise the container owns it (the
  // UC-S005-2 standalone behaviour — just marks aria-selected).
  const isControlled = typeof controlledOnSelect === 'function';
  const selectedId = isControlled ? (controlledSelectedId ?? null) : internalSelectedId;

  // Initial one-shot load on mount; default-expand every branch once.
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(loadItems)
      .then((next) => {
        if (!active) return;
        const arr = Array.isArray(next) ? next : null;
        setItems(arr);
        if (arr && onItemsLoaded) onItemsLoaded(arr);
        if (arr && !didInitExpand) {
          setExpanded(allBranchIds(buildTree(arr)));
          setDidInitExpand(true);
        }
      })
      .catch(() => { if (active) setItems(null); });
    return () => { active = false; };
  }, [loadItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const onToggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSelect = (id) => (isControlled ? controlledOnSelect(id) : setInternalSelectedId(id));

  return (
    <WorkItemTree
      items={items}
      expandedIds={expanded}
      selectedId={selectedId}
      onToggle={onToggle}
      onSelect={onSelect}
    />
  );
}
