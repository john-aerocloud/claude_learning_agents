// @covers ConstraintBadge
// UC-S002-5 — ConstraintBadge: the ◆ + "constraint" corner ribbon that marks the
// QueueBox named as the ToC constraint in baseline.md.
//
// A11Y-6 (constraint non-colour cue): the badge carries VISIBLE text matching
// /constraint/i (the authoritative cue) AND an aria-hidden ◆ icon (decorative
// shape cue) — never colour-only. When `present` is false it renders nothing
// (no orphan element on a non-constraint box).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ConstraintBadge } from '../ConstraintBadge.jsx';

describe('ConstraintBadge (UC-S002-5)', () => {
  it('renders the badge with visible "constraint" text when present (A11Y-6)', () => {
    render(<ConstraintBadge present />);
    const badge = screen.getByTestId('constraint-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/constraint/i);
  });

  it('renders the ◆ icon as aria-hidden (decorative shape cue, not the signal)', () => {
    render(<ConstraintBadge present />);
    const badge = screen.getByTestId('constraint-badge');
    const icon = badge.querySelector('[aria-hidden="true"]');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toContain('◆');
  });

  it('renders nothing when not present (no orphan element)', () => {
    render(<ConstraintBadge present={false} />);
    expect(screen.queryByTestId('constraint-badge')).toBeNull();
  });

  it('renders nothing when present is omitted (default off)', () => {
    render(<ConstraintBadge />);
    expect(screen.queryByTestId('constraint-badge')).toBeNull();
  });
});
