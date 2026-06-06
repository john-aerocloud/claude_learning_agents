import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { WsClose } from './ws-result';

/**
 * WebSocket close-delivery adapter (Cockburn port impl, §41).
 *
 * DEFECT-005-001 Bug B — platform fact: an API Gateway WebSocket Lambda
 * integration RESPONSE never becomes a client-visible close frame, and the
 * @connections management API offers only DELETE (which closes with the generic
 * 1000). Custom close codes (4040/4041/4500) are therefore UNDELIVERABLE as
 * close frames. The error contract instead travels as a normal MESSAGE frame:
 *
 *     { type: 'error', code: <4040|4041|4500>, message: '<customer text>' }
 *
 * posted to the caller's connection, after which the connection is DELETEd. The
 * close CODE survives as a PAYLOAD value; the human-readable message is the same
 * text the F-cases pin. No internal detail is ever placed in the frame (S3).
 */

/** The error frame the SPA consumes. Codes stay as payload values (S3). */
export interface WsErrorFrame {
  type: 'error';
  code: WsClose['code'];
  message: string;
}

function client(): ApiGatewayManagementApiClient {
  return new ApiGatewayManagementApiClient({
    endpoint: process.env.WS_API_ENDPOINT,
  });
}

/**
 * Deliver a requested close to a single connection: POST the error frame, then
 * DELETE the connection. The DELETE is always attempted, even if the POST fails
 * (e.g. the client already vanished — GoneException), so a dead connection is
 * still reaped. No exception propagates to the caller.
 */
export async function deliverClose(
  connectionId: string,
  close: WsClose,
): Promise<void> {
  const c = client();
  const frame: WsErrorFrame = {
    type: 'error',
    code: close.code,
    message: close.reason,
  };

  try {
    await c.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(frame)),
      }),
    );
  } catch {
    // The connection may already be gone; the DELETE below still runs. The
    // caught error is not surfaced (S3 — no leakage).
    console.warn(
      JSON.stringify({
        event: 'ws_error_frame_post_failed',
        category: 'external',
        closeCode: close.code,
      }),
    );
  }

  try {
    await c.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
  } catch {
    // Connection already gone — nothing more to do.
  }
}
