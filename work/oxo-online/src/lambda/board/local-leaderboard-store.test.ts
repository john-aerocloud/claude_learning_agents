import { describe, it, expect } from 'vitest';
import { LocalLeaderboardStore } from './local-leaderboard-store';
import { AlreadyScored } from './ports';

// @covers adapter-local-leaderboard
// R2.4 — the OFFLINE idempotency proof (delta §6 / principles/02). The local
// adapter reproduces the conditional-ADD/`NOT contains(scoredGames)` BRANCH so
// the replay test (SM-4) runs with no cloud. §12a caution: a JS map gives the
// branch SHAPE, not real DynamoDB set-contains atomicity under concurrency —
// that is covered by the CAS pin (ddb adapter) + the §30 prod skeleton.
// (AC2.7 replay, AC2.8 collision accumulation.)

describe('LocalLeaderboardStore.recordResult — increments + marks the gameId', () => {
  it('first record increments the field and slots the gameId into scoredGames', async () => {
    const store = new LocalLeaderboardStore();
    await store.recordResult('ACE', 'wins', 'G1');
    const top = await store.topN(20);
    expect(top).toContainEqual({ name: 'ACE', wins: 1, draws: 0, losses: 0 });
  });
});

describe('LocalLeaderboardStore — idempotency replay (AC2.7, SM-4)', () => {
  it('a second record of the SAME gameId throws AlreadyScored; counters UNCHANGED', async () => {
    const store = new LocalLeaderboardStore();
    await store.recordResult('ACE', 'wins', 'G1');
    await expect(store.recordResult('ACE', 'wins', 'G1')).rejects.toBeInstanceOf(
      AlreadyScored,
    );
    const top = await store.topN(20);
    // wins stayed at 1 — no double-count.
    expect(top.find((e) => e.name === 'ACE')?.wins).toBe(1);
  });

  it('the gameId appears in scoredGames EXACTLY once after a replay attempt', async () => {
    const store = new LocalLeaderboardStore();
    await store.recordResult('ACE', 'wins', 'G1');
    try {
      await store.recordResult('ACE', 'wins', 'G1');
    } catch {
      /* expected AlreadyScored */
    }
    expect(store.scoredGamesFor('ACE')).toEqual(['G1']);
  });
});

describe('LocalLeaderboardStore — name-collision accumulation (AC2.8, SM-2)', () => {
  it('two DISTINCT games for AAA (one won, one drawn) → one row, wins=1 draws=1, scoredGames {G1,G2}', async () => {
    const store = new LocalLeaderboardStore();
    await store.recordResult('AAA', 'wins', 'G1');
    await store.recordResult('AAA', 'draws', 'G2');
    const top = await store.topN(20);
    const aaa = top.find((e) => e.name === 'AAA');
    expect(aaa).toEqual({ name: 'AAA', wins: 1, draws: 1, losses: 0 });
    expect(store.scoredGamesFor('AAA').sort()).toEqual(['G1', 'G2']);
  });
});

describe('LocalLeaderboardStore.topN — same ordering as the ddb adapter', () => {
  it('orders wins desc / losses asc / name asc', async () => {
    const store = new LocalLeaderboardStore();
    await store.recordResult('ACE', 'wins', 'G1');
    await store.recordResult('ACE', 'wins', 'G2');
    await store.recordResult('ACE', 'wins', 'G3');
    await store.recordResult('BEE', 'wins', 'G4');
    await store.recordResult('BEE', 'losses', 'G5');
    await store.recordResult('CAT', 'wins', 'G6');
    const top = await store.topN(20);
    expect(top.map((e) => e.name)).toEqual(['ACE', 'CAT', 'BEE']);
  });
});
