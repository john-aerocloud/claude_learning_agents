import { QueryCommand } from '@aws-sdk/lib-dynamodb';
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

    const game = result.Items?.[0];

    // A2.1 — unknown code: no game for this code. Close 4040, write nothing.
    if (!game) {
      return close(4040);
    }

    // Set C (C1) inserts the happy-path activation + game-ready fan-out here,
    // and A4.1 inserts the not-waiting (4041) rejection branch. Until then a
    // found-but-unhandled game falls through to a safe 4041 (no mutation).
    return close(4041);
  } catch {
    // A2.2 — any unexpected internal error maps to a generic 4500 close.
    // The caught error is intentionally NOT surfaced (no leakage — S3).
    return close(4500);
  }
}
