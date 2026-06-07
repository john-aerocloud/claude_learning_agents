import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler, createHandler } from './handler';
import { verify } from '../token/token';
import type { SecretSource } from '../token/ports';

const ddbMock = mockClient(DynamoDBDocumentClient);

const TEST_SECRET = 'unit-test-shared-secret-32bytes!';
const fakeSecretSource: SecretSource = { get: async () => TEST_SECRET };
// The default exported handler reads the secret via the production adapter,
// which would hit SSM; the existing s004 contract tests below run against the
// port-injected handler so they stay infra-free and independent of A2.
const testHandler = createHandler({ secretSource: fakeSecretSource });

const FORBIDDEN = ['O', '0', '1', 'I', 'L'];

function makeEvent(body?: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /games',
    rawPath: '/games',
    requestContext: { http: { method: 'POST', path: '/games' } },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  process.env.TABLE_NAME = 'oxo-games';
});

describe('handler — POST /games success (T1, F1)', () => {
  it('persists a server-generated item and returns 201 with gameId, code (+wsToken)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await testHandler(makeEvent());
    const after = Math.floor(Date.now() / 1000);

    expect(res.statusCode).toBe(201);
    const respBody = JSON.parse(res.body as string);
    // S-A1.5 regression: existing keys still present; gameId/code unchanged in
    // meaning. wsToken is ADDED (UC1) — no existing field removed.
    expect(respBody.gameId).toBeDefined();
    expect(respBody.code).toBeDefined();

    // gameId is a UUID
    expect(respBody.gameId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // code is the unambiguous 6-char format
    expect(respBody.code).toMatch(/^[A-Z0-9]{6}$/);
    for (const ch of FORBIDDEN) expect(respBody.code).not.toContain(ch);

    // The persisted item matches the contract.
    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const item = calls[0].args[0].input.Item as Record<string, unknown>;
    expect(calls[0].args[0].input.TableName).toBe('oxo-games');
    expect(item.gameId).toBe(respBody.gameId);
    expect(item.code).toBe(respBody.code);
    expect(item.status).toBe('waiting');
    expect(typeof item.ttl).toBe('number');
    // ttl ~ 24h ahead of request time, within a small skew tolerance.
    expect(item.ttl as number).toBeGreaterThanOrEqual(before + 86400 - 5);
    expect(item.ttl as number).toBeLessThanOrEqual(after + 86400 + 5);

    // DEFECT-005-001 Bug A (primary fix): the create write must NOT store a NULL
    // hostConnectionId attribute. Storing NULL made the attribute "exist", which
    // broke register's attribute_not_exists(hostConnectionId) bind condition.
    // Omitting it entirely lets a fresh game satisfy attribute_not_exists.
    expect('hostConnectionId' in item).toBe(false);
  });
});

describe('handler — client-supplied fields are ignored (S1)', () => {
  it('uses server values for gameId/code/status/ttl, never the planted ones', async () => {
    const planted = {
      gameId: 'attacker-controlled-id',
      code: 'HACKED',
      status: 'active',
      ttl: 9999999999,
    };
    const res = await testHandler(makeEvent(planted));
    expect(res.statusCode).toBe(201);
    const respBody = JSON.parse(res.body as string);

    expect(respBody.gameId).not.toBe(planted.gameId);
    expect(respBody.code).not.toBe(planted.code);

    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<
      string,
      unknown
    >;
    expect(item.gameId).not.toBe(planted.gameId);
    expect(item.code).not.toBe(planted.code);
    expect(item.status).toBe('waiting');
    expect(item.ttl).not.toBe(planted.ttl);
  });
});

describe('handler — error path returns a clean 5xx (F5)', () => {
  it('returns 500 with a small JSON error and no internal detail on DDB failure', async () => {
    ddbMock.on(PutCommand).rejects(
      new Error('ProvisionedThroughputExceededException: secret stack trace here'),
    );
    const res = await testHandler(makeEvent());

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ error: 'Could not create game' });
    // No leaked internals.
    expect(res.body as string).not.toContain('stack');
    expect(res.body as string).not.toContain('ProvisionedThroughput');
  });
});

describe('handler — injects a host wsToken (S-A1.4, T7, AC1.1–AC1.5)', () => {
  it('201 body includes a wsToken that decodes to the host claims for THIS game', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await testHandler(makeEvent());
    const after = Math.floor(Date.now() / 1000);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.wsToken).toBeDefined();
    expect(typeof body.wsToken).toBe('string');

    // wsToken verifies with the SAME secret the SecretSource provided.
    const result = verify(body.wsToken, TEST_SECRET, before);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // gameId in the token matches the gameId in the body (same game).
      expect(result.payload.gameId).toBe(body.gameId);
      expect(result.payload.role).toBe('host');
      // exp is ~60s ahead of request time (window assertion, no fixed clock).
      expect(result.payload.exp).toBeGreaterThanOrEqual(before + 60 - 2);
      expect(result.payload.exp).toBeLessThanOrEqual(after + 60 + 2);
    }
  });

  it('does NOT persist the wsToken (it is response-only, never stored)', async () => {
    await testHandler(makeEvent());
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<
      string,
      unknown
    >;
    expect('wsToken' in item).toBe(false);
  });

  it('does NOT mint a token when the create write fails (no token on 5xx)', async () => {
    ddbMock.on(PutCommand).rejects(new Error('ddb down'));
    const res = await testHandler(makeEvent());
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body as string);
    expect(body.wsToken).toBeUndefined();
  });

  // DEFECT-H2-001 (corrected): secret failure is a clean 5xx — semantics never
  // change shape. The deploy ORDER guarantees the secret exists (same stack);
  // see process v20 §39 and the (now unconditional) $connect REQUEST-authorizer
  // gate for the enforcement half — the H2_ENFORCE flag that staged it was
  // factored out at §40 lifecycle completion.
  it('returns a clean 500 (no leak) when the secret source fails', async () => {
    const failingSecretSource = {
      get: async () => {
        throw new Error('SSM stack trace detail should never leak');
      },
    };
    const strictHandler = createHandler({ secretSource: failingSecretSource });
    const res = await strictHandler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Could not create game' });
    expect(res.body as string).not.toContain('SSM');
  });
});

describe('handler — default export wires the production SecretSource (S-A1.6 seam)', () => {
  it('exports a callable default handler bound to the SSM adapter', () => {
    // We do not invoke it here (it would reach SSM); we assert the wiring exists
    // so the deployable entry point is the same shape APIGW invokes.
    expect(typeof handler).toBe('function');
  });
});
