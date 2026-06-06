import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnlineBoard } from './OnlineBoard';

describe('OnlineBoard — role labels (B3, F1)', () => {
  it('shows "You are X" for the host', () => {
    render(<OnlineBoard role="host" />);
    expect(screen.getByText(/you are x/i)).toBeInTheDocument();
  });

  it('shows "You are O" for the guest', () => {
    render(<OnlineBoard role="guest" />);
    expect(screen.getByText(/you are o/i)).toBeInTheDocument();
  });

  it('renders the status line', () => {
    render(<OnlineBoard role="host" />);
    expect(
      screen.getByText('Game active — moves coming in the next update'),
    ).toBeInTheDocument();
  });

  it('renders a 3x3 grid of nine squares', () => {
    render(<OnlineBoard role="host" />);
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toBeInTheDocument();
    }
  });
});

describe('OnlineBoard — inert squares (B3, F7)', () => {
  it('produces no state change and no error when a square is clicked', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<OnlineBoard role="host" />);
    const cell = screen.getByLabelText('cell 4');
    await userEvent.click(cell);
    // Nothing is placed; status line is unchanged.
    expect(cell).toHaveTextContent('');
    expect(
      screen.getByText('Game active — moves coming in the next update'),
    ).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
