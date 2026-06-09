// UC-S002-5 — ConstraintBadge: the ◆ + "constraint" corner ribbon marking the
// QueueBox named as the ToC constraint in baseline.md.
//
// HEXAGONAL ROLE: pure presentation. It takes a single boolean `present` (the
// render layer decides which box is the constraint via matchConstraintQueue) and
// renders the non-colour constraint cue. No fetch/CSV/URL.
//
// A11Y-6 (constraint non-colour cue, NEVER colour-only): the cue is carried by
//   1. visible TEXT "constraint" — the AUTHORITATIVE cue (screen readers,
//      colourblind users), part of the box's accessible-name path;
//   2. an aria-hidden ◆ diamond — decorative shape cue, distinguishable in pure
//      greyscale, never the sole signal;
//   3. colour (--c-constraint / --c-constraint-bd) applied by CSS — the THIRD,
//      REDUNDANT cue.
//
// A11Y-7 (co-occurrence WITHOUT masking): the constraint uses a DISTINCT VISUAL
// CHANNEL + POSITION from the BufferStateIndicator — a CORNER RIBBON (absolutely
// positioned top-right) vs the state-badge's in-flow badge. So a box that is
// BOTH the constraint AND starving/over-WIP shows both, neither hiding the other.

import './constraint-badge.css';

/**
 * @param {object} props
 * @param {boolean} [props.present=false] - render the ribbon only on the constraint box.
 */
export function ConstraintBadge({ present = false }) {
  if (!present) return null; // non-constraint box → no element at all

  return (
    <span class="constraint-badge" data-testid="constraint-badge">
      <span class="constraint-badge__icon" aria-hidden="true">
        ◆
      </span>
      <span class="constraint-badge__label">constraint</span>
    </span>
  );
}
