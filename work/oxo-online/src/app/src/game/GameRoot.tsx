import { useEffect, useRef, useState } from 'react';
import { initialState, applyMove, reset } from './engine';
import { bestMove } from './ai';
import { Board } from './Board';
import { Status } from './Status';

type Mode = 'two-player' | 'vs-computer';
type OnlinePhase = 'idle' | 'creating' | 'waiting' | 'error';

const ONLINE_ERROR = 'Could not start online game — please try again';
const SPINNER_DELAY_MS = 500;

/** Root of the game: owns state + mode, wires the mode selector, Status, Board. */
export function GameRoot() {
  const [state, setState] = useState(initialState);
  const [mode, setMode] = useState<Mode>('two-player');
  const [onlinePhase, setOnlinePhase] = useState<OnlinePhase>('idle');
  const [showSpinner, setShowSpinner] = useState(false);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const spinnerTimer = useRef<ReturnType<typeof setTimeout>>();

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
        </section>
      )}
      {onlinePhase === 'error' && (
        <p className="online-error" role="alert">{ONLINE_ERROR}</p>
      )}
      {onlinePhase !== 'creating' && onlinePhase !== 'waiting' && (
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
