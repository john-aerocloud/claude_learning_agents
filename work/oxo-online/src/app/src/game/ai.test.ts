import { describe, it, expect } from 'vitest';
import { initialState, applyMove } from './engine';
import { bestMove } from './ai';

// A1 — returns a legal empty index when it is O's turn.
describe('ai.bestMove — legal move (A1, T1, T2)', () => {
  it('returns an in-range empty cell index', () => {
    // X has played one cell; O to move.
    const state = applyMove(initialState(), 4); // currentPlayer now O
    expect(state.currentPlayer).toBe('O');
    const move = bestMove(state);
    expect(move).toBeGreaterThanOrEqual(0);
    expect(move).toBeLessThanOrEqual(8);
    expect(state.board[move]).toBeNull();
  });

  it('is deterministic — same input yields same output', () => {
    const state = applyMove(initialState(), 4);
    expect(bestMove(state)).toBe(bestMove(state));
  });
});
