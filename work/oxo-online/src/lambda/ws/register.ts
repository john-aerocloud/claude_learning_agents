import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { ddb } from './ddb';
import type { WsResult } from './ws-result';

/**
 * register — bind the host's connection to its game.
 *
 * T6: hostConnectionId is the caller's own event.requestContext.connectionId;
 * any connectionId/hostConnectionId planted in the body is ignored.
 * S1/no-hijack: the Games write is a conditional UpdateItem that only sets
 * hostConnectionId when it does not already exist (first-binder-wins).
 */
export async function handleRegister(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<WsResult> {
  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body ?? '{}') as { gameId?: string };
  const gameId = body.gameId;

  // Conditional bind on Games — only if hostConnectionId is not already set.
  await ddb.send(
    new UpdateCommand({
      TableName: process.env.GAMES_TABLE,
      Key: { gameId },
      UpdateExpression: 'SET hostConnectionId = :cid',
      ConditionExpression: 'attribute_not_exists(hostConnectionId)',
      ExpressionAttributeValues: { ':cid': connectionId },
    }),
  );

  // Bind the Connections item to this game with the host role.
  await ddb.send(
    new UpdateCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET gameId = :gid, #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':gid': gameId, ':role': 'host' },
    }),
  );

  return { statusCode: 200 };
}
