import { useEffect, useRef, useState } from 'react';
import type { GameSocket, GameSocketFactory, ServerMessage } from './socket';

const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * DEFECT-005-001-R2 (Issue 2, client half). The server posts the error MESSAGE
 * frame then DELETEs the connection; at the browser the DELETE-driven CLOSE
 * event can beat the in-flight message event. On a close with NO prior error
 * frame we therefore HOLD a short grace window for an in-flight error frame
 * before rendering the generic message. An authoritative error frame ALWAYS
 * wins (it cancels the grace timer and shows the specific message), regardless
 * of which event the browser surfaces first. The server also drains the frame
 * before its DELETE — each half is defensible on its own.
 */
const CLOSE_GRACE_MS = 300;

/**
 * Maps the defined error codes to readable messages (S3). DEFECT-005-001 Bug B:
 * these codes now arrive as a {type:'error', code, message} MESSAGE frame rather
 * than as a WS close code (the platform cannot deliver custom close codes). Only
 * the three defined codes get a specific message; anything else (and a bare
 * close with no preceding error frame — a real disconnect) degrades to the
 * generic one. The client never surfaces internal detail.
 */
const ERROR_MESSAGES: Record<number, string> = {
  4040: 'Game not found. Check the code and try again.',
  4041: 'This game is no longer available.',
  4500: GENERIC_ERROR,
};

function messageForCode(code: number): string {
  return ERROR_MESSAGES[code] ?? GENERIC_ERROR;
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
  const graceTimer = useRef<ReturnType<typeof setTimeout>>();

  // Clear any pending grace timer when the screen unmounts.
  useEffect(() => () => clearTimeout(graceTimer.current), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (connecting) return;
    setConnecting(true);
    setError(null);
    clearTimeout(graceTimer.current);
    // Track whether the server already reported a specific error (Bug B). The
    // subsequent DELETE-driven close must not overwrite that specific message.
    let errorShown = false;
    const socket = connect({
      // The guest's $connect credential is the entered code — the factory
      // appends it as `?code=` so the deployed authorizer can verify the game
      // (UC4/AC4.1, T8).
      credential: { code },
      onMessage: (message) => {
        if (message.type === 'game-ready') {
          onGameReady?.(message);
        } else if (message.type === 'error') {
          // Bug B: failure arrives as an error MESSAGE frame. It is
          // AUTHORITATIVE — it always wins, even if a close already opened the
          // grace window (the browser surfaced the close event first).
          errorShown = true;
          clearTimeout(graceTimer.current);
          setConnecting(false);
          setError(messageForCode(message.code));
          // Code is intentionally retained for retry (F3).
        }
      },
      onClose: () => {
        setConnecting(false);
        // A close with no preceding error frame MIGHT be a real disconnect, or
        // it might be the DELETE-driven close racing ahead of an in-flight error
        // frame (Issue 2). Hold a short grace window: if an error frame arrives
        // it wins (handled above); otherwise render the generic message once the
        // window elapses. If a specific message is already shown, do nothing.
        if (errorShown) return;
        clearTimeout(graceTimer.current);
        graceTimer.current = setTimeout(() => {
          if (!errorShown) setError(GENERIC_ERROR);
        }, CLOSE_GRACE_MS);
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
