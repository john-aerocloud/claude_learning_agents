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

/**
 * @param {object} props
 * @param {object|null} props.item          - selected ItemRecord (null → closed)
 * @param {string|null} [props.slug]        - resolved slice slug (null → no artifact)
 * @param {string[]} [props.artifacts]      - available artifact names for the slice
 * @param {string} [props.artifactName]     - the currently-shown artifact name
 * @param {string|null} [props.artifactText]- RAW text of the shown artifact (null → absent)
 * @param {(name:string)=>void} [props.onSelectArtifact] - switch shown artifact
 * @param {Array|null} [props.historyRows] - the item's ledger rows (UC-S005-5; newest-first)
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

  return (
    <section
      class="detail-pane"
      role="region"
      aria-label={paneLabel(item)}
      data-testid="detail-pane"
      data-pane-item={item.id}
      onKeyDown={onKeyDown}
    >
      {/* Breadcrumb + zoom-out controls (UC-S005-6 fleshes out the path; the
          shell here carries the item id + a "Back to map" zoom-out — AC-S005-3-5/6). */}
      <nav class="detail-pane__crumb" aria-label="Zoom path" data-testid="breadcrumb">
        <button
          type="button"
          class="detail-pane__crumb-root"
          data-testid="back-to-map"
          onClick={() => onClose && onClose()}
        >
          ◂ Back to map
        </button>
        <span class="detail-pane__crumb-sep" aria-hidden="true">▸</span>
        <span class="detail-pane__crumb-current" aria-current="page">{item.id}</span>
      </nav>

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
