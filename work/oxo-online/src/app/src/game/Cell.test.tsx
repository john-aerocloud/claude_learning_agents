import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Cell } from './Cell';

describe('Cell (B1)', () => {
  it('renders its value as text', () => {
    render(<Cell value="X" index={0} onSelect={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('X');
  });

  it('renders a blank clickable button when empty', () => {
    const onSelect = vi.fn();
    render(<Cell value={null} index={3} onSelect={onSelect} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('');
    expect(btn).not.toBeDisabled();
  });

  it('calls onSelect with its index when clicked', async () => {
    const onSelect = vi.fn();
    render(<Cell value={null} index={5} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it('is disabled when the cell already has a value', () => {
    render(<Cell value="O" index={2} onSelect={() => {}} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Cell value={null} index={1} onSelect={() => {}} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
