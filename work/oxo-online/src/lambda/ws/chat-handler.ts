import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import type { GameState, GameStorePort, RelayPort } from '../move/ports';
import type { LogFn } from './adapters/failure';
import { normaliseChatText } from './chat/normalise';

/**
 * chat-handler.ts — UC1 ws-fn `chat` route orchestration (§41 hexagonal, delta
 * 011). The handler imports the DOMAIN text bound (`normaliseChatText`) and the
 * EXISTING domain-defined ports (`GameStorePort.getGame` + `RelayPort`); it
 * holds NO SDK / DynamoDB / @connections concept — those live in the adapters
 * wired at the entry (handler.ts). It is unit-tested with port fakes. There is
 * NO new port and NO new IAM grant (the chat relay + echo are two more
 * PostToConnection calls on the s005 ManageConnections grant; the read is the
 * s006 GetItem on Games).
 *
 * Identity (the s006 invariant, UNCHANGED): the frame is { action:'chat',
 * gameId, text } where `gameId` is a NON-TRUSTED LOOKUP KEY. The handler:
 *   - GetItem(Games, body.gameId) — gameId only chooses WHICH record to read; a
 *     miss is a reject (AC1.4);
 *   - derives `senderRole` ('host'/'guest') by matching the REAL
 *     event.requestContext.connectionId against hostConnectionId /
 *     guestConnectionId — NEVER from any body field; neither slot → reject
 *     silently (AC1.3 — no cross-game injection, T-CHAT-2);
 *   - normalises `text` (trim/empty-reject/200-cap/strip — T-CHAT-4); empty
 *     after normalisation → reject.
 *
 * On accept: relay { action:'chat-message', sender:senderRole, text } to the
 * OPPONENT (1 post), then echo the SAME frame to the SENDER (1 post) = exactly 2
 * posts (T-CHAT-8). NO Games/DynamoDB write of any kind (T-CHAT-6). Relay and
 * echo are issued as INDEPENDENT posts: a GoneException (410) on either is
 * caught, logged (category:external/availability), NOT retried, and does NOT
 * block the other (best-effort, T-CHAT-7). A reject emits 0 posts.
 *
 * Failure taxonomy (§41, logging is tested): every reject logs `chat_rejected`
 * with category:'data' (the caller's problem) + buildSha; the accepted path logs
 * `chat_relayed` with buildSha (principles/01); a gone/failed post logs
 * `chat_post_failed` with category:'external', subcategory:'availability'.
 */

export interface ChatHandlerDeps {
  store: GameStorePort;
  relay: RelayPort;
  buildSha: string;
  log: LogFn;
}

interface ChatFrame {
  gameId?: unknown;
  text?: unknown;
}

type SenderRole = 'host' | 'guest';

/** Derive the sender's chat role from the connection↔game binding, or null. */
function senderRoleFor(game: GameState, connectionId: string): SenderRole | null {
  if (game.hostConnectionId === connectionId) return 'host';
  if (game.guestConnectionId === connectionId) return 'guest';
  return null;
}

export async function handleChat(
  event: APIGatewayProxyWebsocketEventV2,
  deps: ChatHandlerDeps,
): Promise<void> {
  const { store, relay, buildSha, log } = deps;
  const connectionId = event.requestContext.connectionId;

  const reject = (reason: string): void => {
    // Silent reject: no frame to the sender (delta 011 — no error frame), only a
    // structured data-category log line for support metrics.
    log({ event: 'chat_rejected', category: 'data', buildSha, connectionId, reason });
  };

  let frame: ChatFrame;
  try {
    frame = JSON.parse(event.body ?? '{}') as ChatFrame;
  } catch {
    return reject('malformed-frame');
  }

  const gameId = frame.gameId;
  if (typeof gameId !== 'string' || gameId.length === 0) {
    return reject('missing-game-id');
  }

  // 1. Read the game by the NON-TRUSTED lookup key (already-granted GetItem). A
  //    miss is a reject (AC1.4). No write.
  const game = await store.getGame(gameId);
  if (!game) {
    return reject('game-not-found');
  }

  // 2. Identity bind: senderRole derived server-side from the connectionId↔game
  //    binding, NEVER from a client field. Neither slot → reject (AC1.3 — no
  //    cross-game injection).
  const senderRole = senderRoleFor(game, connectionId);
  if (!senderRole) {
    return reject('not-a-player');
  }

  // 3. Server bound (T-CHAT-4). Empty after trim/strip → reject (no relay).
  const text = normaliseChatText(frame.text as string);
  if (text === null) {
    return reject('empty-text');
  }

  // 4. Build the relay frame (sender derived server-side) and the two targets.
  const message = { action: 'chat-message', sender: senderRole, text } as const;
  const opponentId = (
    senderRole === 'host' ? game.guestConnectionId : game.hostConnectionId
  ) as string;

  log({ event: 'chat_relayed', category: 'ok', buildSha, gameId, senderRole });

  // 5. Relay to the OPPONENT then echo to the SENDER — two INDEPENDENT posts
  //    (T-CHAT-8 = exactly 2). A GoneException/any error on either is caught,
  //    logged, NOT retried, and does NOT block the other (T-CHAT-7 best-effort).
  await postBestEffort(relay, opponentId, message, deps);
  await postBestEffort(relay, connectionId, message, deps);
}

/**
 * Post one frame to one connection, swallowing any error (410 Gone / transient)
 * as a logged availability event. NO retry — chat is ephemeral and a retry storm
 * against a dead connection is the failure s007 already ruled out (delta 011 §7).
 */
async function postBestEffort(
  relay: RelayPort,
  connectionId: string,
  message: unknown,
  deps: ChatHandlerDeps,
): Promise<void> {
  try {
    await relay.postToConnections([connectionId], message);
  } catch (err) {
    deps.log({
      event: 'chat_post_failed',
      category: 'external',
      subcategory: 'availability',
      buildSha: deps.buildSha,
      connectionId,
      errorName: (err as { name?: string })?.name,
    });
  }
}
