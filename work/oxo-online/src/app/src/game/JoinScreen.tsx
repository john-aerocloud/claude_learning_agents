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

/**
 * The "Game not found" text (the 4040 message), reused for the OI-33 wire-signal
 * case below where the code arrives not as a 4040 error frame but as a refused
 * handshake.
 */
const CODE_NOT_FOUND = ERROR_MESSAGES[4040];

/**
 * OI-33 — the REAL wire signal for code-not-found on the join-by-code flow.
 *
 * A guest's entered code is the `$connect` credential (the factory appends it as
 * `?code=`). The DEPLOYED `$connect` authorizer does the GSI lookup itself and
 * DENIES an unknown code (reason `code-not-found`) BEFORE the handshake completes
 * — so the `join` route never runs and the server never emits the
 * `{type:'error',code:4040}` MESSAGE frame this screen otherwise maps. At the
 * browser an authorizer-refused handshake surfaces as an ABNORMAL close: the
 * socket closes with no close frame (1006) / no status (1005) and NO preceding
 * error frame. In THIS flow that abnormal, frame-less close IS the
 * code-not-found signal (the only reason a guest's `$connect` is refused is a bad
 * code or rate-limit), so we render the actionable "Game not found." message
 * immediately rather than holding the grace window for a frame that can never
 * arrive (the handshake never opened). A CLEAN close (1000/1001 — the server's
 * intentional DELETE after a delivered frame, or a graceful disconnect) keeps the
 * grace-window-then-generic behaviour for genuine post-open disconnects.
 */
const ABNORMAL_CLOSE_CODES = new Set([1005, 1006]);

interface JoinScreenProps {
  /** Socket seam — Set C supplies the real WebSocket-backed factory. */
  connect: GameSocketFactory;
  /**
   * Called when a `game-ready` arrives so the parent can show the board. The
   * live socket is handed up alongside the message so the parent's move loop
   * (UC4) can `send({action:'move'})` over the SAME guest connection and route
   * the subsequent `board-update`/`game-over` broadcasts.
   */
  onGameReady?: (message: ServerMessage, socket: GameSocket) => void;
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
          // Hand the live socket up so the parent's move loop can send moves and
          // route board-update/game-over over THIS guest connection (UC4).
          onGameReady?.(message, socketRef.current as GameSocket);
        } else if (
          message.type === 'board-update' ||
          message.type === 'game-over'
        ) {
          // Post-game-ready relay frames are routed to the parent's move loop.
          onGameReady?.(message, socketRef.current as GameSocket);
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
      onClose: (closeCode: number) => {
        setConnecting(false);
        // An authoritative error frame already won — do not overwrite it.
        if (errorShown) return;
        // OI-33: an ABNORMAL close (1006/1005) with no error frame means the
        // `$connect` handshake was REFUSED — for the join-by-code flow that is
        // the authorizer rejecting an unknown code (code-not-found). No frame
        // can ever arrive (the socket never opened), so render the actionable
        // "Game not found." message immediately — no grace window needed.
        if (ABNORMAL_CLOSE_CODES.has(closeCode)) {
          clearTimeout(graceTimer.current);
          setError(CODE_NOT_FOUND);
          // Code is intentionally retained for retry (F3).
          return;
        }
        // A CLEAN close (1000/1001) with no preceding error frame MIGHT be a
        // real disconnect, or the DELETE-driven close racing ahead of an
        // in-flight error frame (Issue 2). Hold a short grace window: if an
        // error frame arrives it wins (handled above); otherwise render the
        // generic message once the window elapses.
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
