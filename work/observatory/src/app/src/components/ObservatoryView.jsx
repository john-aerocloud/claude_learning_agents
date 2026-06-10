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
// that record. "Back to map"/×/Esc clears selectedId → the pane unmounts and the
// DetailPaneContainer returns focus to the value-stream map (AC-S005-3-6).

import { useEffect, useState, useMemo, useCallback } from 'preact/hooks';
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

  const onSelect = useCallback((id) => setSelectedId(id), []);
  const onClose = useCallback(() => setSelectedId(null), []);

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
        <DetailPaneContainer
          item={selectedItem}
          project={project}
          onClose={onClose}
          {...paneProps}
        />
      </div>
    </div>
  );
}
