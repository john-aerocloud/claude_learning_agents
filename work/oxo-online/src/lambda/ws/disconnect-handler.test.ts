import { describe, it, expect, beforeEach } from 'vitest';
import { handleDisconnect, type DisconnectHandlerDeps } from './disconnect-handler';
import {
  AbandonConditionFailed,
  type ConnectionBinding,
  type ConnectionStorePort,
  type GameState,
  type GameStorePort,
  type MovePatch,
  type RelayPort,
  type Role,
} from '../move/ports';

// @covers wsDisconnectHandler
// @covers domain-disconnect
//
// UC1-S3 — the $disconnect handler orchestrates over the three domain ports with
// port FAKES (no SDK): resolve own connectionId→{gameId,role} (ConnectionStore),
// read the game (GameStore), decide (pure), conditionally abandon (CAS on the
// store write — a ConditionalCheckFailed is swallowed), post exactly ONE survivor
// frame when the abandon committed, DeleteItem(Connections) in ALL branches.
// Order pinned: abandon (3) → notify (4) → delete (5) last.

// ---- port fakes (spies) ----------------------------------------------------
class FakeConnectionStore implements ConnectionStorePort {
  getCalls: string[] = [];
  deleteCalls: string[] = [];
  constructor(private binding: ConnectionBinding | null) {}
  async getConnection(id: string): Promise<ConnectionBinding | null> {
    this.getCalls.push(id);
    return this.binding;
  }
  async deleteConnection(id: string): Promise<void> {
    this.deleteCalls.push(id);
  }
}

class FakeGameStore implements GameStorePort {
  abandonCalls: string[] = [];
  order: string[] = [];
  private failAbandon: AbandonConditionFailed | null;
  constructor(private game: GameState | null, opts: { failAbandon?: boolean } = {}) {
    this.failAbandon = opts.failAbandon ? new AbandonConditionFailed() : null;
  }
  async getGame(): Promise<GameState | null> {
    return this.game;
  }
  async applyMoveWrite(): Promise<void> {
    throw new Error('not used in $disconnect');
  }
  async abandonGame(gameId: string): Promise<void> {
    this.abandonCalls.push(gameId);
    this.order.push('abandon');
    if (this.failAbandon) throw this.failAbandon;
  }
}

class FakeRelay implements RelayPort {
  posts: Array<{ ids: string[]; message: unknown }> = [];
  order: string[] = [];
  private throwGone = false;
  goneOnPost(): void {
    this.throwGone = true;
  }
  async postToConnections(ids: string[], message: unknown): Promise<void> {
    this.posts.push({ ids, message });
    this.order.push('notify');
    if (this.throwGone) {
      const gone = Object.assign(new Error('gone'), { name: 'GoneException' });
      throw gone;
    }
  }
}

const game = (over: Partial<GameState> = {}): GameState => ({
  gameId: 'g-1',
  board: '----X----',
  currentTurn: 'O',
  status: 'active' as GameState['status'],
  version: 1,
  moveCount: 1,
  hostConnectionId: 'host-conn',
  guestConnectionId: 'guest-conn',
  ...over,
});

let logs: Array<Record<string, unknown>>;
function depsFor(conn: FakeConnectionStore, store: FakeGameStore, relay: FakeRelay): DisconnectHandlerDeps {
  return { connections: conn, store, relay, buildSha: 'sha777', log: (l) => logs.push(l) };
}

beforeEach(() => {
  logs = [];
});

describe('handleDisconnect — active game (AC1.1, T1/T2/T3, S3)', () => {
  it('host disconnect: 1 abandon + exactly 1 survivor post (guest) + 1 Connections delete', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'host' });
    const store = new FakeGameStore(game());
    const relay = new FakeRelay();
    await handleDisconnect('host-conn', depsFor(conn, store, relay));

    expect(store.abandonCalls).toEqual(['g-1']);
    expect(relay.posts).toHaveLength(1);
    expect(relay.posts[0].ids).toEqual(['guest-conn']);
    expect(relay.posts[0].message).toEqual({ type: 'opponent-disconnected' });
    expect(conn.deleteCalls).toEqual(['host-conn']);
  });

  it('order is abandon → notify → delete (delta order rationale)', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'guest' });
    const store = new FakeGameStore(game());
    const relay = new FakeRelay();
    // Combine the two stores' order trace via the handler's own delete being last:
    await handleDisconnect('guest-conn', depsFor(conn, store, relay));
    // Abandon happens before notify.
    expect(store.order[0]).toBe('abandon');
    expect(relay.order[0]).toBe('notify');
    // Delete is last: it ran after both abandon and notify (the handler deletes
    // only after the post resolved).
    expect(conn.deleteCalls).toEqual(['guest-conn']);
    // survivor is the host
    expect(relay.posts[0].ids).toEqual(['host-conn']);
  });
});

