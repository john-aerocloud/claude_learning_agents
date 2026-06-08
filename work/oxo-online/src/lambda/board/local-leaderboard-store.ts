import {
  AlreadyScored,
  type LeaderboardEntry,
  type LeaderboardStorePort,
} from './ports';
import { sortEntries } from './ddb-leaderboard-store';
import type { TallyField } from './tally';

/**
 * local-leaderboard-store.ts — in-memory ADAPTER implementing
 * LeaderboardStorePort for the local stand-up + unit injection (delta §6 /
 * principles/02). It reproduces the conditional-ADD / `NOT contains(scoredGames)`
 * BRANCH so the SM-4 replay proof and the SM-2 collision-accumulation proof run
 * OFFLINE with no cloud.
 *
 * §12a caution (a mock encodes a belief about platform semantics): a JS Map +
 * Set gives the branch SHAPE — second-record-of-the-same-gameId rejects, counter
 * unchanged, gameId present once — but NOT real DynamoDB single-item conditional
 * atomicity under genuine concurrency. That guarantee is covered by the CAS
 * ConditionExpression pin (ddb adapter) + the §30 prod skeleton Probe B, NOT by
 * this map.
 */

interface Row {
  wins: number;
  draws: number;
  losses: number;
  scoredGames: Set<string>;
}

export class LocalLeaderboardStore implements LeaderboardStorePort {
  private readonly rows = new Map<string, Row>();

  async recordResult(
    name: string,
    field: TallyField,
    gameId: string,
  ): Promise<void> {
    const row = this.rows.get(name) ?? {
      wins: 0,
      draws: 0,
      losses: 0,
      scoredGames: new Set<string>(),
    };
    // The conditional gate: NOT contains(scoredGames, :gameId). If this name has
    // already scored this game, reject (no increment, no mark) — the replay branch.
    if (row.scoredGames.has(gameId)) {
      throw new AlreadyScored();
    }
    // Increment-and-mark in one logical step (the local stand-in for the atomic
    // conditional UpdateItem).
    row[field] += 1;
    row.scoredGames.add(gameId);
    this.rows.set(name, row);
  }

  async topN(n: number): Promise<LeaderboardEntry[]> {
    const entries: LeaderboardEntry[] = [...this.rows.entries()].map(
      ([name, r]) => ({
        name,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
      }),
    );
    return sortEntries(entries).slice(0, n);
  }

  /** Test/inspection helper — the gameIds recorded against a name's row. */
  scoredGamesFor(name: string): string[] {
    return [...(this.rows.get(name)?.scoredGames ?? [])];
  }
}
