import { describe, it, expect, beforeEach } from 'vitest';
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

// S-A2.5 [S4, CP-H2-B] — per-IP counter adapter over DynamoDB.
//
// DEFECT-H2-003: DynamoDB TTL deletion is LAZY (up to ~48h), so an item whose
// `ttl` has already passed still physically exists. The old single-write
// `ADD count + if_not_exists(ttl)` kept incrementing that stale count forever,
// so once an IP crossed the threshold it was blocked INDEFINITELY past its
// window. The window must SELF-HEAL: a connect arriving after `ttl <= now` is
// the start of a FRESH window (count resets to 1, ttl refreshed).
//
// Shape: UpdateItem ADD count+1 / set first-write ttl, conditioned on
// `attribute_not_exists(ttl) OR ttl > :now`. On ConditionalCheckFailed (window
// expired) overwrite with PutItem count=1 + fresh ttl. Both UpdateItem and
// PutItem are GRANTED on ConnectAttempts (CP-H2-B / infra ConnectAttemptsWrite),
// so the policy pin admits both — Get/Scan/Delete remain forbidden.

const ddbMock = mockClient(DynamoDBDocumentClient);

let logs: Array<Record<string, unknown>>;
const captureLog = (l: Record<string, unknown>) => logs.push(l);

const NOW = 1_000_000;

beforeEach(() => {
  ddbMock.reset();
  logs = [];
});

function counter() {
  return new DdbConnectCounter({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-connect-attempts',
    ttlSeconds: 300,
    now: () => NOW,
    buildSha: 'abc1234',
    log: captureLog,
  });
}

/** A DynamoDB ConditionalCheckFailedException-shaped error. */
function conditionalCheckFailed() {
  return Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
    $metadata: { httpStatusCode: 400 },
  });
}

describe('DdbConnectCounter.increment — live window: ADD count + first-write TTL', () => {
  it('issues a conditional UpdateItem keyed on sourceIp, ADD count 1, returns the new count', async () => {
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
    const expr =
      JSON.stringify(input.UpdateExpression) +
      JSON.stringify(input.ExpressionAttributeValues);
    expect(expr).toMatch(/if_not_exists/);
    // 1_000_000 + 300
    expect(JSON.stringify(input.ExpressionAttributeValues)).toContain('1000300');
  });

  it('guards the increment with a condition that the window is still live (ttl > now OR no ttl yet)', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 2 } });
    await counter().increment('1.2.3.4');
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ConditionExpression).toBeDefined();
    const cond = String(input.ConditionExpression);
    expect(cond).toMatch(/attribute_not_exists/);
    expect(cond).toMatch(/>/); // ttl > :now
    // :now is bound to the current clock so expiry is judged server-side.
    expect(JSON.stringify(input.ExpressionAttributeValues)).toContain(
      String(NOW),
    );
  });
});

// DEFECT-H2-003 — RED: the expired-window self-heal.
describe('DdbConnectCounter.increment — expired window self-heals (DEFECT-H2-003)', () => {
  it('on ConditionalCheckFailed (ttl <= now) overwrites the item to count=1 with a fresh ttl and returns 1', async () => {
    // First the conditional UpdateItem fails — the stored ttl has passed.
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    // Then the adapter resets the window with a Put.
    ddbMock.on(PutCommand).resolves({});

    const n = await counter().increment('88.97.176.116');

    // Fresh window: count back to 1 (this connect is the 1st of the new window).
    expect(n).toBe(1);

    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(1);
    const item = puts[0].args[0].input.Item as Record<string, unknown>;
    expect(item.sourceIp).toBe('88.97.176.116');
    expect(item.count).toBe(1);
    expect(item.ttl).toBe(NOW + 300); // fresh ttl, not the stale one
  });

  it('does NOT treat the expired-window reset as a failure — no EXTERNAL/INTERNAL category logged', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock.on(PutCommand).resolves({});
    await counter().increment('88.97.176.116');
    // Conditional reset is normal control flow, not a taxonomy failure.
    expect(logs.find((l) => l.category)).toBeUndefined();
  });

  it('an UNEXPIRED over-threshold window is unchanged: UpdateItem succeeds, returns the (still high) count, no reset Put', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 29 } });
    const n = await counter().increment('88.97.176.116');
    expect(n).toBe(29); // still high -> domain Denies; window not yet expired
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('first-ever attempt is unchanged: UpdateItem creates the item, returns 1, no reset Put', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 1 } });
    const n = await counter().increment('9.9.9.9');
    expect(n).toBe(1);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe('DdbConnectCounter.increment — CP-H2-B policy pin (granted actions only)', () => {
  it('live-window path issues ONLY UpdateItem — no Get/Scan/Put/Delete', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 1 } });
    await counter().increment('1.2.3.4');
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('reset path issues ONLY UpdateItem + PutItem (both granted) — never Get/Scan/Delete (ungranted)', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock.on(PutCommand).resolves({});
    await counter().increment('88.97.176.116');
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
    // The reset Put guards itself so a racing live increment is never clobbered.
    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.TableName).toBe('oxo-connect-attempts');
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

  it('a 4xx-class service error (not the conditional check) logs INTERNAL and rethrows', async () => {
    const err = Object.assign(new Error('validation'), {
      name: 'ValidationException',
      $metadata: { httpStatusCode: 400 },
    });
    ddbMock.on(UpdateCommand).rejects(err);
    await expect(counter().increment('1.2.3.4')).rejects.toThrow();
    const line = logs.find((l) => l.category);
    expect(line?.category).toBe('INTERNAL');
  });

  it('a 5xx on the reset Put after an expired-window logs EXTERNAL_DEPENDENCY and rethrows', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    const putErr = Object.assign(new Error('throughput'), {
      $metadata: { httpStatusCode: 500 },
    });
    ddbMock.on(PutCommand).rejects(putErr);
    await expect(counter().increment('88.97.176.116')).rejects.toThrow();
    const line = logs.find((l) => l.category);
    expect(line?.category).toBe('EXTERNAL_DEPENDENCY');
  });
});
