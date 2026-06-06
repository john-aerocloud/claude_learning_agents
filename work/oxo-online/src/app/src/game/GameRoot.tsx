import { useEffect, useRef, useState } from 'react';
import { initialState, applyMove, reset } from './engine';
import { bestMove } from './ai';
import { Board } from './Board';
import { Status } from './Status';
import { JoinScreen } from './JoinScreen';
import { OnlineBoard } from './OnlineBoard';
import type {
  GameSocket,
  GameSocketFactory,
  ServerMessage,
} from './socket';

type Mode = 'two-player' | 'vs-computer';
type OnlinePhase =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'joining'
  | 'playing-online'
  | 'error';

const ONLINE_ERROR = 'Could not start online game — please try again';
const SPINNER_DELAY_MS = 500;

/**
 * Default socket factory. Set B ships a stub so the mocked `game-ready`
 * transition is exercised in tests via an injected factory; Set C (C2)
 * replaces this with a real `WebSocket`-backed factory reading
 * `window.OXO_CONFIG.wsUrl`. The components never see the transport.
 */
const stubFactory: GameSocketFactory = () => ({
  send: () => {},
  close: () => {},
});

interface GameRootProps {
  /** Injectable socket seam (defaults to a no-op stub; Set C plugs the real WS). */
  socketFactory?: GameSocketFactory;
}

/** Root of the game: owns state + mode, wires the mode selector, Status, Board. */
export function GameRoot({ socketFactory = stubFactory }: GameRootProps = {}) {
  const [state, setState] = useState(initialState);
  const [mode, setMode] = useState<Mode>('two-player');
  const [onlinePhase, setOnlinePhase] = useState<OnlinePhase>('idle');
  const [showSpinner, setShowSpinner] = useState(false);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [onlineRole, setOnlineRole] = useState<'host' | 'guest'>('host');
  const spinnerTimer = useRef<ReturnType<typeof setTimeout>>();
  const hostSocketRef = useRef<GameSocket | null>(null);

  // A `game-ready` from either side drives both screens to the board.
  const handleGameReady = (message: ServerMessage) => {
    if (message.type === 'game-ready') {
      setOnlineRole(message.role);
      setOnlinePhase('playing-online');
    }
  };

  const onSelect = (index: number) => {
    setState((current) => applyMove(current, index));
  };

  const playOnline = async () => {
    setOnlinePhase('creating');
    // Spinner only appears for waits longer than 500ms (F3).
    spinnerTimer.current = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { gameId: string; code: string };
      setGameCode(body.code);
      setOnlinePhase('waiting');
    } catch {
      setOnlinePhase('error');
    } finally {
      clearTimeout(spinnerTimer.current);
      setShowSpinner(false);
    }
  };

  // When the host reaches the waiting screen, open the socket so the server
  // can reach them with `game-ready` (UC1). Set C sends the `register` frame
  // through the same seam; Set B only needs the listener wired.
  useEffect(() => {
    if (onlinePhase !== 'waiting') return;
    const socket = socketFactory({
      onMessage: handleGameReady,
      onClose: () => {},
    });
    hostSocketRef.current = socket;
    return () => {
      socket.close();
      hostSocketRef.current = null;
    };
    // socketFactory is stable for a render tree; re-run only on phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlinePhase]);

  // In vs-Computer mode the AI plays O. Run it in an effect (not the click
  // handler) so the human's X paints first, then O follows synchronously.
  useEffect(() => {
    if (
      mode === 'vs-computer' &&
      state.status === 'playing' &&
      state.currentPlayer === 'O'
    ) {
      setState((current) => applyMove(current, bestMove(current)));
    }
  }, [mode, state]);

  const selectMode = (next: Mode) => {
    setMode(next);
    setState(reset());
    // Leaving the online flow returns to a clean local game (F4/F5 fallback).
    setOnlinePhase('idle');
    setGameCode(null);
  };

  const joinGame = () => {
    setOnlinePhase('joining');
    setGameCode(null);
  };

  const locked = state.status !== 'playing';

  return (
    <main className="game" aria-label="oxo game">
      <div className="mode-selector" role="group" aria-label="game mode">
        <button
          type="button"
          className="mode"
          aria-pressed={mode === 'two-player'}
          onClick={() => selectMode('two-player')}
        >
          Two player
        </button>
        <button
          type="button"
          className="mode"
          aria-pressed={mode === 'vs-computer'}
          onClick={() => selectMode('vs-computer')}
        >
          vs Computer
        </button>
        <button
          type="button"
          className="mode"
          aria-label="play online"
          onClick={playOnline}
        >
          Play Online
        </button>
        <button
          type="button"
          className="mode"
          aria-label="join a game"
          onClick={joinGame}
        >
          Join a game
        </button>
      </div>
      {onlinePhase === 'creating' && (
        <p className="online-status" role="status" aria-live="polite">
          Starting online game…{showSpinner && <span data-testid="spinner" aria-hidden="true" className="spinner" />}
        </p>
      )}
      {onlinePhase === 'waiting' && gameCode && (
        <section className="online-waiting" aria-label="waiting for opponent">
          <p>Waiting for opponent</p>
          <p className="game-code" data-testid="game-code">{gameCode}</p>
          <p
            className="online-connecting"
            role="status"
            aria-live="polite"
            data-testid="host-connecting"
          >
            Connecting…
          </p>
        </section>
      )}
      {onlinePhase === 'joining' && (
        <JoinScreen connect={socketFactory} onGameReady={handleGameReady} />
      )}
      {onlinePhase === 'playing-online' && <OnlineBoard role={onlineRole} />}
      {onlinePhase === 'error' && (
        <p className="online-error" role="alert">{ONLINE_ERROR}</p>
      )}
      {onlinePhase === 'idle' && (
        <>
          <Status
            status={state.status}
            currentPlayer={state.currentPlayer}
            winner={state.winner}
          />
          <Board board={state.board} onSelect={onSelect} locked={locked} />
          {locked && (
            <button
              type="button"
              className="play-again"
              onClick={() => setState(reset())}
            >
              Play again
            </button>
          )}
        </>
      )}
    </main>
  );
}
