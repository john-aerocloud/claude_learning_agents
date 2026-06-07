import { describe, it, expect } from 'vitest';
import { LocalConnectionStore } from './local-connection-store';

// @covers port-connection-store
// @covers adapter-local-connection-store
//
// UC1-S1 — the Connections store port is extended with getConnection(connectionId)
// → { gameId, role } | null. The local adapter is an in-memory map substitute
// behind the SAME domain-defined ConnectionStorePort the cloud adapter (UC1-S4)
// implements, so the $disconnect resolve-step (connectionId → gameId) stands up
// locally (principles/02). put/delete round-trip with getConnection.

describe('LocalConnectionStore.getConnection — Connections read seam (S1)', () => {
  it('returns the bound { gameId, role } for a known connectionId', async () => {
    const store = new LocalConnectionStore();
    store.put({ connectionId: 'host-conn', gameId: 'g-1', role: 'host' });
    expect(await store.getConnection('host-conn')).toEqual({
      gameId: 'g-1',
      role: 'host',
    });
  });

  it('returns null for an unknown connectionId (absent row — S1/AC1.4)', async () => {
    const store = new LocalConnectionStore();
    expect(await store.getConnection('nobody')).toBeNull();
  });

  it('a deleted connection is gone (getConnection → null after delete)', async () => {
    const store = new LocalConnectionStore();
    store.put({ connectionId: 'guest-conn', gameId: 'g-1', role: 'guest' });
    await store.deleteConnection('guest-conn');
    expect(await store.getConnection('guest-conn')).toBeNull();
  });
});
