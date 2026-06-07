import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { MgmtRelay } from './relay-mgmt';

// @covers adapter-relay-mgmt
// @covers port-relay
//
// UC3 — RelayPort over the @connections Management API (mechanism reused from
// s005; grant CONFIRMED not widened). One POST per target connection. S4:
// the handler passes the TWO bound connectionIds — this adapter never
// broadcasts. R3.8 best-effort relay: a failed/410-Gone post to one connection
// is LOGGED (structured category) and does NOT block the post to the other; no
// per-post retry (recovery deferred to s007 — OR-S006-b).

const mgmtMock = mockClient(ApiGatewayManagementApiClient);

let logs: Array<Record<string, unknown>>;
const captureLog = (l: Record<string, unknown>) => logs.push(l);

beforeEach(() => {
  mgmtMock.reset();
  logs = [];
});

function relay() {
  return new MgmtRelay({
    client: mgmtMock as unknown as ApiGatewayManagementApiClient,
    buildSha: 'abc1234',
    log: captureLog,
  });
}

describe('MgmtRelay — one POST per bound connection (S4)', () => {
  it('posts the message to EACH connectionId exactly once', async () => {
    mgmtMock.on(PostToConnectionCommand).resolves({});
    await relay().postToConnections(['host-conn', 'guest-conn'], { type: 'board-update' });
    const calls = mgmtMock.commandCalls(PostToConnectionCommand);
    expect(calls).toHaveLength(2);
    const ids = calls.map((c) => c.args[0].input.ConnectionId);
    expect(ids).toEqual(['host-conn', 'guest-conn']);
  });

  it('serialises the message as JSON in the Data buffer', async () => {
    mgmtMock.on(PostToConnectionCommand).resolves({});
    await relay().postToConnections(['c1'], { type: 'move-rejected', reason: 'illegal-move' });
    const call = mgmtMock.commandCalls(PostToConnectionCommand)[0];
    const data = Buffer.from(call.args[0].input.Data as Uint8Array).toString();
    expect(JSON.parse(data)).toEqual({ type: 'move-rejected', reason: 'illegal-move' });
  });
});

describe('MgmtRelay — best-effort relay (R3.8 / S4 / OR-S006-b)', () => {
  it('a GoneException on one connection is logged and does NOT block the other', async () => {
    mgmtMock
      .on(PostToConnectionCommand, { ConnectionId: 'gone-conn' })
      .rejects(Object.assign(new Error('gone'), { name: 'GoneException' }));
    mgmtMock.on(PostToConnectionCommand, { ConnectionId: 'live-conn' }).resolves({});

    await relay().postToConnections(['gone-conn', 'live-conn'], { type: 'board-update' });

    // The live connection still received its post (no per-post retry storm,
    // no throw that would abort the fan-out).
    const live = mgmtMock
      .commandCalls(PostToConnectionCommand)
      .filter((c) => c.args[0].input.ConnectionId === 'live-conn');
    expect(live).toHaveLength(1);

    // The 410 is logged distinctly as an availability/external category.
    const goneLog = logs.find((l) => l.event === 'relay_post_failed');
    expect(goneLog).toBeDefined();
    expect(goneLog?.category).toBe('external');
    expect(goneLog?.buildSha).toBe('abc1234');
    expect(goneLog?.connectionId).toBe('gone-conn');
  });
});
