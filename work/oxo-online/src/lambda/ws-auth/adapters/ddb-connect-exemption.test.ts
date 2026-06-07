import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DdbConnectExemption } from './ddb-connect-exemption';

// s007a (DEFECT-S007-001) — per-IP rate-limit exemption READ adapter.
// @covers ws-auth/exemption
//
// Reads the per-run exemption item (PK sourceIp = EXEMPT#<ip>) from
// oxo-connect-attempts. The item is LIVE (exempt = true) iff it exists AND
// ttl > now. DEFECT-H2-003: DynamoDB TTL deletion is LAZY (up to ~48h), so an
// item whose ttl has already passed can still be returned by GetItem; the
// adapter NEVER trusts the lazy delete — it evaluates `ttl > now` itself, the
// same defensive read the counter uses for the window. Fail-closed: any read
// error → not exempt, so the RATE_LIMIT Deny stands (an unavailable exemption
// store never weakens the control).
//
// code<->policy pin (CP-H2-E): this adapter issues ONLY GetItem against the
// connect-attempts table — Update/Put/Delete/Scan/Query are all forbidden by the
// authorizer role (read-only ConnectExemptionRead grant). The pin asserts no
// ungranted command is ever issued.

const ddbMock = mockClient(DynamoDBDocumentClient);

let logs: Array<Record<string, unknown>>;
const captureLog = (l: Record<string, unknown>) => logs.push(l);

const NOW = 1_000_000;

beforeEach(() => {
  ddbMock.reset();
  logs = [];
});

function exemption() {
  return new DdbConnectExemption({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-connect-attempts',
    buildSha: 'abc1234',
    log: captureLog,
  });
}

describe('DdbConnectExemption.isExempt — live / stale / absent branches', () => {
  it('returns TRUE when an item exists and ttl > now (live exemption)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sourceIp: 'EXEMPT#1.2.3.4', ttl: NOW + 1 } });
    const result = await exemption().isExempt('1.2.3.4', NOW);
    expect(result).toBe(true);
  });

  it('GetItems the EXEMPT#<ip> namespaced key (distinct from the counter key <ip>)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sourceIp: 'EXEMPT#1.2.3.4', ttl: NOW + 1 } });
    await exemption().isExempt('1.2.3.4', NOW);
    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('oxo-connect-attempts');
    expect(input.Key).toEqual({ sourceIp: 'EXEMPT#1.2.3.4' });
  });

  it('returns FALSE when no item exists (no exemption written)', async () => {
    ddbMock.on(GetCommand).resolves({}); // no Item
    expect(await exemption().isExempt('1.2.3.4', NOW)).toBe(false);
  });

  // DEFECT-H2-003 lazy-delete defence: an EXPIRED item may still be returned.
  it('returns FALSE for a STALE item whose ttl <= now (lazy-delete defence; never trusts the lazy delete)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sourceIp: 'EXEMPT#1.2.3.4', ttl: NOW } });
    expect(await exemption().isExempt('1.2.3.4', NOW)).toBe(false);
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves({ Item: { sourceIp: 'EXEMPT#1.2.3.4', ttl: NOW - 1 } });
    expect(await exemption().isExempt('1.2.3.4', NOW)).toBe(false);
  });

  it('returns FALSE when the item has no ttl attribute (defensive — treated as not live)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sourceIp: 'EXEMPT#1.2.3.4' } });
    expect(await exemption().isExempt('1.2.3.4', NOW)).toBe(false);
  });
});

describe('DdbConnectExemption.isExempt — fail-closed on read error (§41 taxonomy)', () => {
  it('fail-closed: a 5xx read error → FALSE (RATE_LIMIT Deny stands) and logs EXTERNAL_DEPENDENCY', async () => {
    ddbMock.on(GetCommand).rejects(
      Object.assign(new Error('throttled'), { $metadata: { httpStatusCode: 500 } }),
    );
    expect(await exemption().isExempt('1.2.3.4', NOW)).toBe(false);
    const line = logs.find((l) => l.op === 'ConnectAttempts.isExempt');
    expect(line?.category).toBe('EXTERNAL_DEPENDENCY');
    expect(line?.buildSha).toBe('abc1234');
  });

  it('fail-closed: a 4xx read error → FALSE and logs INTERNAL (our bad request)', async () => {
    ddbMock.on(GetCommand).rejects(
      Object.assign(new Error('bad request'), { $metadata: { httpStatusCode: 400 } }),
    );
    expect(await exemption().isExempt('1.2.3.4', NOW)).toBe(false);
    const line = logs.find((l) => l.op === 'ConnectAttempts.isExempt');
    expect(line?.category).toBe('INTERNAL');
  });
});

describe('DdbConnectExemption — CP-H2-E policy pin (read-only; GetItem only)', () => {
  it('issues ONLY GetItem — never Update/Put/Delete/Scan/Query (ungranted on this read grant)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sourceIp: 'EXEMPT#1.2.3.4', ttl: NOW + 1 } });
    await exemption().isExempt('1.2.3.4', NOW);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});
