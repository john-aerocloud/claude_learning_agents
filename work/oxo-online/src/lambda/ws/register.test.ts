import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handleRegister } from './register';

const ddbMock = mockClient(DynamoDBDocumentClient);

function registerEvent(connectionId: string, body: unknown) {
  return {
    requestContext: { connectionId, routeKey: 'register' },
    body: JSON.stringify(body),
  } as never;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
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
    // One Games update + one Connections update.
    expect(updates.length).toBe(2);

    const gamesUpdate = updates.find(
      (u) => u.args[0].input.TableName === 'oxo-games',
    )!;
    expect(gamesUpdate).toBeDefined();
    expect(gamesUpdate.args[0].input.Key).toEqual({ gameId: 'G-1' });
    // No-hijack conditional write: only set host if not already set.
    expect(gamesUpdate.args[0].input.ConditionExpression).toContain(
      'attribute_not_exists(hostConnectionId)',
    );
    // The persisted host id is the caller's context id.
    const gamesValues = gamesUpdate.args[0].input.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(Object.values(gamesValues)).toContain('CTX-ID');

    const connUpdate = updates.find(
      (u) => u.args[0].input.TableName === 'oxo-connections',
    )!;
    expect(connUpdate).toBeDefined();
    expect(connUpdate.args[0].input.Key).toEqual({ connectionId: 'CTX-ID' });
    const connValues = connUpdate.args[0].input.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(Object.values(connValues)).toContain('host');
    expect(Object.values(connValues)).toContain('G-1');
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
    const updates = ddbMock.commandCalls(UpdateCommand);
    for (const u of updates) {
      expect(JSON.stringify(u.args[0].input)).not.toContain('SPOOF');
    }
    const gamesUpdate = updates.find(
      (u) => u.args[0].input.TableName === 'oxo-games',
    )!;
    const gamesValues = gamesUpdate.args[0].input.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(Object.values(gamesValues)).toContain('CTX-ID');
  });
});
