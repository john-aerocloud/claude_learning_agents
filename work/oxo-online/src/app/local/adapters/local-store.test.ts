import { describe, it, expect } from 'vitest';
import { LocalGameStore } from './local-store';
import { MoveConditionFailed } from '../../../lambda/move/ports';

// @covers adapter-local-store (class-deps.mmd)
//
// The local in-memory Games store implements ENG-1's GameStorePort behind the
// SAME interface the DynamoDB adapter (UC2) implements. It REPRODUCES the
// version-CAS reject branch (AC5.5) so the optimistic-lock path is exercised
// locally before any cloud touch.
//
// Mocked-adapter caution (§12a): this in-memory map CANNOT prove real DynamoDB
// conditional-write ATOMICITY under genuine concurrency — only the branch shape.
// That platform guarantee is covered by R2.6's ConditionExpression code-policy
// pin + UC6 prod zero-divergence, NOT by another assertion here.

function seedActive(store: LocalGameStore) {
  store.seed({
    gameId: 'g-1',
    board: '---------',
    currentTurn: 'X',
    status: 'active',
    version: 0,
    moveCount: 0,
    hostConnectionId: 'host-conn',
    guestConnectionId: 'guest-conn',
  });
}

describe('LocalGameStore — GameStorePort (UC5, AC5.5)', () => {
  it('getGame returns the seeded game and null for an unknown id', async () => {
    const store = new LocalGameStore();
    seedActive(store);
    expect((await store.getGame('g-1'))?.gameId).toBe('g-1');
    expect(await store.getGame('nope')).toBeNull();
  });

  it('applyMoveWrite applies the patch and bumps version + moveCount by 1', async () => {
    const store = new LocalGameStore();
    seedActive(store);
    await store.applyMoveWrite({
      gameId: 'g-1',
      expectedVersion: 0,
      expectedTurn: 'X',
      patch: { board: 'X--------', nextTurn: 'O' },
    });
    const g = await store.getGame('g-1');
    expect(g?.board).toBe('X--------');
    expect(g?.currentTurn).toBe('O');
    expect(g?.version).toBe(1);
    expect(g?.moveCount).toBe(1);
    expect(g?.status).toBe('active');
  });

  it('a terminal patch writes status=won + winner atomically', async () => {
    const store = new LocalGameStore();
    seedActive(store);
    await store.applyMoveWrite({
      gameId: 'g-1',
      expectedVersion: 0,
      expectedTurn: 'X',
      patch: { board: 'XXX------', nextTurn: 'O', status: 'won', winner: 'X' },
    });
    const g = await store.getGame('g-1');
    expect(g?.status).toBe('won');
    expect(g?.winner).toBe('X');
  });

  // AC5.5 — version-CAS reject branch: a SECOND write with the stale
  // expectedVersion=0 (after the first bumped it to 1) is rejected.
  it('AC5.5 — rejects a stale expectedVersion (version-CAS branch)', async () => {
    const store = new LocalGameStore();
    seedActive(store);
    await store.applyMoveWrite({
      gameId: 'g-1',
      expectedVersion: 0,
      expectedTurn: 'X',
      patch: { board: 'X--------', nextTurn: 'O' },
    });
    // Second write still claims version 0 — now stale (game is at version 1).
    await expect(
      store.applyMoveWrite({
        gameId: 'g-1',
        expectedVersion: 0,
        expectedTurn: 'X',
        patch: { board: 'XX-------', nextTurn: 'O' },
      }),
    ).rejects.toBeInstanceOf(MoveConditionFailed);
    // The board is unchanged by the rejected write (no partial write).
    expect((await store.getGame('g-1'))?.board).toBe('X--------');
    expect((await store.getGame('g-1'))?.version).toBe(1);
  });

  it('rejects an out-of-turn write (expectedTurn != currentTurn)', async () => {
    const store = new LocalGameStore();
    seedActive(store);
    await expect(
      store.applyMoveWrite({
        gameId: 'g-1',
        expectedVersion: 0,
        expectedTurn: 'O', // server says X to move
        patch: { board: '----O----', nextTurn: 'X' },
      }),
    ).rejects.toBeInstanceOf(MoveConditionFailed);
  });

  it('rejects a write when the game is no longer active (state-transition lock)', async () => {
    const store = new LocalGameStore();
    store.seed({
      gameId: 'g-2',
      board: 'XXX------',
      currentTurn: 'O',
      status: 'won',
      version: 5,
      moveCount: 5,
    });
    await expect(
      store.applyMoveWrite({
        gameId: 'g-2',
        expectedVersion: 5,
        expectedTurn: 'O',
        patch: { board: 'XXXO-----', nextTurn: 'X' },
      }),
    ).rejects.toBeInstanceOf(MoveConditionFailed);
  });
});
