/**
 * domain-name-normalise (SPA arm) — pure player-name normaliser.
 *
 * The arcade name model (s009 UC1): a player's name is an optional 3-ish-char
 * arcade tag. It is NEVER a gate to play — a blank name resolves to "AAA". This
 * client-side copy normalises the value the SPA threads into `POST /api/games`
 * (host) and the WS `join` frame (guest). The server RE-normalises with the same
 * transform authoritatively (R1.5/R1.6); this SPA copy keeps the wire value clean
 * and is the display-friendly default for the field.
 *
 * The pinned transform (T-LB-2 write-side / §8 stored-XSS bound), in order:
 *   1. charset-strip everything outside `/[^A-Za-z0-9 ._-]/g` (removes < > & " '
 *      and all control chars — the markup/XSS characters cannot reach storage);
 *   2. trim leading/trailing whitespace;
 *   3. cap to MAX_NAME_LEN (10) characters;
 *   4. if the result is empty, fall back to DEFAULT_NAME ("AAA").
 */

/** Default arcade tag when the player leaves the name blank (SM-3). */
export const DEFAULT_NAME = 'AAA';

/** Maximum stored name length (also the input maxlength). */
export const MAX_NAME_LEN = 10;

/** Allowed-charset filter — everything NOT in this class is stripped. */
const DISALLOWED = /[^A-Za-z0-9 ._-]/g;

export function normaliseName(raw: string): string {
  const cleaned = raw.replace(DISALLOWED, '').trim().slice(0, MAX_NAME_LEN);
  return cleaned.length > 0 ? cleaned : DEFAULT_NAME;
}
