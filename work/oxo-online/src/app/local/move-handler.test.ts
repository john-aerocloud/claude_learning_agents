import { describe, it, expect } from 'vitest';
import { LocalGameStore } from './adapters/local-store';
import { LocalRelay } from './adapters/local-relay';
import { handleLocalMove } from './move-handler';

// @covers adapter-local-store, adapter-local-relay (class-deps.mmd)
//
// The local move handler orchestrates the SAME flow UC3's Lambda handler does,
// over the local adapters + the REAL domain applyMove: derive senderRole from
// the connection↔game binding (never a client field, S1), apply the domain move,
// write via the CAS store, relay board-update (+ game-over on terminal) to BOTH
// bound connections (S4), or move-rejected to the sender only on a reject.

function freshGame(store: LocalGameStore) {
  store.seed({
    gameId: 'g-1',
    board: '---------',
    currentTurn: 'X',
    status: 'active',
    version: 0,
    moveCount: 0,
    hostConnectionId: 'host-conn', // X
    guestConnectionId: 'guest-conn', // O
  });
}

describe('handleLocalMove — server-authoritative orchestration (UC5)', () => {
  it('accepted in-turn move: writes once and relays board-update to BOTH connections (S4 = 2 posts)', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    freshGame(store);
    await handleLocalMove({ connectionId: 'host-conn', gameId: 'g-1', square: 4 }, { store, relay });
    // Exactly 2 board-update posts (one per bound connection).
    expect(relay.postCount).toBe(2);
    expect(relay.posts[0].message).toMatchObject({
      type: 'board-update',
      board: '----X----',
      currentTurn: 'O',
      status: 'active',
    });
    // The write landed: board mutated, turn flipped, version bumped.
    const g = await store.getGame('g-1');
    expect(g?.board).toBe('----X----');
    expect(g?.currentTurn).toBe('O');
    expect(g?.version).toBe(1);
  });

  it('out-of-turn move: relays exactly 1 move-rejected to the sender, 0 writes (S2)', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    freshGame(store); // X to move
    await handleLocalMove({ connectionId: 'guest-conn', gameId: 'g-1', square: 0 }, { store, relay });
    expect(relay.postCount).toBe(1);
    expect(relay.posts[0].connectionIds).toEqual(['guest-conn']);
    expect(relay.posts[0].message).toMatchObject({ type: 'move-rejected' });
    // DDB byte-unchanged.
    expect((await store.getGame('g-1'))?.board).toBe('---------');
    expect((await store.getGame('g-1'))?.version).toBe(0);
  });

  it('connection bound to no game: 1 move-rejected, 0 writes (S1 wrong-game)', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    freshGame(store);
    await handleLocalMove({ connectionId: 'spectator-conn', gameId: 'g-1', square: 0 }, { store, relay });
    expect(relay.postCount).toBe(1);
    expect(relay.posts[0].connectionIds).toEqual(['spectator-conn']);
    expect(relay.posts[0].message).toMatchObject({ type: 'move-rejected' });
  });

  it('winning move: relays board-update + game-over to BOTH (4 posts), result X-wins (T3/S4)', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    // X has 0,1; O has 3,4; X plays 2 to win the top row.
    store.seed({
      gameId: 'g-1',
      board: 'XX-OO----', // X:0,1 ; O:3,4 ; X plays 2 to win the top row
      currentTurn: 'X',
      status: 'active',
      version: 4,
      moveCount: 4,
      hostConnectionId: 'host-conn',
      guestConnectionId: 'guest-conn',
    });
    await handleLocalMove({ connectionId: 'host-conn', gameId: 'g-1', square: 2 }, { store, relay });
    // 2 board-update deliveries + 2 game-over deliveries = 4 (S4 terminal ceiling).
    expect(relay.postCount).toBe(4);
    const gameOvers = relay.posts.filter(
      (p) => (p.message as { type?: string }).type === 'game-over',
    );
    // One fan-out record addressed to BOTH bound connections.
    expect(gameOvers).toHaveLength(1);
    expect(gameOvers[0].connectionIds).toEqual(['host-conn', 'guest-conn']);
    expect(gameOvers[0].message).toMatchObject({ type: 'game-over', result: 'X-wins' });
    expect((await store.getGame('g-1'))?.status).toBe('won');
  });

  it('draw move: relays game-over result:draw to BOTH (T3)', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    // One square (8) left; placing X there fills the board with no line.
    // X O X / X O O / O X _  -> X at 8 makes no line (draw).
    store.seed({
      gameId: 'g-1',
      board: 'XOXXOOOX-',
      currentTurn: 'X',
      status: 'active',
      version: 8,
      moveCount: 8,
      hostConnectionId: 'host-conn',
      guestConnectionId: 'guest-conn',
    });
    await handleLocalMove({ connectionId: 'host-conn', gameId: 'g-1', square: 8 }, { store, relay });
    const gameOvers = relay.posts.filter(
      (p) => (p.message as { type?: string }).type === 'game-over',
    );
    expect(gameOvers[0].message).toMatchObject({ type: 'game-over', result: 'draw' });
    expect((await store.getGame('g-1'))?.status).toBe('drawn');
  });
});
