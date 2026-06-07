import { describe, it, expect } from 'vitest';
import { LocalGameStore } from './adapters/local-store';
import { LocalRelay } from './adapters/local-relay';
import { LocalConnectionStore } from './adapters/local-connection-store';
import { handleLocalDisconnect } from './disconnect-handler';

// @covers wsDisconnectHandler
// @covers adapter-local-connection-store
//
// UC1-S6 — the local stand-up's $disconnect orchestration mirrors the cloud
// handler's flow over the local adapters + the SAME pure decideDisconnect domain
// (local/cloud parity behind the same ports, §41 / principles/02). On a host or
// guest close of an ACTIVE local game, the local relay records exactly ONE
// opponent-disconnected post to the survivor and the game flips to abandoned;
// terminal/waiting → 0 posts. The Connections row is deleted in all branches.

function activeGame(store: LocalGameStore) {
  store.seed({
    gameId: 'g-1',
    board: '----X----',
    currentTurn: 'O',
    status: 'active',
    version: 1,
    moveCount: 1,
    hostConnectionId: 'host-conn',
    guestConnectionId: 'guest-conn',
  });
}

function bind(conn: LocalConnectionStore) {
  conn.put({ connectionId: 'host-conn', gameId: 'g-1', role: 'host' });
  conn.put({ connectionId: 'guest-conn', gameId: 'g-1', role: 'guest' });
}

describe('handleLocalDisconnect — active game survivor notify (UC1-S6 parity)', () => {
  it('host close: exactly 1 opponent-disconnected to the guest survivor; game abandoned; row deleted', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    const conn = new LocalConnectionStore();
    activeGame(store);
    bind(conn);

    await handleLocalDisconnect('host-conn', { connections: conn, store, relay });

    expect(relay.posts).toHaveLength(1);
    expect(relay.posts[0].connectionIds).toEqual(['guest-conn']);
    expect(relay.posts[0].message).toEqual({ type: 'opponent-disconnected' });
    expect((await store.getGame('g-1'))?.status).toBe('abandoned');
    expect(await conn.getConnection('host-conn')).toBeNull();
  });

  it('guest close: exactly 1 opponent-disconnected to the host survivor', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    const conn = new LocalConnectionStore();
    activeGame(store);
    bind(conn);

    await handleLocalDisconnect('guest-conn', { connections: conn, store, relay });

    expect(relay.posts).toHaveLength(1);
    expect(relay.posts[0].connectionIds).toEqual(['host-conn']);
  });
});

describe('handleLocalDisconnect — terminal / waiting → 0 posts (T4/T5 parity)', () => {
  it('terminal (won) close: 0 posts, status unchanged, row deleted', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    const conn = new LocalConnectionStore();
    store.seed({
      gameId: 'g-1',
      board: 'XXX------',
      currentTurn: 'O',
      status: 'won',
      version: 5,
      moveCount: 5,
      hostConnectionId: 'host-conn',
      guestConnectionId: 'guest-conn',
    });
    bind(conn);

    await handleLocalDisconnect('host-conn', { connections: conn, store, relay });

    expect(relay.posts).toHaveLength(0);
    expect((await store.getGame('g-1'))?.status).toBe('won');
    expect(await conn.getConnection('host-conn')).toBeNull();
  });

  it('waiting host (no guest): 0 posts, status stays waiting, row deleted', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    const conn = new LocalConnectionStore();
    store.seed({
      gameId: 'g-1',
      board: '---------',
      currentTurn: 'X',
      status: 'waiting',
      version: 0,
      moveCount: 0,
      hostConnectionId: 'host-conn',
    });
    conn.put({ connectionId: 'host-conn', gameId: 'g-1', role: 'host' });

    await handleLocalDisconnect('host-conn', { connections: conn, store, relay });

    expect(relay.posts).toHaveLength(0);
    expect((await store.getGame('g-1'))?.status).toBe('waiting');
    expect(await conn.getConnection('host-conn')).toBeNull();
  });
});
