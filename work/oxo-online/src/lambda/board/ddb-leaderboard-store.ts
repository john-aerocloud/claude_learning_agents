import {
  DynamoDBDocumentClient,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AlreadyScored,
  type LeaderboardEntry,
  type LeaderboardStorePort,
} from './ports';
import type { TallyField } from './tally';

/**
 * ddb-leaderboard-store.ts — ADAPTER implementing LeaderboardStorePort over
 * DynamoDB (§41, s009 / delta 010). The crux is IDEMPOTENCY under at-least-once
 * stream delivery.
 *
 * `recordResult` is a SINGLE conditional UpdateItem against the name's row:
 *   ConditionExpression: NOT contains(scoredGames, :gameId)
 *   UpdateExpression:    ADD <field> :one, scoredGames :gameIdSet
 * The marker (`scoredGames` SS) is CO-LOCATED with the counter it guards on the
 * SAME item, so increment-and-mark is ONE atomic single-item conditional write
 * — the CAS primitive the system already uses on Games/Codes. A replayed
 * game-over runs the same write; `contains(scoredGames, :gameId)` is now TRUE →
 * ConditionalCheckFailed → mapped to AlreadyScored (the handler swallows it; no
 * increment, no retry). The Leaderboard row after replay is byte-identical.
 *
 * Reject-over-mask (delta §3): a ConditionalCheckFailed is the idempotency
 * branch surfaced as AlreadyScored; ANY other backend error propagates as-is so
 * the handler's failure-classification path runs (a self-owned 5xx is a defect
 * signal, never masked as a replay). The SDK's own jittered backoff still
 * applies to the underlying UpdateItem.
 *
 * Code↔policy pin (§30): this adapter issues ONLY UpdateItem (writes) and Scan
 * (reads) — exactly the granted actions (board-fn: UpdateItem; game-fn: Scan).
 * No Get/Put/Delete/Query. recordResult is the board-fn path (UpdateItem only);
 * topN is the game-fn read path (Scan only).
 */

/**
 * The CAS condition string — pinned in a test (T-LB-3) so the idempotency gate
 * cannot be silently removed. The local in-memory adapter reproduces only the
 * reject BRANCH; real DynamoDB set-contains atomicity is covered by this pin +
 * the §30 prod skeleton Probe B (the `leaderboard` platform-gate gap).
 */
export const LEADERBOARD_CONDITION_EXPRESSION =
  'NOT contains(scoredGames, :gameId)';

export type LogFn = (line: Record<string, unknown>) => void;

export interface DdbLeaderboardStoreDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  buildSha: string;
  log: LogFn;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

/** Availability-vs-our-defect split for a DynamoDB SDK error (4xx = INTERNAL). */
function categoriseDdbError(err: unknown): 'INTERNAL' | 'EXTERNAL_DEPENDENCY' {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return 'INTERNAL';
  }
  return 'EXTERNAL_DEPENDENCY';
}

function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

export class DdbLeaderboardStore implements LeaderboardStorePort {
  constructor(private readonly deps: DdbLeaderboardStoreDeps) {}

  async recordResult(
    name: string,
    field: TallyField,
    gameId: string,
  ): Promise<void> {
    try {
      await this.deps.client.send(
        new UpdateCommand({
          TableName: this.deps.tableName,
          Key: { playerName: name },
          UpdateExpression: `ADD ${field} :one, scoredGames :gameIdSet`,
          ConditionExpression: LEADERBOARD_CONDITION_EXPRESSION,
          ExpressionAttributeValues: {
            ':one': 1,
            ':gameId': gameId,
            ':gameIdSet': new Set([gameId]),
          },
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Idempotency branch — this name already scored this game. NOT an error;
        // the handler swallows it (no increment, no retry, no batch failure).
        throw new AlreadyScored();
      }
      // Non-conditional backend failure (throttle / 5xx / timeout) — NOT a
      // replay. Propagate as-is so the handler classifies + logs it (self-owned
      // 5xx = defect signal); never mask an infra fault as success-already-done.
      this.deps.log({
        event: 'leaderboard_write_failed',
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'Leaderboard.recordResult',
        name,
        field,
        gameId,
      });
      throw err;
    }
  }

  async topN(n: number): Promise<LeaderboardEntry[]> {
    const out = await this.deps.client.send(
      new ScanCommand({ TableName: this.deps.tableName }),
    );
    const entries: LeaderboardEntry[] = (out.Items ?? []).map((it) => ({
      name: String(it.playerName),
      wins: asNumber(it.wins),
      draws: asNumber(it.draws),
      losses: asNumber(it.losses),
    }));
    return sortEntries(entries).slice(0, n);
  }
}

/**
 * Pure top-N comparator (wins desc / losses asc / name asc). Exported so the SPA
 * client and the read handler share ONE ordering (and it is unit-pinned).
 */
export function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}
