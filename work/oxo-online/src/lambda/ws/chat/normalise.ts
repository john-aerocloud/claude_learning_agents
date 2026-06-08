/**
 * normalise.ts — PURE domain text bound for the chat relay boundary (§41).
 *
 * T-CHAT-4 (AC1.5 / delta 011 §2b) — the server-side depth control + abuse cap.
 * The PRIMARY XSS control is React text render on the recipient client
 * (T-CHAT-3); this boundary normalisation is defence-in-depth (it protects any
 * FUTURE path that might persist or re-serve the text — there is none today) and
 * an abuse cap (it bounds the DOM cost of a flood and the blast radius of any
 * injection attempt).
 *
 * Steps (engineer's choice on the cap is TRUNCATE, pinned by the AC1.5 test):
 *   1. reject a non-string;
 *   2. trim leading/trailing whitespace;
 *   3. strip the markup chars `< > & " '` and ASCII control characters;
 *   4. reject (null) if the result is empty after trim + strip;
 *   5. cap at 200 characters (truncate the tail).
 *
 * Returns the normalised text, or `null` when the message must be rejected
 * (empty after trim/strip). The handler treats `null` as "no relay, no echo".
 *
 * Zero SDK / transport / APIGW concepts — unit-tested with plain strings.
 */

const MAX_LEN = 200;

// Markup chars `< > & " '` (the s009 player-name normalisation family) plus all
// ASCII control characters (0x00-0x1F and 0x7F DEL), expressed with explicit hex
// escapes so the class is unambiguous in source.
// eslint-disable-next-line no-control-regex
const STRIP = /[<>&"'\x00-\x1f\x7f]/g;

export function normaliseChatText(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().replace(STRIP, '');
  if (stripped.length === 0) return null;
  return stripped.slice(0, MAX_LEN);
}
