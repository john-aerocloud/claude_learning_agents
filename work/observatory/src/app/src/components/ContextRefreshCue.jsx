// UC-S014-4 — ContextRefreshCue: the EXP-036 stale/live cue on the steer
// context block. It tells the operator whether the displayed context is live,
// being refreshed, or has DIVERGED from the prompt they already generated —
// so they never hand Claude a prompt built on context they know is stale.
//
// HEXAGONAL ROLE: pure presentation (the LiveStatusDot idiom). The container
// derives `state` from useSteerContext's `refreshing` flag + a "context
// changed since last Generate" comparison; this component touches no fetch.
//
// A11Y (NEVER colour-only): meaning rides on
//   1. visible TEXT (authoritative — "Live" / "Refreshing…" / the regenerate
//      sentence, S14-4-FIG-2: human words, never a frame id or timestamp);
//   2. an aria-hidden glyph (● / ⟳) — decorative, never the sole signal;
//   3. role="status" aria-live="polite" so a (debounced) refresh is announced
//      ONCE, not spammed per SSE frame (S14-4-A11Y-8).
// `data-state` drives the redundant colour band in CSS (--c-state-over for
// `updated` — the attention channel, on top of the text, A11Y-3).

import './context-refresh-cue.css';

const TEXT = {
  live: 'Live',
  refreshing: 'Refreshing…',
  updated: 'Context updated — regenerate to refresh the prompt',
};

const LABEL = {
  live: 'Item context: live',
  refreshing: 'Item context: refreshing',
  updated: 'Item context: updated — regenerate to refresh the prompt',
};

const GLYPH = {
  live: '●',
  refreshing: '⟳',
  updated: '⟳',
};

const STATES = new Set(['live', 'refreshing', 'updated']);

/**
 * UC-S013-4 ADDITIVE overrides: the idiom gained a second consumer (the
 * defect drill's record-freeze cue), so testId + per-state wording are
 * injectable. Defaults are byte-identical to the steer values — every
 * UC-S014-4 pin holds untouched. The idiom invariants (visible text,
 * aria-hidden glyph, polite status region, data-state colour band) are NOT
 * overridable: they are the component.
 * @param {object} props
 * @param {'live'|'refreshing'|'updated'} [props.state='live']
 * @param {string} [props.testId='steer-context-live']
 * @param {Partial<Record<'live'|'refreshing'|'updated', string>>} [props.texts]
 * @param {Partial<Record<'live'|'refreshing'|'updated', string>>} [props.labels]
 */
export function ContextRefreshCue({ state = 'live', testId = 'steer-context-live', texts, labels }) {
  const safe = STATES.has(state) ? state : 'live'; // fail-soft, never blank
  const text = (texts && texts[safe]) || TEXT[safe];
  const label = (labels && labels[safe]) || LABEL[safe];
  return (
    <span
      class="context-refresh-cue"
      data-testid={testId}
      data-state={safe}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span class="context-refresh-cue__glyph" aria-hidden="true">
        {GLYPH[safe]}
      </span>
      <span class="context-refresh-cue__label">{text}</span>
    </span>
  );
}
