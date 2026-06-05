import { useState } from 'react';
import { initialState, applyMove } from './engine';
import { Board } from './Board';
import { Status } from './Status';

/** Root of the local two-player game: owns state, wires Status + Board. */
export function GameRoot() {
  const [state, setState] = useState(initialState);

  const onSelect = (index: number) => {
    setState((current) => applyMove(current, index));
  };

  const locked = state.status !== 'playing';

  return (
    <main className="game" aria-label="oxo game">
      <Status
        status={state.status}
        currentPlayer={state.currentPlayer}
        winner={state.winner}
      />
      <Board board={state.board} onSelect={onSelect} locked={locked} />
    </main>
  );
}
