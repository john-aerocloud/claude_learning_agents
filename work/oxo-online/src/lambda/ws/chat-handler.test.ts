import { describe, it, expect } from 'vitest';
import { handleChat, type ChatHandlerDeps } from './chat-handler';
import type {
  GameState,
  GameStorePort,
  RelayPort,
  Role,
} from '../move/ports';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

// @covers chat-handler
// @covers domain-chat
// @covers wsfn
//
// UC1 — ws-fn `chat` route handler (delta 011). Orchestrates the in-game chat
// relay over the EXISTING domain-defined ports (GameStorePort.getGame +
// RelayPort.postToConnections — NO new port, NO new grant):
//   1. parse { action:'chat', gameId, text } — gameId is a NON-TRUSTED lookup
//      key; identity is NEVER read from the body.
//   2. getGame(gameId); a miss → reject silently, ZERO posts, ZERO writes
//      (T-CHAT-2 / AC1.4).
//   3. match the REAL event.requestContext.connectionId against the item's
//      host/guest slot → senderRole. Neither slot → reject silently, ZERO posts,
//      ZERO writes (T-CHAT-2 / AC1.3 — no cross-game injection).
//   4. normalise text (trim/empty-reject/200-cap/strip) — empty → reject, 0 posts.
//   5. relay { action:'chat-message', sender:senderRole, text } to the OPPONENT
//      (1 post), then echo the SAME frame to the SENDER (1 post) — exactly 2
//      posts on accept (T-CHAT-8 / AC1.6).
//   6. a GoneException on relay is caught + does NOT block the echo; both-gone is
//      also caught (T-CHAT-7 / AC1.7, AC1.8). NO retry.
//   7. ZERO DynamoDB writes on any path (T-CHAT-6 / AC1.9).

const HOST = 'host-conn'; // sender role 'host'
const GUEST = 'guest-conn'; // sender role 'guest'

/** A GameStorePort fake that records every write attempt (must stay empty). */
class FakeStore implements GameStorePort {
  reads: string[] = [];
  writes: string[] = [];
  constructor(private game: GameState | null) {}
  async getGame(gameId: string): Promise<GameState | null> {
    this.reads.push(gameId);
    return this.game ? { ...this.game } : null;
  }
  async applyMoveWrite(): Promise<void> {
    this.writes.push('applyMoveWrite');
  }
  async abandonGame(): Promise<void> {
    this.writes.push('abandonGame');
  }
}

/** Records each post as a separate call (the handler issues relay then echo). */
class FakeRelay implements RelayPort {
  posts: Array<{ connectionIds: string[]; message: unknown }> = [];
  async postToConnections(connectionIds: string[], message: unknown): Promise<void> {
    this.posts.push({ connectionIds, message });
  }
}

/** A relay that throws GoneException-like errors for the named connectionIds. */
class GoneRelay implements RelayPort {
  posts: Array<{ connectionIds: string[]; message: unknown }> = [];
  constructor(private goneFor: Set<string>) {}
  async postToConnections(connectionIds: string[], message: unknown): Promise<void> {
    this.posts.push({ connectionIds, message });
    if (connectionIds.some((id) => this.goneFor.has(id))) {
      const err = new Error('gone') as Error & { name: string };
      err.name = 'GoneException';
      throw err;
    }
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

function chatEvent(connectionId: string, body: unknown): APIGatewayProxyWebsocketEventV2 {
  return {
    requestContext: { connectionId, routeKey: 'chat' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  } as unknown as APIGatewayProxyWebsocketEventV2;
}

function deps(store: GameStorePort, relay: RelayPort, log: ChatHandlerDeps['log'] = () => {}): ChatHandlerDeps {
  return { store, relay, buildSha: 'test-sha', log };
}

describe('handleChat — accepted chat: relay to opponent + echo to sender (T-CHAT-8 / AC1.6)', () => {
  it('host sends → exactly 2 posts: relay to GUEST + echo to HOST, sender:host', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay));
    expect(relay.posts).toHaveLength(2);
    // First post is the relay to the OPPONENT (guest).
    expect(relay.posts[0].connectionIds).toEqual([GUEST]);
    expect(relay.posts[0].message).toEqual({ action: 'chat-message', sender: 'host', text: 'hi' });
    // Second post is the echo to the SENDER (host) — SAME frame.
    expect(relay.posts[1].connectionIds).toEqual([HOST]);
    expect(relay.posts[1].message).toEqual({ action: 'chat-message', sender: 'host', text: 'hi' });
  });

  it('guest sends → relay to HOST + echo to GUEST, sender:guest (derived server-side)', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(GUEST, { action: 'chat', gameId: 'g-1', text: 'gg' }), deps(store, relay));
    expect(relay.posts).toHaveLength(2);
    expect(relay.posts[0].connectionIds).toEqual([HOST]);
    expect(relay.posts[0].message).toMatchObject({ sender: 'guest', text: 'gg' });
    expect(relay.posts[1].connectionIds).toEqual([GUEST]);
  });

  it('senderRole is NEVER read from the body (a forged sender field is ignored)', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(
      chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi', sender: 'guest' }),
      deps(store, relay),
    );
    expect(relay.posts[0].message).toMatchObject({ sender: 'host' });
  });

  it('relays the NORMALISED text (trim + strip), never the raw text', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(
      chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: '  <b>hey</b>  ' }),
      deps(store, relay),
    );
    const text = (relay.posts[0].message as { text: string }).text;
    expect(text).not.toMatch(/[<>&"']/);
    expect(text).toContain('bhey');
  });

  it('uses gameId from the body ONLY as the getGame key', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay));
    expect(store.reads[0]).toBe('g-1');
  });

  it('performs ZERO DynamoDB writes on the accepted path (T-CHAT-6 / AC1.9)', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay));
    expect(store.writes).toEqual([]);
  });
});

