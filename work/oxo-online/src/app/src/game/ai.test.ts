import { describe, it, expect } from 'vitest';
import { initialState, applyMove, type GameState, type Cell } from './engine';
import { bestMove } from './ai';

/** Build an O-to-move state from a board literal (no win/draw yet). */
function oToMove(board: Cell[]): GameState {
  return { board, currentPlayer: 'O', winner: null, status: 'playing' };
}

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

// A2 — takes an immediate win when one is available.
describe('ai.bestMove — takes the win (A2)', () => {
  it('completes O’s line and the resulting status is O won', () => {
    // O on 7,8 → cell 6 completes the bottom row (an immediate O win).
    // Cells 2,3 are open earlier in index order, so a naive first-empty AI
    // would NOT find this — only minimax does. X holds 0,1,4 (X=3, O=2).
    const state = oToMove([
      'X', 'X', null,
      null, 'X', null,
      null, 'O', 'O',
    ]);
    const move = bestMove(state);
    expect(move).toBe(6);
    const next = applyMove(state, move);
    expect(next.status).toBe('won');
    expect(next.winner).toBe('O');
  });
});

// A3 — blocks an immediate X threat when O has no win of its own.
describe('ai.bestMove — blocks the opponent (A3)', () => {
  it('plays the cell that denies X’s completing line', () => {
    // X on 0,4 → cell 8 completes the diagonal (X threat). O on 1,2 has no
    // immediate win of its own. Counts X=2, O=2 → but O to move: make X=2,O=1
    // by removing one O so X moved first. X=2 (0,4), O=1 (1): O to move.
    const state = oToMove([
      'X', 'O', null,
      null, 'X', null,
      null, null, null,
    ]);
    const move = bestMove(state);
    expect(move).toBe(8);
  });
});

// A4 — game-tree exhaustion: optimal O never loses (T3 / F4).
describe('ai.bestMove — never loses against any X play (A4, T3, F4)', () => {
  it('yields no terminal state where X wins, over every X line of play', () => {
    let xWins = 0;
    // Recurse: at X turns branch over every legal move; at O turns play bestMove.
    const walk = (state: GameState) => {
      if (state.status === 'won') {
        if (state.winner === 'X') xWins += 1;
        return;
      }
      if (state.status === 'draw') return;
      if (state.currentPlayer === 'X') {
        for (let i = 0; i < 9; i += 1) {
          if (state.board[i] === null) walk(applyMove(state, i));
        }
      } else {
        walk(applyMove(state, bestMove(state)));
      }
    };
    walk(initialState()); // X moves first (human is X)
    expect(xWins).toBe(0);
  });
});
