import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { RelayPort } from '../../move/ports';
import type { LogFn } from './failure';

/**
 * relay-mgmt.ts — ADAPTER implementing RelayPort over the API Gateway
 * @connections Management API (§41). The mechanism is REUSED from s005's
 * game-ready fan-out (same role grant — execute-api:ManageConnections scoped to
 * THIS WS API ARN only; CONFIRMED, not widened — S5). One POST per target
 * connection; the handler always passes the TWO bound connectionIds, so this
 * adapter never broadcasts (S4 bounded fan-out).
 *
 * Best-effort relay (R3.8 / OR-S006-b): a failed post to one connection (e.g.
 * 410 GoneException, transient) is LOGGED with a structured availability
 * category and does NOT block the post to the other connection. There is NO
 * per-post application retry (the SDK default retry covers transient 5xx; the
 * authoritative board is already committed in Games). Recovery for a missed
 * push is reconnect-replay in s007.
 */

export interface MgmtRelayDeps {
  client: ApiGatewayManagementApiClient;
  buildSha: string;
  log: LogFn;
}

export class MgmtRelay implements RelayPort {
  constructor(private readonly deps: MgmtRelayDeps) {}

  async postToConnections(connectionIds: string[], message: unknown): Promise<void> {
    const data = Buffer.from(JSON.stringify(message));
    // Best-effort: each post is independent; one failure never aborts the others.
    await Promise.all(
      connectionIds.map(async (connectionId) => {
        try {
          await this.deps.client.send(
            new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }),
          );
        } catch (err) {
          // 410 Gone or transient — log as an availability (external) event and
          // continue. No per-post retry storm; recovery deferred to s007.
          this.deps.log({
            event: 'relay_post_failed',
            category: 'external',
            subcategory: 'availability',
            buildSha: this.deps.buildSha,
            connectionId,
            errorName: (err as { name?: string })?.name,
          });
        }
      }),
    );
  }
}