describe('handleChat — identity reject: no cross-game injection (T-CHAT-2 / T-CHAT-8 / AC1.3, AC1.4)', () => {
  it('AC1.3: connectionId matches NEITHER slot → ZERO posts, ZERO writes, no throw', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(
      chatEvent('stranger-conn', { action: 'chat', gameId: 'g-1', text: 'hi' }),
      deps(store, relay),
    );
    expect(relay.posts).toHaveLength(0);
    expect(store.writes).toEqual([]);
  });

  it('AC1.4: non-existent gameId (getGame miss) → ZERO posts, ZERO writes', async () => {
    const store = new FakeStore(null);
    const relay = new FakeRelay();
    await handleChat(
      chatEvent(HOST, { action: 'chat', gameId: 'ghost', text: 'hi' }),
      deps(store, relay),
    );
    expect(relay.posts).toHaveLength(0);
    expect(store.writes).toEqual([]);
  });

  it('empty-after-trim text → ZERO posts (server bound reject), ZERO writes', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: '   ' }), deps(store, relay));
    expect(relay.posts).toHaveLength(0);
    expect(store.writes).toEqual([]);
  });

  it('text that is empty AFTER markup strip → ZERO posts', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: '<>&' }), deps(store, relay));
    expect(relay.posts).toHaveLength(0);
  });

  it('missing/blank gameId → ZERO posts, ZERO writes', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(HOST, { action: 'chat', text: 'hi' }), deps(store, relay));
    expect(relay.posts).toHaveLength(0);
    expect(store.writes).toEqual([]);
  });

  it('malformed frame (bad JSON) → ZERO posts, ZERO writes, no throw', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    await handleChat(chatEvent(HOST, 'not-json{'), deps(store, relay));
    expect(relay.posts).toHaveLength(0);
    expect(store.writes).toEqual([]);
  });
});

describe('handleChat — GoneException best-effort (T-CHAT-7 / AC1.7, AC1.8)', () => {
  it('AC1.7: relay to gone opponent throws → caught, NO retry, echo still attempted, returns success', async () => {
    const store = new FakeStore(activeGame());
    const relay = new GoneRelay(new Set([GUEST]));
    await expect(
      handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay)),
    ).resolves.toBeUndefined();
    // Both posts were ATTEMPTED (relay + echo); the relay threw but did not block
    // the echo, and there was NO retry (relay attempted exactly once).
    expect(relay.posts).toHaveLength(2);
    expect(relay.posts[0].connectionIds).toEqual([GUEST]);
    expect(relay.posts[1].connectionIds).toEqual([HOST]);
    expect(store.writes).toEqual([]);
  });

  it('AC1.8: BOTH relay and echo throw GoneException → both caught, returns success, no retry', async () => {
    const store = new FakeStore(activeGame());
    const relay = new GoneRelay(new Set([HOST, GUEST]));
    await expect(
      handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay)),
    ).resolves.toBeUndefined();
    expect(relay.posts).toHaveLength(2);
  });
});

describe('handleChat — structured logging (§41, logging is tested)', () => {
  it('logs an accepted line with buildSha + the gameId on the happy path', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    const lines: Array<Record<string, unknown>> = [];
    await handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay, (l) => lines.push(l)));
    const accepted = lines.find((l) => l.event === 'chat_relayed');
    expect(accepted).toBeDefined();
    expect(accepted).toMatchObject({ buildSha: 'test-sha', senderRole: 'host' });
  });

  it('logs a reject line with category:data + buildSha on an identity reject', async () => {
    const store = new FakeStore(activeGame());
    const relay = new FakeRelay();
    const lines: Array<Record<string, unknown>> = [];
    await handleChat(chatEvent('stranger-conn', { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay, (l) => lines.push(l)));
    const reject = lines.find((l) => l.event === 'chat_rejected');
    expect(reject).toMatchObject({ category: 'data', buildSha: 'test-sha' });
  });

  it('logs a gone line with category:external/availability when a post throws', async () => {
    const store = new FakeStore(activeGame());
    const relay = new GoneRelay(new Set([GUEST]));
    const lines: Array<Record<string, unknown>> = [];
    await handleChat(chatEvent(HOST, { action: 'chat', gameId: 'g-1', text: 'hi' }), deps(store, relay, (l) => lines.push(l)));
    const gone = lines.find((l) => l.event === 'chat_post_failed');
    expect(gone).toMatchObject({ category: 'external', subcategory: 'availability' });
  });
});
