// @covers LiveStatusDot
// UC-S002-6 — the small SSE-connection indicator (components.md §LiveStatusDot).
// Pure function of a `state` prop ('connected' | 'reconnecting'). The meaning
// rides on visible text + accessible label (role=status, aria-live polite), NOT
// colour-only — the dot glyph is decorative (aria-hidden).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { LiveStatusDot } from '../LiveStatusDot.jsx';

describe('LiveStatusDot (UC-S002-6 live-connection indicator)', () => {
  it('renders a polite status region with a connected accessible name', () => {
    render(<LiveStatusDot state="connected" />);
    const dot = screen.getByTestId('live-status');
    expect(dot).toHaveAttribute('role', 'status');
    expect(dot).toHaveAttribute('aria-live', 'polite');
    expect(dot).toHaveAccessibleName(/live updates: connected/i);
  });

  it('announces reconnecting state (non-colour cue: visible text)', () => {
    render(<LiveStatusDot state="reconnecting" />);
    const dot = screen.getByTestId('live-status');
    expect(dot).toHaveAccessibleName(/live updates: reconnecting/i);
    // visible text carries meaning, not colour alone
    expect(dot).toHaveTextContent(/reconnecting/i);
  });

  it('the dot glyph is decorative (aria-hidden) so meaning is text, not colour', () => {
    render(<LiveStatusDot state="connected" />);
    const glyph = screen.getByTestId('live-status').querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
  });

  it('carries a data-state attribute reflecting the connection state', () => {
    render(<LiveStatusDot state="reconnecting" />);
    expect(screen.getByTestId('live-status')).toHaveAttribute('data-state', 'reconnecting');
  });

  // DEFECT-003 — a lost/errored SSE connection must show a CLEAR, non-colour-only
  // disconnected state (text carries the meaning), not silently look "live".
  it('announces a disconnected state with visible text (non-colour cue) — DEFECT-003', () => {
    render(<LiveStatusDot state="disconnected" />);
    const dot = screen.getByTestId('live-status');
    expect(dot).toHaveAttribute('data-state', 'disconnected');
    expect(dot).toHaveAccessibleName(/disconnected/i);
    // visible text, not colour alone, carries the meaning
    expect(dot).toHaveTextContent(/disconnected/i);
  });
});
