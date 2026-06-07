import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnlineBoard } from './OnlineBoard';

// @covers spa-online-move (class-deps.mmd)
//
// The s006 UC4 flag (uc4Enabled) was factored out at slice delivery (§40
// code-then-config): the server-authoritative move relay is now the
// unconditional online board behaviour, so there is no flag-OFF inert path left
// to test.

describe('OnlineBoard — role labels (B3, F1)', () => {
  it('shows "You are X" for the host', () => {
    render(<OnlineBoard role="host" onMove={() => {}} />);
    expect(screen.getByText(/you are x/i)).toBeInTheDocument();
  });

  it('shows "You are O" for the guest', () => {
    render(<OnlineBoard role="guest" onMove={() => {}} />);
    expect(screen.getByText(/you are o/i)).toBeInTheDocument();
  });

  it('renders a 3x3 grid of nine squares', () => {
    render(<OnlineBoard role="host" onMove={() => {}} />);
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toBeInTheDocument();
    }
  });
});

// -----------------------------------------------------------------------------
// Server-authoritative move relay (AC4.1–AC4.4) — the unconditional behaviour.
// -----------------------------------------------------------------------------
describe('OnlineBoard — server-authoritative move relay', () => {
  // AC4.1 — clicking a square sends exactly one {action:'move', square}; the
  // board does NOT update optimistically (renders strictly from the server).
  it('AC4.1 — clicking an empty square calls onMove(square) once; no optimistic render', async () => {
    const onMove = vi.fn();
    render(
      <OnlineBoard
        role="host"
        board="---------"
        currentTurn="X"
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByLabelText('cell 4'));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(4);
    // No optimistic update — cell 4 is still empty until the server broadcasts.
    expect(screen.getByLabelText('cell 4')).toHaveTextContent('');
  });

  // AC4.2 — render-on-broadcast: the board reflects the server `board` string and
  // the turn indicator, with no prior click.
  it('AC4.2 — renders the server board string and turn indicator (render-on-broadcast)', () => {
    render(
      <OnlineBoard
        role="host"
        board="X--------"
        currentTurn="O"
        onMove={() => {}}
      />,
    );
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
    // The turn indicator shows whose move the server will accept next.
    expect(screen.getByTestId('online-turn')).toHaveTextContent(/o/i);
  });

  // AC4.1 (turn gating) — a player cannot send a move when it is not their turn:
  // squares are not clickable off-turn (no move can be sent).
  it('does not call onMove when it is not this player\'s turn', async () => {
    const onMove = vi.fn();
    render(
      <OnlineBoard
        role="guest" /* O */
        board="---------"
        currentTurn="X" /* X to move, so guest O cannot */
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByLabelText('cell 0'));
    expect(onMove).not.toHaveBeenCalled();
  });

  // AC4.3 — board lock after game-over: clicks fire 0 moves once a result is set.
  it('AC4.3 — after a result, clicking any square fires no onMove (board locked)', async () => {
    const onMove = vi.fn();
    render(
      <OnlineBoard
        role="host"
        board="XXX------"
        currentTurn="O"
        result="X-wins"
        onMove={onMove}
      />,
    );
    for (let i = 0; i < 9; i += 1) {
      await userEvent.click(screen.getByLabelText(`cell ${i}`));
    }
    expect(onMove).not.toHaveBeenCalled();
  });

  // AC4.4 — result screen rendering.
  it('AC4.4 — result "X-wins" shows "X wins"', () => {
    render(
      <OnlineBoard
        role="host"
        board="XXX------"
        currentTurn="O"
        result="X-wins"
        onMove={() => {}}
      />,
    );
    expect(screen.getByText(/x wins/i)).toBeInTheDocument();
  });

  it('AC4.4 — result "O-wins" shows "O wins"', () => {
    render(
      <OnlineBoard
        role="guest"
        board="OOO------"
        currentTurn="X"
        result="O-wins"
        onMove={() => {}}
      />,
    );
    expect(screen.getByText(/o wins/i)).toBeInTheDocument();
  });

  it('AC4.4 — result "draw" shows "Draw"', () => {
    render(
      <OnlineBoard
        role="host"
        board="XOXXOOOXX"
        currentTurn="X"
        result="draw"
        onMove={() => {}}
      />,
    );
    expect(screen.getByText(/draw/i)).toBeInTheDocument();
  });

  // A taken square is never re-sendable (no double-fill from the client side).
  it('does not call onMove for an already-occupied square', async () => {
    const onMove = vi.fn();
    render(
      <OnlineBoard
        role="host"
        board="X--------"
        currentTurn="X"
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByLabelText('cell 0'));
    expect(onMove).not.toHaveBeenCalled();
  });
});
