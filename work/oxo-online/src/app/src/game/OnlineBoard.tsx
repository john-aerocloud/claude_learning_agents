import type { Cell as CellValue } from './engine';
import { Board } from './Board';
import { uc4Enabled } from './flags';

const EMPTY_BOARD_STRING = '---------';
const STATUS_LINE = 'Game active — moves coming in the next update';

/** Result strings as broadcast by the server `game-over` frame. */
type Result = 'X-wins' | 'O-wins' | 'draw';

interface OnlineBoardProps {
  /** Which side this client is: host plays X, guest plays O. */
  role: 'host' | 'guest';
  /**
   * The authoritative 9-char board string from the latest server `board-update`
   * (`X`/`O`/`-`). UC4: the board is rendered STRICTLY from this — never from the
   * local click (server-authoritative contract). Defaults to an empty board.
   */
  board?: string;
  /** Whose move the server will accept next (from `board-update`). */
  currentTurn?: 'X' | 'O';
  /** Set once a `game-over` frame arrives — locks the board and shows the result. */
  result?: Result;
  /** Called with the clicked square index to send `{action:'move', square}`. */
  onMove: (square: number) => void;
}

/** Map a board-string char to the Board component's cell value. */
function toCell(ch: string): CellValue {
  return ch === 'X' || ch === 'O' ? ch : null;
}

const RESULT_TEXT: Record<Result, string> = {
  'X-wins': 'X wins',
  'O-wins': 'O wins',
  draw: 'Draw',
};

/**
 * The online game board shown to both players after `game-ready`.
 *
 * UC4 (flag ON): server-authoritative move relay. A click on an empty square,
 * when it is THIS player's turn, sends `{action:'move', square}` via `onMove` —
 * the board is NOT updated optimistically; it re-renders only from the server's
 * `board-update` (the `board`/`currentTurn` props). On a `game-over` (`result`
 * set) the board is locked and the result is shown to both players.
 *
 * UC4 flag OFF (default, until UC3 deploys — §40/§19): the board stays inert with
 * every square disabled, exactly as s005 shipped it. This is the dark prod path.
 */
export function OnlineBoard({
  role,
  board = EMPTY_BOARD_STRING,
  currentTurn = 'X',
  result,
  onMove,
}: OnlineBoardProps) {
  const symbol = role === 'host' ? 'X' : 'O';
  const flagOn = uc4Enabled();

  // Flag OFF: preserve the s005 inert board (status line + all squares disabled).
  if (!flagOn) {
    return (
      <section className="online-board" aria-label="online game board">
        <p className="online-role" data-testid="online-role">{`You are ${symbol}`}</p>
        <Board board={Array(9).fill(null)} onSelect={() => {}} locked />
        <p className="online-board-status" role="status" aria-live="polite">
          {STATUS_LINE}
        </p>
      </section>
    );
  }

  const cells = board.split('').map(toCell);
  const myTurn = currentTurn === symbol;
  const gameOver = result !== undefined;
  // Board is locked when the game is over OR it is not this player's turn — a
  // locked board sends no `move` (AC4.1 turn gating, AC4.3 game-over lock).
  const locked = gameOver || !myTurn;

  const handleSelect = (index: number) => {
    // Defence-in-depth: never send a move on a locked board or an occupied
    // square (the Cell already disables these, but the contract is explicit).
    if (locked || cells[index] !== null) return;
    onMove(index);
  };

  return (
    <section className="online-board" aria-label="online game board">
      <p className="online-role" data-testid="online-role">{`You are ${symbol}`}</p>
      <Board board={cells} onSelect={handleSelect} locked={locked} />
      {gameOver ? (
        <p className="online-result" role="status" aria-live="polite" data-testid="online-result">
          {RESULT_TEXT[result]}
        </p>
      ) : (
        <p
          className="online-turn"
          role="status"
          aria-live="polite"
          data-testid="online-turn"
        >
          {myTurn ? 'Your turn' : `${currentTurn} to move`}
        </p>
      )}
    </section>
  );
}
