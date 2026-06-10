// UC-S005-6 — ZoomBreadcrumb: the zoom-out path inside the detail drawer.
//
// HEXAGONAL ROLE: pure render. It is a function of `path` (the root->selected
// chain of ItemRecords the container derived via ancestryPath) plus two zoom-out
// callbacks. It owns NO fetch and NO ancestry logic — the domain
// (workItemTree.ancestryPath) computes the chain; this only paints it.
//
// ZOOM-OUT SEMANTICS (AC-S005-6-1, A11Y-S005-5):
//   - "Back to map" (the root control) CLOSES the drawer and returns to the
//     value-stream map — the full zoom-out.
//   - Each ANCESTOR crumb is a button that zooms out ONE level: clicking it
//     re-selects that ancestor (onZoomTo(id)) so the drawer reframes on the
//     parent without losing orientation.
//   - The SELECTED (last) crumb is the current location: it is aria-current and
//     NOT actionable (you are already here).
//   - Separators (▸) are decorative → aria-hidden.
// Labelled <nav aria-label="Zoom path"> so it is announced as a navigation
// landmark; each crumb keyboard-operable (native <button>).

/**
 * @param {object} props
 * @param {Array} props.path           - root->selected ItemRecord chain (selected last)
 * @param {()=>void} props.onClose     - close the drawer (Back to map / full zoom-out)
 * @param {(id:string)=>void} props.onZoomTo - re-select an ancestor (one level out)
 */
export function ZoomBreadcrumb({ path = [], onClose, onZoomTo }) {
  const crumbs = Array.isArray(path) ? path : [];
  const lastIdx = crumbs.length - 1;

  return (
    <nav class="detail-pane__crumb" aria-label="Zoom path" data-testid="breadcrumb">
      <button
        type="button"
        class="detail-pane__crumb-root"
        data-testid="back-to-map"
        onClick={() => onClose && onClose()}
      >
        ◂ Back to map
      </button>
      {crumbs.map((rec, i) => {
        const isCurrent = i === lastIdx;
        return (
          <>
            <span class="detail-pane__crumb-sep" aria-hidden="true">▸</span>
            <span
              class={`detail-pane__crumb-item${isCurrent ? ' detail-pane__crumb-current' : ''}`}
              data-testid="crumb"
              data-crumb-id={rec.id}
              {...(isCurrent ? { 'aria-current': 'page' } : {})}
            >
              {isCurrent ? (
                rec.id
              ) : (
                <button
                  type="button"
                  class="detail-pane__crumb-link"
                  aria-label={`Zoom out to ${rec.id}`}
                  onClick={() => onZoomTo && onZoomTo(rec.id)}
                >
                  {rec.id}
                </button>
              )}
            </span>
          </>
        );
      })}
    </nav>
  );
}
