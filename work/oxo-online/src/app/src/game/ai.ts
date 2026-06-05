import type { GameState } from './engine';

/**
 * Returns the board index the current player should play.
 * Minimal first cut: the first empty cell. Replaced by minimax in A2+.
 */
export function bestMove(state: GameState): number {
  return state.board.findIndex((cell) => cell === null);
}
