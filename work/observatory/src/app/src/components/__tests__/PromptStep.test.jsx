// @covers uc-s018-4
// @covers PromptStep
// @covers GenerateIntakeButton
// @covers NoWriteAffordance
// @covers RegenerateCue
// @covers WizardComplete
// UC-S018-4 — PromptStep: the step-4 content surface, mounted by IntakeWizard
// into its EXISTING step-4 slot (replacing the surviving wizard-step-placeholder
// for currentStep === 4). A PURE render of the lifted draft + the one
// buildIntakePrompt call on Generate; owns NO drawer, NO step machine, NO fetch.
// REUSES the s014 PromptOutput slot + CopyPromptButton + CopyToast VERBATIM (not
// forked). PROMPT-FREEZE: the prompt mutates ONLY on Generate (EXP-036).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { PromptStep } from '../PromptStep.jsx';
import { buildIntakePrompt } from '../../lib/intakePromptBuilder.js';

const JTBD = {
  situation: 'the loop starves because no UI work is queued',
  motivation: 'see which queue is empty at a glance',
  outcome: 'replenish before the constraint goes idle',
};
const CODSCORE = {
  token: 'HIGH',
  band: 'HIGH',
  complete: true,
  reason: 'High value and time-critical — ranks with the top tier.',
};
const COD = {
  value: 'HIGH',
  timeCritical: true,
  urgencyWhy: 'the loop is idle right now',
  riskOfDelay: 'engineers sit idle',
};
const RANK = {
  complete: true,
  total: 6,
  ahead: 2,
  behind: 3,
  alongside: 1,
  token: 'HIGH',
  empty: false,
  sentence: 'Your item (HIGH value) would rank ahead of 2 items and behind 3 items.',
};

const PROMPT = buildIntakePrompt({ jtbd: JTBD, codScore: CODSCORE, cod: COD, rank: RANK });

function base(overrides = {}) {
  return {
    jtbd: JTBD,
    codScore: CODSCORE,
    cod: COD,
    rank: RANK,
    prompt: null,
    dirty: false,
    toastVisible: false,
    onGenerate: vi.fn(),
    onCopied: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    uid: 'u',
    ...overrides,
  };
}

describe('PromptStep region semantics (A11Y-S018-4-1, SEL-S018-4-1)', () => {
  it('is a role=group named /generate prompt/i with an <h3> sub-heading', () => {
    render(<PromptStep {...base()} />);
    const region = screen.getByTestId('prompt-step');
    expect(region.getAttribute('role')).toBe('group');
    expect(screen.getByRole('group', { name: /generate prompt/i })).toBe(region);
    const h = screen.getByTestId('prompt-step-heading');
    expect(h.tagName.toLowerCase()).toBe('h3');
    expect(region.getAttribute('aria-labelledby')).toBe(h.id);
  });

  it('NOWRITE-S018-4-3: the nowrite note is present with visible "writes nothing" copy', () => {
    render(<PromptStep {...base()} />);
    const note = screen.getByTestId('intake-nowrite-note');
    expect(note.textContent.toLowerCase()).toMatch(/writes nothing/);
  });
});

