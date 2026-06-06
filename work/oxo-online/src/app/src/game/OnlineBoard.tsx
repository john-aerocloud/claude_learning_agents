import { Board } from './Board';

const EMPTY_BOARD = [null, null, null, null, null, null, null, null, null] as const;
const STATUS_LINE = 'Game active — moves coming in the next update';
const NOOP = () => {};

interface OnlineBoardProps {
  /** Which side this client is: host plays X, guest plays O. */
  role: 'host' | 'guest';
}

/**
 * The online game board shown to both players after `game-ready` (UC5). It
 * wraps the existing 3x3 `Board` with `locked` so every square is inert —
 * move relay arrives in s006. The status line tells the player why clicks do
 * nothing (F7), and the role label tells them which symbol is theirs (F1).
 */
export function OnlineBoard({ role }: OnlineBoardProps) {
  const symbol = role === 'host' ? 'X' : 'O';
  return (
    <section className="online-board" aria-label="online game board">
      <p className="online-role" data-testid="online-role">{`You are ${symbol}`}</p>
      <Board board={[...EMPTY_BOARD]} onSelect={NOOP} locked />
      <p className="online-board-status" role="status" aria-live="polite">
        {STATUS_LINE}
      </p>
    </section>
  );
}
