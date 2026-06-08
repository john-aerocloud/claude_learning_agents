import { describe, it, expect } from 'vitest';
import { handleLocalChat } from './chat-handler';
import { LocalGameStore } from './adapters/local-store';
import { LocalRelay } from './adapters/local-relay';

// @covers domain-chat
// @covers ws-chat-handler
//
// UC1 local-parity (delta 011 §5) — the local stand-up's chat orchestration. It
// mirrors the UC1 Lambda handler's flow over the local adapters + the REAL
// domain text bound, so the SPA faces the SAME send→relay→echo contract locally
// that it faces in cloud:
//   1. getGame(gameId) [non-trusted lookup key] — miss → reject (0 posts);
//   2. derive senderRole by matching the SENDER's connectionId (never a body
//      field) — neither slot → reject (0 posts);
//   3. normalise text — empty → reject (0 posts);
//   4. relay chat-message to the OPPONENT + echo to the SENDER (2 posts);
//   5. a relay to a connection with no sink (gone — closed local socket) is
//      best-effort dropped by LocalRelay, NOT retried, and does not crash.

const HOST = 'host-conn';
const GUEST = 'guest-conn';

function seedActive(store: LocalGameStore): void {
  store.seed({
    gameId: 'g-1',
    board: '---------',
    currentTurn: 'X',
    status: 'active',
    version: 0,
    moveCount: 0,
    hostConnectionId: HOST,
    guestConnectionId: GUEST,
  });
}

describe('handleLocalChat — relay + echo (local parity)', () => {
  it('host sends → relay to GUEST + echo to HOST, sender:host, normalised text', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    seedActive(store);
    await handleLocalChat({ connectionId: HOST, gameId: 'g-1', text: '  hi  ' }, { store, relay });
    expect(relay.posts).toHaveLength(2);
    expect(relay.posts[0].connectionIds).toEqual([GUEST]);
    expect(relay.posts[0].message).toEqual({ action: 'chat-message', sender: 'host', text: 'hi' });
    expect(relay.posts[1].connectionIds).toEqual([HOST]);
    expect(relay.posts[1].message).toEqual({ action: 'chat-message', sender: 'host', text: 'hi' });
  });

  it('guest sends → relay to HOST + echo to GUEST, sender:guest', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    seedActive(store);
    await handleLocalChat({ connectionId: GUEST, gameId: 'g-1', text: 'gg' }, { store, relay });
    expect(relay.posts[0].connectionIds).toEqual([HOST]);
    expect(relay.posts[0].message).toMatchObject({ sender: 'guest', text: 'gg' });
  });

  it('a sender bound to neither slot → 0 posts (no cross-game injection)', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    seedActive(store);
    await handleLocalChat({ connectionId: 'stranger', gameId: 'g-1', text: 'hi' }, { store, relay });
    expect(relay.posts).toHaveLength(0);
  });

  it('a getGame miss → 0 posts', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    await handleLocalChat({ connectionId: HOST, gameId: 'ghost', text: 'hi' }, { store, relay });
    expect(relay.posts).toHaveLength(0);
  });

  it('empty-after-trim text → 0 posts', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    seedActive(store);
    await handleLocalChat({ connectionId: HOST, gameId: 'g-1', text: '   ' }, { store, relay });
    expect(relay.posts).toHaveLength(0);
  });

  it('GoneException parity: a gone opponent (no registered sink) is best-effort dropped, echo still delivered, no crash', async () => {
    const store = new LocalGameStore();
    const relay = new LocalRelay();
    seedActive(store);
    // Only the sender (host) has a live sink; the opponent (guest) socket closed.
    const delivered: unknown[] = [];
    relay.register(HOST, (m) => delivered.push(m));
    // GUEST sink intentionally NOT registered (closed local socket = gone).
    await expect(
      handleLocalChat({ connectionId: HOST, gameId: 'g-1', text: 'hi' }, { store, relay }),
    ).resolves.toBeUndefined();
    // Both posts recorded (relay attempted + echo attempted); the host echo was
    // delivered to the live sink; the gone opponent delivery was silently dropped.
    expect(relay.posts).toHaveLength(2);
    expect(delivered).toEqual([{ action: 'chat-message', sender: 'host', text: 'hi' }]);
  });
});
