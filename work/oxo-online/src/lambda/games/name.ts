/**
 * name.ts (games) — the SERVER-SIDE name normaliser, the WRITE-SIDE half of the
 * stored-XSS control (§8, delta 010). The name is normalised ONCE at the API
 * boundary on BOTH paths (oxo-game-fn create, oxo-ws-fn join) BEFORE it reaches
 * the durable Games item — so even a future unescaped render, or a non-SPA
 * consumer of GET /api/leaderboard, cannot be XSS'd by a planted name.
 *
 * Order (pinned): strip the disallowed charset -> trim -> truncate to <=10 ->
 * blank becomes the arcade default "AAA". Play is NEVER blocked over a name
 * (arcade UX, SM-3): a too-long or markup-laden name is truncated/stripped to
 * the safe set, never rejected.
 *
 * The SPA carries a mirror normaliser (src/app/src/game/name.ts) for instant
 * feedback; THIS server-side one is authoritative (the SPA's is convenience,
 * the boundary's is the control). The regex is pinned in a test (T-LB-2).
 */

/** The single source of truth for the safe charset: strip anything NOT in it. */
export const NAME_STRIP_REGEX = /[^A-Za-z0-9 ._-]/g;

/** Arcade default when the name is absent/blank/all-stripped (SM-3). */
const DEFAULT_NAME = 'AAA';

/** Maximum stored name length. */
const MAX_NAME_LENGTH = 10;

export function normaliseName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NAME;
  const stripped = raw.replace(NAME_STRIP_REGEX, '');
  const trimmed = stripped.trim();
  const bounded = trimmed.slice(0, MAX_NAME_LENGTH);
  return bounded === '' ? DEFAULT_NAME : bounded;
}
