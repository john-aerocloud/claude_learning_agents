// UC-S002-4 — BufferStateIndicator: the starving / over-WIP badge inside a
// QueueBox.
//
// HEXAGONAL ROLE: pure presentation. It takes a domain `status`
// ('ok'|'starving'|'over-wip') — the value UC2's QueueState already computed —
// and renders the redundant non-colour state cue. It touches no fetch/CSV/URL.
//
// A11Y-5 (the core a11y requirement — state is NEVER colour-only): each non-ok
// state is conveyed by THREE redundant channels —
//   1. visible TEXT label ("starving" / "over-WIP") — the AUTHORITATIVE cue,
//      part of the box's accessible name path (the box also names the state, see
//      PipelineMap.accessibleName), readable by screen readers + colourblind users;
//   2. an icon (▽ down-triangle / △ up-triangle) that is aria-hidden="true" —
//      decorative shape cue, distinguishable in pure greyscale, never the sole signal;
//   3. colour (the design-system --c-state-* border/token) applied by CSS as a
//      REDUNDANT cue, layered on top — not the signal itself.
// The `ok` state has NO badge (clean state → element absent).

import './buffer-state-indicator.css';

// status → { icon (shape cue, aria-hidden), label (authoritative text cue) }.
const STATE = {
  starving: { icon: '▽', label: 'starving' },
  'over-wip': { icon: '△', label: 'over-WIP' },
};

/**
 * Renders the buffer-state badge for a queue's status, or nothing when the
 * status is `ok`/unknown. data-testid="state-badge" is the stable hook the
 * tester and UC5 (ConstraintBadge sits alongside) rely on; data-status drives
 * the redundant colour token in CSS.
 */
export function BufferStateIndicator({ status }) {
  const state = STATE[status];
  if (!state) return null; // ok / undefined → no badge (clean state)

  return (
    <span class="state-badge" data-testid="state-badge" data-status={status}>
      <span class="state-badge__icon" aria-hidden="true">
        {state.icon}
      </span>
      <span class="state-badge__label">{state.label}</span>
    </span>
  );
}
