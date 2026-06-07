import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { authorize } from './authorizer';
import {
  eventToInput,
  decisionToPolicy,
  type WsAuthRequestEvent,
  type WsAuthPolicyResponse,
} from './adapters/apigw-authorizer';
import { DdbConnectCounter } from './adapters/ddb-connect-counter';
import { DdbGameLookup } from './adapters/ddb-game-lookup';
import { SsmSecretSource } from './adapters/ssm-secret-source';

/**
 * handler.ts — COMPOSITION ROOT for oxo-ws-auth-fn (the $connect REQUEST
 * authorizer). Wires the concrete adapters to the domain orchestration and
 * maps the decision to the PINNED WS REST IAM-policy response (T4). All config
 * comes from CDK-injected env (delta §10); buildSha from BUILD_SHA (T9).
 *
 * Clients are module-scoped so warm invocations reuse them (and the secret
 * cache). The structured log lines are emitted via console.log as single-line
 * JSON so CloudWatch metric filters can split category/effect.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});

const CONNECT_TTL_SECONDS = 300; // 5-min rolling per-IP window (delta §1).

function log(line: Record<string, unknown>): void {
  console.log(JSON.stringify(line));
}

export async function handler(
  event: WsAuthRequestEvent,
): Promise<WsAuthPolicyResponse> {
  const buildSha = process.env.BUILD_SHA ?? 'unknown';
  const now = () => Math.floor(Date.now() / 1000);

  const secretSource = new SsmSecretSource({
    client: ssm,
    paramName: process.env.WS_TOKEN_SECRET_PARAM as string,
    buildSha,
    log,
  });
  const counter = new DdbConnectCounter({
    client: ddb,
    tableName: process.env.CONNECT_ATTEMPTS_TABLE as string,
    ttlSeconds: CONNECT_TTL_SECONDS,
    now,
    buildSha,
    log,
  });
  const lookup = new DdbGameLookup({
    client: ddb,
    tableName: process.env.GAMES_TABLE as string,
    indexName: process.env.GAMES_CODE_INDEX as string,
    buildSha,
    log,
  });

  const decision = await authorize(eventToInput(event), {
    secretSource,
    counter,
    lookup,
    threshold: Number(process.env.CONNECT_RATE_THRESHOLD ?? '20'),
    now,
    buildSha,
    log,
  });

  return decisionToPolicy(decision, event.methodArn);
}
