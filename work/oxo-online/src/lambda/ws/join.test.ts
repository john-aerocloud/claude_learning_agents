import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { handleJoin } from './join';

const ddbMock = mockClient(DynamoDBDocumentClient);

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
  process.env.GAMES_TABLE = 'oxo-games';
  process.env.GAMES_CODE_INDEX = 'code-index';
  process.env.CONNECTIONS_TABLE = 'oxo-connections';
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
