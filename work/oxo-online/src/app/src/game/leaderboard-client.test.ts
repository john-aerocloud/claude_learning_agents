import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sortLeaderboard,
  fetchLeaderboard,
  type LeaderboardEntry,
} from './leaderboard-client';

/**
 * @covers spa-leaderboard-client
 *
 * R3.1 — the pure top-N sort + the fetch client (state-machine inputs). The
 * board ranks wins desc, ties broken by losses asc, then name asc (AC3.1). The
 * client fetches GET /api/leaderboard against a local stub returning
 * {entries, buildSha}; a fetch failure resolves to an error outcome with NO
 * aggressive retry loop (retry happens on the next idle-view mount only, AC3.4).
 */
describe('sortLeaderboard — wins desc / losses asc / name asc (AC3.1)', () => {
  it('orders a 5-entry fixture by the pinned comparator', () => {
    const fixture: LeaderboardEntry[] = [
      { name: 'DEE', wins: 2, draws: 0, losses: 5 },
      { name: 'ACE', wins: 3, draws: 1, losses: 0 },
      { name: 'BEE', wins: 2, draws: 0, losses: 1 }, // ties DEE on wins; fewer losses → ranks first
      { name: 'CAT', wins: 2, draws: 0, losses: 1 }, // ties BEE fully on wins+losses; name asc → after BEE
      { name: 'EEL', wins: 0, draws: 4, losses: 2 },
    ];
    const ranked = sortLeaderboard(fixture).map((e) => e.name);
    expect(ranked).toEqual(['ACE', 'BEE', 'CAT', 'DEE', 'EEL']);
  });

  it('does not mutate the input array', () => {
    const fixture: LeaderboardEntry[] = [
      { name: 'B', wins: 1, draws: 0, losses: 0 },
      { name: 'A', wins: 2, draws: 0, losses: 0 },
    ];
    const copy = [...fixture];
    sortLeaderboard(fixture);
    expect(fixture).toEqual(copy);
  });
});

describe('fetchLeaderboard — client state inputs (AC3.4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns ready + sorted entries on a 200 with {entries, buildSha}', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            { name: 'LO', wins: 1, draws: 0, losses: 0 },
            { name: 'HI', wins: 5, draws: 0, losses: 0 },
          ],
          buildSha: 'abc123',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await fetchLeaderboard();
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.entries.map((e) => e.name)).toEqual(['HI', 'LO']);
      expect(result.buildSha).toBe('abc123');
    }
  });

  it('returns error on a non-OK response (no throw, no retry loop)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    const result = await fetchLeaderboard();
    expect(result.status).toBe('error');
  });

  it('returns error when the fetch rejects (network down)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const result = await fetchLeaderboard();
    expect(result.status).toBe('error');
  });

  it('fetches GET /api/leaderboard exactly once per call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ entries: [], buildSha: 's' }), { status: 200 }),
    );
    await fetchLeaderboard();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard', expect.anything());
  });
});
