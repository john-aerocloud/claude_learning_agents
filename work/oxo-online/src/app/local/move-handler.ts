import { applyMove } from '../../lambda/move/move';
import { MoveConditionFailed, type GameState, type Role } from '../../lambda/move/ports';
import type { LocalGameStore } from './adapters/local-store';
import type { LocalRelay } from './adapters/local-relay';

/**
 * handleLocalMove — the local stand-up's server-authoritative move orchestration
 * (UC5). It mirrors the UC3 Lambda handler's flow over the local adapters + the
 * REAL domain `applyMove`, so the SPA faces the same move-relay contract locally
 * that it will face in cloud:
 *
 *  1. Derive the game from the SENDER's connectionId (the connection↔game
 *     binding) — never from a client field (S1). A connection bound to no game,
 *     or whose role is neither host(X) nor guest(O) of this game, is rejected.
 *  2. Run the pure domain `applyMove`. A reject (out-of-turn / taken / terminal)
 *     → exactly 1 `move-rejected` to the sender, 0 writes (S2/S4).
 *  3. On accept, write via the CAS store. A CAS reject (concurrent race) →
 *     1 `move-rejected`, 0 net writes (S6 reject-over-retry).
 *  4. On a committed write, relay `board-update` to BOTH bound connections
 *     (S4 = 2 posts), plus `game-over` to both on a terminal move (4 posts).
 */
export interface LocalMoveInput {
  connectionId: string;
  square: number;
}

export interface LocalMoveDeps {
  store: LocalGameStore;
  relay: LocalRelay;
}

/** Domain win/draw result → the server `game-over` result string. */
function resultFor(winner: Role | undefined): 'X-wins' | 'O-wins' | 'draw' {
  if (winner === 'X') return 'X-wins';
  if (winner === 'O') return 'O-wins';
  return 'draw';
}

/** Find the game this connection is bound to, scanning the local store. */
async function findGameByConnection(
  store: LocalGameStore,
  connectionId: string,
): Promise<{ game: GameState; role: Role } | null> {
  // The local store does not index by connection; the stand-up holds one active
  // game at a time, so a direct membership check on the known ids is honest.
  for (const gameId of ['g-1']) {
    const game = await store.getGame(gameId);
    if (!game) continue;
    if (game.hostConnectionId === connectionId) return { game, role: 'X' };
    if (game.guestConnectionId === connectionId) return { game, role: 'O' };
  }
  return null;
}

export async function handleLocalMove(
  input: LocalMoveInput,
  deps: LocalMoveDeps,
): Promise<void> {
  const { store, relay } = deps;

  // 1. Identity bind (S1): role derived server-side from the connection↔game
  //    binding, never a client field. No binding → reject the sender only.
  const bound = await findGameByConnection(store, input.connectionId);
  if (!bound) {
    await relay.postToConnections([input.connectionId], {
      type: 'move-rejected',
      reason: 'not-a-player',
    });
    return;
  }
  const { game, role } = bound;

  // 2. Pure domain move.
  const outcome = applyMove(game.board, game.currentTurn, input.square, role, game.status);
  if (!outcome.accepted) {
    await relay.postToConnections([input.connectionId], {
      type: 'move-rejected',
      reason: 'illegal-move',
    });
    return;
  }

  // 3. CAS write. A failed condition (concurrent race) → reject the sender.
  try {
    await store.applyMoveWrite({
      gameId: game.gameId,
      expectedVersion: game.version,
      expectedTurn: game.currentTurn,
      patch: {
        board: outcome.newBoard as string,
        nextTurn: outcome.nextTurn as Role,
        ...(outcome.terminal
          ? { status: outcome.winner ? 'won' : 'drawn', ...(outcome.winner ? { winner: outcome.winner } : {}) }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof MoveConditionFailed) {
      await relay.postToConnections([input.connectionId], {
        type: 'move-rejected',
        reason: 'version-conflict',
      });
      return;
    }
    throw err;
  }

  // 4. Relay to BOTH bound connections (S4). One board-update each; plus one
  //    game-over each on a terminal move.
  const both = [game.hostConnectionId as string, game.guestConnectionId as string];
  const updated = await store.getGame(game.gameId);
  await relay.postToConnections(both, {
    type: 'board-update',
    board: outcome.newBoard,
    currentTurn: outcome.nextTurn,
    status: updated?.status ?? 'active',
  });
  if (outcome.terminal) {
    await relay.postToConnections(both, {
      type: 'game-over',
      result: resultFor(outcome.winner),
    });
  }
}
