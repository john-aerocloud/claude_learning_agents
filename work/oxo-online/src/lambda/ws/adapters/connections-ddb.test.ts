import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DdbConnectionStore } from './connections-ddb';

// @covers adapter-connections-ddb
// @covers port-connection-store
//
// UC1-S4 — the cloud Connections adapter implements ConnectionStorePort over
// DynamoDB GetItem (resolve connectionId→{gameId,role}) + DeleteItem (best-effort
// row removal). Code↔policy pin (§30 / S5): it issues ONLY GetItem + DeleteItem
// against the Connections table — NEVER Query/Scan/Put/Update — so least-privilege
// (the UC2 Connections:GetItem grant) and code cannot silently diverge into a
// prod AccessDenied. connectionId IS the identity (S1): single primary-key read.

const ddbMock = mockClient(DynamoDBDocumentClient);

let logs: Array<Record<string, unknown>>;
beforeEach(() => {
  ddbMock.reset();
  logs = [];
});

function store() {
  return new DdbConnectionStore({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-connections',
    buildSha: 'sha777',
    log: (l) => logs.push(l),
  });
}

describe('DdbConnectionStore.getConnection — resolve connectionId→binding (S1)', () => {
  it('issues a GetItem keyed on connectionId and maps the item to { gameId, role }', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { connectionId: 'host-conn', gameId: 'g-1', role: 'host' },
    });
    const b = await store().getConnection('host-conn');
    expect(b).toEqual({ gameId: 'g-1', role: 'host' });
    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('oxo-connections');
    expect(calls[0].args[0].input.Key).toEqual({ connectionId: 'host-conn' });
  });

  it('returns null when the Connections row is absent (AC1.4)', async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await store().getConnection('ghost')).toBeNull();
  });
});

describe('DdbConnectionStore.deleteConnection — best-effort row delete', () => {
  it('issues a DeleteItem keyed on connectionId', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await store().deleteConnection('host-conn');
    const calls = ddbMock.commandCalls(DeleteCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Key).toEqual({ connectionId: 'host-conn' });
  });
});

describe('DdbConnectionStore — code↔policy pin: ONLY GetItem/DeleteItem on Connections (§30/S5)', () => {
  it('getConnection issues GetItem and NEVER Query/Scan/Put/Update/Delete', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { connectionId: 'c', gameId: 'g', role: 'host' } });
    await store().getConnection('c');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('deleteConnection issues DeleteItem and NEVER Query/Scan/Put/Update', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await store().deleteConnection('c');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe('DdbConnectionStore — failure taxonomy (§41, logging tested)', () => {
  it('a DDB 5xx on getConnection logs EXTERNAL_DEPENDENCY and rethrows (availability)', async () => {
    ddbMock.on(GetCommand).rejects(
      Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }),
    );
    await expect(store().getConnection('c')).rejects.toThrow();
    const line = logs.find((l) => l.event === 'connection_read_failed');
    expect(line?.category).toBe('EXTERNAL_DEPENDENCY');
    expect(line?.buildSha).toBe('sha777');
  });
});
