import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { generateCode as defaultGenerateCode } from './code';
import { mint } from '../token/token';
import type { SecretSource } from '../token/ports';
import { createSsmSecretSource } from '../token/adapters/ssm-secret-source';
import { CodeCollision, type CodeReservationPort } from './codes/ports';
import { DdbCodeReservation } from './codes/ddb-code-reservation';

const TTL_SECONDS = 24 * 60 * 60; // 24h — abandoned waiting games self-delete.

// s005-h3 (delta 009 §retry-cap): bounded fresh-code redraws on collision. Each
// attempt draws a NEW code and re-reserves; only CodeCollision retries. At hobby
// volume (~1e9 codes) 5 consecutive collisions is effectively unreachable — the
// cap exists to make the uniqueness invariant TOTAL (never a wrong code).
const MAX_RESERVE_ATTEMPTS = 5;

// Reuse the client across warm invocations.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type LogFn = (line: Record<string, unknown>) => void;

interface HandlerDeps {
  /** Domain port (S-A1.3). Production wires the SSM adapter; tests inject a fake. */
  secretSource: SecretSource;
  /**
   * s005-h3 (UC1) code-uniqueness port. Production wires the DynamoDB adapter
   * (conditional PutItem attribute_not_exists(code)); tests inject a fake/local.
   */
  codeReservation: CodeReservationPort;
  /** Code generator — injectable so the SM-1/SM-4 injection tests can force draws. */
  generateCode?: () => string;
  /** Build identity for structured logs (principles/01). */
  buildSha?: string;
  /** Structured-log sink (§41 — category-tagged JSON lines). */
  log?: LogFn;
}

/**
 * createHandler — hexagonal factory. The handler depends on the SecretSource and
 * CodeReservation PORTS, not on SSM/DynamoDB directly; tests inject fakes (infra-
 * free), production injects the SSM + DynamoDB adapters.
 *
 * POST /games — create a new online game session.
 *
 * Security (S1): every persisted field is generated server-side. The request
 * body is NOT trusted for gameId/code/status/ttl; any such planted values are
 * ignored.
 *
 * s005-h3 (UC2, delta 009, OI-3): the create flow RESERVES the code on the Codes
 * table (conditional PutItem attribute_not_exists(code) = single-item CAS) BEFORE
 * the Games PutItem, inside a bounded retry loop. On CodeCollision it draws a
 * FRESH code and retries (≤ N=5); on exhaustion it returns the existing opaque
 * 500 (NO wsToken, NEVER a duplicate code) and emits ONE structured log line
 * reason:code-reservation-exhausted (a 5xx WE own — §5a). Any NON-collision error
 * from the port breaks straight to the 5xx path (an infra fault is not masked as
 * a redraw). The client response {gameId, code, wsToken} is UNCHANGED.
 *
 * UC1 (S-A1.4): on a successful create the handler mints a short-lived host
 * `wsToken` (HMAC-SHA256, {gameId, role:'host', exp now+60}) signed with the
 * shared secret and returns it in the 201 body. The token is NEVER persisted
 * and is NOT minted on any 5xx path.
 */
export function createHandler(deps: HandlerDeps) {
  const generateCode = deps.generateCode ?? defaultGenerateCode;
  const buildSha = deps.buildSha ?? process.env.BUILD_SHA ?? 'unknown';
  const log: LogFn = deps.log ?? ((line) => console.log(JSON.stringify(line)));

  return async function handler(
    _event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyResultV2> {
    const tableName = process.env.TABLE_NAME;

    const gameId = randomUUID();
    const nowSeconds = Math.floor(Date.now() / 1000);

    // ---------------------------------------------------------------------
    // s005-h3: reserve a unique code at the storage layer BEFORE writing the
    // game. The reservation is the uniqueness gate; the first writer to claim a
    // code value wins atomically. On collision, redraw a FRESH code and retry
    // (bounded). Only CodeCollision retries — any other error breaks out.
    // ---------------------------------------------------------------------
    let code: string | undefined;
    let attempts = 0;
    try {
      for (let i = 0; i < MAX_RESERVE_ATTEMPTS; i += 1) {
        const candidate = generateCode();
        attempts += 1;
        try {
          await deps.codeReservation.reserve(candidate, gameId);
          code = candidate; // reserved exclusively — this is our code.
          break;
        } catch (err) {
          if (err instanceof CodeCollision) {
            continue; // collision — redraw a fresh code and retry.
          }
          throw err; // NON-collision (infra fault) — do not mask as a redraw.
        }
      }
    } catch {
      // Non-collision reservation failure — opaque 5xx, no wsToken, no write.
      return errorResponse();
    }

    if (code === undefined) {
      // Retry cap exhausted: N consecutive collisions. A 5xx WE own (§5a) — the
      // invariant held (NEVER a wrong/duplicate code), but we could not mint a
      // unique one. Structured-logged with buildSha + attempt count so a defect
      // signal is observable (effectively unreachable at hobby volume).
      log({
        event: 'code_create_failed',
        reason: 'code-reservation-exhausted',
        category: 'internal-service',
        buildSha,
        attempts,
      });
      return errorResponse();
    }

    // DEFECT-005-001 Bug A: do NOT write a NULL hostConnectionId (a stored NULL
    // "exists" in DynamoDB and broke register's attribute_not_exists bind). The
    // attribute is simply absent until the host registers.
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
      // Do not leak internal detail. No wsToken minted on the error path. The
      // reservation already written becomes a harmless orphan (24h TTL, never
      // read by the join path — delta §orphan).
      return errorResponse();
    }

    // UC1: mint the host wsToken AFTER the game is persisted. A successful create
    // ALWAYS carries wsToken; secret-fetch failure is a clean 5xx (the deploy
    // ORDER guarantees the secret exists — DEFECT-H2-001, §39).
    let wsToken: string;
    try {
      const secret = await deps.secretSource.get();
      wsToken = mint({ gameId, role: 'host' }, secret, Math.floor(Date.now() / 1000));
    } catch {
      return errorResponse();
    }

    return {
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, code, wsToken }),
    };
  };
}

/** The single opaque 5xx — no internal detail, no wsToken (every error path). */
function errorResponse(): APIGatewayProxyResultV2 {
  return {
    statusCode: 500,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: 'Could not create game' }),
  };
}

// Production entry point invoked by APIGW (handler.handler). Wires the SSM
// SecretSource adapter (S-A1.6) and the DynamoDB CodeReservation adapter (UC1).
// Env vars (TABLE_NAME, WS_TOKEN_SECRET_PARAM, CODES_TABLE, BUILD_SHA) are set
// by the infra (game-stack).
const buildLog: LogFn = (line) => console.log(JSON.stringify(line));
export const handler = createHandler({
  secretSource: createSsmSecretSource(),
  codeReservation: new DdbCodeReservation({
    client: ddb,
    tableName: process.env.CODES_TABLE ?? '',
    buildSha: process.env.BUILD_SHA ?? 'unknown',
    log: buildLog,
  }),
  buildSha: process.env.BUILD_SHA ?? 'unknown',
  log: buildLog,
});