describe('PromptStep pre-generate state (FREEZE-S018-4-1, SEL-S018-4-3)', () => {
  it('with prompt==null: the Generate button is present; NO prompt-output, NO Copy, NO terminal affordance', () => {
    render(<PromptStep {...base({ prompt: null })} />);
    expect(screen.getByRole('button', { name: /generate.*prompt/i })).toBeTruthy();
    expect(screen.getByTestId('intake-generate')).toBeTruthy();
    expect(screen.queryByTestId('prompt-output')).toBeNull();
    expect(screen.queryByTestId('copy-prompt-btn')).toBeNull();
    expect(screen.queryByTestId('intake-done')).toBeNull();
    expect(screen.queryByTestId('intake-start-another')).toBeNull();
    expect(screen.queryByTestId('intake-regenerate-cue')).toBeNull();
  });

  it('pressing Generate calls onGenerate (the only prompt mutation point)', () => {
    const onGenerate = vi.fn();
    render(<PromptStep {...base({ prompt: null, onGenerate })} />);
    fireEvent.click(screen.getByTestId('intake-generate'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});

describe('PromptStep generated state (AC-S018-4-1, A11Y-S018-4-2, SEL-S018-4-2)', () => {
  it('renders the frozen prompt in the REUSED prompt-output <pre> (focusable, labelled)', () => {
    render(<PromptStep {...base({ prompt: PROMPT })} />);
    const slot = screen.getByTestId('prompt-output-slot');
    const pre = screen.getByTestId('prompt-output');
    expect(slot.contains(pre)).toBe(true);
    expect(pre.tagName.toLowerCase()).toBe('pre');
    expect(pre.getAttribute('aria-label')).toBe('Generated prompt');
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(pre.textContent).toBe(PROMPT);
  });

  it('AC-S018-4-1: the rendered prompt contains all six required fields verbatim', () => {
    render(<PromptStep {...base({ prompt: PROMPT })} />);
    const text = screen.getByTestId('prompt-output').textContent;
    expect(text).toContain(JTBD.situation);
    expect(text).toContain(JTBD.motivation);
    expect(text).toContain(JTBD.outcome);
    expect(text).toMatch(/value signal:\s*HIGH/i);
    expect(text).toContain(COD.urgencyWhy);
    expect(text).toMatch(/^\/intake When .+, I want to .+, so I can .+\./m);
  });

  it('renders the REUSED CopyPromptButton (byte-equal copy target) + the terminal affordance', () => {
    render(<PromptStep {...base({ prompt: PROMPT })} />);
    expect(screen.getByTestId('copy-prompt-btn')).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
    expect(screen.getByTestId('intake-done')).toBeTruthy();
    expect(screen.getByTestId('intake-start-another')).toBeTruthy();
  });

  it('the Generate button label flips to a regenerate form once a prompt exists (still matches /generate/i)', () => {
    render(<PromptStep {...base({ prompt: PROMPT })} />);
    const btn = screen.getByTestId('intake-generate');
    expect(btn.textContent).toMatch(/generate/i);
    expect(btn.textContent.toLowerCase()).toMatch(/re-?generate/);
  });
});

describe('PromptStep regenerate cue (FREEZE-S018-4-3, A11Y-S018-4-8)', () => {
  it('absent when not dirty (prompt matches inputs)', () => {
    render(<PromptStep {...base({ prompt: PROMPT, dirty: false })} />);
    expect(screen.queryByTestId('intake-regenerate-cue')).toBeNull();
  });

  it('present with data-state=updated + role=status + instructive text when dirty', () => {
    render(<PromptStep {...base({ prompt: PROMPT, dirty: true })} />);
    const cue = screen.getByTestId('intake-regenerate-cue');
    expect(cue.getAttribute('data-state')).toBe('updated');
    expect(cue.getAttribute('role')).toBe('status');
    expect(cue.getAttribute('aria-live')).toBe('polite');
    expect(cue.textContent.toLowerCase()).toMatch(/regenerate|inputs changed/);
  });

  it('the cue is NOT shown before any prompt exists', () => {
    render(<PromptStep {...base({ prompt: null, dirty: true })} />);
    expect(screen.queryByTestId('intake-regenerate-cue')).toBeNull();
  });
});

describe('PromptStep copy + toast (AC-S018-4-2, A11Y-S018-4-3, SEL-S018-4-2)', () => {
  let writeText;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('Copy writes the EXACT displayed <pre> text byte-for-byte', async () => {
    render(<PromptStep {...base({ prompt: PROMPT })} />);
    const preText = screen.getByTestId('prompt-output').textContent;
    fireEvent.click(screen.getByTestId('copy-prompt-btn'));
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(preText);
    expect(writeText).toHaveBeenCalledWith(PROMPT);
  });

  it('the CopyToast renders when toastVisible', () => {
    render(<PromptStep {...base({ prompt: PROMPT, toastVisible: true })} />);
    const toast = screen.getByTestId('copy-toast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });
});

describe('PromptStep terminal affordance (NAV-S018-4-3/4, SEL-S018-4-3)', () => {
  it('Done calls onClose', () => {
    const onClose = vi.fn();
    render(<PromptStep {...base({ prompt: PROMPT, onClose })} />);
    fireEvent.click(screen.getByTestId('intake-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Start another calls onReset', () => {
    const onReset = vi.fn();
    render(<PromptStep {...base({ prompt: PROMPT, onReset })} />);
    fireEvent.click(screen.getByTestId('intake-start-another'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('Done / Start another are resolvable by role+name', () => {
    render(<PromptStep {...base({ prompt: PROMPT })} />);
    expect(screen.getByRole('button', { name: /done/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /start another/i })).toBeTruthy();
  });
});

describe('PromptStep is a pure render — no fetch (NOWRITE-S018-4-1/2)', () => {
  it('mounting + Generate + Copy issue NO network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    render(<PromptStep {...base({ prompt: PROMPT })} />);
    fireEvent.click(screen.getByTestId('intake-generate'));
    fireEvent.click(screen.getByTestId('intake-done'));
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
