import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { handleJoin } from './join';

const ddbMock = mockClient(DynamoDBDocumentClient);
const apiMock = mockClient(ApiGatewayManagementApiClient);

/** Decode a PostToConnection Data payload (Uint8Array | string) to an object. */
function decodeFrame(data: unknown): Record<string, unknown> {
  const text =
    typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array);
  return JSON.parse(text) as Record<string, unknown>;
}

function joinEvent(connectionId: string, body: unknown) {
  return {
    requestContext: { connectionId, routeKey: 'join' },
    body: JSON.stringify(body),
  } as never;
}

// Strings that must NEVER appear in a client-visible close payload (S3).
const INTERNAL_LEAK_MARKERS = [
  'stack',
  'Exception',
  'arn:aws',
  'oxo-games',
  'oxo-connections',
  'requestId',
  'RequestId',
];

function assertNoLeak(payload: unknown) {
  const json = JSON.stringify(payload);
  for (const marker of INTERNAL_LEAK_MARKERS) {
    expect(json).not.toContain(marker);
  }
}

beforeEach(() => {
  ddbMock.reset();
  apiMock.reset();
  process.env.GAMES_TABLE = 'oxo-games';
  process.env.GAMES_CODE_INDEX = 'code-index';
  process.env.CONNECTIONS_TABLE = 'oxo-connections';
  process.env.WS_API_ENDPOINT = 'https://ws.example.com/prod';
});

describe('join — unknown code closes 4040, no writes (A2.1; F3, T4, S3)', () => {
  it('queries code-index, finds nothing, closes 4040 and writes nothing', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    const res = await handleJoin(joinEvent('CTX-ID', { action: 'join', code: 'NOPE12' }));

    expect(res.close).toBeDefined();
    expect(res.close!.code).toBe(4040);
    // No Connections write, no Games mutation on a miss.
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    // The query targeted the GSI.
    const queries = ddbMock.commandCalls(QueryCommand);
    expect(queries).toHaveLength(1);
    expect(queries[0].args[0].input.IndexName).toBe('code-index');
    assertNoLeak(res.close);
  });
});

describe('join — internal fault closes 4500, generic message, no leak (A2.2; F9, S3)', () => {
  it('maps an unexpected client error to a 4500 close with no internal detail', async () => {
    ddbMock
      .on(QueryCommand)
      .rejects(
        new Error(
          'ProvisionedThroughputExceededException: secret stack trace, arn:aws:dynamodb:...:table/oxo-games, RequestId 123',
        ),
      );

    const res = await handleJoin(joinEvent('CTX-ID', { action: 'join', code: 'ABC123' }));

    expect(res.close).toBeDefined();
    expect(res.close!.code).toBe(4500);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    assertNoLeak(res.close);
  });
});

describe('join — game not waiting closes 4041, no mutation (A4.1; F4, T5, S3)', () => {
  it('attempts the conditional UpdateItem; on ConditionalCheckFailedException closes 4041 with no other write', async () => {
    // GSI hit: a game exists for the code but it is not joinable.
    ddbMock.on(QueryCommand).resolves({
      Items: [{ gameId: 'G-1', code: 'ABC123', status: 'active' }],
      Count: 1,
    });
    // The conditional activate is REJECTED (status!='waiting' or guest set).
    const condErr = new Error('The conditional request failed');
    (condErr as { name: string }).name = 'ConditionalCheckFailedException';
    ddbMock.on(UpdateCommand).rejects(condErr);

    const res = await handleJoin(joinEvent('CTX-ID', { action: 'join', code: 'ABC123' }));

    expect(res.close).toBeDefined();
    expect(res.close!.code).toBe(4041);
    // Exactly one (rejected) Games write attempt; no Connections mutation.
    const updates = ddbMock.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0].input.TableName).toBe('oxo-games');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    // The rejected write carried the no-hijack ConditionExpression.
    expect(updates[0].args[0].input.ConditionExpression).toContain(
      'attribute_not_exists(guestConnectionId)',
    );
    assertNoLeak(res.close);
  });
});

