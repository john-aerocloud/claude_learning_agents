export type Cell = 'X' | 'O' | null;
export type Player = 'X' | 'O';
export type Status = 'playing' | 'won' | 'draw';

export interface GameState {
  board: Cell[];
  currentPlayer: Player;
  winner: Player | null;
  status: Status;
}

export function initialState(): GameState {
  return {
    board: [null, null, null, null, null, null, null, null, null],
    currentPlayer: 'X',
    winner: null,
    status: 'playing',
  };
}

export function applyMove(state: GameState, index: number): GameState {
  const board = state.board.slice();
  board[index] = state.currentPlayer;
  const currentPlayer: Player = state.currentPlayer === 'X' ? 'O' : 'X';
  return { ...state, board, currentPlayer };
}
