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

import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { getActive, getItems, subscribeEvents } from '../api/client.js';
import { WorkItemTree } from './WorkItemTree.jsx';
import { buildTree } from '../state/workItemTree.js';

/** Default loader: resolve the active project, then fetch its items array. */
async function loadActiveItems() {
  const project = await getActive();
  if (!project) return null;
  return getItems(project);
}

const DEFAULT_DEBOUNCE_MS = 250;

/** Is this SSE change-frame path one that affects the work-item tree? The tree is
 * computed from items.csv (states/value/cost) and the queue CSVs (queue
 * positions); a change to either re-derives the tree. Other paths are ignored.
 * Mirrors VsmContainer.isRelevantChange (which gates on ledger.csv). */
function isRelevantChange(path) {
  if (typeof path !== 'string') return false;
  const p = path.replace(/\\/g, '/');
  return /items\.csv$/i.test(p) || /\/queues\/[^/]+\.csv$/i.test(p);
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
 * @param {(onChange:(evt:{type:string,path:string})=>void)=>(()=>void)} [props.subscribe]
 *        SSE subscribe seam (UC-S005-6). Injected so jsdom drives it without
 *        EventSource; default is the real subscribeEvents.
 * @param {number} [props.debounceMs] - coalesce a burst of change frames into one re-fetch
 * @param {string|null} [props.selectedId] - CONTROLLED selection (UC-S005-3 lifts it)
 * @param {(id:string)=>void} [props.onSelect] - CONTROLLED select handler
 * @param {(items:Array)=>void} [props.onItemsLoaded] - report the loaded item rows up
 */
export function WorkItemTreeContainer({
  loadItems = loadActiveItems,
  subscribe = subscribeEvents,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  selectedId: controlledSelectedId,
  onSelect: controlledOnSelect,
  onItemsLoaded,
}) {
  const [items, setItems] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [internalSelectedId, setInternalSelectedId] = useState(null);

  // Selection is CONTROLLED when the parent passes onSelect (UC-S005-3 lifts the
  // selected item into the detail pane); otherwise the container owns it (the
  // UC-S005-2 standalone behaviour — just marks aria-selected).
  const isControlled = typeof controlledOnSelect === 'function';
  const selectedId = isControlled ? (controlledSelectedId ?? null) : internalSelectedId;

  // Stable refs so the SSE effect (subscribed once) never closes over a stale
  // loader / callback and never needs to re-subscribe when they change.
  const loadRef = useRef(loadItems);
  loadRef.current = loadItems;
  const onItemsLoadedRef = useRef(onItemsLoaded);
  onItemsLoadedRef.current = onItemsLoaded;
  // The default-expand-every-branch happens ONCE (first successful load). An SSE
  // re-fetch must NOT reset the operator's collapse/expand state — a ref, not
  // state, so refresh() reads it synchronously without re-subscribing.
  const didInitExpand = useRef(false);

  // refresh() re-fetches items and re-renders, PRESERVING expanded + selected
  // (it never re-runs the init-expand). It is the SSE change-frame path and is
  // fail-soft: a null/failed load maps to the empty tree, never a crash.
  const refresh = useCallback(() => {
    return Promise.resolve()
      .then(() => loadRef.current())
      .then((next) => {
        const arr = Array.isArray(next) ? next : null;
        setItems(arr);
        if (arr && onItemsLoadedRef.current) onItemsLoadedRef.current(arr);
        if (arr && !didInitExpand.current) {
          setExpanded(allBranchIds(buildTree(arr)));
          didInitExpand.current = true;
        }
      })
      .catch(() => setItems(null));
  }, []);

  // Initial one-shot load on mount (and when an injected loader changes).
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(loadItems)
      .then((next) => {
        if (!active) return;
        const arr = Array.isArray(next) ? next : null;
        setItems(arr);
        if (arr && onItemsLoadedRef.current) onItemsLoadedRef.current(arr);
        if (arr && !didInitExpand.current) {
          setExpanded(allBranchIds(buildTree(arr)));
          didInitExpand.current = true;
        }
      })
      .catch(() => { if (active) setItems(null); });
    return () => { active = false; };
  }, [loadItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // UC-S005-6 — SSE live refresh. Subscribe ONCE on mount; a relevant change
  // frame (items.csv / a queue CSV) triggers a debounced re-fetch so states +
  // queue positions update live without a manual reload. Unsubscribe on unmount.
  // Mirrors VsmContainer; the real EventSource path is proven by the live spec.
  useEffect(() => {
    let timer = null;
    let unsubscribe = null;

    const onChange = (evt) => {
      if (!evt || !isRelevantChange(evt.path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; refresh(); }, debounceMs);
    };

    try {
      unsubscribe = subscribe(onChange);
    } catch {
      // no EventSource / blocked → the tree stays on its last good data (the
      // initial load already populated it); never crash the render.
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [subscribe, debounceMs, refresh]);

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