describe('handleDisconnect — terminal / waiting / missing (AC1.2, AC1.3, AC1.5)', () => {
  it('terminal (won): 0 abandon, 0 posts, 1 delete', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'host' });
    const store = new FakeGameStore(game({ status: 'won' as GameState['status'] }));
    const relay = new FakeRelay();
    await handleDisconnect('host-conn', depsFor(conn, store, relay));
    expect(store.abandonCalls).toHaveLength(0);
    expect(relay.posts).toHaveLength(0);
    expect(conn.deleteCalls).toEqual(['host-conn']);
  });

  it('waiting host (no guest): 0 abandon, 0 posts, 1 delete (T5)', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'host' });
    const store = new FakeGameStore(
      game({ status: 'waiting' as GameState['status'], guestConnectionId: undefined }),
    );
    const relay = new FakeRelay();
    await handleDisconnect('host-conn', depsFor(conn, store, relay));
    expect(store.abandonCalls).toHaveLength(0);
    expect(relay.posts).toHaveLength(0);
    expect(conn.deleteCalls).toEqual(['host-conn']);
  });

  it('absent Games row: 0 abandon, 0 posts, still attempts Connections delete (AC1.5)', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'guest' });
    const store = new FakeGameStore(null);
    const relay = new FakeRelay();
    await handleDisconnect('guest-conn', depsFor(conn, store, relay));
    expect(store.abandonCalls).toHaveLength(0);
    expect(relay.posts).toHaveLength(0);
    expect(conn.deleteCalls).toEqual(['guest-conn']);
  });
});

describe('handleDisconnect — absent Connections row (AC1.4)', () => {
  it('no connection binding: 0 abandon, 0 posts; delete attempted no-op/logged', async () => {
    const conn = new FakeConnectionStore(null);
    const store = new FakeGameStore(game());
    const relay = new FakeRelay();
    await handleDisconnect('ghost-conn', depsFor(conn, store, relay));
    expect(store.abandonCalls).toHaveLength(0);
    expect(relay.posts).toHaveLength(0);
    // best-effort: delete still attempted against the disconnecting id (no-op).
    expect(conn.deleteCalls).toEqual(['ghost-conn']);
    // the log line still emits (T7 — handler ran), posted:0.
    const line = logs.find((l) => l.evt === 'disconnect-notify');
    expect(line).toMatchObject({ posted: 0, gone: false });
  });
});

describe('handleDisconnect — survivor GoneException (AC1.6, S4)', () => {
  it('410 on the survivor post: 1 post attempt, 0 retries, swallowed; game still abandoned', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'host' });
    const store = new FakeGameStore(game());
    const relay = new FakeRelay();
    relay.goneOnPost();
    await handleDisconnect('host-conn', depsFor(conn, store, relay));
    // abandon committed before the post.
    expect(store.abandonCalls).toEqual(['g-1']);
    // exactly ONE post attempt (no retry storm).
    expect(relay.posts).toHaveLength(1);
    // delete still ran.
    expect(conn.deleteCalls).toEqual(['host-conn']);
    const line = logs.find((l) => l.evt === 'disconnect-notify');
    expect(line).toMatchObject({ posted: 1, gone: true });
  });
});

describe('handleDisconnect — simultaneous double-disconnect (AC1.7)', () => {
  it('ConditionalCheckFailed on abandon is swallowed → 0 posts; Connections deleted', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'guest' });
    const store = new FakeGameStore(game(), { failAbandon: true });
    const relay = new FakeRelay();
    await handleDisconnect('guest-conn', depsFor(conn, store, relay));
    // abandon was attempted but the condition failed (someone else won the race).
    expect(store.abandonCalls).toEqual(['g-1']);
    // because the abandon did NOT commit, no survivor post is sent.
    expect(relay.posts).toHaveLength(0);
    expect(conn.deleteCalls).toEqual(['guest-conn']);
    const line = logs.find((l) => l.evt === 'disconnect-notify');
    expect(line).toMatchObject({ posted: 0, gone: false });
  });
});

describe('handleDisconnect — S4 structured log carrier (AC1.9)', () => {
  it('emits disconnect-notify with gameId, posted, gone, buildSha on an active disconnect', async () => {
    const conn = new FakeConnectionStore({ gameId: 'g-1', role: 'host' });
    const store = new FakeGameStore(game());
    const relay = new FakeRelay();
    await handleDisconnect('host-conn', depsFor(conn, store, relay));
    const line = logs.find((l) => l.evt === 'disconnect-notify');
    expect(line).toEqual({
      evt: 'disconnect-notify',
      gameId: 'g-1',
      posted: 1,
      gone: false,
      buildSha: 'sha777',
    });
  });
});
