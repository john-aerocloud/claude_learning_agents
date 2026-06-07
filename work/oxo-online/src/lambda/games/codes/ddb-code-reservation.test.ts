import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DdbCodeReservation,
  CODES_RESERVE_CONDITION_EXPRESSION,
} from './ddb-code-reservation';
import { CodeCollision } from './ports';

// @covers adapterCodeReservationDdb (class-deps.mmd s005-h3)
// @covers AC-6 (ConditionExpression code-policy pin)

const ddbMock = mockClient(DynamoDBDocumentClient);

const logs: Array<Record<string, unknown>> = [];
function makeAdapter() {
  return new DdbCodeReservation({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-codes',
    buildSha: 'test-sha',
    log: (line) => logs.push(line),
  });
}

function conditionalCheckFailed(): Error {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  logs.length = 0;
});

describe('DdbCodeReservation — AC-6 code-policy pin: ConditionExpression', () => {
  it('exports the literal attribute_not_exists(code) condition string', () => {
    // The uniqueness is enforced BY THE CONDITION, not by code-side checking.
    expect(CODES_RESERVE_CONDITION_EXPRESSION).toBe('attribute_not_exists(code)');
  });

  it('issues a conditional PutItem with attribute_not_exists(code) on the Codes table', async () => {
    const adapter = makeAdapter();
    await adapter.reserve('ABC234', 'game-uuid-1');

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('oxo-codes');
    expect(input.ConditionExpression).toBe('attribute_not_exists(code)');
    // Item carries the code PK, the diagnostic gameId, and a ~24h ttl.
    const item = input.Item as Record<string, unknown>;
    expect(item.code).toBe('ABC234');
    expect(item.gameId).toBe('game-uuid-1');
    expect(typeof item.ttl).toBe('number');
  });

  it('sets ttl ~24h ahead of now (matches Games TTL; orphans self-delete)', async () => {
    const adapter = makeAdapter();
    const before = Math.floor(Date.now() / 1000);
    await adapter.reserve('ABC234', 'g1');
    const after = Math.floor(Date.now() / 1000);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<
      string,
      unknown
    >;
    expect(item.ttl as number).toBeGreaterThanOrEqual(before + 86400 - 5);
    expect(item.ttl as number).toBeLessThanOrEqual(after + 86400 + 5);
  });
});

describe('DdbCodeReservation — collision mapping (the ONLY retryable branch)', () => {
  it('maps ConditionalCheckFailedException to a typed CodeCollision', async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    const adapter = makeAdapter();
    await expect(adapter.reserve('ABC234', 'g1')).rejects.toBeInstanceOf(CodeCollision);
    // Collision is a data-class reject, structured-logged with buildSha.
    const line = logs.find((l) => l.event === 'code_reservation_collision');
    expect(line).toBeDefined();
    expect(line?.category).toBe('data');
    expect(line?.buildSha).toBe('test-sha');
  });

  it('does NOT map a non-collision DynamoDB error to CodeCollision (propagates as-is)', async () => {
    // A 5xx / throttling / connection failure is an availability problem, NOT a
    // collision — it must NOT trigger a redraw (delta §3: do not mask infra fault).
    const infraErr = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
      $metadata: { httpStatusCode: 500 },
    });
    ddbMock.on(PutCommand).rejects(infraErr);
    const adapter = makeAdapter();
    await expect(adapter.reserve('ABC234', 'g1')).rejects.not.toBeInstanceOf(CodeCollision);
    const line = logs.find((l) => l.event === 'code_reservation_write_failed');
    expect(line).toBeDefined();
    expect(line?.category).toBe('EXTERNAL_DEPENDENCY');
  });
});

describe('DdbCodeReservation — code↔policy pin: only PutItem ever issued (AC-5 mirror)', () => {
  it('never issues Get/Update/Delete/Query/Scan against the Codes table', async () => {
    const adapter = makeAdapter();
    await adapter.reserve('ABC234', 'g1');
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
