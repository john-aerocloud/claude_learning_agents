// @covers uc-s018-4
// @covers IntakeWizard
// @covers PromptStep
// UC-S018-4 — the real PromptStep mounted into the shell's step-4 slot, with
// PROMPT-FREEZE owned by the shell.
//
// What this file pins (acceptance.md UC-S018-4 — wizard-level / integration):
//   NAV-S018-4-1     — step 4 current; PromptStep REPLACES the last placeholder
//                      (NO placeholder branch remains); step 4 LOST its "(soon)"
//                      tag (now built); "Next" ABSENT on step 4
//   FREEZE-S018-4-1  — no prompt on step-4 entry; appears only after Generate
//   FREEZE-S018-4-2  — frozen on upstream edit (Back, change a field, return →
//                      shown prompt byte-identical until Generate pressed again)
//   FREEZE-S018-4-3  — RegenerateCue on divergence; clears on Re-generate
//   AC-S018-4-1      — generated prompt carries all six fields verbatim
//   NAV-S018-4-3/4   — Done closes (onClose); Start another resets to step 1
//   NOWRITE-S018-4-2 — step 4 issues NO new items GET (rank read from lifted state)
// The UC-S018-1/2/3 shell contract is asserted unchanged by the existing specs —
// NOT re-stated here.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { IntakeWizard, INTAKE_STEPS } from '../IntakeWizard.jsx';

const BACKLOG = [
  { id: 'A', state: 'planned', value: 'HIGH' },
  { id: 'B', state: 'in-flight', value: 'MED' },
  { id: 'C', state: 'planned', value: 'LOW' },
];

const fillJtbd = () => {
  fireEvent.input(screen.getByTestId('jtbd-situation'), {
    target: { value: 'the loop starves because no UI work is queued' },
  });
  fireEvent.input(screen.getByTestId('jtbd-motivation'), {
    target: { value: 'see which queue is empty at a glance' },
  });
  fireEvent.input(screen.getByTestId('jtbd-outcome'), {
    target: { value: 'replenish before the constraint goes idle' },
  });
};
const completeCod = () => {
  fireEvent.click(screen.getByTestId('cod-value-high'));
  fireEvent.click(screen.getByTestId('cod-urgency-yes'));
  fireEvent.input(screen.getByTestId('cod-urgency-why'), {
    target: { value: 'the loop is idle right now' },
  });
};
const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

/** Fill steps 1–3 fully, land on step 4 with the backlog fetched. */
const renderToStep4 = async () => {
  const loadActive = vi.fn().mockResolvedValue('demo');
  const loadItems = vi.fn().mockResolvedValue(BACKLOG);
  render(<IntakeWizard onClose={vi.fn()} loaders={{ loadActive, loadItems }} />);
  fillJtbd();
  next(); // → step 2
  completeCod();
  next(); // → step 3
  await waitFor(() => expect(screen.getByTestId('queue-rank-step')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('rank-preview')).toBeTruthy());
  next(); // → step 4
  await waitFor(() => expect(screen.getByTestId('prompt-step')).toBeTruthy());
  return { loadActive, loadItems };
};

describe('PromptStep mounted in the wizard step-4 slot (NAV-S018-4-1)', () => {
  it('INTAKE_STEPS[3].built is now true (step 4 is built)', () => {
    expect(INTAKE_STEPS[3].key).toBe('prompt');
    expect(INTAKE_STEPS[3].built).toBe(true);
  });

  it('step 4 mounts PromptStep; NO placeholder branch remains; step 4 current + no "(soon)"; "Next" ABSENT', async () => {
    await renderToStep4();
    expect(screen.getByTestId('prompt-step')).toBeTruthy();
    expect(screen.queryByTestId('wizard-step-placeholder')).toBeNull();
    const s4 = screen.getByTestId('wizard-step-4');
    expect(s4.getAttribute('data-step-state')).toBe('current');
    expect(s4.getAttribute('aria-current')).toBe('step');
    expect(s4.textContent).not.toMatch(/soon/i);
    expect(screen.queryByTestId('wizard-next')).toBeNull(); // no 5th step
    expect(screen.getByTestId('wizard-back')).toBeTruthy(); // Back remains
  });
});

