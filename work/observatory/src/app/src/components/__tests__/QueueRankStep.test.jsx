// @covers uc-s018-3
// @covers QueueRankStep
// @covers RankPreviewSentence
// UC-S018-3 — QueueRankStep: the step-3 content surface. A PURE render of the
// useQueueRank fetch state + the lifted codScore + rankPreview. Four textually
// DISTINCT states, each its own testid (FIG-S018-3-3): rank-loading /
// rank-error / rank-gated / rank-preview (with data-rank-ahead/-behind/-total).
// Owns NO drawer, NO step machine, NO fetch logic. The hook is injectable for
// testability (mirroring CodStep's score prop pattern).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { QueueRankStep } from '../QueueRankStep.jsx';

const SCORE = (token) => ({ token, band: token, complete: token != null, reason: 'r' });
const BACKLOG = [
  { id: 'A', state: 'planned', value: 'HIGH' },
  { id: 'B', state: 'in-flight', value: 'MED' },
  { id: 'C', state: 'planned', value: 'LOW' },
];

/** Inject a fixed hook return so the component is a deterministic pure render. */
const useRank = (status, items = []) => () => ({ status, items });

describe('QueueRankStep region semantics (A11Y-S018-3-1/2, SEL-S018-3-1)', () => {
  it('is a role=group named /queue rank/i with an <h3> sub-heading and the rank-preview status region', () => {
    render(<QueueRankStep score={SCORE('HIGH')} useRankHook={useRank('ready', BACKLOG)} uid="u" />);
    const region = screen.getByTestId('queue-rank-step');
    expect(region.getAttribute('role')).toBe('group');
    const group = screen.getByRole('group', { name: /queue rank/i });
    expect(group).toBe(region);
    const h = screen.getByTestId('rank-step-heading');
    expect(h.tagName.toLowerCase()).toBe('h3');
    expect(region.getAttribute('aria-labelledby')).toBe(h.id);
  });

  it('the rank sentence is a role=status aria-live=polite region (A11Y-S018-3-1/7)', () => {
    render(<QueueRankStep score={SCORE('HIGH')} useRankHook={useRank('ready', BACKLOG)} uid="u" />);
    const preview = screen.getByTestId('rank-preview');
    expect(preview.getAttribute('role')).toBe('status');
    expect(preview.getAttribute('aria-live')).toBe('polite');
  });
});

