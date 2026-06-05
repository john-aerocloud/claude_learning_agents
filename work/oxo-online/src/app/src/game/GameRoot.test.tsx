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