describe('PROMPT-FREEZE: built only on Generate (FREEZE-S018-4-1)', () => {
  it('no prompt-output on step-4 entry; appears only after Generate', async () => {
    await renderToStep4();
    expect(screen.queryByTestId('prompt-output')).toBeNull();
    fireEvent.click(screen.getByTestId('intake-generate'));
    expect(screen.getByTestId('prompt-output')).toBeTruthy();
  });

  it('AC-S018-4-1: the generated prompt carries all six fields verbatim + the /intake command', async () => {
    await renderToStep4();
    fireEvent.click(screen.getByTestId('intake-generate'));
    const text = screen.getByTestId('prompt-output').textContent;
    expect(text).toMatch(/^\/intake When .+, I want to .+, so I can .+\./m);
    expect(text).toContain('the loop starves because no UI work is queued');
    expect(text).toContain('see which queue is empty at a glance');
    expect(text).toContain('replenish before the constraint goes idle');
    expect(text).toMatch(/value signal:\s*HIGH/i);
    expect(text).toContain('the loop is idle right now');
    // the rank line is the verbatim step-3 sentence
    expect(text).toMatch(/Queue rank/i);
  });
});

describe('PROMPT-FREEZE: frozen on upstream edit, regenerate cue (FREEZE-S018-4-2/3)', () => {
  it('after Generate, going Back + editing a field does NOT silently change the shown prompt; the cue appears; Re-generate refreshes', async () => {
    await renderToStep4();
    fireEvent.click(screen.getByTestId('intake-generate'));
    const frozen = screen.getByTestId('prompt-output').textContent;
    expect(screen.queryByTestId('intake-regenerate-cue')).toBeNull();

    // go Back to step 3 → step 2 → step 1, change the situation, return to step 4
    fireEvent.click(screen.getByTestId('wizard-back')); // → step 3
    fireEvent.click(screen.getByTestId('wizard-back')); // → step 2
    fireEvent.click(screen.getByTestId('wizard-back')); // → step 1
    fireEvent.input(screen.getByTestId('jtbd-situation'), {
      target: { value: 'a DIFFERENT situation entirely' },
    });
    next(); // → 2
    next(); // → 3
    await waitFor(() => expect(screen.getByTestId('rank-preview')).toBeTruthy());
    next(); // → 4
    await waitFor(() => expect(screen.getByTestId('prompt-step')).toBeTruthy());

    // the SHOWN prompt is byte-identical to the frozen one (no live rebuild)
    expect(screen.getByTestId('prompt-output').textContent).toBe(frozen);
    // the divergence is signalled
    const cue = screen.getByTestId('intake-regenerate-cue');
    expect(cue.getAttribute('data-state')).toBe('updated');

    // Re-generate rebuilds from the current inputs + clears the cue
    fireEvent.click(screen.getByTestId('intake-generate'));
    const refreshed = screen.getByTestId('prompt-output').textContent;
    expect(refreshed).not.toBe(frozen);
    expect(refreshed).toContain('a DIFFERENT situation entirely');
    expect(screen.queryByTestId('intake-regenerate-cue')).toBeNull();
  });
});

describe('terminal affordance (NAV-S018-4-3/4)', () => {
  it('Done closes the wizard (onClose called)', async () => {
    const loadActive = vi.fn().mockResolvedValue('demo');
    const loadItems = vi.fn().mockResolvedValue(BACKLOG);
    const onClose = vi.fn();
    render(<IntakeWizard onClose={onClose} loaders={{ loadActive, loadItems }} />);
    fillJtbd();
    next();
    completeCod();
    next();
    await waitFor(() => expect(screen.getByTestId('rank-preview')).toBeTruthy());
    next();
    await waitFor(() => expect(screen.getByTestId('prompt-step')).toBeTruthy());
    fireEvent.click(screen.getByTestId('intake-generate'));
    fireEvent.click(screen.getByTestId('intake-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Start another clears the draft + returns to step 1 (all-empty preview, prompt discarded)', async () => {
    await renderToStep4();
    fireEvent.click(screen.getByTestId('intake-generate'));
    fireEvent.click(screen.getByTestId('intake-start-another'));
    // back on step 1 — the JobSentencePreview shows its all-empty starter
    expect(screen.getByTestId('wizard-step-1').getAttribute('data-step-state')).toBe('current');
    expect(screen.getByTestId('job-sentence-preview').textContent).toMatch(/start typing/i);
    // the JTBD draft is cleared
    expect(screen.getByTestId('jtbd-situation').value).toBe('');
  });
});

describe('NO new GET on step 4 (NOWRITE-S018-4-2)', () => {
  it('the items loader is called exactly ONCE across the whole flow (step-3 entry)', async () => {
    const { loadItems } = await renderToStep4();
    fireEvent.click(screen.getByTestId('intake-generate'));
    fireEvent.click(screen.getByTestId('wizard-back')); // back to step 3 — no 2nd GET
    await waitFor(() => expect(screen.getByTestId('queue-rank-step')).toBeTruthy());
    expect(loadItems).toHaveBeenCalledTimes(1);
  });
});
