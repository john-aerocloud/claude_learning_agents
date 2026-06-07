import { QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { ddb, CONNECTION_TTL_SECONDS } from './ddb';
import { close, type WsResult } from './ws-result';

/**
 * Post a server frame to a single WebSocket connection via the @connections
 * Management API (execute-api:ManageConnections — scoped to this WS API only, S2).
 * The endpoint is the prod-stage management URL injected via WS_API_ENDPOINT.
 */
async function postToConnection(
  connectionId: string,
  payload: { type: 'game-ready'; role: 'host' | 'guest'; gameId: string },
): Promise<void> {
  const client = new ApiGatewayManagementApiClient({
    endpoint: process.env.WS_API_ENDPOINT,
  });
  await client.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload)),
    }),
  );
}

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

    const game = result.Items?.[0] as
      | { gameId?: string; hostConnectionId?: string }
      | undefined;

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
          // R2.5/AC2.5/T6 (s006) — fold board init into the SAME atomic
          // waiting→active write so the first move finds an initialised item
          // (board="---------", currentTurn="X", version=0, moveCount=0). These
          // SET clauses ride the no-hijack ConditionExpression, so they apply
          // ONLY when this caller legitimately wins the join — never to an
          // already-active game.
          UpdateExpression:
            'SET guestConnectionId = :cid, #status = :active, ' +
            'board = :empty, currentTurn = :X, version = :zero, moveCount = :zero',
          ConditionExpression:
            '#status = :waiting AND attribute_not_exists(guestConnectionId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':cid': connectionId,
            ':active': 'active',
            ':waiting': 'waiting',
            ':empty': '---------',
            ':X': 'X',
            ':zero': 0,
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

    // C1 — happy-path tail. The atomic activate above succeeded, so this caller
    // is the one and only guest. Record the guest's Connections item (role,
    // gameId, 2h TTL — T3), then fan out `game-ready` to both sides (T1).
    const nowSeconds = Math.floor(Date.now() / 1000);
    await ddb.send(
      new PutCommand({
        TableName: process.env.CONNECTIONS_TABLE,
        Item: {
          connectionId,
          gameId: game.gameId,
          role: 'guest',
          ttl: nowSeconds + CONNECTION_TTL_SECONDS,
        },
      }),
    );

    // game-ready fan-out. Each payload carries ONLY { type, role } — never the
    // other player's connectionId or any other game field (T1, data-classification).
    //
    // DEFECT-005-001-R2 (Issue 2 cheap verify): the host connection may have
    // vanished between register and join (GoneException / 410). The guest's join
    // itself already succeeded, but with the host gone the game cannot proceed —
    // so the guest gets the SPECIFIC "no longer available" 4041 rather than a
    // generic 4500 that would mask the situation. The 410 is logged distinctly as
    // an EXTERNAL/availability category (the host's connection became unavailable
    // — not our bad request) so support can split it from our own 4xx defects.
    // NOTE: this does not reap the stale host Connections/Games rows — fuller
    // host-disconnect handling is deferred to s007.
    try {
      await postToConnection(game.hostConnectionId as string, {
        type: 'game-ready',
        role: 'host',
        // GATE-AMEND (s006): carry gameId so each side can thread it into its
        // move frames as the non-trusted GetItem lookup key (S1). It is the
        // opaque server gameId (not the join code) — discloses no connection
        // detail, so the data-classification is unchanged.
        gameId: game.gameId as string,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'GoneException') {
        console.warn(
          JSON.stringify({
            event: 'join_host_gone',
            category: 'external',
            subcategory: 'availability',
            closeCode: 4041,
          }),
        );
        return close(4041);
      }
      throw err;
    }
    await postToConnection(connectionId, {
      type: 'game-ready',
      role: 'guest',
      gameId: game.gameId as string,
    });

    return { statusCode: 200 };
  } catch {
    // A2.2 — any unexpected internal error maps to a generic 4500 close.
    // The caught error is intentionally NOT surfaced (no leakage — S3).
    return close(4500);
  }
}
