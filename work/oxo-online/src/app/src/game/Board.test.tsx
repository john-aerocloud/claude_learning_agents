import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Board } from './Board';
import type { Cell } from './engine';

const empty: Cell[] = [null, null, null, null, null, null, null, null, null];

describe('Board (B2)', () => {
  it('renders nine cell buttons', () => {
    render(<Board board={empty} onSelect={() => {}} locked={false} />);
    expect(screen.getAllByRole('button')).toHaveLength(9);
  });

  it('shows the symbol held by a cell', () => {
    const board: Cell[] = [...empty];
    board[4] = 'X';
    render(<Board board={board} onSelect={() => {}} locked={false} />);
    expect(screen.getByLabelText('cell 4')).toHaveTextContent('X');
  });

  it('calls onSelect with the clicked cell index', async () => {
    const onSelect = vi.fn();
    render(<Board board={empty} onSelect={onSelect} locked={false} />);
    await userEvent.click(screen.getByLabelText('cell 7'));
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it('disables every cell when locked', () => {
    render(<Board board={empty} onSelect={() => {}} locked />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled();
    }
  });
});