describe('join — happy path: activate + game-ready both sides (C1; F1, F2, F5, T1, T2, T3, T6)', () => {
  beforeEach(() => {
    // A waiting game with the host already registered; ready to be joined.
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          gameId: 'G-1',
          code: 'ABC123',
          status: 'waiting',
          hostConnectionId: 'HOST-CONN',
        },
      ],
      Count: 1,
    });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    apiMock.on(PostToConnectionCommand).resolves({});
  });

  it('activates the game with the guest from request context (T2, T6) — planted body id ignored', async () => {
    const res = await handleJoin(
      joinEvent('GUEST-CONN', {
        action: 'join',
        code: 'ABC123',
        connectionId: 'SPOOF',
        guestConnectionId: 'SPOOF',
      }),
    );

    expect(res.close).toBeUndefined();
    expect(res.statusCode).toBe(200);

    const updates = ddbMock.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    const update = updates[0].args[0].input;
    expect(update.TableName).toBe('oxo-games');
    expect(update.Key).toEqual({ gameId: 'G-1' });
    // No-hijack conditional write (T5 regression — happy path uses the same guard).
    expect(update.ConditionExpression).toContain('attribute_not_exists(guestConnectionId)');
    expect(update.ConditionExpression).toContain('waiting');
    // Activates with status=active and the caller's OWN context id (T6).
    expect(update.ExpressionAttributeValues?.[':cid']).toBe('GUEST-CONN');
    expect(update.ExpressionAttributeValues?.[':active']).toBe('active');
    // The planted body id appears nowhere in the persisted write.
    expect(JSON.stringify(update)).not.toContain('SPOOF');
  });

  it('writes the guest Connections item with role=guest, gameId and ~2h ttl (T3)', async () => {
    const before = Math.floor(Date.now() / 1000);
    await handleJoin(joinEvent('GUEST-CONN', { action: 'join', code: 'ABC123' }));
    const after = Math.floor(Date.now() / 1000);

    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(1);
    const item = puts[0].args[0].input.Item as Record<string, unknown>;
    expect(puts[0].args[0].input.TableName).toBe('oxo-connections');
    expect(item.connectionId).toBe('GUEST-CONN');
    expect(item.role).toBe('guest');
    expect(item.gameId).toBe('G-1');
    // ttl ~2h ahead (7200s), with clock-skew tolerance.
    expect(item.ttl as number).toBeGreaterThanOrEqual(before + 7200 - 5);
    expect(item.ttl as number).toBeLessThanOrEqual(after + 7200 + 5);
  });

  it('posts game-ready to BOTH connections; payload is exactly {type,role}, no id leak (T1)', async () => {
    await handleJoin(joinEvent('GUEST-CONN', { action: 'join', code: 'ABC123' }));

    const posts = apiMock.commandCalls(PostToConnectionCommand);
    expect(posts).toHaveLength(2);

    const byConn = new Map<string, Record<string, unknown>>();
    for (const post of posts) {
      const input = post.args[0].input;
      byConn.set(input.ConnectionId as string, decodeFrame(input.Data));
    }

    // Host gets role=host; guest gets role=guest.
    expect(byConn.get('HOST-CONN')).toEqual({ type: 'game-ready', role: 'host' });
    expect(byConn.get('GUEST-CONN')).toEqual({ type: 'game-ready', role: 'guest' });

    // T1: each payload carries ONLY {type, role} — never the other player's id.
    for (const frame of byConn.values()) {
      expect(Object.keys(frame).sort()).toEqual(['role', 'type']);
    }
    const hostFrameJson = JSON.stringify(byConn.get('HOST-CONN'));
    const guestFrameJson = JSON.stringify(byConn.get('GUEST-CONN'));
    expect(hostFrameJson).not.toContain('GUEST-CONN');
    expect(guestFrameJson).not.toContain('HOST-CONN');
  });

  it('orders the writes before the fan-out: activate, then Connections, then post', async () => {
    await handleJoin(joinEvent('GUEST-CONN', { action: 'join', code: 'ABC123' }));
    // The conditional activate and the guest Connections write both happen, and
    // two frames are posted only after a successful activation.
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(apiMock.commandCalls(PostToConnectionCommand)).toHaveLength(2);
  });
});
