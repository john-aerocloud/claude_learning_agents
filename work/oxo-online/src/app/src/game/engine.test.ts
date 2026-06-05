import { describe, it, expect } from 'vitest';
import { initialState, applyMove } from './engine';

describe('engine — initialState (A1)', () => {
  it('returns nine empty cells, X to move, playing, no winner', () => {
    const s = initialState();
    expect(s.board).toHaveLength(9);
    expect(s.board.every((c) => c === null)).toBe(true);
    expect(s.currentPlayer).toBe('X');
    expect(s.winner).toBeNull();
    expect(s.status).toBe('playing');
  });
});

describe('engine — applyMove placement (A2)', () => {
  it('places X in the chosen empty cell and leaves the rest empty', () => {
    const s = applyMove(initialState(), 0);
    expect(s.board[0]).toBe('X');
    expect(s.board.filter((c) => c !== null)).toHaveLength(1);
  });

  it('does not mutate the input state (immutable)', () => {
    const start = initialState();
    applyMove(start, 4);
    expect(start.board[4]).toBeNull();
  });
});

describe('engine — turn alternation (A3)', () => {
  it('switches to O after X moves, and back to X after O moves', () => {
    const afterX = applyMove(initialState(), 0);
    expect(afterX.currentPlayer).toBe('O');
    const afterO = applyMove(afterX, 1);
    expect(afterO.currentPlayer).toBe('X');
    expect(afterO.board[1]).toBe('O');
  });
});

describe('engine — illegal move on a taken cell (A4)', () => {
  it('returns the state unchanged when the cell is occupied', () => {
    const afterX = applyMove(initialState(), 0);
    const again = applyMove(afterX, 0);
    expect(again.board[0]).toBe('X');
    expect(again.currentPlayer).toBe('O');
    expect(again).toEqual(afterX);
  });
});
