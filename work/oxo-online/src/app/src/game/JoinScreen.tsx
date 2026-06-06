import { useRef, useState } from 'react';
import type { GameSocket, GameSocketFactory, ServerMessage } from './socket';

const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Maps the defined WebSocket close codes to readable messages (S3). Only the
 * three defined codes get a specific message; anything else degrades to the
 * generic one — the client never surfaces internal detail.
 */
const CLOSE_MESSAGES: Record<number, string> = {
  4040: 'Game not found. Check the code and try again.',
  4041: 'This game is no longer available.',
  4500: GENERIC_ERROR,
};

function messageForClose(code: number): string {
  return CLOSE_MESSAGES[code] ?? GENERIC_ERROR;
}

interface JoinScreenProps {
  /** Socket seam — Set C supplies the real WebSocket-backed factory. */
  connect: GameSocketFactory;
  /** Called when a `game-ready` arrives so the parent can show the board. */
  onGameReady?: (message: ServerMessage) => void;
}

/**
 * The "Join a game" screen: a 6-character code input + submit. On submit it
 * opens the (injected) socket and sends `{ action: 'join', code }`, showing a
 * connecting indicator while pending. The code is retained on close so the
 * player can correct and retry (F3).
 */
export function JoinScreen({ connect, onGameReady }: JoinScreenProps) {
  const [code, setCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<GameSocket | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (connecting) return;
    setConnecting(true);
    setError(null);
    const socket = connect({
      onMessage: (message) => {
        if (message.type === 'game-ready') {
          onGameReady?.(message);
        }
      },
      onClose: (closeCode) => {
        setConnecting(false);
        setError(messageForClose(closeCode));
        // Code is intentionally retained for retry (F3).
      },
    });
    socketRef.current = socket;
    socket.send({ action: 'join', code });
  };

  return (
    <section className="join-screen" aria-label="join a game">
      <form onSubmit={submit}>
        <label htmlFor="join-code">Game code</label>
        <input
          id="join-code"
          className="join-code-input"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
        />
        <button type="submit" className="join-submit">
          Join
        </button>
      </form>
      {connecting && (
        <p
          className="join-connecting"
          role="status"
          aria-live="polite"
          data-testid="join-connecting"
        >
          Connecting…
        </p>
      )}
      {error && (
        <p className="join-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
