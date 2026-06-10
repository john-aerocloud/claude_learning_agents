// UC-S005-2 — SpaceTagBadge: the /work-vs-/process distinction badge.
//
// HEXAGONAL ROLE: pure presentational. Renders the §8 three-redundant-cue
// pattern for a node's `space` so the distinction NEVER rides on colour alone
// (A11Y-S005-6 / AC-S005-2-5):
//   1. visible text label ("work" / "process") — AUTHORITATIVE
//   2. an icon glyph (aria-hidden, decorative shape: project vs gear)
//   3. a colour band, carried by a space-distinct CSS class (the only colour cue)
//
// The class differs per space value so distinct data-space values map to
// distinct computed colour bands (AC-S005-2-5 asserts class/colour differs).

const SPACE_META = {
  work: { label: 'work', icon: '▤' }, // ▤ stacked/project glyph
  process: { label: 'process', icon: '⚙' }, // ⚙ gear / self-state glyph
};

/**
 * @param {{ space: 'work'|'process' }} props
 */
export function SpaceTagBadge({ space }) {
  const meta = SPACE_META[space] || SPACE_META.work;
  return (
    <span
      class={`space-tag space-tag--${space}`}
      data-testid="space-tag"
      data-space={space}
    >
      <span class="space-tag__icon" aria-hidden="true">{meta.icon}</span>
      <span class="space-tag__label">{meta.label}</span>
    </span>
  );
}
