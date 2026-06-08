/**
 * spa-leaderboard-client — the leaderboard read client + pure top-N sort (UC3).
 *
 * The SPA fetches GET /api/leaderboard on every idle-view mount and renders the
 * shared standings. The handler (oxo-game-fn) already sorts server-side, but the
 * SPA re-sorts defensively with the SAME pinned comparator (wins desc / losses
 * asc / name asc) so the display ranking cannot drift from the contract (AC3.1).
 *
 * Failure handling (UC3 / §failure-handling): a non-OK response or a rejected
 * fetch resolves to an `error` outcome — NO aggressive retry loop. The leaderboard
 * is read-only and non-critical, so the SPA degrades to a graceful error state
 * and re-fetches on the next idle-view mount (return-to-idle), not on a timer.
 */

export interface LeaderboardEntry {
  name: string;
  wins: number;
  draws: number;
  losses: number;
}

/** The state-machine outcome of one fetch (loading is the pre-fetch state). */
export type LeaderboardResult =
  | { status: 'ready'; entries: LeaderboardEntry[]; buildSha?: string }
  | { status: 'error' };

/** Pure comparator-driven sort: wins desc, then losses asc, then name asc. */
export function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.name.localeCompare(b.name);
  });
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  buildSha?: string;
}

export async function fetchLeaderboard(): Promise<LeaderboardResult> {
  try {
    const res = await fetch('/api/leaderboard', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { status: 'error' };
    const body = (await res.json()) as LeaderboardResponse;
    return {
      status: 'ready',
      entries: sortLeaderboard(body.entries ?? []),
      buildSha: body.buildSha,
    };
  } catch {
    return { status: 'error' };
  }
}
