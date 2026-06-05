import { useEffect, useState } from 'react';
import { initialState, applyMove, reset } from './engine';
import { bestMove } from './ai';
import { Board } from './Board';
import { Status } from './Status';

type Mode = 'two-player' | 'vs-computer';

/** Root of the game: owns state + mode, wires the mode selector, Status, Board. */
export function GameRoot() {
  const [state, setState] = useState(initialState);
  const [mode, setMode] = useState<Mode>('two-player');

  const onSelect = (index: number) => {
    setState((current) => applyMove(current, index));
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
      </div>
      <Status
        status={state.status}
        currentPlayer={state.currentPlayer}
        winner={state.winner}
      />
      <Board board={state.board} onSelect={onSelect} locked={locked} />
      {locked && (
        <button type="button" className="play-again" onClick={() => setState(reset())}>
          Play again
        </button>
      )}
    </main>
  );
}
