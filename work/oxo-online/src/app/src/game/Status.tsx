import type { Player, Status as GameStatus } from './engine';

interface StatusProps {
  status: GameStatus;
  currentPlayer: Player;
  winner: Player | null;
}

/** Live region announcing whose turn it is, or the terminal result. */
export function Status({ status, currentPlayer, winner }: StatusProps) {
  let message: string;
  if (status === 'won' && winner) {
    message = `${winner} wins`;
  } else if (status === 'draw') {
    message = 'Draw';
  } else {
    message = `${currentPlayer}'s turn`;
  }
  return (
    <p className="status" role="status" aria-live="polite">
      {message}
    </p>
  );
}
