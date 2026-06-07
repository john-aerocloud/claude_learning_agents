import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { handleConnect } from './connect';
import { handleRegister } from './register';
import { handleJoin } from './join';
import type { WsResult } from './ws-result';
import { deliverClose } from './ws-transport';
import { handleMove } from './move-handler';
import { handleDisconnect } from './disconnect-handler';
import { ddb } from './ddb';
import { DdbGamesStore } from './adapters/games-ddb';
import { DdbConnectionStore } from './adapters/connections-ddb';
import { MgmtRelay } from './adapters/relay-mgmt';

/** Structured-log sink for the move path (§41 — category-tagged JSON lines). */
const log = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify(line));
};

/** Build sha injected by the pipeline (principles/01) — never hardcoded. */
const BUILD_SHA = process.env.BUILD_SHA ?? 'unknown';

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
    case 'move': {
      // UC3 — wire the real adapters behind the domain-defined ports and run the
      // move orchestration. The move relays directly via @connections (it does
      // NOT use the close-frame path), so it returns a plain 200.
      const store = new DdbGamesStore({
        client: ddb,
        tableName: process.env.GAMES_TABLE as string,
        buildSha: BUILD_SHA,
        log,
      });
      const relay = new MgmtRelay({
        client: new ApiGatewayManagementApiClient({
          endpoint: process.env.WS_API_ENDPOINT,
        }),
        buildSha: BUILD_SHA,
        log,
      });
      await handleMove(event, { store, relay, buildSha: BUILD_SHA, log });
      return { statusCode: 200 };
    }
    case '$disconnect': {
      // UC1 (s007) — the real $disconnect handler: resolve the disconnecting
      // connection's OWN game (S1 — connectionId from requestContext, never a
      // body), conditionally abandon an active game, notify the ONE survivor, and
      // delete the Connections row in all branches. Same adapter wiring shape as
      // the move case, plus the Connections store (UC2 Connections:GetItem grant).
      const store = new DdbGamesStore({
        client: ddb,
        tableName: process.env.GAMES_TABLE as string,
        buildSha: BUILD_SHA,
        log,
      });
      const connections = new DdbConnectionStore({
        client: ddb,
        tableName: process.env.CONNECTIONS_TABLE as string,
        buildSha: BUILD_SHA,
        log,
      });
      const relay = new MgmtRelay({
        client: new ApiGatewayManagementApiClient({
          endpoint: process.env.WS_API_ENDPOINT,
        }),
        buildSha: BUILD_SHA,
        log,
      });
      await handleDisconnect(event.requestContext.connectionId, {
        connections,
        store,
        relay,
        buildSha: BUILD_SHA,
        log,
      });
      return { statusCode: 200 };
    }
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
