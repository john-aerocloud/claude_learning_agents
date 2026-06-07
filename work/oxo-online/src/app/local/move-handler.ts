import { applyMove } from '../../lambda/move/move';
import { MoveConditionFailed, type GameState, type Role } from '../../lambda/move/ports';
import type { LocalGameStore } from './adapters/local-store';
import type { LocalRelay } from './adapters/local-relay';

/**
 * handleLocalMove — the local stand-up's server-authoritative move orchestration
 * (UC5). It mirrors the UC3 Lambda handler's flow over the local adapters + the
 * REAL domain `applyMove`, so the SPA faces the same move-relay contract locally
 * that it will face in cloud (GATE-AMEND 2026-06-07):
 *
 *  1. Read the game by the body `gameId` (a NON-TRUSTED lookup key) via the
 *     store port — getGame(gameId), the SAME contract the cloud handler uses.
 *     A miss is a reject (S1b).
 *  2. Derive `senderRole` SERVER-SIDE by matching the SENDER's connectionId
 *     against the fetched item's host(X)/guest(O) slot — never a client field
 *     (S1). A connectionId matching neither slot is rejected (S1a forged/foreign
 *     gameId, S1c spectator/stale).
 *  3. Run the pure domain `applyMove`. A reject (out-of-turn / taken / terminal)
 *     → exactly 1 `move-rejected` to the sender, 0 writes (S2/S4).
 *  4. On accept, write via the CAS store. A CAS reject (concurrent race) →
 *     1 `move-rejected`, 0 net writes (S6 reject-over-retry).
 *  5. On a committed write, relay `board-update` to BOTH bound connections
 *     (S4 = 2 posts), plus `game-over` to both on a terminal move (4 posts).
 */
export interface LocalMoveInput {
  connectionId: string;
  /** GATE-AMEND: the non-trusted lookup key the SPA threads from game-ready. */
  gameId: string;
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

/** Derive the sender's role from the connectionId↔game binding (S1), or null. */
function roleFor(game: GameState, connectionId: string): Role | null {
  if (game.hostConnectionId === connectionId) return 'X';
  if (game.guestConnectionId === connectionId) return 'O';
  return null;
}

export async function handleLocalMove(
  input: LocalMoveInput,
  deps: LocalMoveDeps,
): Promise<void> {
  const { store, relay } = deps;

  // 1. Read the game by the non-trusted lookup key (getGame-by-id — the SAME
  //    contract the cloud handler uses; GATE-AMEND). A miss is a reject (S1b).
  const game = await store.getGame(input.gameId);
  if (!game) {
    await relay.postToConnections([input.connectionId], {
      type: 'move-rejected',
      reason: 'game-not-found',
    });
    return;
  }

  // 2. Identity bind (S1): role derived server-side from the connectionId↔game
  //    binding, never a client field. Neither slot → reject the sender only
  //    (S1a forged/foreign gameId, S1c spectator/stale).
  const role = roleFor(game, input.connectionId);
  if (!role) {
    await relay.postToConnections([input.connectionId], {
      type: 'move-rejected',
      reason: 'not-a-player',
    });
    return;
  }

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
