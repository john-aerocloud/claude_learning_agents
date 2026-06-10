// UC-S005-3 — DOMAIN logic for the drill-down detail pane.
//
// HEXAGONAL ROLE: pure domain. It owns the ubiquitous language of "which slice
// directory backs this work item" and "what does the pane call itself", and
// knows NOTHING about HTTP/fetch/the DOM/Preact. The DetailPane (render) and the
// api/client adapter consume these helpers; neither re-implements the slug rule.
//
// SLUG DERIVATION — the live observatory tree is REQ→CHK→UC (no SLC item rows),
// while slice ARTIFACTS live in work/<id>/slices/<slug>/. A UC id encodes its
// slice number (UC-S001-4 → s001), so we map the node onto the slice dir whose
// name starts with that sNNN prefix. A slice-type node (should one exist) uses
// its own id directly. REQ/CHK and any node with no sNNN → null (no artifact;
// the pane shows the "not yet available" placeholder — AC-S005-3-4).

/**
 * Map a work-item record to its backing slice slug, or null when it has none.
 * @param {object|null} item            - the selected ItemRecord
 * @param {string[]|null} availableSlugs - slice dir names from GET /slices
 * @returns {string|null}
 */
export function deriveSliceSlug(item, availableSlugs) {
  if (!item || typeof item !== 'object') return null;
  if (!Array.isArray(availableSlugs)) return null;
  const id = typeof item.id === 'string' ? item.id : '';
  if (!id) return null;

  // A slice-type node whose id IS a slug → use it directly.
  if (item.type === 'slice' && availableSlugs.includes(id)) return id;

  // Otherwise derive the sNNN prefix from the id (e.g. UC-S001-4 → s001).
  const m = id.match(/S(\d{3})/i);
  if (!m) return null;
  const prefix = `s${m[1]}`.toLowerCase();
  const match = availableSlugs.find(
    (slug) => typeof slug === 'string' && slug.toLowerCase().startsWith(`${prefix}-`),
  );
  return match || null;
}

/** The artifact shown first when a slice node is drilled into. */
export function defaultArtifactName() {
  return 'slice.md';
}

/** Accessible region label for the pane (A11Y-S005-3: "Item detail: <id>"). */
export function paneLabel(item) {
  const id = item && typeof item.id === 'string' ? item.id : '';
  return id ? `Item detail: ${id}` : 'Item detail';
}
