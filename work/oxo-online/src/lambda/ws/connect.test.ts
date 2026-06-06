import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handleConnect } from './connect';

const ddbMock = mockClient(DynamoDBDocumentClient);

function connectEvent(connectionId: string, body?: unknown) {
  return {
    requestContext: { connectionId, routeKey: '$connect' },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as never;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  process.env.CONNECTIONS_TABLE = 'oxo-connections';
});

describe('$connect — writes a Connections item with null gameId + ~2h TTL (T3, T6)', () => {
  it('persists connectionId from requestContext, gameId null, ttl ~7200s ahead', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await handleConnect(connectEvent('CTX-ID'));
    const after = Math.floor(Date.now() / 1000);

    expect(res.statusCode).toBe(200);
    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const item = calls[0].args[0].input.Item as Record<string, unknown>;
    expect(calls[0].args[0].input.TableName).toBe('oxo-connections');
    expect(item.connectionId).toBe('CTX-ID');
    // gameId is null/absent at $connect (not yet known).
    expect(item.gameId == null).toBe(true);
    expect(typeof item.ttl).toBe('number');
    expect(item.ttl as number).toBeGreaterThanOrEqual(before + 7200 - 5);
    expect(item.ttl as number).toBeLessThanOrEqual(after + 7200 + 5);
  });

  it('T6: never reads a planted body connectionId — uses the context id only', async () => {
    await handleConnect(connectEvent('CTX-ID', { connectionId: 'SPOOF' }));
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<
      string,
      unknown
    >;
    expect(item.connectionId).toBe('CTX-ID');
    expect(JSON.stringify(item)).not.toContain('SPOOF');
  });
});
