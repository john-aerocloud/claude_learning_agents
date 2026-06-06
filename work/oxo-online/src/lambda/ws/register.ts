import { UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { ddb, CONNECTION_TTL_SECONDS } from './ddb';
import { close, type WsResult } from './ws-result';

/**
 * register — bind the host's connection to its game.
 *
 * T6: hostConnectionId is the caller's own event.requestContext.connectionId;
 * any connectionId/hostConnectionId planted in the body is ignored.
 * S1/no-hijack: the Games write is a conditional UpdateItem that only sets
 * hostConnectionId when it is not already bound (first-binder-wins).
 *
 * DEFECT-005-001 (Bug A): create-game writes the Games item with the attribute
 * present but NULL (`hostConnectionId: null`). A bare
 * `attribute_not_exists(hostConnectionId)` therefore FAILS on a brand-new game,
 * which previously threw an UNHANDLED ConditionalCheckFailedException. The
 * condition now also tolerates an existing NULL via the OR clause, and this path
 * is defensive — a rejected/failed write is mapped to a clean close, never an
 * unhandled throw (S3). The upstream create handler is also fixed to stop
 * writing the NULL attribute, so new games satisfy attribute_not_exists; the OR
 * clause keeps already-created (NULL-bearing) games joinable too.
 */
export async function handleRegister(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<WsResult> {
  const connectionId = event.requestContext.connectionId;

  try {
    const body = JSON.parse(event.body ?? '{}') as { gameId?: string };
    const gameId = body.gameId;

    // Conditional bind on Games — only if hostConnectionId is unset OR a stored
    // NULL (legacy create write). T6: the bound id is the caller's context id.
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.GAMES_TABLE,
        Key: { gameId },
        UpdateExpression: 'SET hostConnectionId = :cid',
        ConditionExpression:
          'attribute_not_exists(hostConnectionId) OR hostConnectionId = :null',
        ExpressionAttributeValues: { ':cid': connectionId, ':null': null },
      }),
    );

    // Bind the Connections item to this game with the host role.
    //
    // DEFECT-005-001-R2 (Issue 1): the oxo-ws-fn execution role grants ONLY
    // PutItem/DeleteItem on the Connections table (least-privilege, by design).
    // An UpdateItem here drifted from that policy and produced AccessDenied ->
    // register_failed -> a 4500 close on every host register. We obey the
    // granted action set: write the FULL item with PutItem. PutItem REPLACES the
    // item, so it resets the connection's ~2h TTL on each register — acceptable,
    // since a freshly-registering host's connection should live a full window.
    const nowSeconds = Math.floor(Date.now() / 1000);
    await ddb.send(
      new PutCommand({
        TableName: process.env.CONNECTIONS_TABLE,
        Item: {
          connectionId,
          gameId,
          role: 'host',
          ttl: nowSeconds + CONNECTION_TTL_SECONDS,
        },
      }),
    );

    return { statusCode: 200 };
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      // Host is already bound (or game gone) — no-hijack rejection, no further
      // write. INTERNAL category: a client-driven precondition, not availability.
      console.warn(
        JSON.stringify({
          event: 'register_rejected',
          category: 'internal',
          reason: 'host_already_bound',
          closeCode: 4041,
        }),
      );
      return close(4041);
    }
    // Any other fault maps to a generic 4500 close. The caught error is NOT
    // surfaced to the client (no leakage — S3). EXTERNAL category: a dependency
    // (DynamoDB) failure after the SDK's own retry strategy.
    console.error(
      JSON.stringify({
        event: 'register_failed',
        category: 'external',
        closeCode: 4500,
      }),
    );
    return close(4500);
  }
}
