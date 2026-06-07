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

/**
 * applyMove — apply `senderRole`'s move at `square` to `board`, given whose
 * turn it currently is and the current game status. Returns the resulting
 * board, the next turn, and terminal/winner. Rejected moves return
 * `{ accepted:false, terminal:false }` with NO board mutation.
 *
 * `status` defaults to 'active'; a non-active status is a post-terminal guard
 * reject (AC1.5).
 */
export function applyMove(
  board: string,
  currentTurn: Role,
  square: number,
  senderRole: Role,
  status: 'active' | 'won' | 'drawn' = 'active',
): MoveOutcome {
  const newBoard = board.slice(0, square) + senderRole + board.slice(square + 1);
  const nextTurn = other(senderRole);
  return { accepted: true, newBoard, nextTurn, terminal: false };
}
