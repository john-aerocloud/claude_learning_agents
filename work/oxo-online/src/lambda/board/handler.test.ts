import { describe, it, expect } from 'vitest';
import type { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { createHandler } from './handler';
import { LocalLeaderboardStore } from './local-leaderboard-store';
import { AlreadyScored, type LeaderboardStorePort } from './ports';
import type { TallyField } from './tally';

// @covers board-fn-handler
// R2.5 — the stream-record adapter: parse OLD/NEW image FROM THE RECORD (no
// Games read), call domain tally, drive the store port. On AlreadyScored:
// swallow + log + DO NOT fail the batch + DO NOT retry. On a self-owned 5xx:
// log category:internal-service (defect signal) and surface the item failure so
// the platform retries. Logging is TESTED (§failure-handling). (AC2.2, AC2.7.)

/** A MODIFY stream record for an active→<newStatus> transition with names. */
function wonRecord(opts: {
  gameId: string;
  newStatus: 'won' | 'drawn' | 'abandoned';
  hostName?: string;
  guestName?: string;
  winner?: 'X' | 'O';
  oldStatus?: string;
}): DynamoDBRecord {
  const { gameId, newStatus, hostName, guestName, winner, oldStatus } = opts;
  const newImage: Record<string, unknown> = {
    gameId: { S: gameId },
    status: { S: newStatus },
  };
  if (hostName !== undefined) newImage.hostName = { S: hostName };
  if (guestName !== undefined) newImage.guestName = { S: guestName };
  if (winner !== undefined) newImage.winner = { S: winner };
  return {
    eventID: `evt-${gameId}`,
    eventName: 'MODIFY',
    dynamodb: {
      Keys: { gameId: { S: gameId } },
      OldImage: { gameId: { S: gameId }, status: { S: oldStatus ?? 'active' } },
      NewImage: newImage,
    },
  } as unknown as DynamoDBRecord;
}

function event(...records: DynamoDBRecord[]): DynamoDBStreamEvent {
  return { Records: records };
}

describe('board-fn handler — won game scores winner + loser (AC2.4 end-to-end)', () => {
  it('host wins (winner=X): hostName +1 win, guestName +1 loss, each scoredGames has the gameId', async () => {
    const store = new LocalLeaderboardStore();
    const handler = createHandler({ store, buildSha: 'sha', log: () => {} });
    await handler(
      event(
        wonRecord({
          gameId: 'G1',
          newStatus: 'won',
          hostName: 'ACE',
          guestName: 'BEE',
          winner: 'X',
        }),
      ),
    );
    const top = await store.topN(20);
    expect(top.find((e) => e.name === 'ACE')).toEqual({
      name: 'ACE',
      wins: 1,
      draws: 0,
      losses: 0,
    });
    expect(top.find((e) => e.name === 'BEE')).toEqual({
      name: 'BEE',
      wins: 0,
      draws: 0,
      losses: 1,
    });
    expect(store.scoredGamesFor('ACE')).toEqual(['G1']);
    expect(store.scoredGamesFor('BEE')).toEqual(['G1']);
  });

  it('guest wins (winner=O): guestName +1 win, hostName +1 loss', async () => {
    const store = new LocalLeaderboardStore();
    const handler = createHandler({ store, buildSha: 'sha', log: () => {} });
    await handler(
      event(
        wonRecord({
          gameId: 'G2',
          newStatus: 'won',
          hostName: 'ACE',
          guestName: 'BEE',
          winner: 'O',
        }),
      ),
    );
    const top = await store.topN(20);
    expect(top.find((e) => e.name === 'BEE')?.wins).toBe(1);
    expect(top.find((e) => e.name === 'ACE')?.losses).toBe(1);
  });
});

describe('board-fn handler — drawn game (AC2.5)', () => {
  it('both names +1 draw', async () => {
    const store = new LocalLeaderboardStore();
    const handler = createHandler({ store, buildSha: 'sha', log: () => {} });
    await handler(
      event(
        wonRecord({
          gameId: 'G3',
          newStatus: 'drawn',
          hostName: 'ACE',
          guestName: 'BEE',
        }),
      ),
    );
    const top = await store.topN(20);
    expect(top.find((e) => e.name === 'ACE')?.draws).toBe(1);
    expect(top.find((e) => e.name === 'BEE')?.draws).toBe(1);
  });
});

describe('board-fn handler — missing names default to AAA (SM-3)', () => {
  it('a won game where BOTH default to AAA scores AAA once (the per-name-per-game marker dedups the loss)', async () => {
    const store = new LocalLeaderboardStore();
    const handler = createHandler({ store, buildSha: 'sha', log: () => {} });
    await handler(event(wonRecord({ gameId: 'G4', newStatus: 'won', winner: 'X' })));
    const top = await store.topN(20);
    // Both winner and loser default to AAA, so the SAME row (AAA) is the target
    // of both ops. The first op (wins, G4) marks AAA.scoredGames={G4}; the second
    // op (losses, G4) hits the idempotency gate (G4 already scored for AAA) and
    // is swallowed. The scoredGames marker is per-name-per-game by design — one
    // name cannot score twice in ONE game. Result: AAA wins=1, losses=0.
    const aaa = top.find((e) => e.name === 'AAA');
    expect(aaa).toEqual({ name: 'AAA', wins: 1, draws: 0, losses: 0 });
    expect(store.scoredGamesFor('AAA')).toEqual(['G4']);
  });

  it('a won game with only the host named (guest defaults to AAA) scores both distinctly', async () => {
    const store = new LocalLeaderboardStore();
    const handler = createHandler({ store, buildSha: 'sha', log: () => {} });
    await handler(
      event(wonRecord({ gameId: 'G4b', newStatus: 'won', hostName: 'ACE', winner: 'X' })),
    );
    const top = await store.topN(20);
    expect(top.find((e) => e.name === 'ACE')?.wins).toBe(1);
    expect(top.find((e) => e.name === 'AAA')?.losses).toBe(1);
  });
});

describe('board-fn handler — idempotency: AlreadyScored is swallowed (AC2.7, SM-4)', () => {
  it('a replayed record does NOT throw, does NOT double-count, logs the swallow', async () => {
    const store = new LocalLeaderboardStore();
    const logs: Array<Record<string, unknown>> = [];
    const handler = createHandler({
      store,
      buildSha: 'sha',
      log: (l) => logs.push(l),
    });
    const rec = wonRecord({
      gameId: 'G5',
      newStatus: 'won',
      hostName: 'ACE',
      guestName: 'BEE',
      winner: 'X',
    });
    await handler(event(rec));
    // Replay the SAME record — must not throw and must not move counters.
    const result = await handler(event(rec));
    const top = await store.topN(20);
    expect(top.find((e) => e.name === 'ACE')?.wins).toBe(1);
    expect(top.find((e) => e.name === 'BEE')?.losses).toBe(1);
    // No item failures reported for an idempotent replay.
    expect(result?.batchItemFailures ?? []).toEqual([]);
    // The swallow is logged with the category + gameId so the §30 skeleton can
    // assert ConditionalCheckFailed-equivalent in logs.
    const swallowed = logs.filter((l) => l.event === 'already_scored');
    expect(swallowed.length).toBeGreaterThanOrEqual(2);
    expect(swallowed[0].category).toBe('idempotent-replay');
    expect(swallowed[0].buildSha).toBe('sha');
  });
});

describe('board-fn handler — self-owned 5xx is a defect signal (§failure-handling)', () => {
  it('a non-AlreadyScored store failure logs category:internal-service and reports the item failure', async () => {
    const failing: LeaderboardStorePort = {
      async recordResult(_n: string, _f: TallyField, _g: string) {
        throw Object.assign(new Error('throttled'), {
          name: 'ProvisionedThroughputExceededException',
          $metadata: { httpStatusCode: 500 },
        });
      },
      async topN() {
        return [];
      },
    };
    const logs: Array<Record<string, unknown>> = [];
    const handler = createHandler({
      store: failing,
      buildSha: 'sha',
      log: (l) => logs.push(l),
    });
    const result = await handler(
      event(
        wonRecord({
          gameId: 'G6',
          newStatus: 'won',
          hostName: 'ACE',
          guestName: 'BEE',
          winner: 'X',
        }),
      ),
    );
    // The record is reported as a batch item failure so the platform retries
    // (off the game hot path — never affects play).
    expect(result?.batchItemFailures?.length).toBeGreaterThanOrEqual(1);
    const internal = logs.filter((l) => l.category === 'internal-service');
    expect(internal.length).toBeGreaterThanOrEqual(1);
    expect(internal[0].buildSha).toBe('sha');
  });
});

describe('board-fn handler — emits buildSha on every invocation (principles/01)', () => {
  it('logs an invocation line carrying buildSha', async () => {
    const store = new LocalLeaderboardStore();
    const logs: Array<Record<string, unknown>> = [];
    const handler = createHandler({ store, buildSha: 'sha-123', log: (l) => logs.push(l) });
    await handler(
      event(wonRecord({ gameId: 'G7', newStatus: 'won', hostName: 'ACE', winner: 'X' })),
    );
    expect(logs.some((l) => l.buildSha === 'sha-123')).toBe(true);
  });

  it('exports a callable default handler bound to the DDB store', async () => {
    const mod = await import('./handler');
    expect(typeof mod.handler).toBe('function');
  });
});
