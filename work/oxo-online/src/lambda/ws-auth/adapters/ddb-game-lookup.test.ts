import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DdbGameLookup } from './ddb-game-lookup';

// S-A2.6 [CP-H2-A] — guest code lookup over the code-index GSI. Query only
// (no Scan, no write). Maps the item → { status } or null. Logging asserted.

const ddbMock = mockClient(DynamoDBDocumentClient);

let logs: Array<Record<string, unknown>>;
const captureLog = (l: Record<string, unknown>) => logs.push(l);

beforeEach(() => {
  ddbMock.reset();
  logs = [];
});

function lookup() {
  return new DdbGameLookup({
    client: ddbMock as unknown as DynamoDBDocumentClient,
    tableName: 'oxo-games',
    indexName: 'code-index',
    buildSha: 'abc1234',
    log: captureLog,
  });
}

describe('DdbGameLookup.findByCode — Query on code-index GSI only', () => {
  it('queries the code-index GSI by code and maps the item → { status }', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ code: 'ABC123', status: 'waiting' }] });
    const game = await lookup().findByCode('ABC123');
    expect(game).toEqual({ status: 'waiting' });
    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('oxo-games');
    expect(input.IndexName).toBe('code-index');
  });

  it('returns null when no game has that code', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    expect(await lookup().findByCode('NOPE00')).toBeNull();
  });

  it('CP-H2-A negative: issues ONLY Query — never Scan/Update/Put/Delete', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ status: 'waiting' }] });
    await lookup().findByCode('ABC123');
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});

describe('DdbGameLookup.findByCode — failure taxonomy + logging (§41)', () => {
  it('a 5xx after retry logs EXTERNAL_DEPENDENCY and rethrows', async () => {
    ddbMock.on(QueryCommand).rejects(
      Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }),
    );
    await expect(lookup().findByCode('ABC123')).rejects.toThrow();
    const line = logs.find((l) => l.category);
    expect(line?.category).toBe('EXTERNAL_DEPENDENCY');
    expect(line?.buildSha).toBe('abc1234');
  });
});
