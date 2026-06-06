import { test, expect, request as pwRequest } from '@playwright/test';

/**
 * =============================================================================
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * -----------------------------------------------------------------------------
 * Slice:            004-create-game
 * Acceptance pinned: F2 (code format), T1 (response half — {gameId, code}),
 *                    S1 (override defence — server generates persisted fields,
 *                        response values differ from client-planted values).
 * Relevancy:        pinned (standing regression — runs every validation pass).
 * Retire when:      the POST /api/games response contract changes (new fields,
 *                   renamed code/gameId) or the create-game endpoint is removed.
 *                   Until then this is the regression guard for the public
 *                   create-game contract; do not delete at routine slice-next.
 * Surface:          live production, PROD_URL (default CloudFront distribution),
 *                   via Playwright request context (no browser, no AWS creds).
 * Replaces:         the tester's ad-hoc `curl POST /api/games` probes and the
 *                   planted-value override curl from slice 004 step 16.
 * =============================================================================
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';

/** Unambiguous-code alphabet: A-Z + 2-9 minus O,0,1,I,L (F2). */
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Planted attacker fixtures (S1). These live in the spec, in code-review scope —
 * NOT generated ad hoc in a shell. If any of these values are echoed back in the
 * response, the server is trusting client-supplied persisted fields.
 */
const PLANTED_BODY = {
  gameId: '00000000-dead-beef-cafe-000000000000',
  code: 'HACKED',
  status: 'finished',
  ttl: 1,
} as const;

test.describe('Slice 004 — POST /api/games public contract', () => {
  test('T1 (response) / F2 — 201 with exactly {gameId, code}; gameId is a UUID, code is unambiguous 6-char', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    try {
      const res = await ctx.post('/api/games', { data: {} });
      expect(res.status(), 'POST /api/games must return 201').toBe(201);
      expect(
        res.headers()['content-type'] ?? '',
        'response must be JSON, not the SPA index.html',
      ).toContain('application/json');

      const body = await res.json();

      // Exactly the two server-owned fields — no leakage of ttl/status/etc.
      expect(
        Object.keys(body).sort(),
        `response keys must be exactly [code, gameId], got ${JSON.stringify(Object.keys(body))}`,
      ).toEqual(['code', 'gameId']);

      expect(body.gameId, `gameId "${body.gameId}" must be a UUID`).toMatch(UUID_RE);
      expect(
        body.code,
        `code "${body.code}" must be unambiguous 6-char (no O 0 1 I L)`,
      ).toMatch(CODE_RE);
    } finally {
      await ctx.dispose();
    }
  });

  test('S1 — planted gameId/code/status/ttl are ignored; response values are server-generated and differ', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    try {
      const res = await ctx.post('/api/games', { data: PLANTED_BODY });
      expect(res.status(), 'planted POST must still return 201').toBe(201);

      const body = await res.json();

      // Server-generated shape holds regardless of planted input.
      expect(body.gameId, `gameId "${body.gameId}" must be a UUID`).toMatch(UUID_RE);
      expect(body.code, `code "${body.code}" must be unambiguous 6-char`).toMatch(CODE_RE);

      // None of the planted values may be echoed back.
      expect(
        body.gameId,
        'server must NOT accept client-supplied gameId',
      ).not.toBe(PLANTED_BODY.gameId);
      expect(
        body.code,
        'server must NOT accept client-supplied code',
      ).not.toBe(PLANTED_BODY.code);
      expect(
        body.code,
        'planted code "HACKED" contains forbidden chars and must never be issued',
      ).not.toBe('HACKED');
    } finally {
      await ctx.dispose();
    }
  });

  test('T2 (observable) — repeated POSTs return distinct gameIds (CachingDisabled on /api/*)', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    try {
      const a = await (await ctx.post('/api/games', { data: {} })).json();
      const b = await (await ctx.post('/api/games', { data: {} })).json();
      expect(
        a.gameId,
        'two POSTs must yield distinct gameIds — a cached API response would repeat them',
      ).not.toBe(b.gameId);
    } finally {
      await ctx.dispose();
    }
  });
});
