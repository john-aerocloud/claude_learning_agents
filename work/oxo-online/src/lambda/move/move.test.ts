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

describe('applyMove — rejections leave the board untouched', () => {
  it('AC1.3 out-of-turn (senderRole !== currentTurn) → not accepted, no mutation', () => {
    const out = applyMove(EMPTY, 'X', 4, 'O');
    expect(out).toEqual({ accepted: false, terminal: false });
  });

  it('AC1.4 square-taken (board[square] !== "-") → not accepted, no mutation', () => {
    const out = applyMove('----X----', 'O', 4, 'O');
    expect(out).toEqual({ accepted: false, terminal: false });
  });

  it('AC1.5 post-terminal guard (status !== active) → not accepted', () => {
    const out = applyMove('XXX------', 'O', 5, 'O', 'won');
    expect(out).toEqual({ accepted: false, terminal: false });
  });

  it('AC1.5 post-terminal guard (status drawn) → not accepted', () => {
    const out = applyMove('XOXXOOOXX', 'X', 0, 'X', 'drawn');
    expect(out).toEqual({ accepted: false, terminal: false });
  });

  it('AC1.4 out-of-range / negative square → not accepted', () => {
    expect(applyMove(EMPTY, 'X', 9, 'X')).toEqual({ accepted: false, terminal: false });
    expect(applyMove(EMPTY, 'X', -1, 'X')).toEqual({ accepted: false, terminal: false });
  });
});

describe('applyMove — AC1.1 all eight win lines, X and O', () => {
  // Each case: a board ONE move short of the winning line, the move that
  // completes it, and the role. Lines: 3 rows, 3 cols, 2 diagonals.
  const lines: ReadonlyArray<[number, number, number]> = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6], // diagonals
  ];
  for (const [a, b, c] of lines) {
    for (const role of ['X', 'O'] as const) {
      it(`role ${role} completing line [${a},${b},${c}] → terminal win`, () => {
        // Pre-fill a,b with role; play c. Fill the rest with '-' (legal partial board).
        const arr = '---------'.split('');
        arr[a] = role;
        arr[b] = role;
        const board = arr.join('');
        const out = applyMove(board, role, c, role);
        expect(out.accepted).toBe(true);
        expect(out.terminal).toBe(true);
        expect(out.winner).toBe(role);
        expect(out.newBoard![c]).toBe(role);
      });
    }
  }
});

describe('applyMove — AC1.2 draw by fill', () => {
  it('ninth square filled with no line → terminal draw, no winner', () => {
    // X O X / X O O / O X _  — playing X at 8 fills the board with no line.
    const board = 'XOXXOOOX-';
    const out = applyMove(board, 'X', 8, 'X');
    expect(out.accepted).toBe(true);
    expect(out.terminal).toBe(true);
    expect(out.winner).toBeUndefined();
    expect(out.newBoard).toBe('XOXXOOOXX');
  });

  it('a winning ninth move is a win, not a draw (terminal precedence)', () => {
    // Board one short of col [2,5,8] for O; O plays 8 → column win on the last
    // square. moveCount reaches 9 but a line exists, so winner is set (not draw).
    //  X X O / X X O / O O _   indices: 0X 1X 2O 3X 4X 5O 6O 7O 8-
    const board = 'XXOXXOOO-';
    const out = applyMove(board, 'O', 8, 'O');
    expect(out.accepted).toBe(true);
    expect(out.terminal).toBe(true);
    expect(out.winner).toBe('O'); // col [2,5,8] = O,O,O
    expect(out.newBoard).toBe('XXOXXOOOO');
  });
});
