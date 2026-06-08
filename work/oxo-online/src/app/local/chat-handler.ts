import type { GameState } from '../../lambda/move/ports';
import { normaliseChatText } from '../../lambda/ws/chat/normalise';
import type { LocalGameStore } from './adapters/local-store';
import type { LocalRelay } from './adapters/local-relay';

/**
 * handleLocalChat — the local stand-up's chat orchestration (UC1 local parity,
 * delta 011 §5). It mirrors the UC1 Lambda chat handler's flow over the local
 * adapters + the REAL domain text bound (`normaliseChatText`), so the SPA faces
 * the same send→relay→echo contract locally that it faces in cloud:
 *
 *  1. getGame(gameId) — the body gameId is a NON-TRUSTED lookup key; a miss is a
 *     reject (0 posts).
 *  2. derive senderRole by matching the SENDER's connectionId against the
 *     fetched item's host/guest slot — never a client field; neither slot →
 *     reject (0 posts — no cross-game injection).
 *  3. normalise text (trim/empty-reject/200-cap/strip); empty → reject.
 *  4. relay chat-message to the OPPONENT, then echo to the SENDER — exactly 2
 *     posts. A relay to a connection with no registered sink (a closed local
 *     socket = the GoneException analogue) is best-effort dropped by LocalRelay,
 *     NOT retried, and does not crash the sender path.
 *
 * NO store write of any kind (in-memory / no-persist parity).
 */
export interface LocalChatInput {
  connectionId: string;
  /** The non-trusted lookup key the SPA threads from game-ready. */
  gameId: string;
  text: string;
}

export interface LocalChatDeps {
  store: LocalGameStore;
  relay: LocalRelay;
}

type SenderRole = 'host' | 'guest';

function senderRoleFor(game: GameState, connectionId: string): SenderRole | null {
  if (game.hostConnectionId === connectionId) return 'host';
  if (game.guestConnectionId === connectionId) return 'guest';
  return null;
}

export async function handleLocalChat(
  input: LocalChatInput,
  deps: LocalChatDeps,
): Promise<void> {
  const { store, relay } = deps;

  const game = await store.getGame(input.gameId);
  if (!game) return; // getGame miss → reject (0 posts).

  const senderRole = senderRoleFor(game, input.connectionId);
  if (!senderRole) return; // neither slot → reject (0 posts).

  const text = normaliseChatText(input.text);
  if (text === null) return; // empty after trim/strip → reject (0 posts).

  const message = { action: 'chat-message', sender: senderRole, text } as const;
  const opponentId = (
    senderRole === 'host' ? game.guestConnectionId : game.hostConnectionId
  ) as string;

  // Relay to the OPPONENT then echo to the SENDER — two posts. LocalRelay drops a
  // post to a connection with no sink (gone) best-effort; no retry, no crash.
  await relay.postToConnections([opponentId], message);
  await relay.postToConnections([input.connectionId], message);
}
