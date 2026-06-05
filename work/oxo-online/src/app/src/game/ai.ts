import { applyMove, type GameState } from './engine';

/**
 * Pure minimax for tic-tac-toe. Optimises for O (the AI) and treats X as the
 * adversary. No I/O, no DOM, no globals, no side effects: it only reads the
 * given state and reuses `applyMove` for legality and win/draw detection.
 *
 * Score convention (from O's perspective): +1 O wins, -1 X wins, 0 draw.
 * Deeper wins/losses are discounted so O prefers the fastest win and the
 * slowest loss, which yields stable, deterministic choices.
 */
function score(state: GameState, depth: number): number {
  if (state.status === 'won') {
    return state.winner === 'O' ? 10 - depth : depth - 10;
  }
  return 0; // draw
}

/** Returns the minimax value of `state` to move, from O's perspective. */
function minimax(state: GameState, depth: number): number {
  if (state.status !== 'playing') {
    return score(state, depth);
  }
  const maximising = state.currentPlayer === 'O';
  let best = maximising ? -Infinity : Infinity;
  for (let i = 0; i < 9; i += 1) {
    if (state.board[i] !== null) continue;
    const value = minimax(applyMove(state, i), depth + 1);
    best = maximising ? Math.max(best, value) : Math.min(best, value);
  }
  return best;
}

/**
 * Returns the board index O should play. Assumes it is O's turn and the game
 * is still in progress. Deterministic: ties are broken by lowest index.
 */
export function bestMove(state: GameState): number {
  let bestIndex = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < 9; i += 1) {
    if (state.board[i] !== null) continue;
    const value = minimax(applyMove(state, i), 1);
    if (value > bestValue) {
      bestValue = value;
      bestIndex = i;
    }
  }
  return bestIndex;
}