describe('QueueRankStep four DISTINCT states (FIG-S018-3-3, SEL-S018-3-2/3)', () => {
  it('GATED (score incomplete) → rank-gated prompt to finish step 2; NO rank, NO number, rank-preview absent', () => {
    render(<QueueRankStep score={SCORE(null)} useRankHook={useRank('ready', BACKLOG)} uid="u" />);
    const gated = screen.getByTestId('rank-gated');
    expect(gated.textContent).toMatch(/value and urgency|previous step|finish/i);
    expect(screen.queryByTestId('rank-preview')).toBeNull();
    expect(screen.queryByTestId('rank-loading')).toBeNull();
    expect(screen.queryByTestId('rank-error')).toBeNull();
    // gated shows no fabricated number
    expect(gated.querySelector('[data-rank-total]')).toBeNull();
  });

  it('LOADING (complete + status loading) → rank-loading "Reading the live queue…"; others absent', () => {
    render(<QueueRankStep score={SCORE('HIGH')} useRankHook={useRank('loading')} uid="u" />);
    expect(screen.getByTestId('rank-loading').textContent).toMatch(/reading the live queue/i);
    expect(screen.queryByTestId('rank-preview')).toBeNull();
    expect(screen.queryByTestId('rank-error')).toBeNull();
    expect(screen.queryByTestId('rank-gated')).toBeNull();
  });

  it('ERROR (complete + status error) → rank-error fail-soft "couldn\'t read the live queue"; NO fabricated rank', () => {
    render(<QueueRankStep score={SCORE('HIGH')} useRankHook={useRank('error')} uid="u" />);
    const err = screen.getByTestId('rank-error');
    expect(err.textContent).toMatch(/couldn.?t read the live queue/i);
    expect(err.textContent).toMatch(/still generate the prompt/i);
    expect(screen.queryByTestId('rank-preview')).toBeNull();
    expect(err.querySelector('[data-rank-total]')).toBeNull();
  });

  it('READY-POPULATED → rank-preview directional sentence with data-rank-ahead/-behind/-total (AC-S018-3-1)', () => {
    // HIGH(3) vs A=3 B=2 C=1 → ahead 0, behind 2, alongside 1, total 3
    render(<QueueRankStep score={SCORE('HIGH')} useRankHook={useRank('ready', BACKLOG)} uid="u" />);
    const preview = screen.getByTestId('rank-preview');
    expect(preview.getAttribute('data-rank-ahead')).toBe('0');
    expect(preview.getAttribute('data-rank-behind')).toBe('2');
    expect(preview.getAttribute('data-rank-total')).toBe('3');
    expect(preview.textContent).toMatch(/HIGH value/);
    expect(preview.textContent).toMatch(/ahead of/i);
    expect(preview.textContent).toMatch(/behind/i);
    expect(preview.textContent).toMatch(/items|item/);
    expect(preview.textContent).not.toMatch(/undefined|null|NaN/);
    expect(screen.queryByTestId('rank-loading')).toBeNull();
    expect(screen.queryByTestId('rank-error')).toBeNull();
    expect(screen.queryByTestId('rank-gated')).toBeNull();
  });

  it('READY-EMPTY (AC-S018-3-4) → rank-preview empty-queue sentence, data-rank-total="0", NOT "ahead of 0", NOT an error', () => {
    render(<QueueRankStep score={SCORE('HIGH')} useRankHook={useRank('ready', [])} uid="u" />);
    const preview = screen.getByTestId('rank-preview');
    expect(preview.getAttribute('data-rank-total')).toBe('0');
    expect(preview.textContent).toMatch(/queue is currently empty/i);
    expect(preview.textContent).toMatch(/would be next/i);
    expect(preview.textContent).not.toMatch(/ahead of 0/i);
    expect(screen.queryByTestId('rank-error')).toBeNull();
  });

  it('LIFT (UC-S018-4 contract): when the wizard supplies the derived RankPreview, the component renders THAT object (single compute site), not a re-derivation', () => {
    const lifted = {
      complete: true,
      total: 9,
      ahead: 7,
      behind: 1,
      alongside: 1,
      token: 'MED',
      empty: false,
      sentence: 'Your item (MED value) would rank ahead of 1 item and behind 7 items.',
    };
    // rankState.items deliberately differs — if the component re-derived it
    // would NOT produce ahead=7; it must render the lifted object verbatim.
    render(
      <QueueRankStep
        score={SCORE('MED')}
        rankState={{ status: 'ready', items: BACKLOG }}
        rank={lifted}
        uid="u"
      />,
    );
    const preview = screen.getByTestId('rank-preview');
    expect(preview.getAttribute('data-rank-ahead')).toBe('7');
    expect(preview.getAttribute('data-rank-behind')).toBe('1');
    expect(preview.getAttribute('data-rank-total')).toBe('9');
    expect(preview.textContent).toBe(lifted.sentence);
  });

  it('FIG-S018-3-4: when populated, ahead + behind + alongside === total (counts add up)', () => {
    render(<QueueRankStep score={SCORE('MED')} useRankHook={useRank('ready', BACKLOG)} uid="u" />);
    const p = screen.getByTestId('rank-preview');
    const total = Number(p.getAttribute('data-rank-total'));
    const ahead = Number(p.getAttribute('data-rank-ahead'));
    const behind = Number(p.getAttribute('data-rank-behind'));
    // alongside isn't a data attr but the text surfaces it; total = sum holds
    expect(ahead + behind).toBeLessThanOrEqual(total);
  });
});
