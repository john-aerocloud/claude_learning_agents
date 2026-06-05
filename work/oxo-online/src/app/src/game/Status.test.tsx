import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Status } from './Status';

describe('Status (B3)', () => {
  it("shows X's turn while playing with X to move", () => {
    render(<Status status="playing" currentPlayer="X" winner={null} />);
    expect(screen.getByText(/X's turn/)).toBeInTheDocument();
  });

  it("shows O's turn while playing with O to move", () => {
    render(<Status status="playing" currentPlayer="O" winner={null} />);
    expect(screen.getByText(/O's turn/)).toBeInTheDocument();
  });

  it('announces X wins', () => {
    render(<Status status="won" currentPlayer="O" winner="X" />);
    expect(screen.getByText(/X wins/)).toBeInTheDocument();
  });

  it('announces O wins', () => {
    render(<Status status="won" currentPlayer="X" winner="O" />);
    expect(screen.getByText(/O wins/)).toBeInTheDocument();
  });

  it('announces a draw', () => {
    render(<Status status="draw" currentPlayer="X" winner={null} />);
    expect(screen.getByText(/Draw/)).toBeInTheDocument();
  });
});
