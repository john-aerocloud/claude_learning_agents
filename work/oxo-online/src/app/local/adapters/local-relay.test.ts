import { describe, it, expect, vi } from 'vitest';
import { LocalRelay } from './local-relay';

// @covers adapter-local-relay (class-deps.mmd)
//
// The local relay implements ENG-1's RelayPort. It RECORDS every post (so the
// "exactly 2 posts on an accepted non-terminal move / 1 on a reject" assertions
// run locally — S4) AND forwards each post to a per-connection sink so the local
// WS server can push the frame to the right browser.

describe('LocalRelay — RelayPort (UC5, S4 amplification bound)', () => {
  it('records each post with its target connectionIds and message', async () => {
    const relay = new LocalRelay();
    await relay.postToConnections(['host-conn', 'guest-conn'], {
      type: 'board-update',
      board: 'X--------',
      currentTurn: 'O',
      status: 'active',
    });
    expect(relay.posts).toHaveLength(1);
    expect(relay.posts[0].connectionIds).toEqual(['host-conn', 'guest-conn']);
    expect(relay.postCount).toBe(2); // one delivery per bound connection (S4)
  });

  it('a non-terminal accepted move relays to exactly 2 connections (S4 bound)', async () => {
    const relay = new LocalRelay();
    await relay.postToConnections(['host-conn', 'guest-conn'], { type: 'board-update' });
    expect(relay.postCount).toBe(2);
  });

  it('a reject relays to exactly 1 connection (the sender)', async () => {
    const relay = new LocalRelay();
    await relay.postToConnections(['guest-conn'], { type: 'move-rejected' });
    expect(relay.postCount).toBe(1);
  });

  it('forwards each post to the registered per-connection sink', async () => {
    const relay = new LocalRelay();
    const hostSink = vi.fn();
    const guestSink = vi.fn();
    relay.register('host-conn', hostSink);
    relay.register('guest-conn', guestSink);
    const frame = { type: 'board-update', board: 'X--------' };
    await relay.postToConnections(['host-conn', 'guest-conn'], frame);
    expect(hostSink).toHaveBeenCalledWith(frame);
    expect(guestSink).toHaveBeenCalledWith(frame);
  });

  it('a post to an unknown connection is recorded but silently dropped (best-effort, S4)', async () => {
    const relay = new LocalRelay();
    await relay.postToConnections(['gone-conn'], { type: 'board-update' });
    expect(relay.postCount).toBe(1); // recorded; no sink registered → dropped
  });
});
