import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { handler } from './handler';

const ddbMock = mockClient(DynamoDBDocumentClient);
const apiMock = mockClient(ApiGatewayManagementApiClient);

/** Decode a PostToConnection Data payload (Uint8Array | string) to an object. */
function decodeFrame(data: unknown): Record<string, unknown> {
  const text =
    typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array);
  return JSON.parse(text) as Record<string, unknown>;
}

function event(routeKey: string, body?: unknown) {
  return {
    requestContext: { connectionId: 'CTX-ID', routeKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as never;
}

beforeEach(() => {
  ddbMock.reset();
  apiMock.reset();
  ddbMock.on(PutCommand).resolves({});
  apiMock.on(PostToConnectionCommand).resolves({});
  apiMock.on(DeleteConnectionCommand).resolves({});
  process.env.CONNECTIONS_TABLE = 'oxo-connections';
  process.env.GAMES_TABLE = 'oxo-games';
  process.env.GAMES_CODE_INDEX = 'code-index';
  process.env.WS_API_ENDPOINT = 'https://ws.example.com/prod';
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

// DEFECT-005-001 Bug B: a Lambda integration response NEVER becomes a WS close
// frame, and @connections only supports DELETE (close 1000) — custom close
// codes are undeliverable. The handler must therefore POST an error MESSAGE
// frame {type:'error', code, message} to the caller, then DELETE the connection.
describe('handler — close delivery via error frame + DELETE (DEFECT-005-001 Bug B; S3)', () => {
  // Strings that must NEVER appear in a client-visible error frame (S3).
  const INTERNAL_LEAK_MARKERS = ['stack', 'Exception', 'arn:aws', 'oxo-games', 'oxo-connections', 'RequestId'];

  it('posts {type:error, code:4040, message} to the caller then DELETEs the connection', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await handler(event('join', { action: 'join', code: 'NOPE12' }));

    const posts = apiMock.commandCalls(PostToConnectionCommand);
    expect(posts).toHaveLength(1);
    expect(posts[0].args[0].input.ConnectionId).toBe('CTX-ID');
    const frame = decodeFrame(posts[0].args[0].input.Data);
    expect(frame).toEqual({
      type: 'error',
      code: 4040,
      message: 'Game not found. Check the code and try again.',
    });

    // Then the connection is DELETEd (the only close primitive @connections has).
    const deletes = apiMock.commandCalls(DeleteConnectionCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args[0].input.ConnectionId).toBe('CTX-ID');

    // No internal detail leaks in the error frame (S3).
    const json = JSON.stringify(frame);
    for (const marker of INTERNAL_LEAK_MARKERS) {
      expect(json).not.toContain(marker);
    }
  });

  it('still DELETEs the connection even if the error-frame POST throws (GoneException)', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
    const gone = new Error('connection gone');
    (gone as { name: string }).name = 'GoneException';
    apiMock.on(PostToConnectionCommand).rejects(gone);

    // Must not throw to the caller.
    const res = await handler(event('join', { action: 'join', code: 'NOPE12' }));
    expect(res.statusCode).toBe(400);

    const deletes = apiMock.commandCalls(DeleteConnectionCommand);
    expect(deletes).toHaveLength(1);
  });

  it('does not post/delete on a successful (no-close) result', async () => {
    const res = await handler(event('$disconnect'));
    expect(res.statusCode).toBe(200);
    expect(apiMock.commandCalls(PostToConnectionCommand)).toHaveLength(0);
    expect(apiMock.commandCalls(DeleteConnectionCommand)).toHaveLength(0);
  });
});
