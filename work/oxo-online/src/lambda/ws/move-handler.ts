import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { applyMove } from '../move/move';
import {
  MoveConditionFailed,
  type GameState,
  type GameStorePort,
  type RelayPort,
  type Role,
} from '../move/ports';
import type { LogFn } from './adapters/failure';

/**
 * move-handler.ts — UC3 ws-fn move route orchestration (§41 hexagonal). The
 * handler imports the DOMAIN (`applyMove`) and the DOMAIN-defined ports; it
 * holds NO SDK / DynamoDB / @connections concept — those live in the adapters
 * wired at the entry (handler.ts). It is unit-tested with port fakes.
 *
 * Authorization (GATE-AMEND 2026-06-07, apigw-websocket.md S1): the move frame
 * is { action:'move', gameId, square } where `gameId` is a NON-TRUSTED LOOKUP
 * KEY. The handler:
 *   - GetItem(Games, body.gameId) — gameId only chooses WHICH record to read;
 *   - authorizes by matching the REAL event.requestContext.connectionId against
 *     the fetched item's hostConnectionId (role X) / guestConnectionId (role O);
 *   - role is derived SERVER-SIDE from that match — NEVER from a body-supplied
 *     role/connectionId/gameId field.
 * Reject (sender-only move-rejected, ZERO writes) on:
 *   S1b item miss · S1a/S1c connectionId matches neither slot (forged/foreign
 *   gameId, spectator, stale).
 *
 * On accept: applyMoveWrite (single conditional UpdateItem CAS), then relay a
 * board-update to BOTH bound connections (exactly 2 — S4), plus a game-over to
 * both on a terminal move (4). A reject relays exactly 1 move-rejected to the
 * sender and writes nothing. A version-CAS race (MoveConditionFailed) gets ONE
 * bounded re-read + re-evaluate, then reject (reject-over-retry; §5a, OR-S006-a).
 *
 * Failure taxonomy (§41, logging is tested): every reject logs a structured line
 * with `category:'data'` (4xx-class, the caller's problem) + `buildSha`. The
 * accepted path also logs `buildSha` (principles/01 — a relayed move is
 * attributable to a code version).
 */

export interface MoveHandlerDeps {
  store: GameStorePort;
  relay: RelayPort;
  buildSha: string;
  log: LogFn;
}

interface MoveFrame {
  square?: unknown;
  gameId?: unknown;
}

/** Domain win/draw result → the server `game-over` result string. */
function resultFor(winner: Role | undefined): 'X-wins' | 'O-wins' | 'draw' {
  if (winner === 'X') return 'X-wins';
  if (winner === 'O') return 'O-wins';
  return 'draw';
}

/**
 * Derive the sender's role from the connection↔game binding (S1): X if the real
 * connectionId is the host slot, O if it is the guest slot, else null (the
 * sender is not a player of this game — forged/foreign gameId, spectator, stale).
 */
function roleFor(game: GameState, connectionId: string): Role | null {
  if (game.hostConnectionId === connectionId) return 'X';
  if (game.guestConnectionId === connectionId) return 'O';
  return null;
}

export async function handleMove(
  event: APIGatewayProxyWebsocketEventV2,
  deps: MoveHandlerDeps,
): Promise<void> {
  const { store, relay, buildSha, log } = deps;
  const connectionId = event.requestContext.connectionId;

  const reject = async (reason: string): Promise<void> => {
    log({ event: 'move_rejected', category: 'data', buildSha, connectionId, reason });
    await relay.postToConnections([connectionId], { type: 'move-rejected', reason });
  };

  let frame: MoveFrame;
  try {
    frame = JSON.parse(event.body ?? '{}') as MoveFrame;
  } catch {
    return reject('malformed-frame');
  }

  const square = frame.square;
  const gameId = frame.gameId;
  if (typeof gameId !== 'string' || gameId.length === 0) {
    return reject('missing-game-id');
  }
  if (typeof square !== 'number') {
    return reject('invalid-square');
  }

  // 1. Read the game by the NON-TRUSTED lookup key. S1b: a miss is a reject.
  const game = await store.getGame(gameId);
  if (!game) {
    return reject('game-not-found');
  }

  // 2. Identity bind (S1a/S1c): role derived server-side from the connectionId↔
  //    game binding, NEVER from a client field. Neither slot → reject.
  const role = roleFor(game, connectionId);
  if (!role) {
    return reject('not-a-player');
  }

  // 3. Pure domain move (out-of-turn / taken / post-terminal all reject here).
  const outcome = applyMove(game.board, game.currentTurn, square, role, game.status);
  if (!outcome.accepted) {
    return reject('illegal-move');
  }

  // 4. CAS write. On a version race, ONE bounded re-read + re-evaluate, then
  //    reject (reject-over-retry; the board in Games is authoritative either way).
  const patchFor = (g: GameState, o: typeof outcome) => ({
    gameId: g.gameId,
    expectedVersion: g.version,
    expectedTurn: g.currentTurn,
    patch: {
      board: o.newBoard as string,
      nextTurn: o.nextTurn as Role,
      ...(o.terminal
        ? { status: (o.winner ? 'won' : 'drawn') as GameState['status'], ...(o.winner ? { winner: o.winner } : {}) }
        : {}),
    },
  });

  try {
    await store.applyMoveWrite(patchFor(game, outcome));
  } catch (err) {
    if (err instanceof MoveConditionFailed) {
      // ONE bounded re-read (no jittered loop — protects p95, OR-S006-a).
      const fresh = await store.getGame(gameId);
      if (!fresh) return reject('game-not-found');
      const freshRole = roleFor(fresh, connectionId);
      if (!freshRole) return reject('not-a-player');
      const retryOutcome = applyMove(fresh.board, fresh.currentTurn, square, freshRole, fresh.status);
      if (!retryOutcome.accepted) {
        return reject('version-conflict');
      }
      try {
        await store.applyMoveWrite(patchFor(fresh, retryOutcome));
        return relayAccepted(deps, fresh.gameId, fresh, retryOutcome);
      } catch (err2) {
        if (err2 instanceof MoveConditionFailed) {
          return reject('version-conflict');
        }
        throw err2;
      }
    }
    throw err;
  }

  // 5. Relay the accepted move to BOTH bound connections (S4).
  return relayAccepted(deps, game.gameId, game, outcome);
}

/** Fan the accepted move out to the two bound connections (exactly 2; +2 terminal). */
async function relayAccepted(
  deps: MoveHandlerDeps,
  gameId: string,
  game: GameState,
  outcome: ReturnType<typeof applyMove>,
): Promise<void> {
  const { relay, buildSha, log } = deps;
  const both = [game.hostConnectionId as string, game.guestConnectionId as string];
  const status: GameState['status'] = outcome.terminal ? (outcome.winner ? 'won' : 'drawn') : 'active';

  log({
    event: 'move_accepted',
    category: 'ok',
    buildSha,
    gameId,
    terminal: outcome.terminal,
  });

  await relay.postToConnections(both, {
    type: 'board-update',
    board: outcome.newBoard,
    currentTurn: outcome.nextTurn,
    status,
  });
  if (outcome.terminal) {
    await relay.postToConnections(both, {
      type: 'game-over',
      result: resultFor(outcome.winner),
    });
  }
}
