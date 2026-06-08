import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createLeaderboardHandler } from './leaderboard-handler';
import type { LeaderboardStorePort } from '../board/ports';
import type { TallyField } from '../board/tally';

// @covers gamesCreateHandler (read arm), port-leaderboard-store
// R3.5 — GET /api/leaderboard: top-20 via topN(20) (Scan + sort) → JSON
// { entries:[{name,wins,draws,losses}], buildSha }. buildSha in the body
// (principles/01). Scan-only read path (the game-fn Scan grant is pinned at
// synth). (AC3.6, AC3.8, T-LB-6.)

function getEvent(): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /api/leaderboard',
    rawPath: '/api/leaderboard',
    requestContext: { http: { method: 'GET', path: '/api/leaderboard' } },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function storeReturning(
  entries: { name: string; wins: number; draws: number; losses: number }[],
): LeaderboardStorePort & { topNArg?: number } {
  const self: LeaderboardStorePort & { topNArg?: number } = {
    async recordResult(_n: string, _f: TallyField, _g: string) {
      throw new Error('read handler must not write');
    },
    async topN(n: number) {
      self.topNArg = n;
      return entries.slice(0, n);
    },
  };
  return self;
}

describe('leaderboard read handler — shape + buildSha (AC3.8, T-LB-6)', () => {
  it('returns 200 with entries {name,wins,draws,losses} and a buildSha string', async () => {
    const store = storeReturning([
      { name: 'ACE', wins: 3, draws: 1, losses: 0 },
      { name: 'BEE', wins: 1, draws: 0, losses: 2 },
    ]);
    const handler = createLeaderboardHandler({ store, buildSha: 'sha-xyz' });
    const res = await handler(getEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toContain('application/json');
    const body = JSON.parse(res.body as string);
    expect(body.entries).toEqual([
      { name: 'ACE', wins: 3, draws: 1, losses: 0 },
      { name: 'BEE', wins: 1, draws: 0, losses: 2 },
    ]);
    expect(typeof body.buildSha).toBe('string');
    expect(body.buildSha).toBe('sha-xyz');
  });

  it('asks the store for the top 20 (the slice bound)', async () => {
    const store = storeReturning([]);
    const handler = createLeaderboardHandler({ store, buildSha: 'sha' });
    await handler(getEvent());
    expect(store.topNArg).toBe(20);
  });

  it('empty store -> 200 with entries:[]', async () => {
    const store = storeReturning([]);
    const handler = createLeaderboardHandler({ store, buildSha: 'sha' });
    const res = await handler(getEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string).entries).toEqual([]);
  });
});

describe('leaderboard read handler — self-owned 5xx on store failure (§failure-handling)', () => {
  it('a Scan failure returns a clean 500 (we own it) + logs category internal-service', async () => {
    const logs: Array<Record<string, unknown>> = [];
    const store: LeaderboardStorePort = {
      async recordResult() {
        throw new Error('n/a');
      },
      async topN() {
        throw Object.assign(new Error('throttled'), {
          $metadata: { httpStatusCode: 500 },
        });
      },
    };
    const handler = createLeaderboardHandler({
      store,
      buildSha: 'sha',
      log: (l) => logs.push(l),
    });
    const res = await handler(getEvent());
    expect(res.statusCode).toBe(500);
    // No internal leak in the body.
    expect(res.body as string).not.toContain('throttled');
    const internal = logs.filter((l) => l.category === 'internal-service');
    expect(internal.length).toBeGreaterThanOrEqual(1);
    expect(internal[0].buildSha).toBe('sha');
  });
});
