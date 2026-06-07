import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { generateCode } from './code';
import { mint } from '../token/token';
import type { SecretSource } from '../token/ports';
import { createSsmSecretSource } from '../token/adapters/ssm-secret-source';

const TTL_SECONDS = 24 * 60 * 60; // 24h — abandoned waiting games self-delete.

// Reuse the client across warm invocations.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface HandlerDeps {
  /** Domain port (S-A1.3). Production wires the SSM adapter; tests inject a fake. */
  secretSource: SecretSource;
}

/**
 * createHandler — hexagonal factory. The handler depends on the SecretSource
 * PORT, not on SSM; tests inject a fake (independent of A2's infra), production
 * injects the SSM adapter.
 *
 * POST /games — create a new online game session.
 *
 * Security (S1): every persisted field is generated server-side. The request
 * body is NOT trusted for gameId/code/status/ttl; any such planted values are
 * ignored.
 *
 * UC1 (S-A1.4): on a successful create the handler mints a short-lived host
 * `wsToken` (HMAC-SHA256, {gameId, role:'host', exp now+60}) signed with the
 * shared secret and returns it in the 201 body alongside the unchanged
 * `gameId`/`code`. The token is NEVER persisted (response-only) and is NOT
 * minted on the 5xx error path.
 */
export function createHandler(deps: HandlerDeps) {
  return async function handler(
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
      // No wsToken is minted on the error path.
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Could not create game' }),
      };
    }

    // UC1: mint the host wsToken AFTER the game is persisted. Secret
    // unavailability (env not yet provisioned, SSM transient, rotation) MUST
    // NOT fail the create — the game already exists; failing here reports a
    // false failure for a successful create (DEFECT-H2-001 prod outage).
    // Degrade: omit wsToken, log categorised (external/availability), and let
    // the client proceed. Safe because $connect enforcement ships in the same
    // deploy as the secret — there is no enforce-without-token window.
    let wsToken: string | undefined;
    try {
      const secret = await deps.secretSource.get();
      wsToken = mint({ gameId, role: 'host' }, secret, Math.floor(Date.now() / 1000));
    } catch {
      console.log(
        JSON.stringify({
          event: 'ws_token_mint_degraded',
          category: 'external',
          subcategory: 'availability',
          detail: 'secret unavailable; created game without wsToken',
        }),
      );
      wsToken = undefined;
    }

    return {
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        wsToken === undefined ? { gameId, code } : { gameId, code, wsToken },
      ),
    };
  };
}

// Production entry point invoked by APIGW (handler.handler). Wires the SSM
// SecretSource adapter (S-A1.6). The env var WS_TOKEN_SECRET_PARAM is set by
// the infra (A2, secret-wiring order step 1).
export const handler = createHandler({ secretSource: createSsmSecretSource() });
