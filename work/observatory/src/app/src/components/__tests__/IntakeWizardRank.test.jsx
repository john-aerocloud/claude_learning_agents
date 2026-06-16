// @covers uc-s018-3
// @covers IntakeWizard
// @covers QueueRankStep
// UC-S018-3 — the real QueueRankStep mounted into the shell's step-3 slot.
//
// What this file pins (acceptance.md UC-S018-3):
//   NAV-S018-3-1     — step 3 current; QueueRankStep REPLACES the placeholder;
//                      step 3 LOST its "(soon)" tag (now built); step 4 keeps it
//   NAV-S018-3-2/3   — Back→step2 preserves CoD; gated path on incomplete CoD
//   NOWRITE-S018-3-2 — NO items GET while currentStep < 3 (fetch on step-3 entry)
//   AC-S018-3-2/3    — exactly ONE getItems; a tier change re-derives, no 2nd GET
//   AC-S018-3-1      — directional sentence with data-rank-* matching the backlog
// The shell contract (drawer, focus, Esc, indicator, de-emphasis) is
// UC-S018-1's and is asserted unchanged by the existing specs — NOT re-stated.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { IntakeWizard, INTAKE_STEPS } from '../IntakeWizard.jsx';

// A fixed backlog: 1 HIGH, 1 MED, 1 LOW (all non-terminal).
const BACKLOG = [
  { id: 'A', state: 'planned', value: 'HIGH' },
  { id: 'B', state: 'in-flight', value: 'MED' },
  { id: 'C', state: 'planned', value: 'LOW' },
];

const advanceTo = async (step) => {
  for (let n = 1; n < step; n += 1) fireEvent.click(screen.getByTestId('wizard-next'));
};
const completeCod = () => {
  fireEvent.click(screen.getByTestId('cod-value-high'));
  fireEvent.click(screen.getByTestId('cod-urgency-yes'));
};

describe('QueueRankStep mounted in the wizard step-3 slot (UC-S018-3)', () => {
  it('INTAKE_STEPS[2].built is now true (step 3 is built — NAV-S018-3-1)', () => {
    expect(INTAKE_STEPS[2].key).toBe('rank');
    expect(INTAKE_STEPS[2].built).toBe(true);
  });

  it('NAV-S018-3-1: step 3 mounts the LIVE QueueRankStep — placeholder GONE for step 3, SURVIVES for step 4; step 3 current; no "(soon)" on step 3', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(BACKLOG);
    render(<IntakeWizard onClose={() => {}} loaders={{ loadActive, loadItems }} />);
    await advanceTo(3);
    expect(screen.getByTestId('queue-rank-step')).toBeTruthy();
    expect(screen.queryByTestId('wizard-step-placeholder')).toBeNull();
    const s3 = screen.getByTestId('wizard-step-3');
    expect(s3.getAttribute('data-step-state')).toBe('current');
    expect(s3.getAttribute('aria-current')).toBe('step');
    // step 3 lost its "(soon)" tag; step 4 still planned & tagged
    expect(s3.textContent).not.toMatch(/soon/i);
    expect(screen.getByTestId('wizard-step-4').textContent).toMatch(/soon/i);
    // step 4 still shows the labelled placeholder
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-step-placeholder').textContent).toMatch(/intake prompt/i);
  });

  it('NOWRITE-S018-3-2: NO items GET while on steps 1–2; the read fires on step-3 ENTRY', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(BACKLOG);
    render(<IntakeWizard onClose={() => {}} loaders={{ loadActive, loadItems }} />);
    // step 1
    expect(loadItems).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('wizard-next')); // step 2
    expect(loadItems).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('wizard-next')); // step 3 → fetch
    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(1));
    expect(loadActive).toHaveBeenCalledTimes(1);
  });

  it('AC-S018-3-1: with a HIGH CoD score and the backlog, the rank sentence is directional with matching data-rank-*', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(BACKLOG);
    render(<IntakeWizard onClose={() => {}} loaders={{ loadActive, loadItems }} />);
    fireEvent.click(screen.getByTestId('wizard-next')); // step 2
    completeCod();
    fireEvent.click(screen.getByTestId('wizard-next')); // step 3
    const preview = await screen.findByTestId('rank-preview');
    // HIGH(3) vs A=3 B=2 C=1 → ahead 0, behind 2, alongside 1, total 3
    expect(preview.getAttribute('data-rank-ahead')).toBe('0');
    expect(preview.getAttribute('data-rank-behind')).toBe('2');
    expect(preview.getAttribute('data-rank-total')).toBe('3');
    expect(preview.textContent).toMatch(/HIGH value/);
    expect(preview.textContent).not.toMatch(/undefined|null|NaN/);
  });

  it('NAV-S018-3-3 (gated path): reaching step 3 with an incomplete CoD shows rank-gated (NO rank); completing step 2 then returning shows the real rank', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(BACKLOG);
    render(<IntakeWizard onClose={() => {}} loaders={{ loadActive, loadItems }} />);
    fireEvent.click(screen.getByTestId('wizard-next')); // step 2 (no CoD chosen)
    fireEvent.click(screen.getByTestId('wizard-next')); // step 3 — gated
    expect(screen.getByTestId('rank-gated')).toBeTruthy();
    expect(screen.queryByTestId('rank-preview')).toBeNull();
    // go back, complete CoD, return → real rank
    fireEvent.click(screen.getByTestId('wizard-back')); // step 2
    completeCod();
    fireEvent.click(screen.getByTestId('wizard-next')); // step 3
    const preview = await screen.findByTestId('rank-preview');
    expect(preview.textContent).toMatch(/HIGH value/);
    expect(screen.queryByTestId('rank-gated')).toBeNull();
  });

  it('AC-S018-3-3 / NOWRITE-S018-3-1: a Back→tier-change→forward round trip does NOT issue a second items GET (rank re-derives from cached items)', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(BACKLOG);
    render(<IntakeWizard onClose={() => {}} loaders={{ loadActive, loadItems }} />);
    fireEvent.click(screen.getByTestId('wizard-next')); // step 2
    completeCod(); // HIGH
    fireEvent.click(screen.getByTestId('wizard-next')); // step 3 → GET
    let preview = await screen.findByTestId('rank-preview');
    expect(preview.getAttribute('data-rank-ahead')).toBe('0'); // HIGH: nothing ahead
    expect(loadItems).toHaveBeenCalledTimes(1);
    // back, change tier to LOW, forward
    fireEvent.click(screen.getByTestId('wizard-back')); // step 2
    fireEvent.click(screen.getByTestId('cod-value-low'));
    fireEvent.click(screen.getByTestId('cod-urgency-no')); // LOW
    fireEvent.click(screen.getByTestId('wizard-next')); // step 3 again
    preview = await screen.findByTestId('rank-preview');
    // LOW(1) vs A=3 B=2 C=1 → ahead 2, behind 0, alongside 1
    expect(preview.getAttribute('data-rank-ahead')).toBe('2');
    expect(preview.getAttribute('data-rank-behind')).toBe('0');
    // CRITICAL: still exactly one GET — the items were cached, the rank re-derived
    expect(loadItems).toHaveBeenCalledTimes(1);
  });
});
