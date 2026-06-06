import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { ddb, CONNECTION_TTL_SECONDS } from './ddb';
import type { WsResult } from './ws-result';

/**
 * $connect — record the new connection.
 *
 * T6: connectionId is ALWAYS taken from event.requestContext.connectionId, never
 * from the client body. gameId is null at this point (not yet known); it is set
 * later by register/join. ttl = now + 2h (T3).
 */
export async function handleConnect(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<WsResult> {
  const connectionId = event.requestContext.connectionId;
  const nowSeconds = Math.floor(Date.now() / 1000);

  await ddb.send(
    new PutCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      Item: {
        connectionId,
        gameId: null,
        ttl: nowSeconds + CONNECTION_TTL_SECONDS,
      },
    }),
  );

  return { statusCode: 200 };
}
