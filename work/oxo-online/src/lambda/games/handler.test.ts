import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from './handler';

const ddbMock = mockClient(DynamoDBDocumentClient);

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
  it('persists a server-generated item and returns 201 with only gameId and code', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await handler(makeEvent());
    const after = Math.floor(Date.now() / 1000);

    expect(res.statusCode).toBe(201);
    const respBody = JSON.parse(res.body as string);
    expect(Object.keys(respBody).sort()).toEqual(['code', 'gameId']);

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
    const res = await handler(makeEvent(planted));
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
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ error: 'Could not create game' });
    // No leaked internals.
    expect(res.body as string).not.toContain('stack');
    expect(res.body as string).not.toContain('ProvisionedThroughput');
  });
});
