import { describe, it, expect } from 'vitest';
import { applyMove } from './move';

// @covers domain-move
//
// UC1 — Move domain core. Pure function over (board, currentTurn, square,
// senderRole, status). ZERO AWS / transport / persistence imports (§41 — the
// domain centre owns the ubiquitous language and defines the ports; it imports
// no concrete system). All branches unit-tested with no infra.

const EMPTY = '---------';

describe('applyMove — accepted non-terminal move (AC1.6 happy path)', () => {
  it('places senderRole at the square, flips turn, terminal=false', () => {
    const out = applyMove(EMPTY, 'X', 4, 'X');
    expect(out).toEqual({
      accepted: true,
      newBoard: '----X----',
      nextTurn: 'O',
      terminal: false,
    });
  });

  it('flips O -> X and writes O at the chosen square', () => {
    const out = applyMove('----X----', 'O', 0, 'O');
    expect(out).toEqual({
      accepted: true,
      newBoard: 'O---X----',
      nextTurn: 'X',
      terminal: false,
    });
  });
});
