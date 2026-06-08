import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameField } from './NameField';

/**
 * @covers spa-name-field
 *
 * R1.2 — the NameField presentational component (idle view, above the mode
 * buttons). Controlled: value + onChange + optional disabled, all owned by
 * GameRoot (R1.3 wires sessionStorage + the default). The component itself only
 * renders the label + input and reports edits.
 *
 * A11Y: programmatic accessible name "Your name" via <label for="name-input">
 * (A11Y-1); maxlength 10 (write-side length bound, A11Y-6 target sizing is CSS);
 * autocomplete off (arcade tag, not a saved identity).
 */
describe('NameField (R1.2 — AC1.1, A11Y-1)', () => {
  it('renders a labelled "Your name" textbox resolvable by role+name', () => {
    render(<NameField value="ACE" onChange={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Your name' });
    expect(input).toBeInTheDocument();
  });

  it('exposes the stable data-testid="name-input" with maxlength 10', () => {
    render(<NameField value="ACE" onChange={() => {}} />);
    const input = screen.getByTestId('name-input');
    expect(input).toHaveAttribute('maxlength', '10');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('shows the controlled value (pre-fill is the parent’s job)', () => {
    render(<NameField value="BEE" onChange={() => {}} />);
    expect(screen.getByTestId('name-input')).toHaveValue('BEE');
  });

  it('reports each keystroke through onChange', async () => {
    const onChange = vi.fn();
    render(<NameField value="" onChange={onChange} />);
    await userEvent.type(screen.getByTestId('name-input'), 'Z');
    expect(onChange).toHaveBeenCalledWith('Z');
  });

  it('disables the input when disabled (create/join in flight)', () => {
    render(<NameField value="ACE" onChange={() => {}} disabled />);
    expect(screen.getByTestId('name-input')).toBeDisabled();
  });
});
