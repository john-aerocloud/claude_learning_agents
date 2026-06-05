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

// Helper: play a sequence of moves from a fresh game.
function play(indices: number[]): GameState {
  return indices.reduce((s, i) => applyMove(s, i), initialState());
}

describe('engine — win detection on each line (A5)', () => {
  // For each line, X takes the three line cells while O takes harmless cells.
  // Sequence interleaves X and O so turns stay valid.
  const xWinSequences: Array<[string, number[]]> = [
    ['row 0 (0,1,2)', [0, 3, 1, 4, 2]],
    ['row 1 (3,4,5)', [3, 0, 4, 1, 5]],
    ['row 2 (6,7,8)', [6, 0, 7, 1, 8]],
    ['col 0 (0,3,6)', [0, 1, 3, 2, 6]],
    ['col 1 (1,4,7)', [1, 0, 4, 2, 7]],
    ['col 2 (2,5,8)', [2, 0, 5, 1, 8]],
    ['diag (0,4,8)', [0, 1, 4, 2, 8]],
    ['diag (2,4,6)', [2, 1, 4, 3, 6]],
  ];

  it.each(xWinSequences)('detects X win on %s', (_label, seq) => {
    const s = play(seq);
    expect(s.status).toBe('won');
    expect(s.winner).toBe('X');
  });

  it('detects an O win', () => {
    // X: 0,1,8 ; O: 3,4,5 (O wins row 1)
    const s = play([0, 3, 1, 4, 8, 5]);
    expect(s.status).toBe('won');
    expect(s.winner).toBe('O');
  });

  it('stays playing when no line is complete', () => {
    const s = play([0, 1, 2]);
    expect(s.status).toBe('playing');
    expect(s.winner).toBeNull();
  });
});

describe('engine — board locked after a win (A6)', () => {
  it('ignores further moves once the game is won', () => {
    const won = play([0, 3, 1, 4, 2]); // X wins row 0
    const after = applyMove(won, 5); // cell 5 is empty but game is over
    expect(after).toEqual(won);
    expect(after.status).toBe('won');
  });
});

describe('engine — draw detection (A7)', () => {
  it('reports a draw when the board fills with no winning line', () => {
    // X O X
    // X O O
    // O X X
    // Move order (X first): 0,1,2,4,3,5,7,6,8 → full, no line.
    const s = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(s.board.every((c) => c !== null)).toBe(true);
    expect(s.status).toBe('draw');
    expect(s.winner).toBeNull();
  });
});
