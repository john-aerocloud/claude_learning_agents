import { describe, it, expect } from 'vitest';
import { handleMove, type MoveHandlerDeps } from './move-handler';
import {
  MoveConditionFailed,
  type GameState,
  type GameStorePort,
  type RelayPort,
  type Role,
} from '../move/ports';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

// @covers ws-move-handler
// @covers wsfn
//
// UC3 — ws-fn move route handler. Orchestrates the server-authoritative move:
//   1. parse { action:'move', gameId, square } — gameId is a NON-TRUSTED lookup
//      key (GATE-AMEND 2026-06-07); identity is NEVER read from the body.
//   2. getGame(gameId); authorize by matching the REAL
//      event.requestContext.connectionId against the item's host/guest slot —
//      role = whichever slot matches.
//   3. reject (sender-only, ZERO writes) on: item miss (S1b), neither slot
//      matches (S1a forged/foreign gameId, S1c spectator/stale).
//   4. run the pure domain applyMove; reject (1 sender post, 0 writes) on a
//      domain reject (out-of-turn S2, taken, post-terminal).
//   5. on accept, applyMoveWrite (CAS), then relay board-update to BOTH bound
//      connections (exactly 2 posts; +2 game-over on terminal = 4; S4).
//   6. on MoveConditionFailed (version race): ONE bounded re-read; still
//      illegal → 1 move-rejected, 0 net writes.
//   7. taxonomy logging + buildSha on every path.

const HOST = 'host-conn'; // X
const GUEST = 'guest-conn'; // O

/** A recording GameStorePort fake that reproduces the CAS branch. */
class FakeStore implements GameStorePort {
  writes: Array<{ gameId: string; expectedVersion: number; expectedTurn: Role }> = [];
  reads: string[] = [];
  // queue of CAS outcomes: when an entry is true the next applyMoveWrite throws.
  failNextWrite = false;
  constructor(private game: GameState | null) {}
  setGame(g: GameState | null) {
    this.game = g;
  }
  async getGame(gameId: string): Promise<GameState | null> {
    this.reads.push(gameId);
    return this.game ? { ...this.game } : null;
  }
  async applyMoveWrite(args: {
    gameId: string;
    expectedVersion: number;
    expectedTurn: Role;
    patch: { board: string; nextTurn: Role; status?: GameState['status']; winner?: Role };
  }): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new MoveConditionFailed();
    }
    this.writes.push({
      gameId: args.gameId,
      expectedVersion: args.expectedVersion,
      expectedTurn: args.expectedTurn,
    });
    if (this.game) {
      this.game = {
        ...this.game,
        board: args.patch.board,
        currentTurn: args.patch.nextTurn,
        version: this.game.version + 1,
        moveCount: this.game.moveCount + 1,
        ...(args.patch.status ? { status: args.patch.status } : {}),
      };
    }
  }
}

class FakeRelay implements RelayPort {
  posts: Array<{ connectionIds: string[]; message: unknown }> = [];
  async postToConnections(connectionIds: string[], message: unknown): Promise<void> {
    this.posts.push({ connectionIds, message });
  }
}

function activeGame(over: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g-1',
    board: '---------',
    currentTurn: 'X',
    status: 'active',
    version: 0,
    moveCount: 0,
    hostConnectionId: HOST,
    guestConnectionId: GUEST,
    ...over,
  };
}

function moveEvent(connectionId: string, body: unknown): APIGatewayProxyWebsocketEventV2 {
  return {
    requestContext: { connectionId, routeKey: 'move' },
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyWebsocketEventV2;
}

function deps(store: GameStorePort, relay: RelayPort): MoveHandlerDeps {
  return { store, relay, buildSha: 'test-sha', log: () => {} };
}

describe('handleMove — accepted in-turn move (AC3.1 / T1 / S4)', () => {
  it('writes once and relays board-update to BOTH connections (exactly 2 posts)', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleMove(moveEvent(HOST, { action: 'move', gameId: 'g-1', square: 4 }), deps(store, relay));
    expect(store.writes).toHaveLength(1);
    expect(relay.posts).toHaveLength(1); // one fan-out record addressed to both
    expect(relay.posts[0].connectionIds).toEqual([HOST, GUEST]);
    expect(relay.posts[0].message).toMatchObject({
      type: 'board-update',
      board: '----X----',
      currentTurn: 'O',
      status: 'active',
    });
  });

  it('uses the gameId from the body ONLY as the getGame key (not for identity)', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleMove(moveEvent(HOST, { action: 'move', gameId: 'g-1', square: 0 }), deps(store, relay));
    expect(store.reads[0]).toBe('g-1');
  });
});

describe('handleMove — identity binding by connectionId, never the body (S1)', () => {
  it('S1a forged/foreign gameId: real connectionId matches neither slot → reject, ZERO writes', async () => {
    // Valid game exists, but the sender is NOT one of its bound connections.
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleMove(
      moveEvent('stranger-conn', { action: 'move', gameId: 'g-1', square: 0 }),
      deps(store, relay),
    );
    expect(store.writes).toHaveLength(0);
    expect(relay.posts).toHaveLength(1);
    expect(relay.posts[0].connectionIds).toEqual(['stranger-conn']);
    expect(relay.posts[0].message).toMatchObject({ type: 'move-rejected' });
  });

  it('S1b non-existent gameId: getGame miss → reject, ZERO writes', async () => {
    const store = new FakeStore(null);
    const relay = new FakeRelay();
    await handleMove(
      moveEvent(HOST, { action: 'move', gameId: 'nope', square: 0 }),
      deps(store, relay),
    );
    expect(store.writes).toHaveLength(0);
    expect(relay.posts).toHaveLength(1);
    expect(relay.posts[0].connectionIds).toEqual([HOST]);
    expect(relay.posts[0].message).toMatchObject({ type: 'move-rejected' });
  });

  it('never derives role from a body-supplied role/connectionId field', async () => {
    // The body claims to be the guest (O) and even forges a connectionId, but the
    // REAL connectionId is the host (X) and it is X's turn → accepted as X.
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleMove(
      moveEvent(HOST, {
        action: 'move',
        gameId: 'g-1',
        square: 4,
        role: 'O',
        connectionId: GUEST,
      }),
      deps(store, relay),
    );
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0].expectedTurn).toBe('X');
    expect(relay.posts[0].message).toMatchObject({ board: '----X----' });
  });
});

