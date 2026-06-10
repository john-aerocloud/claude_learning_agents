// UC-S005-3 — ObservatoryView: the ONE composition edit that joins the existing
// work-item tree rail + value-stream map with the new drill-down detail pane.
//
// HEXAGONAL ROLE: composition/wiring only. It owns the lifted interaction state
// the drill needs that neither the tree nor the pane should own alone:
//   - selectedId : which node is drilled (controlled into WorkItemTreeContainer)
//   - items      : the loaded ItemRecord[] (reported up via onItemsLoaded) so the
//                  selected RECORD can be resolved and handed to the pane
//   - project    : the active project id (DetailPaneContainer fetches artifacts)
// The tree + map keep their own containers (their data loads, SSE, etc. are
// untouched — the value-stream map is NOT re-laid-out, only placed beside the
// rail with the pane anchored to the right of the main column).
//
// open-on-click (AC-S005-3-1): a node click sets selectedId → the pane opens for
// that record. "Back to map"/×/Esc clears selectedId → the pane unmounts.
//
// DEFECT-006 (positioning/containment only — no behaviour/data-flow change):
//   1. The DetailPaneContainer renders as a SIBLING of .observatory-main-col
//      (inside .observatory-layout), NOT nested in the column — so the floating
//      drawer cannot reflow the column/map even structurally (the css makes it
//      position:fixed; lifting it out of the column makes the contract structural).
//   2. On select we capture the ORIGINATING treeitem element so that on close we
//      can restore focus there (the non-modal drawer drops the keyboard user back
//      where they were), instead of focusing the value-stream map. The map-surface
//      behaviour of "Back to map" (AC-S005-3-6) is unchanged — that lives in the
//      breadcrumb control; only the close FOCUS target moved to the node.

import { useEffect, useState, useMemo, useCallback, useRef } from 'preact/hooks';
import { getActive } from '../api/client.js';
import { WorkItemTreeContainer } from './WorkItemTreeContainer.jsx';
import { VsmContainer } from './VsmContainer.jsx';
import { DetailPaneContainer } from './DetailPaneContainer.jsx';

/**
 * @param {object} [props]
 * @param {() => Promise<Array|null>} [props.loadItems]
 * @param {() => Promise<string|null>} [props.loadActiveProject]
 * @param {(project:string)=>Promise<string[]|null>} [props.loadSlices]
 * @param {(project:string, slug:string, artifact:string)=>Promise<string|null>} [props.loadArtifact]
 */
export function ObservatoryView({
  loadItems,
  loadActiveProject = getActive,
  loadSlices,
  loadArtifact,
}) {
  const [items, setItems] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [project, setProject] = useState(null);
  // DEFECT-006: the treeitem element that opened the pane — focus returns here on close.
  const originRef = useRef(null);

  // Resolve the active project once (the DetailPaneContainer needs it to build
  // the /slices + /slices/:slug/:artifact URLs).
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(loadActiveProject)
      .then((p) => { if (active) setProject(p || null); })
      .catch(() => { if (active) setProject(null); });
    return () => { active = false; };
  }, [loadActiveProject]);

  const selectedItem = useMemo(() => {
    if (!selectedId || !Array.isArray(items)) return null;
    return items.find((it) => it && it.id === selectedId) || null;
  }, [selectedId, items]);

  const onSelect = useCallback((id) => {
    // Capture the originating treeitem so focus can return there on close
    // (DEFECT-006). The node is already in the DOM at select time.
    originRef.current =
      typeof document !== 'undefined'
        ? document.querySelector(`[role="treeitem"][data-item-id="${id}"]`)
        : null;
    setSelectedId(id);
  }, []);
  const onClose = useCallback(() => setSelectedId(null), []);

  // DEFECT-006: restore focus to the originating tree node (not the map) on close.
  // The treeitem owns roving tabindex; if it is not focusable at the moment of
  // close, make it focusable so focus lands on the node the operator drilled from.
  const focusOnClose = useCallback(() => {
    const node = originRef.current;
    if (node && typeof node.focus === 'function') {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus();
    }
  }, []);

  // Pass loaders to the tree container only when injected (tests); otherwise the
  // container uses its real defaults (getActive→getItems).
  const treeProps = loadItems ? { loadItems } : {};
  const paneProps = {};
  if (loadSlices) paneProps.loadSlices = loadSlices;
  if (loadArtifact) paneProps.loadArtifact = loadArtifact;

  return (
    <div class="observatory-layout">
      <WorkItemTreeContainer
        {...treeProps}
        selectedId={selectedId}
        onSelect={onSelect}
        onItemsLoaded={setItems}
      />
      <div class="observatory-main-col">
        <VsmContainer />
      </div>
      {/* DEFECT-006: the drawer is a SIBLING of the main column (not nested in
          it). It is position:fixed (detail-pane.css) so it floats over the map
          and never reflows the column. Wiring unchanged. */}
      <DetailPaneContainer
        item={selectedItem}
        project={project}
        onClose={onClose}
        focusOnClose={focusOnClose}
        {...paneProps}
      />
    </div>
  );
}
