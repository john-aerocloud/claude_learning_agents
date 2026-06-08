import { describe, it, expect } from 'vitest';
import { tally } from './tally';

// @covers domain-tally
// R2.3 — pure tally function: (transition) → [{ name, field, gameId }].
// PURE: zero SDK/transport. Won → winner +1 win, loser +1 loss. Drawn → both
// +1 draw. Any non-terminal NEW status → ZERO ops (defence in depth behind the
// stream filter, SM-5). (AC2.4, AC2.5, AC2.6.)

describe('tally — won game (AC2.4)', () => {
  it('returns winner.wins + loser.losses, both marked with the gameId', () => {
    const ops = tally({
      oldStatus: 'active',
      newStatus: 'won',
      winnerName: 'ACE',
      loserName: 'AAA',
      gameId: 'G1',
    });
    expect(ops).toEqual([
      { name: 'ACE', field: 'wins', gameId: 'G1' },
      { name: 'AAA', field: 'losses', gameId: 'G1' },
    ]);
  });
});

describe('tally — drawn game (AC2.5)', () => {
  it('returns two draws ops (both participants), marked with the gameId', () => {
    const ops = tally({
      oldStatus: 'active',
      newStatus: 'drawn',
      winnerName: 'ACE',
      loserName: 'BEE',
      gameId: 'G2',
    });
    expect(ops).toEqual([
      { name: 'ACE', field: 'draws', gameId: 'G2' },
      { name: 'BEE', field: 'draws', gameId: 'G2' },
    ]);
  });
});

describe('tally — non-terminal transitions produce ZERO ops (AC2.6, SM-5)', () => {
  it('abandoned → no ops (defence in depth behind the source filter)', () => {
    expect(
      tally({
        oldStatus: 'active',
        newStatus: 'abandoned',
        winnerName: 'ACE',
        loserName: 'AAA',
        gameId: 'G3',
      }),
    ).toEqual([]);
  });

  it('still-active board-update → no ops', () => {
    expect(
      tally({
        oldStatus: 'active',
        newStatus: 'active',
        winnerName: 'ACE',
        loserName: 'AAA',
        gameId: 'G4',
      }),
    ).toEqual([]);
  });

  it('a transition that did NOT come from active → no ops (only active→terminal counts)', () => {
    expect(
      tally({
        oldStatus: 'waiting',
        newStatus: 'won',
        winnerName: 'ACE',
        loserName: 'AAA',
        gameId: 'G5',
      }),
    ).toEqual([]);
  });
});

describe('tally — names default to AAA when absent (server-side belt-and-braces)', () => {
  it('blank winner/loser fall back to AAA so a nameless game still scores', () => {
    const ops = tally({
      oldStatus: 'active',
      newStatus: 'won',
      winnerName: '',
      loserName: undefined,
      gameId: 'G6',
    });
    expect(ops).toEqual([
      { name: 'AAA', field: 'wins', gameId: 'G6' },
      { name: 'AAA', field: 'losses', gameId: 'G6' },
    ]);
  });
});
