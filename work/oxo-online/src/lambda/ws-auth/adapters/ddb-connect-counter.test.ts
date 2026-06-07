import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DdbConnectCounter } from './ddb-connect-counter';

// S-A2.5 [S4, CP-H2-B] — per-IP counter adapter over DynamoDB UpdateItem(ADD)
// + conditional first-write TTL. Returns the new count. Code↔policy negative
// pin: ONLY UpdateItem against ConnectAttempts — no Get/Scan/Delete. Failure
// taxonomy + logging asserted.

const ddbMock = mockClient(DynamoDBDocumentClient);

let logs: Array<Record<string, unknown>>;
const captureLog = (l: Record<string, unknown>) => logs.push(l);

beforeEach(() => {
  ddbMock.reset();
  logs = [];
});

function counter() {
  return new DdbConnectCounter({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-connect-attempts',
    ttlSeconds: 300,
    now: () => 1_000_000,
    buildSha: 'abc1234',
    log: captureLog,
  });
}

describe('DdbConnectCounter.increment — ADD count + TTL, returns new count', () => {
  it('issues an UpdateItem keyed on sourceIp, ADD count 1, returns the new count', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 3 } });
    const n = await counter().increment('1.2.3.4');
    expect(n).toBe(3);
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('oxo-connect-attempts');
    expect(input.Key).toEqual({ sourceIp: '1.2.3.4' });
    expect(input.ReturnValues).toBe('UPDATED_NEW');
    // ADD count :one — increment expression present.
    expect(JSON.stringify(input.UpdateExpression)).toMatch(/ADD/);
  });

  it('sets the TTL only on first write (if_not_exists), now + ttlSeconds', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 1 } });
    await counter().increment('1.2.3.4');
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    const expr = JSON.stringify(input.UpdateExpression) + JSON.stringify(input.ExpressionAttributeValues);
    expect(expr).toMatch(/if_not_exists/);
    // 1_000_000 + 300
    expect(JSON.stringify(input.ExpressionAttributeValues)).toContain('1000300');
  });

  it('CP-H2-B negative: issues ONLY UpdateItem — never Get/Scan/Put/Delete', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 1 } });
    await counter().increment('1.2.3.4');
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});

describe('DdbConnectCounter.increment — failure taxonomy + logging (§41)', () => {
  it('a 5xx-class service error after retry logs EXTERNAL_DEPENDENCY and rethrows', async () => {
    const err = Object.assign(new Error('throughput'), {
      $metadata: { httpStatusCode: 500 },
    });
    ddbMock.on(UpdateCommand).rejects(err);
    await expect(counter().increment('1.2.3.4')).rejects.toThrow();
    const line = logs.find((l) => l.category);
    expect(line?.category).toBe('EXTERNAL_DEPENDENCY');
    expect(line?.buildSha).toBe('abc1234');
  });

  it('a 4xx-class service error logs INTERNAL (our bad request) and rethrows', async () => {
    const err = Object.assign(new Error('validation'), {
      $metadata: { httpStatusCode: 400 },
    });
    ddbMock.on(UpdateCommand).rejects(err);
    await expect(counter().increment('1.2.3.4')).rejects.toThrow();
    const line = logs.find((l) => l.category);
    expect(line?.category).toBe('INTERNAL');
  });
});
