import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DdbGamesStore, MOVE_CONDITION_EXPRESSION } from './games-ddb';
import { MoveConditionFailed } from '../../move/ports';

// @covers adapter-games-ddb
// @covers port-game-store
// @covers games
//
// UC2 — Games store adapter. ONE conditional UpdateItem carrying the turn gate +
// status='active' + version CAS; terminal flip in the SAME write. Reject over
// retry. §41 failure taxonomy + buildSha logging. Mocked-adapter caution: the
// CAS ConditionExpression is a PLATFORM behaviour the local mock CANNOT enforce
// against real DynamoDB — so the expression STRING is pinned (R2.6 policy pin)
// and the cloud guarantee is proven by UC6 prod zero-divergence, not by the mock.

const ddbMock = mockClient(DynamoDBDocumentClient);

let logs: Array<Record<string, unknown>>;
const captureLog = (l: Record<string, unknown>) => logs.push(l);

beforeEach(() => {
  ddbMock.reset();
  logs = [];
});

function store() {
  return new DdbGamesStore({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-games',
    buildSha: 'abc1234',
    log: captureLog,
  });
}

describe('DdbGamesStore.applyMoveWrite — single conditional UpdateItem CAS (AC2.1)', () => {
  it('issues exactly one UpdateItem with the turn+status+version condition and the SET clauses', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store().applyMoveWrite({
      gameId: 'g1',
      expectedVersion: 0,
      expectedTurn: 'X',
      patch: { board: '----X----', nextTurn: 'O' },
    });
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('oxo-games');
    expect(input.Key).toEqual({ gameId: 'g1' });
    // CAS condition: status active AND currentTurn = sender AND version = expected.
    expect(input.ConditionExpression).toBe(MOVE_CONDITION_EXPRESSION);
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':active': 'active',
      ':expRole': 'X',
      ':expVersion': 0,
      ':newBoard': '----X----',
      ':nextTurn': 'O',
      ':one': 1,
    });
    // SET bumps board/turn/version+1/moveCount+1.
    expect(input.UpdateExpression).toContain('version = version + :one');
    expect(input.UpdateExpression).toContain('moveCount = moveCount + :one');
    expect(input.UpdateExpression).toContain('board = :newBoard');
    expect(input.UpdateExpression).toContain('currentTurn = :nextTurn');
  });
});

describe('DdbGamesStore.applyMoveWrite — version CAS reject (AC2.2 / S6)', () => {
  it('surfaces ConditionalCheckFailed as a typed MoveConditionFailed (no retry, no partial write)', async () => {
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('cond'), {
        name: 'ConditionalCheckFailedException',
      }),
    );
    await expect(
      store().applyMoveWrite({
        gameId: 'g1',
        expectedVersion: 0,
        expectedTurn: 'X',
        patch: { board: '----X----', nextTurn: 'O' },
      }),
    ).rejects.toBeInstanceOf(MoveConditionFailed);
    // reject-over-retry: exactly ONE UpdateItem, never a blind re-attempt.
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    // business reject is logged category=data (caller's problem, 4xx-class), not external.
    const line = logs.find((l) => l.event === 'move_condition_failed');
    expect(line?.category).toBe('data');
    expect(line?.buildSha).toBe('abc1234');
  });
});

describe('DdbGamesStore.applyMoveWrite — terminal flips status+winner in the SAME write (AC2.3 / S3)', () => {
  it('a winning patch sets status=won and winner atomically in the one UpdateItem', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store().applyMoveWrite({
      gameId: 'g1',
      expectedVersion: 2,
      expectedTurn: 'X',
      patch: { board: 'XXX------', nextTurn: 'O', status: 'won', winner: 'X' },
    });
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toContain('#status = :newStatus');
    expect(input.UpdateExpression).toContain('winner = :winner');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':newStatus': 'won',
      ':winner': 'X',
    });
    expect(input.ExpressionAttributeNames).toMatchObject({ '#status': 'status' });
  });

  it('a draw patch sets status=drawn and NO winner (AC2.4)', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store().applyMoveWrite({
      gameId: 'g1',
      expectedVersion: 8,
      expectedTurn: 'X',
      patch: { board: 'XOXXOOOXX', nextTurn: 'O', status: 'drawn' },
    });
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toContain('#status = :newStatus');
    expect(input.UpdateExpression).not.toContain('winner = :winner');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':newStatus': 'drawn' });
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':winner');
  });
});

describe('DdbGamesStore.getGame — read current board (AC2.1 read side)', () => {
  it('maps a GetItem into domain GameState', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        gameId: 'g1',
        board: '----X----',
        currentTurn: 'O',
        status: 'active',
        version: 1,
        moveCount: 1,
        hostConnectionId: 'hc',
        guestConnectionId: 'gc',
      },
    });
    const g = await store().getGame('g1');
    expect(g).toEqual({
      gameId: 'g1',
      board: '----X----',
      currentTurn: 'O',
      status: 'active',
      version: 1,
      moveCount: 1,
      hostConnectionId: 'hc',
      guestConnectionId: 'gc',
    });
  });

  it('returns null when no item exists', async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await store().getGame('nope')).toBeNull();
  });
});

describe('DdbGamesStore — failure taxonomy + retry (§5a / §41) — logging TESTED', () => {
  it('a DDB 5xx on the write logs EXTERNAL_DEPENDENCY and rethrows (availability)', async () => {
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }),
    );
    await expect(
      store().applyMoveWrite({
        gameId: 'g1',
        expectedVersion: 0,
        expectedTurn: 'X',
        patch: { board: '----X----', nextTurn: 'O' },
      }),
    ).rejects.toThrow();
    const line = logs.find((l) => l.event === 'move_write_failed');
    expect(line?.category).toBe('EXTERNAL_DEPENDENCY');
    expect(line?.buildSha).toBe('abc1234');
  });

  it('a DDB 4xx (our bad request) on the write logs INTERNAL and rethrows (defect signal)', async () => {
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('bad'), { $metadata: { httpStatusCode: 400 } }),
    );
    await expect(
      store().applyMoveWrite({
        gameId: 'g1',
        expectedVersion: 0,
        expectedTurn: 'X',
        patch: { board: '----X----', nextTurn: 'O' },
      }),
    ).rejects.toThrow();
    const line = logs.find((l) => l.event === 'move_write_failed');
    expect(line?.category).toBe('INTERNAL');
  });
});

describe('DdbGamesStore — code↔policy pin: issues ONLY GetItem/UpdateItem on Games (S5)', () => {
  it('applyMoveWrite issues UpdateItem and NEVER Query/Scan/Put/Delete', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store().applyMoveWrite({
      gameId: 'g1',
      expectedVersion: 0,
      expectedTurn: 'X',
      patch: { board: '----X----', nextTurn: 'O' },
    });
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('getGame issues GetItem and NEVER a write command', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { gameId: 'g1', status: 'active', board: '---------', currentTurn: 'X', version: 0, moveCount: 0 } });
    await store().getGame('g1');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});

describe('MOVE_CONDITION_EXPRESSION — code-policy pin (AC2.6 / S3)', () => {
  it('contains all three CAS terms so the gate cannot be silently removed', () => {
    expect(MOVE_CONDITION_EXPRESSION).toContain('#status = :active');
    expect(MOVE_CONDITION_EXPRESSION).toContain('currentTurn = :expRole');
    expect(MOVE_CONDITION_EXPRESSION).toContain('version = :expVersion');
  });
});
