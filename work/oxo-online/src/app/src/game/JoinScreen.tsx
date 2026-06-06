import { useRef, useState } from 'react';
import type { GameSocket, GameSocketFactory, ServerMessage } from './socket';

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
  const socketRef = useRef<GameSocket | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (connecting) return;
    setConnecting(true);
    const socket = connect({
      onMessage: (message) => {
        if (message.type === 'game-ready') {
          onGameReady?.(message);
        }
      },
      onClose: () => {
        setConnecting(false);
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
    </section>
  );
}
