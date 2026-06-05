import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameRoot } from './GameRoot';

describe('GameRoot — placing a symbol (B4)', () => {
  it('shows X in the cell that the first move clicks', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0'));
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
  });
});

describe('GameRoot — turn alternation in the UI (B5)', () => {
  it("reads X's turn, then O's turn, then X's turn as play proceeds", async () => {
    render(<GameRoot />);
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
    await userEvent.click(screen.getByLabelText('cell 0'));
    expect(screen.getByRole('status')).toHaveTextContent("O's turn");
    await userEvent.click(screen.getByLabelText('cell 1'));
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
  });
});

describe('GameRoot — clicking a taken cell is a no-op (B6)', () => {
  it('leaves the symbol and the turn unchanged', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0')); // X, now O's turn
    expect(screen.getByLabelText('cell 0')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('cell 0')); // ignored
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
    expect(screen.getByRole('status')).toHaveTextContent("O's turn");
  });
});

async function clickCells(indices: number[]) {
  for (const i of indices) {
    await userEvent.click(screen.getByLabelText(`cell ${i}`));
  }
}

describe('GameRoot — win locks the board and shows result (B7)', () => {
  it('announces the winner and disables remaining empty cells', async () => {
    render(<GameRoot />);
    // X: 0,1,2 (row 0 win) ; O: 3,4
    await clickCells([0, 3, 1, 4, 2]);
    expect(screen.getByRole('status')).toHaveTextContent('X wins');
    // cell 5 is still empty but the board is locked
    expect(screen.getByLabelText('cell 5')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('cell 5'));
    expect(screen.getByLabelText('cell 5')).toHaveTextContent('');
  });
});

describe('GameRoot — draw shows Draw (B8)', () => {
  it('announces a draw when the board fills with no line', async () => {
    render(<GameRoot />);
    // Fills board with no winning line (see engine A7).
    await clickCells([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(screen.getByRole('status')).toHaveTextContent('Draw');
  });
});

describe('GameRoot — Play again resets (B9)', () => {
  it('is hidden while playing', () => {
    render(<GameRoot />);
    expect(
      screen.queryByRole('button', { name: /play again/i }),
    ).not.toBeInTheDocument();
  });

  it('clears the board and returns to X’s turn after a finished game', async () => {
    render(<GameRoot />);
    await clickCells([0, 3, 1, 4, 2]); // X wins
    await userEvent.click(
      screen.getByRole('button', { name: /play again/i }),
    );
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
    // A fresh move can be played.
    await userEvent.click(screen.getByLabelText('cell 8'));
    expect(screen.getByLabelText('cell 8')).toHaveTextContent('X');
  });
});

describe('GameRoot — mode selector (B1, S1, F1)', () => {
  it('offers a vs Computer control and defaults to two-player', () => {
    render(<GameRoot />);
    expect(
      screen.getByRole('button', { name: /vs computer/i }),
    ).toBeInTheDocument();
    // Default unchanged: empty board, X to move.
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
  });
});

describe('GameRoot — selecting vs Computer (B2, F1)', () => {
  it('starts a fresh game with the human as X', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
  });
});

describe('GameRoot — switching mode resets the board (B3)', () => {
  it('clears an in-progress two-player game when vs Computer is chosen', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0')); // X plays
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('');
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
  });
});
