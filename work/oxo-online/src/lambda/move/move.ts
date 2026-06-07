/**
 * move.ts — DOMAIN core for server-authoritative play (UC1). PURE: no AWS SDK,
 * no APIGW event, no DynamoDB type. Validates and applies a single move over a
 * 9-char board string and detects win/draw. The ports it would be driven
 * through live in ./ports.ts; this module imports only domain types from there.
 */

import type { Role } from './ports';

export interface MoveOutcome {
  accepted: boolean;
  newBoard?: string;
  nextTurn?: Role;
  terminal: boolean;
  winner?: Role;
}

const other = (r: Role): Role => (r === 'X' ? 'O' : 'X');

const REJECT: MoveOutcome = { accepted: false, terminal: false };

// The eight winning lines (3 rows, 3 cols, 2 diagonals) as board indices.
const WIN_LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Returns the role occupying a completed line on `board`, or undefined. */
function winnerOf(board: string): Role | undefined {
  for (const [a, b, c] of WIN_LINES) {
    const v = board[a];
    if (v !== '-' && v === board[b] && v === board[c]) return v as Role;
  }
  return undefined;
}

/**
 * applyMove — apply `senderRole`'s move at `square` to `board`, given whose
 * turn it currently is and the current game status. Returns the resulting
 * board, the next turn, and terminal/winner. Rejected moves return
 * `{ accepted:false, terminal:false }` with NO board mutation.
 *
 * Rejection cases (all leave the board byte-unchanged):
 *  - status not 'active' (post-terminal guard, AC1.5)
 *  - square out of 0..8 range (AC1.4)
 *  - sender is not the player to move (out-of-turn, AC1.3)
 *  - target square already occupied (AC1.4)
 *
 * `status` defaults to 'active'.
 */
export function applyMove(
  board: string,
  currentTurn: Role,
  square: number,
  senderRole: Role,
  status: 'active' | 'won' | 'drawn' = 'active',
): MoveOutcome {
  if (status !== 'active') return REJECT;
  if (!Number.isInteger(square) || square < 0 || square > 8) return REJECT;
  if (senderRole !== currentTurn) return REJECT;
  if (board[square] !== '-') return REJECT;

  const newBoard = board.slice(0, square) + senderRole + board.slice(square + 1);
  const nextTurn = other(senderRole);

  const winner = winnerOf(newBoard);
  if (winner) {
    return { accepted: true, newBoard, nextTurn, terminal: true, winner };
  }
  // Draw: board full (no '-') and no line.
  if (!newBoard.includes('-')) {
    return { accepted: true, newBoard, nextTurn, terminal: true };
  }
  return { accepted: true, newBoard, nextTurn, terminal: false };
}
