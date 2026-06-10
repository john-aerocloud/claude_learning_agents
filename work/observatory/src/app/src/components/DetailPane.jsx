// UC-S005-3 — DetailPane: the right-anchored NON-MODAL detail region opened when
// the operator drills into a tree node.
//
// HEXAGONAL ROLE: render layer. It is a (near-)pure function of resolved props —
// the selected item record, the resolved slice slug, the available-artifact list
// + the chosen artifact's RAW text (the container fetched both via api/client),
// and onClose. It owns NO fetch; the only impure behaviour is the managed-focus
// effect (A11Y-S005-3) and the Esc key handler, both DOM concerns proper to the
// render layer.
//
// SCOPE (bounded — UC-S005-3 only): the pane SHELL + open-on-select + slice
// artifact rendered as RAW <pre> text. It deliberately does NOT pretty-render
// markdown/mmd — that is UC-S005-4, which swaps the <pre> inside the
// `data-testid="artifact-view"` slot for <ArtifactView>. It does NOT render
// ledger history — that is UC-S005-5, which mounts <ItemHistoryPanel> into the
// labelled `data-testid="item-history-slot"`. Both slots are left clearly marked.
//
// A11Y-S005-3: role=region + aria-label="Item detail: <id>"; on open focus moves
// to the pane heading; Esc / × / "Back to map" all call onClose (the container
// returns focus to the value-stream map). NON-MODAL: the tree stays operable
// (no focus trap, no aria-modal) — the "whole and the part" requirement.
//
// GEO-S005-3/4: the pane is anchored to the RIGHT of the main column (CSS), so
// its left edge sits past the tree rail (no illegible overlap); the selected
// node keeps aria-selected="true" in the tree while the pane is open (the tree
// owns that affordance), giving the visible link between node and pane.

import { useEffect, useRef } from 'preact/hooks';
import './detail-pane.css';
import { paneLabel } from '../state/itemDetail.js';
import { ItemHistoryPanel } from './ItemHistoryPanel.jsx';
import { ArtifactView } from './ArtifactView.jsx';
import { ZoomBreadcrumb } from './ZoomBreadcrumb.jsx';

/**
 * @param {object} props
 * @param {object|null} props.item          - selected ItemRecord (null → closed)
 * @param {string|null} [props.slug]        - resolved slice slug (null → no artifact)
 * @param {string[]} [props.artifacts]      - available artifact names for the slice
 * @param {string} [props.artifactName]     - the currently-shown artifact name
 * @param {string|null} [props.artifactText]- RAW text of the shown artifact (null → absent)
 * @param {(name:string)=>void} [props.onSelectArtifact] - switch shown artifact
 * @param {Array|null} [props.historyRows] - the item's ledger rows (UC-S005-5; newest-first)
 * @param {Array} [props.crumbPath]         - UC-S005-6 root->selected ancestry chain
 *        (from ancestryPath). Absent → a single-crumb path of the item itself.
 * @param {(id:string)=>void} [props.onZoomTo] - UC-S005-6 zoom-out one level (re-select ancestor)
 * @param {()=>void} props.onClose          - close the pane (Esc / × / Back to map)
 */
export function DetailPane({
  item,
  slug = null,
  artifacts = [],
  artifactName = 'slice.md',
  artifactText = null,
  onSelectArtifact,
  historyRows = null,
  crumbPath = null,
  onZoomTo,
  onClose,
}) {
  const headingRef = useRef(null);

  // Managed focus (A11Y-S005-3): when the pane opens (item becomes non-null),
  // move focus to the heading so a keyboard/screen-reader user lands in the pane.
  useEffect(() => {
    if (item && headingRef.current) headingRef.current.focus();
  }, [item ? item.id : null]); // re-run when the selected item changes

  if (!item) return null;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose && onClose();
    }
  };

  const source = slug ? `work/.../slices/${slug}/${artifactName}` : null;
  // UC-S005-4: artifact KIND drives the renderer — .mmd → Mermaid SVG, else markdown.
  const artifactKind = /\.mmd$/i.test(artifactName || '') ? 'mmd' : 'md';

  // UC-S005-6: the zoom-out breadcrumb path. Use the derived ancestry chain when
  // the container supplies one; otherwise fall back to a single crumb of the
  // current item so the breadcrumb always carries the selected id (AC-S005-3-5).
  const breadcrumbPath =
    Array.isArray(crumbPath) && crumbPath.length > 0 ? crumbPath : [{ id: item.id, type: item.type }];

  return (
    <section
      class="detail-pane"
      role="region"
      aria-label={paneLabel(item)}
      data-testid="detail-pane"
      data-pane-item={item.id}
      onKeyDown={onKeyDown}
    >
      {/* UC-S005-6: the zoom-out breadcrumb renders the full root->selected path
          (Pipeline ▸ CHK-4 ▸ s005 ▸ UC), each ancestor a zoom-out control, plus
          a "Back to map" full zoom-out (AC-S005-6-1/4, A11Y-S005-5). */}
      <ZoomBreadcrumb path={breadcrumbPath} onClose={onClose} onZoomTo={onZoomTo} />

      <header class="detail-pane__head">
        <h2
          class="detail-pane__h"
          data-testid="detail-pane-heading"
          ref={headingRef}
          tabindex="-1"
        >
          {item.id}
        </h2>
        <button
          type="button"
          class="detail-pane__close"
          data-testid="detail-pane-close"
          aria-label={`Close detail for ${item.id}`}
          onClick={() => onClose && onClose()}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {/* Identity row — the item record fields (AC-S005-3-1 shell). */}
      <dl class="detail-pane__identity" data-testid="detail-identity">
        <div><dt>type</dt><dd data-field="type">{item.type}</dd></div>
        <div><dt>state</dt><dd data-field="state">{item.state}</dd></div>
        <div><dt>value</dt><dd data-field="value">{item.value}</dd></div>
        <div><dt>cost</dt><dd data-field="cost">{item.cost}</dd></div>
        {item.job ? <div class="detail-pane__job"><dt>job</dt><dd data-field="job">{item.job}</dd></div> : null}
      </dl>

      {/* Artifact list — switch which artifact is shown (only when slice-backed). */}
      {slug && artifacts && artifacts.length > 0 ? (
        <div class="detail-pane__artifact-list" data-testid="artifact-list" role="list">
          {artifacts.map((name) => (
            <button
              type="button"
              role="listitem"
              class={`artifact-tab${name === artifactName ? ' artifact-tab--active' : ''}`}
              aria-pressed={name === artifactName ? 'true' : 'false'}
              onClick={() => onSelectArtifact && onSelectArtifact(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {/* ARTIFACT VIEW SLOT — UC-S005-4: <ArtifactView> renders the artifact text
          as markdown→HTML (semantic) or .mmd→Mermaid SVG, with a readable-text
          fallback (never blank/broken). data-testid="artifact-view" + data-source. */}
      <ArtifactView
        kind={artifactKind}
        text={artifactText}
        source={source}
      />

      {/* ITEM-HISTORY SLOT — UC-S005-5: <ItemHistoryPanel> renders the item's
          ledger rows (newest-first) as readable history lines. The slot wrapper
          carries the stable data-testid="item-history-slot" hook. */}
      <div class="detail-pane__history-slot" data-testid="item-history-slot">
        <ItemHistoryPanel rows={historyRows} itemId={item.id} />
      </div>
    </section>
  );
}
