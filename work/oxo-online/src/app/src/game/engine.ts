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

const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function findWinner(board: Cell[]): Player | null {
  for (const [a, b, c] of LINES) {
    if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as Player;
    }
  }
  return null;
}

export function applyMove(state: GameState, index: number): GameState {
  if (state.status !== 'playing' || state.board[index] !== null) {
    return state;
  }
  const board = state.board.slice();
  board[index] = state.currentPlayer;
  const winner = findWinner(board);
  if (winner !== null) {
    return { ...state, board, winner, status: 'won' };
  }
  if (board.every((c) => c !== null)) {
    return { ...state, board, status: 'draw' };
  }
  const currentPlayer: Player = state.currentPlayer === 'X' ? 'O' : 'X';
  return { ...state, board, currentPlayer };
}
