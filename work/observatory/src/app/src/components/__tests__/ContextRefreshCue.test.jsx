// @covers uc-s014-4
// @covers ContextRefreshCue
// UC-S014-4 — ContextRefreshCue: the EXP-036 stale/live cue on the steer
// context block, reusing the LiveStatusDot idiom — meaning rides on
// (1) visible TEXT (authoritative), (2) an aria-hidden glyph (decorative,
// never the sole signal), (3) role="status" aria-live="polite" announce-once.
// FIG-2: every state renders a HUMAN sentence — never a raw timestamp, frame
// id, or SSE event name.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ContextRefreshCue } from '../ContextRefreshCue.jsx';

describe('ContextRefreshCue (UC-S014-4, EXP-036)', () => {
  it('live: quiet steady indicator — visible "Live" text + aria-hidden glyph', () => {
    render(<ContextRefreshCue state="live" />);
    const cue = screen.getByTestId('steer-context-live');
    expect(cue.getAttribute('data-state')).toBe('live');
    expect(cue.textContent).toMatch(/live/i);
    const glyph = cue.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    // accessible name carries the FULL state (S14-4-A11Y-8 contract)
    expect(cue.getAttribute('aria-label')).toMatch(/item context: live/i);
  });

  it('refreshing: visible "Refreshing…" text', () => {
    render(<ContextRefreshCue state="refreshing" />);
    const cue = screen.getByTestId('steer-context-live');
    expect(cue.getAttribute('data-state')).toBe('refreshing');
    expect(cue.textContent).toMatch(/refreshing/i);
  });

  it('updated: the operative regenerate sentence — text + glyph, never colour alone (A11Y-3)', () => {
    render(<ContextRefreshCue state="updated" />);
    const cue = screen.getByTestId('steer-context-live');
    expect(cue.getAttribute('data-state')).toBe('updated');
    expect(cue.textContent).toMatch(/context updated — regenerate to refresh the prompt/i);
    expect(cue.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(cue.getAttribute('aria-label')).toMatch(/updated/i);
  });

  it('is a polite status region (role=status, aria-live=polite — announce once, A11Y-8)', () => {
    render(<ContextRefreshCue state="live" />);
    const cue = screen.getByTestId('steer-context-live');
    expect(cue.getAttribute('role')).toBe('status');
    expect(cue.getAttribute('aria-live')).toBe('polite');
  });

  it('FIG-2: no machine tokens — no epoch timestamps, no "event:" / frame ids in any state', () => {
    for (const state of ['live', 'refreshing', 'updated']) {
      const { unmount } = render(<ContextRefreshCue state={state} />);
      const text = screen.getByTestId('steer-context-live').textContent;
      expect(text).not.toMatch(/event:/i);
      expect(text).not.toMatch(/\b\d{10,}\b/); // no epoch
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamp
      unmount();
    }
  });

  it('falls back to "live" on an unknown state (fail-soft, never blank/crash)', () => {
    render(<ContextRefreshCue state="bogus" />);
    const cue = screen.getByTestId('steer-context-live');
    expect(cue.getAttribute('data-state')).toBe('live');
    expect(cue.textContent).toMatch(/live/i);
  });
});

// @covers uc-s013-4
// UC-S013-4 — the cue idiom gets a SECOND consumer (the defect drill's
// PROMPT-FREEZE-style record cue), so the component gains ADDITIVE overrides:
// testId + per-state text/label wording. Defaults are byte-identical to the
// steer values (every pin above stays green untouched) — one idiom, one
// component, per-surface words.
describe('ContextRefreshCue — per-consumer overrides (UC-S013-4)', () => {
  it('testId + texts/labels overrides render the consumer wording; idiom invariants hold', () => {
    render(
      <ContextRefreshCue
        state="updated"
        testId="defect-drill-cue"
        texts={{ updated: 'Record updated — re-open to refresh' }}
        labels={{ updated: 'Defect record: updated — re-open to refresh' }}
      />,
    );
    const cue = screen.getByTestId('defect-drill-cue');
    expect(cue.getAttribute('data-state')).toBe('updated');
    expect(cue.textContent).toMatch(/record updated — re-open to refresh/i);
    expect(cue.getAttribute('aria-label')).toMatch(/defect record: updated/i);
    // idiom invariants: polite status region + aria-hidden glyph (never colour-only)
    expect(cue.getAttribute('role')).toBe('status');
    expect(cue.getAttribute('aria-live')).toBe('polite');
    expect(cue.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('states NOT overridden fall back to the default wording (partial override is safe)', () => {
    render(
      <ContextRefreshCue
        state="live"
        testId="defect-drill-cue"
        texts={{ updated: 'Record updated — re-open to refresh' }}
      />,
    );
    const cue = screen.getByTestId('defect-drill-cue');
    expect(cue.getAttribute('data-state')).toBe('live');
    expect(cue.textContent).toMatch(/live/i);
    expect(cue.getAttribute('aria-label')).toMatch(/item context: live/i);
  });
});
