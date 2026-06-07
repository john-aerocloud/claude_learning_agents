import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  type GameStorePort,
  type GameState,
  type MovePatch,
  type Role,
  MoveConditionFailed,
} from '../../move/ports';
import {
  categoriseDdbError,
  isConditionalCheckFailed,
  type LogFn,
} from './failure';

/**
 * games-ddb.ts — ADAPTER implementing GameStorePort over DynamoDB (§41).
 * The move write is a SINGLE conditional UpdateItem that is BOTH the legality
 * gate AND the optimistic lock:
 *   ConditionExpression = status='active' AND currentTurn=senderRole AND
 *                         version=expectedVersion  (compare-and-swap)
 *   UpdateExpression    = SET board, currentTurn, version+1, moveCount+1
 *                         [, status, winner]  (terminal flip in the SAME write)
 *
 * Reject-over-retry (delta §3 / §5a): a ConditionalCheckFailed is a BUSINESS
 * reject surfaced as a typed MoveConditionFailed — the adapter does NOT blindly
 * retry. Transient 5xx is handled by the AWS SDK default backoff; on exhaustion
 * it is logged EXTERNAL_DEPENDENCY and rethrown. A 4xx (our bad request) is
 * INTERNAL — a defect signal, not terminal handling.
 *
 * Code↔policy pin (S5): this adapter issues ONLY GetItem (read) and UpdateItem
 * (write) against the Games table — exactly the s005 grant set. No Query/Scan/
 * Put/Delete. The test asserts no ungranted command type is ever issued so code
 * cannot silently diverge into a prod AccessDenied.
 */

/**
 * The move CAS condition string — pinned in a test (AC2.6 / S3) so the atomic
 * gate cannot be silently removed (the local mock CANNOT enforce real DDB
 * conditional atomicity; this pin + UC6 prod zero-divergence cover that gap).
 */
export const MOVE_CONDITION_EXPRESSION =
  '#status = :active AND currentTurn = :expRole AND version = :expVersion';

export interface DdbGamesStoreDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  buildSha: string;
  log: LogFn;
}

export class DdbGamesStore implements GameStorePort {
  constructor(private readonly deps: DdbGamesStoreDeps) {}

  async getGame(gameId: string): Promise<GameState | null> {
    try {
      const out = await this.deps.client.send(
        new GetCommand({
          TableName: this.deps.tableName,
          Key: { gameId },
        }),
      );
      const item = out.Item;
      if (!item) return null;
      return {
        gameId: item.gameId as string,
        board: item.board as string,
        currentTurn: item.currentTurn as Role,
        status: item.status as GameState['status'],
        version: (item.version as number) ?? 0,
        moveCount: (item.moveCount as number) ?? 0,
        hostConnectionId: item.hostConnectionId as string | undefined,
        guestConnectionId: item.guestConnectionId as string | undefined,
      };
    } catch (err) {
      this.deps.log({
        event: 'game_read_failed',
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'Games.getGame',
      });
      throw err;
    }
  }

  async applyMoveWrite(args: {
    gameId: string;
    expectedVersion: number;
    expectedTurn: Role;
    patch: MovePatch;
  }): Promise<void> {
    const { gameId, expectedVersion, expectedTurn, patch } = args;

    // Build the UpdateExpression. board/turn/version+1/moveCount+1 always; the
    // terminal status (+ winner on a win) is folded into the SAME write.
    const sets = [
      'board = :newBoard',
      'currentTurn = :nextTurn',
      'version = version + :one',
      'moveCount = moveCount + :one',
    ];
    const values: Record<string, unknown> = {
      ':active': 'active',
      ':expRole': expectedTurn,
      ':expVersion': expectedVersion,
      ':newBoard': patch.board,
      ':nextTurn': patch.nextTurn,
      ':one': 1,
    };
    const names: Record<string, string> = { '#status': 'status' };

    if (patch.status && patch.status !== 'active') {
      sets.push('#status = :newStatus');
      values[':newStatus'] = patch.status;
      if (patch.winner) {
        sets.push('winner = :winner');
        values[':winner'] = patch.winner;
      }
    }

    try {
      await this.deps.client.send(
        new UpdateCommand({
          TableName: this.deps.tableName,
          Key: { gameId },
          ConditionExpression: MOVE_CONDITION_EXPRESSION,
          UpdateExpression: 'SET ' + sets.join(', '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Business reject (turn/status/version CAS lost) — caller's problem, no
        // retry, no partial write occurred. Surface a typed reject.
        this.deps.log({
          event: 'move_condition_failed',
          buildSha: this.deps.buildSha,
          category: 'data',
          gameId,
          expectedVersion,
        });
        throw new MoveConditionFailed();
      }
      // Transient/dependency failure after SDK default backoff.
      this.deps.log({
        event: 'move_write_failed',
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'Games.applyMoveWrite',
        gameId,
      });
      throw err;
    }
  }
}
