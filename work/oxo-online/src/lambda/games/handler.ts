import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { generateCode } from './code';

const TTL_SECONDS = 24 * 60 * 60; // 24h — abandoned waiting games self-delete.

// Reuse the client across warm invocations.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * POST /games — create a new online game session.
 *
 * Security (S1): every persisted field is generated server-side. The request
 * body is NOT trusted for gameId/code/status/ttl; any such planted values are
 * ignored. The endpoint takes no required input for s004.
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const tableName = process.env.TABLE_NAME;

  const gameId = randomUUID();
  const code = generateCode();
  const nowSeconds = Math.floor(Date.now() / 1000);

  // DEFECT-005-001 Bug A: do NOT write a NULL hostConnectionId. A stored NULL
  // attribute "exists" in DynamoDB, which broke register's
  // attribute_not_exists(hostConnectionId) bind. The attribute is simply absent
  // until the host registers, so attribute_not_exists holds for a fresh game.
  const item = {
    gameId,
    code,
    status: 'waiting' as const,
    createdAt: new Date().toISOString(),
    ttl: nowSeconds + TTL_SECONDS,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      }),
    );
  } catch {
    // Do not leak internal detail (no stack trace, no SDK error message).
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Could not create game' }),
    };
  }

  return {
    statusCode: 201,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId, code }),
  };
}
