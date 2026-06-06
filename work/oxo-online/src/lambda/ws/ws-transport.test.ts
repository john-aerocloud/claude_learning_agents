import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { deliverClose } from './ws-transport';
import type { WsClose } from './ws-result';

const apiMock = mockClient(ApiGatewayManagementApiClient);

const CLOSE_4041: WsClose = {
  code: 4041,
  reason: 'This game is no longer available.',
};

beforeEach(() => {
  apiMock.reset();
  apiMock.on(PostToConnectionCommand).resolves({});
  apiMock.on(DeleteConnectionCommand).resolves({});
  process.env.WS_API_ENDPOINT = 'https://ws.example.com/prod';
});

afterEach(() => {
  vi.useRealTimers();
});

// DEFECT-005-001-R2 (Issue 2, SERVER half) — error-frame-then-close ORDERING.
//
// deliverClose POSTs the error frame, then DELETEs the connection. The DELETE
// closes the socket; at the browser the close event can otherwise beat the
// in-flight message event, so the generic "Something went wrong" renders
// instead of the specific 4040/4041 text. This is a genuine async-delivery
// ordering concern (NOT a §39 designed-impossible order), so the adapter waits
// a brief DRAIN interval between the POST and the DELETE to let the frame land
// before the socket is torn down. The client holds its own grace window too —
// each half is defensible alone.
describe('deliverClose — drains the error frame before DELETE (Issue 2 server half)', () => {
  it('POSTs the error frame, then waits a drain interval, then DELETEs', async () => {
    vi.useFakeTimers();

    const promise = deliverClose('CTX-ID', CLOSE_4041);

    // Let the POST (and its awaited microtasks) settle without advancing the
    // drain timer. The frame is posted; the DELETE is held back.
    await vi.advanceTimersByTimeAsync(0);
    expect(apiMock.commandCalls(PostToConnectionCommand)).toHaveLength(1);
    expect(apiMock.commandCalls(DeleteConnectionCommand)).toHaveLength(0);

    // After the drain interval elapses the DELETE fires.
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(apiMock.commandCalls(DeleteConnectionCommand)).toHaveLength(1);
    expect(
      apiMock.commandCalls(DeleteConnectionCommand)[0].args[0].input.ConnectionId,
    ).toBe('CTX-ID');
  });

  it('still DELETEs after the drain even when the POST throws (GoneException)', async () => {
    vi.useFakeTimers();
    const gone = new Error('connection gone');
    (gone as { name: string }).name = 'GoneException';
    apiMock.on(PostToConnectionCommand).rejects(gone);

    const promise = deliverClose('CTX-ID', CLOSE_4041);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBeUndefined();
    expect(apiMock.commandCalls(DeleteConnectionCommand)).toHaveLength(1);
  });
});
