import {
  AbandonConditionFailed,
  type ConnectionStorePort,
  type GameStorePort,
  type RelayPort,
} from '../move/ports';
import { decideDisconnect } from './disconnect/decide';
import type { LogFn } from './adapters/failure';

/**
 * disconnect-handler.ts — UC1 $disconnect orchestration (§41 hexagonal). It
 * imports the DOMAIN decision (decideDisconnect) and the three domain-defined
 * ports; it holds NO SDK / DynamoDB / @connections concept (those live in the
 * adapters wired at the entry, handler.ts). Unit-tested with port fakes.
 *
 * Flow (delta §1, order pinned abandon→notify→delete):
 *   1. getConnection(connectionId) — resolve the disconnecting connection's own
 *      gameId (S1: connectionId IS the identity; read from requestContext, never
 *      a body). Absent row → log + delete (no-op) + return (AC1.4).
 *   2. getGame(gameId) — read status + bound connectionIds. Absent → log, skip
 *      abandon/notify, STILL attempt the Connections delete (AC1.5).
 *   3. decideDisconnect — pure short-circuit; only an ACTIVE two-player game whose
 *      disconnector is a bound player is abandoned.
 *   4. abandonGame(gameId) — conditional UpdateItem (status=:active CAS lives on
 *      the store write — S2). On AbandonConditionFailed (not active / racing
 *      second disconnect) → swallow, do NOT notify (AC1.7/T4).
 *   5. notify the ONE survivor — exactly one opponent-disconnected post, ONLY when
 *      the abandon committed (S3 bound=1). GoneException (410) → swallow, 0
 *      retries (S4 — both gone, nobody to tell).
 *   6. deleteConnection(connectionId) — runs in ALL branches (best-effort; the 2h
 *      Connections TTL is the backstop). Delete is LAST (delta order rationale).
 *
 * Structured log (AC1.9 / OI-35 S4 carrier): one disconnect-notify line per
 * invocation with { evt, gameId, posted:1|0, gone:bool, buildSha } — the
 * CloudWatch Logs-Insights count pin (AC4.6) reads it. buildSha is injected by
 * the pipeline (principles/01), never hardcoded.
 */

export interface DisconnectHandlerDeps {
  connections: ConnectionStorePort;
  store: GameStorePort;
  relay: RelayPort;
  buildSha: string;
  log: LogFn;
}

export async function handleDisconnect(
  connectionId: string,
  deps: DisconnectHandlerDeps,
): Promise<void> {
  const { connections, store, relay, buildSha, log } = deps;

  let gameId: string | undefined;
  let posted: 0 | 1 = 0;
  let gone = false;

  try {
    // 1. Resolve the disconnecting connection's OWN binding (S1).
    const binding = await connections.getConnection(connectionId).catch((err) => {
      log({
        event: 'disconnect_connection_read_failed',
        category: 'EXTERNAL_DEPENDENCY',
        buildSha,
        connectionId,
        errorName: (err as { name?: string })?.name,
      });
      return null;
    });

    if (binding) {
      gameId = binding.gameId;
      // 2. Read the game.
      const game = await store.getGame(gameId).catch((err) => {
        log({
          event: 'disconnect_game_read_failed',
          category: 'EXTERNAL_DEPENDENCY',
          buildSha,
          gameId,
          errorName: (err as { name?: string })?.name,
        });
        return null;
      });

      // 3. Pure decision.
      const decision = decideDisconnect(connectionId, game);

      if (decision.abandon) {
        // 4. Conditional abandon (CAS on the store write — S2).
        let committed = false;
        try {
          await store.abandonGame(gameId);
          committed = true;
        } catch (err) {
          if (err instanceof AbandonConditionFailed) {
            // Not active / racing second disconnect — swallow, no notify (AC1.7).
            log({
              event: 'disconnect_abandon_skipped',
              category: 'data',
              buildSha,
              gameId,
              reason: 'condition-failed',
            });
          } else {
            // 5xx after SDK backoff: log availability; the 24h Games TTL reaps an
            // orphaned active game (owned defect signal only if observed — §v30).
            log({
              event: 'disconnect_abandon_failed',
              category: 'EXTERNAL_DEPENDENCY',
              buildSha,
              gameId,
              errorName: (err as { name?: string })?.name,
            });
          }
        }

        // 5. Notify the ONE survivor — only when the abandon actually committed
        //    (S3 amplification bound = 1).
        if (committed && decision.notify && decision.survivorId) {
          try {
            await relay.postToConnections([decision.survivorId], {
              type: 'opponent-disconnected',
            });
            posted = 1;
          } catch (err) {
            // 410 Gone (survivor also gone) → swallow, ZERO retries (S4). The
            // post was attempted exactly once; the game is already abandoned.
            gone = (err as { name?: string })?.name === 'GoneException';
            posted = 1;
            log({
              event: 'disconnect_notify_failed',
              category: 'external',
              subcategory: 'availability',
              buildSha,
              gameId,
              survivorId: decision.survivorId,
              gone,
            });
          }
        }
      }
    }
  } finally {
    // 6. Delete the disconnecting Connections row in ALL branches (best-effort).
    await connections.deleteConnection(connectionId).catch((err) => {
      log({
        event: 'disconnect_delete_failed',
        category: 'EXTERNAL_DEPENDENCY',
        buildSha,
        connectionId,
        errorName: (err as { name?: string })?.name,
      });
    });

    // The OI-35 S4 pin carrier — one line per $disconnect invocation (AC1.9).
    log({ evt: 'disconnect-notify', gameId, posted, gone, buildSha });
  }
}
