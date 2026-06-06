import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { handleConnect } from './connect';
import { handleRegister } from './register';
import { handleJoin } from './join';
import type { WsResult } from './ws-result';
import { deliverClose } from './ws-transport';

/**
 * oxo-ws-fn entry point — dispatches by event.requestContext.routeKey to the
 * four WebSocket routes. There is NO $default route on the API (S3/T7), so an
 * unrecognised routeKey is simply acknowledged without side effects.
 *
 * A handler returns a WsResult; this adapter maps it to the API Gateway proxy
 * response. DEFECT-005-001 Bug B: a requested close is NOT deliverable via the
 * integration response (the platform never turns it into a close frame, and
 * @connections only supports DELETE/1000). The close is therefore delivered to
 * the caller as an error MESSAGE frame followed by a connection DELETE, via the
 * ws-transport adapter. The proxy status code still mirrors the close for
 * API Gateway's own accounting. No internal detail is ever placed in the frame.
 */
export async function handler(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const routeKey = event.requestContext.routeKey;

  let result: WsResult;
  switch (routeKey) {
    case '$connect':
      result = await handleConnect(event);
      break;
    case 'register':
      result = await handleRegister(event);
      break;
    case 'join':
      result = await handleJoin(event);
      break;
    case '$disconnect':
      // Stub this slice (delta — no $disconnect reaping; TTL cleans up).
      result = { statusCode: 200 };
      break;
    default:
      result = { statusCode: 200 };
      break;
  }

  if (result.close) {
    // Deliver the close as an error frame + DELETE (Bug B). The caller's own
    // connectionId is the target; never trust a body-supplied id.
    await deliverClose(event.requestContext.connectionId, result.close);
    return { statusCode: result.statusCode };
  }
  return { statusCode: result.statusCode };
}
