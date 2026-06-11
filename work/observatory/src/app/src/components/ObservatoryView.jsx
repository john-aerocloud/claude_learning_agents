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
import { SteerPanelContainer } from './SteerPanel.jsx';
import { ViewSwitch } from './ViewSwitch.jsx';
import { WipPanelContainer } from './WipPanel.jsx';
import { DefectsPanelContainer } from './DefectsPanel.jsx';

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
  // UC-S014-2: the active steer gesture — {itemId, actionType} | null. Set by
  // any SteerMenu's onSteer (chips via VsmContainer, rows via the tree
  // container); non-null mounts the SteerPanel drawer. The panel captures its
  // own focus-return target (the steer trigger) on mount.
  const [steer, setSteer] = useState(null);
  // UC-S015-1: which main-column view is active — 'pipeline' (default; the
  // at-a-glance home, J1 stays 0-click), 'wip' (the WIP navigation panel), or
  // 'defects' (UC-S013-2: the defects list panel).
  // ROUTED VIEW (EXP-016): the surfaces never co-exist — switching unmounts
  // the others, so there is no overlay-reflow failure mode by construction.
  const [view, setView] = useState('pipeline');

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

  // UC-S005-6 (zoom-out one level): clicking an ancestor crumb re-selects that
  // ancestor so the drawer reframes on the parent and the tree selection follows.
  const onZoomTo = useCallback((id) => {
    if (typeof document !== 'undefined') {
      originRef.current = document.querySelector(`[role="treeitem"][data-item-id="${id}"]`);
    }
    setSelectedId(id);
  }, []);

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

  // UC-S014-2: SteerMenu selection → open the steer panel for that item+action.
  const onSteer = useCallback((itemId, actionType) => setSteer({ itemId, actionType }), []);
  const onSteerClose = useCallback(() => setSteer(null), []);

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
        onSteer={onSteer}
      />
      <div class="observatory-main-col">
        {/* UC-S015-1: the two-view switch. STRUCTURAL wrapper only — the
            VsmContainer line (incl. the UC-S014-2 onSteer pass-through) is
            unchanged; it is merely hosted inside its tabpanel. Both tabpanels
            stay in the DOM (valid aria-controls targets); the INACTIVE one is
            hidden AND empty, so the inactive view is genuinely unmounted
            (GEO-S015-1: no hidden-but-present reflow). */}
        <ViewSwitch active={view} onSelect={setView} />
        <div
          role="tabpanel"
          id="view-panel-pipeline"
          aria-labelledby="view-tab-pipeline"
          hidden={view !== 'pipeline'}
        >
          {view === 'pipeline' ? (
            <VsmContainer onSteer={onSteer} />
          ) : null}
        </div>
        <div
          role="tabpanel"
          id="view-panel-wip"
          aria-labelledby="view-tab-wip"
          hidden={view !== 'wip'}
        >
          {view === 'wip' ? <WipPanelContainer /> : null}
        </div>
        {/* UC-S013-2: the Defects routed view — same hidden-AND-empty tabpanel
            discipline (GEO-S013-2-1: the inactive view is genuinely unmounted,
            never hidden-but-present reflowing). */}
        <div
          role="tabpanel"
          id="view-panel-defects"
          aria-labelledby="view-tab-defects"
          hidden={view !== 'defects'}
        >
          {view === 'defects' ? <DefectsPanelContainer /> : null}
        </div>
      </div>
      {/* DEFECT-006: the drawer is a SIBLING of the main column (not nested in
          it). It is position:fixed (detail-pane.css) so it floats over the map
          and never reflows the column. Wiring unchanged. */}
      <DetailPaneContainer
        item={selectedItem}
        items={items}
        onZoomTo={onZoomTo}
        project={project}
        onClose={onClose}
        focusOnClose={focusOnClose}
        {...paneProps}
      />
      {/* UC-S014-2: the steer drawer — body-portalled fixed overlay (its own
          stacking context above both drawers' host surfaces); onGenerate is
          UC-S014-3's seam (prompt building — not wired in this UC). */}
      {steer ? (
        <SteerPanelContainer
          itemId={steer.itemId}
          actionType={steer.actionType}
          project={project}
          {...(loadItems ? { loadItems } : {})}
          onCancel={onSteerClose}
        />
      ) : null}
    </div>
  );
}
