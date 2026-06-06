import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { ddb } from './ddb';
import { close, type WsResult } from './ws-result';

/**
 * join — guest joins a game by code.
 *
 * This file currently implements the ERROR branches only (Set A: A2/A4):
 *   - unknown code (GSI miss)                  -> close 4040, no writes  (A2.1)
 *   - any unexpected internal fault            -> close 4500, no leak    (A2.2)
 *   - game found but not joinable (4041)       -> added in A4.1
 * The happy path (atomic activate + game-ready fan-out) is added by Set C (C1)
 * on top of these branches — see route.md collision note.
 *
 * Contracts:
 *   T6  — connectionId is the caller's own requestContext.connectionId; the
 *         body code is read but no body-supplied connectionId is ever trusted.
 *   T4  — a code miss closes 4040 and makes no Connections/Games write.
 *   S3  — only the defined close codes are used; the client-visible payload
 *         carries no stack trace, exception class, table ARN, or request id.
 */
export async function handleJoin(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<WsResult> {
  try {
    const body = JSON.parse(event.body ?? '{}') as { code?: string };
    const code = body.code;

    // Look up the game by its join code via the code-index GSI.
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.GAMES_TABLE,
        IndexName: process.env.GAMES_CODE_INDEX,
        KeyConditionExpression: '#code = :code',
        ExpressionAttributeNames: { '#code': 'code' },
        ExpressionAttributeValues: { ':code': code },
        Limit: 1,
      }),
    );

    const game = result.Items?.[0] as { gameId?: string } | undefined;

    // A2.1 — unknown code: no game for this code. Close 4040, write nothing.
    if (!game) {
      return close(4040);
    }

    const connectionId = event.requestContext.connectionId;

    // A4.1 — atomic no-hijack activation. The ConditionExpression guarantees
    // exactly one joiner wins: the game must still be `waiting` AND have no
    // guestConnectionId yet. If it is already active/finished/abandoned (UC4)
    // or another joiner won a race, the write is rejected with
    // ConditionalCheckFailedException and we close 4041 having mutated nothing.
    // T6: guestConnectionId is the caller's own context connectionId.
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.GAMES_TABLE,
          Key: { gameId: game.gameId },
          UpdateExpression:
            'SET guestConnectionId = :cid, #status = :active',
          ConditionExpression:
            '#status = :waiting AND attribute_not_exists(guestConnectionId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':cid': connectionId,
            ':active': 'active',
            ':waiting': 'waiting',
          },
        }),
      );
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        // Game is no longer joinable; no-hijack rejection. No further write.
        return close(4041);
      }
      // Re-throw any other error to the outer 4500 handler (no leakage).
      throw err;
    }

    // Set C (C1) inserts the happy-path tail here: write the guest Connections
    // item and post game-ready to both connections via @connections. Until C1
    // lands, a successful activation is acknowledged without a close.
    return { statusCode: 200 };
  } catch {
    // A2.2 — any unexpected internal error maps to a generic 4500 close.
    // The caught error is intentionally NOT surfaced (no leakage — S3).
    return close(4500);
  }
}
