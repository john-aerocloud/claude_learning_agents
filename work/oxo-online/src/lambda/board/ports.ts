import type { TallyField } from './tally';

/**
 * ports.ts (board) — DOMAIN-defined port for the leaderboard store seam,
 * expressed in domain terms (§41 hexagonal). The DynamoDB adapter (prod) and the
 * in-memory adapter (local stand-up + unit injection) implement this interface.
 * Domain/handler code imports NOTHING concrete from a store backend — no AWS
 * SDK, no DynamoDB AttributeValue, no ConditionalCheckFailedException type.
 *
 * s009 (delta 010 §3). The crux is IDEMPOTENCY under at-least-once stream
 * delivery: `recordResult` is a per-name conditional increment guarded by the
 * `scoredGames` set-marker, co-located with the counter on the SAME row so
 * increment-and-mark is ONE atomic single-item conditional write. A replay of
 * the same gameId fails the condition → no write (AlreadyScored) → the handler
 * swallows it (success-already-done). `topN` is the read path (Scan + sort).
 */

/** One leaderboard entry, in domain terms (no persistence concepts). */
export interface LeaderboardEntry {
  name: string;
  wins: number;
  draws: number;
  losses: number;
}

/**
 * LeaderboardStorePort — the durable standings behind an interface.
 *
 * `recordResult(name, field, gameId)` atomically increments `field` on `name`'s
 * row AND adds `gameId` to that row's `scoredGames` set, CONDITIONED on the
 * gameId not already being present. On a replay (gameId already scored for this
 * name) it throws `AlreadyScored` — a legitimate idempotency outcome the handler
 * swallows. Any OTHER backend failure propagates as-is (not masked as a replay).
 *
 * `topN(n)` returns the top-n entries ordered wins desc / losses asc / name asc.
 */
export interface LeaderboardStorePort {
  recordResult(name: string, field: TallyField, gameId: string): Promise<void>;
  topN(n: number): Promise<LeaderboardEntry[]>;
}

/**
 * Raised by LeaderboardStorePort.recordResult when this name has ALREADY scored
 * this gameId (the conditional `NOT contains(scoredGames, :gameId)` failed). The
 * idempotency outcome under at-least-once stream redelivery — the handler
 * swallows it (no increment, no retry, no batch failure). NOT an error to raise.
 */
export class AlreadyScored extends Error {
  constructor(message = 'name has already scored this game') {
    super(message);
    this.name = 'AlreadyScored';
  }
}
