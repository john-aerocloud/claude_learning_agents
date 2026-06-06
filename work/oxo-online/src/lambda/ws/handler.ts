import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { handleConnect } from './connect';
import { handleRegister } from './register';
import { handleJoin } from './join';
import type { WsResult } from './ws-result';

/**
 * oxo-ws-fn entry point — dispatches by event.requestContext.routeKey to the
 * four WebSocket routes. There is NO $default route on the API (S3/T7), so an
 * unrecognised routeKey is simply acknowledged without side effects.
 *
 * A handler returns a WsResult; this adapter maps it to the API Gateway proxy
 * response. A requested close is surfaced as the response status code (the
 * customer-facing close message is the handler's reason; the transport that
 * delivers the close frame to the client is wired in the deploy adapter / Set C
 * happy path). No internal error detail is ever placed in the response.
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
    return {
      statusCode: result.statusCode,
      body: JSON.stringify({ code: result.close.code, message: result.close.reason }),
    };
  }
  return { statusCode: result.statusCode };
}
