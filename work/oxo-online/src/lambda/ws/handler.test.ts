import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { handler } from './handler';

const ddbMock = mockClient(DynamoDBDocumentClient);

function event(routeKey: string, body?: unknown) {
  return {
    requestContext: { connectionId: 'CTX-ID', routeKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as never;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  process.env.CONNECTIONS_TABLE = 'oxo-connections';
  process.env.GAMES_TABLE = 'oxo-games';
  process.env.GAMES_CODE_INDEX = 'code-index';
});

describe('handler dispatch — routes by requestContext.routeKey', () => {
  it('routes $connect to the connect handler (writes a Connections item)', async () => {
    const res = await handler(event('$connect'));
    expect(res.statusCode).toBe(200);
    expect(ddbMock.commandCalls(PutCommand).length).toBeGreaterThanOrEqual(1);
  });

  it('routes $disconnect to a no-op 200 (stub this slice)', async () => {
    const res = await handler(event('$disconnect'));
    expect(res.statusCode).toBe(200);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('routes join with an unknown code to a 4xx close response (4040)', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
    const res = await handler(event('join', { action: 'join', code: 'NOPE12' }));
    // The proxy response status reflects the close (non-2xx for 4040).
    expect(res.statusCode).toBe(400);
  });

  it('unknown routeKey returns 200 without throwing (no $default route exists)', async () => {
    const res = await handler(event('mystery'));
    expect(res.statusCode).toBe(200);
  });
});