describe('handleMove — domain rejects: 1 sender post, 0 writes (S2)', () => {
  it('out-of-turn (guest plays on X-turn) → 1 move-rejected to sender, 0 writes', async () => {
    const store = new FakeStore(activeGame()); // X to move
    const relay = new FakeRelay();
    await handleMove(moveEvent(GUEST, { action: 'move', gameId: 'g-1', square: 0 }), deps(store, relay));
    expect(store.writes).toHaveLength(0);
    expect(relay.posts).toHaveLength(1);
    expect(relay.posts[0].connectionIds).toEqual([GUEST]);
    expect(relay.posts[0].message).toMatchObject({ type: 'move-rejected' });
  });

  it('square taken → 1 move-rejected, 0 writes', async () => {
    const store = new FakeStore(activeGame({ board: 'X--------', currentTurn: 'O', version: 1, moveCount: 1 }));
    const relay = new FakeRelay();
    await handleMove(moveEvent(GUEST, { action: 'move', gameId: 'g-1', square: 0 }), deps(store, relay));
    expect(store.writes).toHaveLength(0);
    expect(relay.posts[0].message).toMatchObject({ type: 'move-rejected' });
  });
});

describe('handleMove — terminal move (AC3.2 / T3 / S4)', () => {
  it('winning move relays board-update + game-over to BOTH (4 deliveries)', async () => {
    const store = new FakeStore(
      activeGame({ board: 'XX-OO----', currentTurn: 'X', version: 4, moveCount: 4 }),
    );
    const relay = new FakeRelay();
    await handleMove(moveEvent(HOST, { action: 'move', gameId: 'g-1', square: 2 }), deps(store, relay));
    expect(store.writes).toHaveLength(1);
    // 2 records (board-update to both, game-over to both); each addressed to both.
    expect(relay.posts).toHaveLength(2);
    const over = relay.posts.find((p) => (p.message as { type?: string }).type === 'game-over');
    expect(over?.connectionIds).toEqual([HOST, GUEST]);
    expect(over?.message).toMatchObject({ type: 'game-over', result: 'X-wins' });
  });
});

describe('handleMove — version race (AC3.5 / S6): ONE bounded re-read then reject', () => {
  it('CAS fails, re-read still illegal → 1 move-rejected, 0 net writes', async () => {
    // First write throws MoveConditionFailed; the re-read returns a game whose
    // turn has moved on (so the same move is now out-of-turn) → reject.
    const store = new FakeStore(activeGame());
    store.failNextWrite = true;
    const relay = new FakeRelay();
    // Make the re-read return a game where it is now O's turn (move no longer legal).
    const original = store.getGame.bind(store);
    let call = 0;
    store.getGame = async (gameId: string) => {
      call += 1;
      if (call === 1) return original(gameId);
      return { ...activeGame({ currentTurn: 'O', version: 1, moveCount: 1, board: '----X----' }) };
    };
    await handleMove(moveEvent(HOST, { action: 'move', gameId: 'g-1', square: 0 }), deps(store, relay));
    expect(store.writes).toHaveLength(0);
    const rejects = relay.posts.filter((p) => (p.message as { type?: string }).type === 'move-rejected');
    expect(rejects).toHaveLength(1);
    expect(rejects[0].connectionIds).toEqual([HOST]);
  });
});

describe('handleMove — taxonomy logging + buildSha (AC3.8 / §41)', () => {
  it('emits a structured log with buildSha and a category on a reject path', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    const lines: Record<string, unknown>[] = [];
    await handleMove(
      moveEvent('stranger-conn', { action: 'move', gameId: 'g-1', square: 0 }),
      { store, relay, buildSha: 'sha-123', log: (l) => lines.push(l) },
    );
    const reject = lines.find((l) => l.category === 'data');
    expect(reject).toBeDefined();
    expect(reject?.buildSha).toBe('sha-123');
  });

  it('emits buildSha on the accepted path too', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    const lines: Record<string, unknown>[] = [];
    await handleMove(
      moveEvent(HOST, { action: 'move', gameId: 'g-1', square: 4 }),
      { store, relay, buildSha: 'sha-xyz', log: (l) => lines.push(l) },
    );
    expect(lines.some((l) => l.buildSha === 'sha-xyz')).toBe(true);
  });
});

describe('handleMove — malformed inbound frame (data 4xx-class)', () => {
  it('non-numeric/out-of-range square → 1 move-rejected, 0 writes', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleMove(moveEvent(HOST, { action: 'move', gameId: 'g-1', square: 99 }), deps(store, relay));
    expect(store.writes).toHaveLength(0);
    expect(relay.posts[0].message).toMatchObject({ type: 'move-rejected' });
  });
});
