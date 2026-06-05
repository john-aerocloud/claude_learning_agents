import { describe, it, expect } from 'vitest';
import { initialState } from './engine';

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
