// UC-S002-6 — LiveStatusDot: the small SSE-connection indicator
// (components.md §LiveStatusDot). It tells the operator the map is updating live
// vs reconnecting, so a stale-looking screen is never mistaken for a fresh one.
//
// HEXAGONAL ROLE: pure presentation. It takes a single `state`
// ('connected' | 'reconnecting') the MapContainer derives from the SSE channel;
// it touches no EventSource/fetch.
//
// A11Y (NEVER colour-only): the meaning rides on
//   1. visible TEXT ("Live" / "Reconnecting") — the AUTHORITATIVE cue;
//   2. an aria-hidden ● dot — decorative shape/colour cue, never the sole signal;
//   3. role=status + aria-live=polite so a reconnect is ANNOUNCED ONCE (not
//      spammed) to assistive tech; the accessible name carries the full state.
// data-state drives the redundant colour token in CSS.

import './live-status-dot.css';

const LABEL = {
  connected: 'Live updates: connected',
  reconnecting: 'Live updates: reconnecting',
};

const TEXT = {
  connected: 'Live',
  reconnecting: 'Reconnecting',
};

/**
 * @param {object} props
 * @param {'connected'|'reconnecting'} [props.state='connected']
 */
export function LiveStatusDot({ state = 'connected' }) {
  const safe = state === 'reconnecting' ? 'reconnecting' : 'connected';
  return (
    <span
      class="live-status"
      data-testid="live-status"
      data-state={safe}
      role="status"
      aria-live="polite"
      aria-label={LABEL[safe]}
    >
      <span class="live-status__dot" aria-hidden="true">
        ●
      </span>
      <span class="live-status__label">{TEXT[safe]}</span>
    </span>
  );
}
