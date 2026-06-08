import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DdbLeaderboardStore,
  LEADERBOARD_CONDITION_EXPRESSION,
} from './ddb-leaderboard-store';
import { AlreadyScored } from './ports';

// @covers adapter-leaderboard-ddb
// R2.4 — the idempotency CRUX. The conditional UpdateItem ADD + scoredGames
// set-marker is a single-item CAS. T-LB-3 MANDATES the literal
// ConditionExpression `NOT contains(scoredGames, :gameId)`. The local in-memory
// adapter reproduces the BRANCH; real DDB set-contains atomicity is covered by
// this pin + the §30 prod skeleton (Probe A+B). (AC2.7, T-LB-3/4.)

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeStore() {
  return new DdbLeaderboardStore({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-leaderboard',
    buildSha: 'test-sha',
    log: () => {},
  });
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
});

describe('DdbLeaderboardStore.recordResult — the conditional CAS write (T-LB-3)', () => {
  it('PINS the ConditionExpression literal NOT contains(scoredGames, :gameId)', () => {
    expect(LEADERBOARD_CONDITION_EXPRESSION).toBe(
      'NOT contains(scoredGames, :gameId)',
    );
  });

  it('issues ONE conditional UpdateItem: ADD <field> :one, scoredGames :gameIdSet', async () => {
    const store = makeStore();
    await store.recordResult('ACE', 'wins', 'G1');

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('oxo-leaderboard');
    expect(input.Key).toEqual({ playerName: 'ACE' });
    // ADD increments the counter AND adds the gameId to the scoredGames set, in
    // ONE atomic write (increment-and-mark co-located on the same row).
    expect(input.UpdateExpression).toBe('ADD wins :one, scoredGames :gameIdSet');
    expect(input.ConditionExpression).toBe(
      'NOT contains(scoredGames, :gameId)',
    );
    const values = input.ExpressionAttributeValues as Record<string, unknown>;
    expect(values[':one']).toBe(1);
    expect(values[':gameId']).toBe('G1');
    // :gameIdSet is a String Set containing exactly the gameId. lib-dynamodb's
    // document client marshals a JS Set to a DynamoDB SS.
    expect(values[':gameIdSet']).toBeInstanceOf(Set);
    expect([...(values[':gameIdSet'] as Set<string>)]).toEqual(['G1']);
  });

  it('targets the draws field when asked', async () => {
    const store = makeStore();
    await store.recordResult('BEE', 'draws', 'G2');
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toBe('ADD draws :one, scoredGames :gameIdSet');
  });

  it('targets the losses field when asked', async () => {
    const store = makeStore();
    await store.recordResult('AAA', 'losses', 'G3');
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toBe('ADD losses :one, scoredGames :gameIdSet');
  });
});

describe('DdbLeaderboardStore.recordResult — idempotency branch (AC2.7, T-LB-3)', () => {
  it('maps ConditionalCheckFailedException to AlreadyScored (no retry, no double-count)', async () => {
    const store = makeStore();
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('conditional check failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    );
    await expect(store.recordResult('ACE', 'wins', 'G1')).rejects.toBeInstanceOf(
      AlreadyScored,
    );
  });

  it('propagates a non-conditional backend failure as-is (NOT masked as a replay)', async () => {
    const store = makeStore();
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('throttled'), {
        name: 'ProvisionedThroughputExceededException',
        $metadata: { httpStatusCode: 500 },
      }),
    );
    await expect(store.recordResult('ACE', 'wins', 'G1')).rejects.toThrow(
      'throttled',
    );
  });
});

describe('DdbLeaderboardStore — code↔policy pin: only granted command types issued', () => {
  it('recordResult issues ONLY UpdateItem (never Scan/Put/Delete/Get)', async () => {
    const store = makeStore();
    await store.recordResult('ACE', 'wins', 'G1');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});

describe('DdbLeaderboardStore.topN — Scan + in-memory sort (read path)', () => {
  it('scans the table and returns entries sorted wins desc / losses asc / name asc', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { playerName: 'AAA', wins: 1, draws: 0, losses: 2 },
        { playerName: 'ACE', wins: 3, draws: 1, losses: 0 },
        { playerName: 'BEE', wins: 1, draws: 0, losses: 1 },
        { playerName: 'CAT', wins: 1, draws: 0, losses: 1 },
      ],
    });
    const store = makeStore();
    const top = await store.topN(20);
    expect(top.map((e) => e.name)).toEqual(['ACE', 'BEE', 'CAT', 'AAA']);
    // shape: name + the three counters (no scoredGames leak to the read surface).
    expect(top[0]).toEqual({ name: 'ACE', wins: 3, draws: 1, losses: 0 });
  });

  it('treats absent counters as 0 and slices to n', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { playerName: 'X', wins: 5 },
        { playerName: 'Y', wins: 4 },
        { playerName: 'Z', wins: 3 },
      ],
    });
    const store = makeStore();
    const top = await store.topN(2);
    expect(top).toEqual([
      { name: 'X', wins: 5, draws: 0, losses: 0 },
      { name: 'Y', wins: 4, draws: 0, losses: 0 },
    ]);
  });
});
