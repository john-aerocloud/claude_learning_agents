import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { handleRegister } from './register';

const ddbMock = mockClient(DynamoDBDocumentClient);

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

function registerEvent(connectionId: string, body: unknown) {
  return {
    requestContext: { connectionId, routeKey: 'register' },
    body: JSON.stringify(body),
  } as never;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  process.env.CONNECTIONS_TABLE = 'oxo-connections';
  process.env.GAMES_TABLE = 'oxo-games';
});

describe('register — binds host connection to the game (T6, S1, F6)', () => {
  it('writes hostConnectionId from requestContext, conditional on attribute_not_exists', async () => {
    const res = await handleRegister(
      registerEvent('CTX-ID', { action: 'register', gameId: 'G-1' }),
    );
    expect(res.statusCode).toBe(200);

    const updates = ddbMock.commandCalls(UpdateCommand);
    // The ONLY UpdateItem is the conditional bind on Games (UpdateItem is the
    // granted action there). The Connections write is a Put (see below).
    expect(updates.length).toBe(1);

    const gamesUpdate = updates.find(
      (u) => u.args[0].input.TableName === 'oxo-games',
    )!;
    expect(gamesUpdate).toBeDefined();
    expect(gamesUpdate.args[0].input.Key).toEqual({ gameId: 'G-1' });
    // No-hijack conditional write: only set host if not already set.
    expect(gamesUpdate.args[0].input.ConditionExpression).toContain(
      'attribute_not_exists(hostConnectionId)',
    );
    // DEFECT-005-001 Bug A: a stored NULL hostConnectionId attribute (from an
    // older create write) must ALSO satisfy the bind condition — the condition
    // tolerates an existing NULL via the OR clause.
    expect(gamesUpdate.args[0].input.ConditionExpression).toContain(
      'hostConnectionId = :null',
    );
    const gamesNames = gamesUpdate.args[0].input.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(gamesNames[':null']).toBeNull();
    // The persisted host id is the caller's context id.
    const gamesValues = gamesUpdate.args[0].input.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(Object.values(gamesValues)).toContain('CTX-ID');

    const puts = ddbMock.commandCalls(PutCommand);
    const connPut = puts.find(
      (p) => p.args[0].input.TableName === 'oxo-connections',
    )!;
    expect(connPut).toBeDefined();
    const connItem = connPut.args[0].input.Item as Record<string, unknown>;
    expect(connItem.connectionId).toBe('CTX-ID');
    expect(connItem.gameId).toBe('G-1');
    expect(connItem.role).toBe('host');
  });

  it('T6: a planted body connectionId is never read or stored', async () => {
    await handleRegister(
      registerEvent('CTX-ID', {
        action: 'register',
        gameId: 'G-1',
        connectionId: 'SPOOF',
        hostConnectionId: 'SPOOF',
      }),
    );
    const writes = [
      ...ddbMock.commandCalls(UpdateCommand),
      ...ddbMock.commandCalls(PutCommand),
    ];
    for (const w of writes) {
      expect(JSON.stringify(w.args[0].input)).not.toContain('SPOOF');
    }
    const gamesUpdate = ddbMock
      .commandCalls(UpdateCommand)
      .find((u) => u.args[0].input.TableName === 'oxo-games')!;
    const gamesValues = gamesUpdate.args[0].input.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(Object.values(gamesValues)).toContain('CTX-ID');
  });
});

// DEFECT-005-001-R2 (Issue 1) — CODE↔POLICY CONTRACT PIN.
//
// This block exists because the CODE and the IAM POLICY drifted: register.ts
// had been writing the Connections item with an UpdateItem (UpdateCommand),
// but the oxo-ws-fn execution role grants ONLY dynamodb:PutItem/DeleteItem on
// the Connections table (least-privilege, working as designed). The live result
// was AccessDenied -> register_failed -> 4500 close on every host register.
//
// The thinnest correct fix is to make the code obey the granted action set:
// write the FULL Connections item with a PutCommand. PutItem REPLACES the item,
// so it resets the connection's ~2h TTL on each register — that is ACCEPTABLE
// (a freshly-registering host's connection should live a full window) and is
// documented here as the intended behaviour. These tests pin the contract so
// the code can never silently drift back to an action the role does not grant.
describe('register — Connections write obeys the granted action set (DEFECT-005-001-R2, Issue 1)', () => {
  it('persists the Connections item with PutItem (Put), NOT UpdateItem', async () => {
    await handleRegister(
      registerEvent('CTX-ID', { action: 'register', gameId: 'G-1' }),
    );

    // The Connections write must be a Put — the granted action. There must be
    // NO Update against the Connections table (that action is not granted).
    const connPut = ddbMock
      .commandCalls(PutCommand)
      .find((p) => p.args[0].input.TableName === 'oxo-connections');
    expect(connPut).toBeDefined();

    const connUpdate = ddbMock
      .commandCalls(UpdateCommand)
      .find((u) => u.args[0].input.TableName === 'oxo-connections');
    expect(connUpdate).toBeUndefined();
  });

  it('writes the FULL Connections item: connectionId, gameId, role=host, fresh TTL', async () => {
    const before = Math.floor(Date.now() / 1000);
    await handleRegister(
      registerEvent('CTX-ID', { action: 'register', gameId: 'G-1' }),
    );
    const after = Math.floor(Date.now() / 1000);

    const connPut = ddbMock
      .commandCalls(PutCommand)
      .find((p) => p.args[0].input.TableName === 'oxo-connections')!;
    const item = connPut.args[0].input.Item as {
      connectionId?: string;
      gameId?: string;
      role?: string;
      ttl?: number;
    };
    expect(item.connectionId).toBe('CTX-ID');
    expect(item.gameId).toBe('G-1');
    expect(item.role).toBe('host');
    // Fresh ~2h TTL (PutItem resets it — documented, acceptable).
    expect(item.ttl).toBeGreaterThanOrEqual(before + 2 * 60 * 60);
    expect(item.ttl).toBeLessThanOrEqual(after + 2 * 60 * 60);
  });
});

describe('register — defensive error handling (DEFECT-005-001 Bug A; S3)', () => {
  it('ConditionalCheckFailedException (host already bound) closes 4041, no leak', async () => {
    const condErr = new Error('The conditional request failed');
    (condErr as { name: string }).name = 'ConditionalCheckFailedException';
    ddbMock.on(UpdateCommand).rejects(condErr);

    const res = await handleRegister(
      registerEvent('CTX-ID', { action: 'register', gameId: 'G-1' }),
    );

    // The register path must NOT throw unhandled — it returns a clean close.
    expect(res.close).toBeDefined();
    expect(res.close!.code).toBe(4041);
    assertNoLeak(res.close);
  });

  it('an unexpected fault closes 4500 with a generic message, no leak', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(
        new Error(
          'ProvisionedThroughputExceededException: secret stack trace, arn:aws:dynamodb:...:table/oxo-games, RequestId 123',
        ),
      );

    const res = await handleRegister(
      registerEvent('CTX-ID', { action: 'register', gameId: 'G-1' }),
    );

    expect(res.close).toBeDefined();
    expect(res.close!.code).toBe(4500);
    assertNoLeak(res.close);
  });
});
