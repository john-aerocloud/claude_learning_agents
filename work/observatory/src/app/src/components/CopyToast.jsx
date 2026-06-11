// UC-S014-4 — CopyToast: the transient copy-success confirmation. A POLITE
// live region (role="status" aria-live="polite" — never role=alert/assertive:
// a successful copy is a confirmation, not an interruption; matches the
// LiveStatusDot announce-once discipline, S14-4-A11Y-2).
//
// HEXAGONAL ROLE: pure presentation. Visibility + the auto-dismiss timer are
// owned by the caller (SteerPanel); this component renders or doesn't.
//
// GEOMETRY (GEO-S014-4-1): portalled to document.body + position:fixed — its
// own stacking context, ZERO flow height: showing it reflows NOTHING (panel,
// prompt <pre>, VSM, tree all byte-identical) and it never causes scroll.
// FOCUS (S14-4-A11Y-7): a status region, not a dialog — it NEVER takes focus.
// NON-COLOUR (S14-4-A11Y-3 / FIG-1): success is the human TEXT "Copied to
// clipboard" (+ the button's "Copied ✓" flip); the ✓ glyph is aria-hidden
// decoration; the --c-state-ok accent is a redundant channel only.
// REDUCED MOTION (S14-4-A11Y-6): fade is --dur-fast under no-preference,
// none under reduce (CSS @media) — appear/disappear is instant.

import { createPortal } from 'preact/compat';
import './copy-toast.css';

/** Auto-dismiss visible duration when --dur-toast is unreadable (jsdom). */
export const TOAST_FALLBACK_MS = 3000;

/**
 * The toast's visible duration, read from the ONE design token (--dur-toast,
 * tokens.css) so a duration change lands in one place; falls back when no
 * stylesheet is applied (jsdom).
 * @returns {number} milliseconds
 */
export function toastDurationMs() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-toast');
    const m = raw.trim().match(/^([\d.]+)(ms|s)$/);
    if (m) return m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
  } catch {
    /* no computed styles (jsdom) — fall through */
  }
  return TOAST_FALLBACK_MS;
}

/**
 * @param {object} props
 * @param {boolean} [props.visible=false] - hidden state renders NOTHING (absent, not invisible)
 * @param {string} [props.message='Copied to clipboard']
 */
export function CopyToast({ visible = false, message = 'Copied to clipboard' }) {
  if (!visible) return null;
  return createPortal(
    <div class="copy-toast" data-testid="copy-toast" role="status" aria-live="polite">
      <span class="copy-toast__glyph" aria-hidden="true">✓</span>
      <span class="copy-toast__label">{message}</span>
    </div>,
    document.body,
  );
}
