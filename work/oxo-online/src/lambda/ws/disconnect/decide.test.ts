import { describe, it, expect } from 'vitest';
import { decideDisconnect, type DisconnectGameItem } from './decide';

// @covers domain-disconnect
// @covers wsDisconnectHandler
//
// UC1-S2 — the $disconnect decision is a PURE function over
// (disconnectingConnectionId, gameItem | null). Zero AWS, zero SDK. It decides:
//   - whether to abandon (only an ACTIVE game),
//   - who the survivor is (the bound connection that is NOT the disconnector — S1),
//   - whether to notify (only when we will abandon an active two-player game).
// terminal (won/drawn) / waiting / already-abandoned / missing-game → no-op.

const active = (over: Partial<DisconnectGameItem> = {}): DisconnectGameItem => ({
  gameId: 'g-1',
  status: 'active',
  hostConnectionId: 'host-conn',
  guestConnectionId: 'guest-conn',
  ...over,
});

describe('decideDisconnect — active game (S1, S2, S3 core)', () => {
  it('host disconnects from an active game → abandon + notify the GUEST survivor', () => {
    expect(decideDisconnect('host-conn', active())).toEqual({
      abandon: true,
      survivorId: 'guest-conn',
      notify: true,
    });
  });

  it('guest disconnects from an active game → abandon + notify the HOST survivor', () => {
    expect(decideDisconnect('guest-conn', active())).toEqual({
      abandon: true,
      survivorId: 'host-conn',
      notify: true,
    });
  });
});

describe('decideDisconnect — terminal / waiting / missing → no-op (S2, S3)', () => {
  it('a won game → no abandon, no survivor, no notify (T4 — terminal not overwritten)', () => {
    expect(decideDisconnect('host-conn', active({ status: 'won' }))).toEqual({
      abandon: false,
      survivorId: null,
      notify: false,
    });
  });

  it('a drawn game → no-op', () => {
    expect(decideDisconnect('guest-conn', active({ status: 'drawn' }))).toEqual({
      abandon: false,
      survivorId: null,
      notify: false,
    });
  });

  it('an already-abandoned game → no-op (simultaneous double-disconnect 2nd arm — AC1.7)', () => {
    expect(decideDisconnect('guest-conn', active({ status: 'abandoned' }))).toEqual({
      abandon: false,
      survivorId: null,
      notify: false,
    });
  });

  it('a waiting host (no guest bound) → no abandon, no survivor, no notify (T5)', () => {
    expect(
      decideDisconnect('host-conn', {
        gameId: 'g-1',
        status: 'waiting',
        hostConnectionId: 'host-conn',
      }),
    ).toEqual({ abandon: false, survivorId: null, notify: false });
  });

  it('a missing Games row (null item) → no-op (AC1.5 — delete only)', () => {
    expect(decideDisconnect('host-conn', null)).toEqual({
      abandon: false,
      survivorId: null,
      notify: false,
    });
  });

  it('an active game where the disconnector is bound to NEITHER slot → no notify (defensive)', () => {
    // Should not happen (the connection row resolved this gameId), but the pure
    // function never invents a survivor it cannot identify.
    expect(decideDisconnect('stranger-conn', active())).toEqual({
      abandon: false,
      survivorId: null,
      notify: false,
    });
  });

  it('an active game with no surviving opponent bound → abandon but no survivor to notify', () => {
    // active but guest slot empty (edge): abandon the active game, but there is
    // nobody to notify.
    expect(
      decideDisconnect('host-conn', {
        gameId: 'g-1',
        status: 'active',
        hostConnectionId: 'host-conn',
      }),
    ).toEqual({ abandon: false, survivorId: null, notify: false });
  });
});
