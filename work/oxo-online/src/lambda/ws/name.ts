/**
 * name.ts (ws) — the SERVER-SIDE name normaliser for the GUEST join path
 * (oxo-ws-fn), the write-side half of the stored-XSS control (§8, delta 010).
 * IDENTICAL logic to games/name.ts (the host create path) — both API boundaries
 * normalise once, server-side, before the name reaches the durable Games item.
 *
 * It is duplicated here (not imported from games/) because the ws build
 * (tsconfig.ws.json: rootDir = lambda root, include ws/** + move/**) does not
 * compile the games/ tree. The regex is pinned in BOTH name.test.ts files so the
 * two boundaries cannot silently diverge — a divergence fails a test.
 *
 * Order (pinned): strip disallowed charset -> trim -> truncate <=10 -> blank
 * becomes "AAA". Play is never blocked over a name (arcade UX, SM-3).
 */

/** The single source of truth for the safe charset: strip anything NOT in it. */
export const NAME_STRIP_REGEX = /[^A-Za-z0-9 ._-]/g;

const DEFAULT_NAME = 'AAA';
const MAX_NAME_LENGTH = 10;

export function normaliseName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NAME;
  const stripped = raw.replace(NAME_STRIP_REGEX, '');
  const trimmed = stripped.trim();
  const bounded = trimmed.slice(0, MAX_NAME_LENGTH);
  return bounded === '' ? DEFAULT_NAME : bounded;
}
