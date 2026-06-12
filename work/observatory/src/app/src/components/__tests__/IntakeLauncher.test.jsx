// @covers uc-s018-1
// @covers IntakeLauncher
// UC-S018-1 — IntakeLauncher: the persistent "+ New Work" primary launcher in
// the main-column header (SEL-S018-1-1; A11Y: native button, visible text
// label, the + glyph aria-hidden).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { IntakeLauncher } from '../IntakeLauncher.jsx';

describe('IntakeLauncher (UC-S018-1)', () => {
  it('SEL-S018-1-1: resolvable by role button with accessible name "New Work" AND data-testid', () => {
    render(<IntakeLauncher onOpen={() => {}} />);
    const btn = screen.getByRole('button', { name: 'New Work' });
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId('intake-launcher')).toBe(btn);
  });

  it('is a native type=button (keyboard-operable by construction — A11Y-S018-1-2)', () => {
    render(<IntakeLauncher onOpen={() => {}} />);
    const btn = screen.getByTestId('intake-launcher');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('the + glyph is aria-hidden — the accessible name is the TEXT "New Work", never icon-only', () => {
    render(<IntakeLauncher onOpen={() => {}} />);
    const btn = screen.getByTestId('intake-launcher');
    const glyph = btn.querySelector('[aria-hidden="true"]');
    expect(glyph).toBeTruthy();
    expect(glyph.textContent).toContain('+');
  });

  it('fires onOpen on click', () => {
    const onOpen = vi.fn();
    render(<IntakeLauncher onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('intake-launcher'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
