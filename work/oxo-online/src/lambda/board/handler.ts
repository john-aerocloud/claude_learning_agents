import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  DynamoDBStreamEvent,
  DynamoDBRecord,
  DynamoDBBatchResponse,
} from 'aws-lambda';
import { tally } from './tally';
import {
  AlreadyScored,
  type LeaderboardStorePort,
} from './ports';
import { DdbLeaderboardStore } from './ddb-leaderboard-store';

/**
 * handler.ts (oxo-board-fn) — the DynamoDB Stream consumer ADAPTER (§41). It
 * translates a stream MODIFY record into a domain transition, runs the pure
 * `tally` function, and drives the LeaderboardStorePort. It reads OLD+NEW images
 * FROM THE RECORD — it NEVER reads the Games table (hence no Games table grant).
 *
 * Idempotency (delta §3, SM-4): each tally op is a conditional UpdateItem
 * (recordResult). On AlreadyScored the handler SWALLOWS it (log, no increment,
 * no retry, no batch failure) — at-least-once redelivery is neutralised. On a
 * NON-replay store failure (self-owned 5xx after SDK backoff) it logs
 * category:internal-service (a defect signal — a self-owned 5xx is never
 * terminal handling) and reports the record as a batch item failure so the
 * platform retries it. board-fn is OFF the game hot path, so a retry/stall never
 * affects play (SM-6).
 *
 * The event-source mapping filter criteria already screen to the
 * active→{won,drawn} MODIFY transition; the domain re-checks (defence in depth).
 */

type LogFn = (line: Record<string, unknown>) => void;

interface HandlerDeps {
  store: LeaderboardStorePort;
  buildSha?: string;
  log?: LogFn;
}

function strAttr(image: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = image?.[key] as { S?: string } | undefined;
  return v?.S;
}

export function createHandler(deps: HandlerDeps) {
  const buildSha = deps.buildSha ?? process.env.BUILD_SHA ?? 'unknown';
  const log: LogFn = deps.log ?? ((line) => console.log(JSON.stringify(line)));

  return async function handler(
    streamEvent: DynamoDBStreamEvent,
  ): Promise<DynamoDBBatchResponse> {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of streamEvent.Records) {
      const failed = await processRecord(record);
      if (failed && record.eventID) {
        batchItemFailures.push({ itemIdentifier: record.eventID });
      }
    }

    return { batchItemFailures };

    /** Returns true if the record should be reported as a batch item failure. */
    async function processRecord(record: DynamoDBRecord): Promise<boolean> {
      const oldImage = record.dynamodb?.OldImage as Record<string, unknown> | undefined;
      const newImage = record.dynamodb?.NewImage as Record<string, unknown> | undefined;

      const gameId = strAttr(newImage, 'gameId') ?? strAttr(oldImage, 'gameId') ?? '';
      const oldStatus = strAttr(oldImage, 'status') ?? '';
      const newStatus = strAttr(newImage, 'status') ?? '';
      const hostName = strAttr(newImage, 'hostName');
      const guestName = strAttr(newImage, 'guestName');
      const winner = strAttr(newImage, 'winner'); // 'X' (host) | 'O' (guest)

      // Map host/guest → winner/loser by the recorded winner mark. For a draw
      // the winner/loser distinction is irrelevant (both get a draw).
      const hostWon = winner === 'X';
      const winnerName = hostWon ? hostName : guestName;
      const loserName = hostWon ? guestName : hostName;

      const ops = tally({
        oldStatus,
        newStatus,
        winnerName,
        loserName,
        gameId,
      });

      // Build-identity carrier (principles/01): every invocation logs buildSha.
      log({
        event: 'board_tally',
        buildSha,
        gameId,
        oldStatus,
        newStatus,
        ops: ops.length,
      });

      if (ops.length === 0) return false; // filtered/non-terminal — nothing to do.

      let recordFailed = false;
      for (const op of ops) {
        try {
          await deps.store.recordResult(op.name, op.field, op.gameId);
          log({
            event: 'leaderboard_recorded',
            buildSha,
            gameId: op.gameId,
            name: op.name,
            field: op.field,
            action: 'increment',
          });
        } catch (err) {
          if (err instanceof AlreadyScored) {
            // Idempotency branch — swallow. No increment, no retry, no failure.
            log({
              event: 'already_scored',
              buildSha,
              category: 'idempotent-replay',
              gameId: op.gameId,
              name: op.name,
              field: op.field,
            });
            continue;
          }
          // A self-owned 5xx (after SDK backoff) — a defect signal, NOT terminal
          // handling. Log internal-service + report the item so the platform
          // retries (off the game hot path — never affects play).
          log({
            event: 'leaderboard_write_failed',
            buildSha,
            category: 'internal-service',
            gameId: op.gameId,
            name: op.name,
            field: op.field,
            error: (err as Error)?.name ?? 'unknown',
          });
          recordFailed = true;
        }
      }
      return recordFailed;
    }
  };
}

// Production entry point invoked by the Lambda event-source mapping. Wires the
// DynamoDB Leaderboard store adapter (UpdateItem on the Leaderboard ARN only).
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const buildLog: LogFn = (line) => console.log(JSON.stringify(line));
export const handler = createHandler({
  store: new DdbLeaderboardStore({
    client: ddb,
    tableName: process.env.LEADERBOARD_TABLE ?? '',
    buildSha: process.env.BUILD_SHA ?? 'unknown',
    log: buildLog,
  }),
  buildSha: process.env.BUILD_SHA ?? 'unknown',
  log: buildLog,
});
