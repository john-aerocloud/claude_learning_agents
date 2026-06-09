// @covers BufferStateIndicator
// UC-S002-4 — buffer-state badge (starving ▽ / over-WIP △) component test (jsdom).
//
// What this UC pins (acceptance.md / ui-design.md §4): A11Y-5 redundant state
// encoding — a non-ok state surfaces as icon + VISIBLE TEXT + colour, never
// colour alone. The text label is the authoritative cue; the icon is
// aria-hidden (decorative). An `ok` state renders NOTHING (no badge element).
//
// This file drives BufferStateIndicator in isolation (the badge contract UC5's
// ConstraintBadge will sit alongside on the same box). Colour is asserted
// nowhere here — only icon presence (aria-hidden) + visible text + the
// data-testid="state-badge" hook the tester and UC5 rely on.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { BufferStateIndicator } from '../BufferStateIndicator.jsx';

describe('BufferStateIndicator (UC-S002-4)', () => {
  it('renders a state-badge with visible "starving" text + an aria-hidden ▽ icon for status=starving (A11Y-5)', () => {
    render(<BufferStateIndicator status="starving" />);
    const badge = screen.getByTestId('state-badge');
    expect(badge).toBeInTheDocument();
    // authoritative cue: visible text
    expect(badge).toHaveTextContent(/starving/i);
    // shape cue: the ▽ icon is aria-hidden (decorative; text carries meaning)
    const icon = badge.querySelector('[aria-hidden="true"]');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toContain('▽');
  });

  it('renders a state-badge with visible "over-WIP" text + an aria-hidden △ icon for status=over-wip (A11Y-5)', () => {
    render(<BufferStateIndicator status="over-wip" />);
    const badge = screen.getByTestId('state-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/over-?wip/i);
    const icon = badge.querySelector('[aria-hidden="true"]');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toContain('△');
  });

  it('renders NOTHING for status=ok — the clean state has no badge element (A11Y-5)', () => {
    const { container } = render(<BufferStateIndicator status="ok" />);
    expect(screen.queryByTestId('state-badge')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders nothing for an undefined/unknown status (fail-soft, no crash)', () => {
    const { container } = render(<BufferStateIndicator status={undefined} />);
    expect(screen.queryByTestId('state-badge')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('carries the status on a data-status hook so the redundant colour token can be applied by CSS', () => {
    render(<BufferStateIndicator status="starving" />);
    expect(screen.getByTestId('state-badge')).toHaveAttribute('data-status', 'starving');
  });
});
