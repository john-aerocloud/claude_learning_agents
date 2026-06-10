// UC-S005-3 — data→render container for the drill-down detail pane.
//
// HEXAGONAL ROLE: the wiring seam between the API adapter (api/client:
// getSlices + getSliceArtifact), the pure slug DOMAIN (itemDetail.deriveSliceSlug)
// and the pure DetailPane render. Given the selected item it:
//   1. fetches the project's slice-slug list (once, memoised by project),
//   2. resolves which slice dir backs the item (deriveSliceSlug),
//   3. fetches the chosen artifact's RAW text (default slice.md),
//   4. hands item + slug + artifacts + text to DetailPane.
// A node that maps to NO slice (REQ/CHK) never triggers an artifact fetch — the
// pane shows the "not yet available" placeholder (AC-S005-3-4).
//
// CLOSE → RETURN FOCUS (A11Y-S005-3, DEFECT-006 revision): on close the container
// calls the parent's onClose (which clears selection so the pane unmounts) AND
// invokes the injected `focusOnClose` handler. The parent (ObservatoryView)
// restores focus to the ORIGINATING tree node — the non-modal drawer drops the
// keyboard user back where they were so they can drill the next sibling without
// re-traversing. If no handler is injected (standalone use), it falls back to
// focusing the value-stream map.
//
// SCOPE: UC-S005-3 fetches + shows the artifact as RAW text inside DetailPane's
// artifact-view slot. UC-S005-4 (markdown/mmd) and UC-S005-5 (history) compose
// into DetailPane's slots later; this container leaves them untouched.

import { useEffect, useState, useCallback, useMemo } from 'preact/hooks';
import { getSlices, getSliceArtifact, getItemLedger } from '../api/client.js';
import { deriveSliceSlug, defaultArtifactName } from '../state/itemDetail.js';
import { ancestryPath } from '../state/workItemTree.js';
import { DetailPane } from './DetailPane.jsx';

/** Return focus to the value-stream map element if present (managed focus). */
function focusValueStreamMap() {
  const map = document.querySelector('[data-testid="value-stream-map"]');
  if (map && typeof map.focus === 'function') {
    if (!map.hasAttribute('tabindex')) map.setAttribute('tabindex', '-1');
    map.focus();
  }
}

/**
 * @param {object} props
 * @param {object|null} props.item   - the selected ItemRecord (null → pane closed)
 * @param {Array} [props.items]      - UC-S005-6: the full ItemRecord[] (to derive
 *        the zoom-out breadcrumb ancestry path via ancestryPath)
 * @param {(id:string)=>void} [props.onZoomTo] - UC-S005-6: zoom out one level
 *        (re-select an ancestor crumb)
 * @param {string} props.project     - active project id
 * @param {()=>void} props.onClose   - parent handler that clears the selection
 * @param {()=>void} [props.focusOnClose] - parent focus-restore handler (DEFECT-006:
 *        returns focus to the originating tree node). Falls back to focusing the
 *        value-stream map when not injected.
 * @param {(project:string)=>Promise<string[]|null>} [props.loadSlices]
 * @param {(project:string, slug:string, artifact:string)=>Promise<string|null>} [props.loadArtifact]
 * @param {(project:string, itemId:string)=>Promise<Array|null>} [props.loadLedger] - UC-S005-5
 */
export function DetailPaneContainer({
  item,
  items,
  onZoomTo,
  project,
  onClose,
  focusOnClose,
  loadSlices = getSlices,
  loadArtifact = getSliceArtifact,
  loadLedger = getItemLedger,
}) {
  const [slugs, setSlugs] = useState(null);
  const [slug, setSlug] = useState(null);
  const [artifactName, setArtifactName] = useState(defaultArtifactName());
  const [artifactText, setArtifactText] = useState(null);
  // UC-S005-5: the selected item's ledger history rows (newest-first), or null
  // while loading / [] when the item has no rows.
  const [historyRows, setHistoryRows] = useState(null);

  // Fetch the slice-slug list once per project (the slug map for the whole tree).
  useEffect(() => {
    let active = true;
    if (!project) return undefined;
    Promise.resolve()
      .then(() => loadSlices(project))
      .then((list) => { if (active) setSlugs(Array.isArray(list) ? list : []); })
      .catch(() => { if (active) setSlugs([]); });
    return () => { active = false; };
  }, [project, loadSlices]);

  // When the selected item (or slug list) changes, resolve the slug + fetch the
  // default artifact. A node with no slice → slug null, no artifact fetch.
  useEffect(() => {
    if (!item || slugs == null) {
      setSlug(null);
      setArtifactText(null);
      return undefined;
    }
    const resolved = deriveSliceSlug(item, slugs);
    setSlug(resolved);
    setArtifactName(defaultArtifactName());
    if (!resolved) {
      setArtifactText(null);
      return undefined;
    }
    let active = true;
    Promise.resolve()
      .then(() => loadArtifact(project, resolved, defaultArtifactName()))
      .then((text) => { if (active) setArtifactText(typeof text === 'string' ? text : null); })
      .catch(() => { if (active) setArtifactText(null); });
    return () => { active = false; };
  }, [item ? item.id : null, slugs, project, loadArtifact]); // eslint-disable-line react-hooks/exhaustive-deps

  // UC-S005-5: fetch the selected item's ledger history (newest-first). Keyed on
  // the item id + project; a node with no item never loads. Fail-soft to [].
  useEffect(() => {
    if (!item || !project) {
      setHistoryRows(null);
      return undefined;
    }
    setHistoryRows(null); // reset to loading on item change
    let active = true;
    Promise.resolve()
      .then(() => loadLedger(project, item.id))
      .then((rows) => { if (active) setHistoryRows(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (active) setHistoryRows([]); });
    return () => { active = false; };
  }, [item ? item.id : null, project, loadLedger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch which artifact is shown (artifact-list tab click).
  const onSelectArtifact = useCallback(
    (name) => {
      if (!slug) return;
      setArtifactName(name);
      let active = true;
      Promise.resolve()
        .then(() => loadArtifact(project, slug, name))
        .then((text) => { if (active) setArtifactText(typeof text === 'string' ? text : null); })
        .catch(() => { if (active) setArtifactText(null); });
      return () => { active = false; };
    },
    [slug, project, loadArtifact],
  );

  const handleClose = useCallback(() => {
    onClose && onClose();
    if (typeof focusOnClose === 'function') focusOnClose();
    else focusValueStreamMap();
  }, [onClose, focusOnClose]);

  // UC-S005-6: derive the root→selected zoom-out path from the full item set.
  // ancestryPath fails soft to [] for an absent items set or unknown id; DetailPane
  // then falls back to a single crumb of the item itself (AC-S005-3-5 preserved).
  const crumbPath = useMemo(
    () => (item ? ancestryPath(item.id, items) : []),
    [item ? item.id : null, items],
  );

  if (!item) return null;

  return (
    <DetailPane
      item={item}
      slug={slug}
      artifacts={slug ? [defaultArtifactName()] : []}
      artifactName={artifactName}
      artifactText={artifactText}
      onSelectArtifact={onSelectArtifact}
      historyRows={historyRows}
      crumbPath={crumbPath}
      onZoomTo={onZoomTo}
      onClose={handleClose}
    />
  );
}
