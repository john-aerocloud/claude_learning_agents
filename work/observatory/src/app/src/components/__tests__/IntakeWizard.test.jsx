// @covers uc-s018-1
// @covers IntakeWizard
// @covers WizardStepIndicator
// @covers JtbdFields
// @covers JobSentencePreview
// @covers WizardStepNav
// UC-S018-1 — IntakeWizard: the body-portalled NON-modal floating drawer
// hosting the guided intake flow; THIS UC = shell (4-step state machine) +
// step 1 (JTBD three-field capture + live job-sentence preview).
//
// Drawer idiom REUSE (DEFECT-006 / SteerPanel family — css idiom, not
// component composition): position:fixed, portalled to document.body, zero
// flow height; heading focus on open; Esc/×/Cancel close; focus returns to
// the opener on unmount.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { IntakeWizard } from '../IntakeWizard.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const type = (el, value) => fireEvent.input(el, { target: { value } });
const fields = () => ({
  situation: screen.getByRole('textbox', { name: /situation/i }),
  motivation: screen.getByRole('textbox', { name: /motivation/i }),
  outcome: screen.getByRole('textbox', { name: /outcome/i }),
});

describe('IntakeWizard shell (UC-S018-1)', () => {
  it('A11Y-S018-1-7 / SEL-S018-1-2: role=dialog with an accessible name matching /new work|intake/i, NON-modal (no aria-modal)', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const dlg = screen.getByRole('dialog', { name: /new work|intake/i });
    expect(dlg).toBe(screen.getByTestId('intake-wizard'));
    expect(dlg.getAttribute('aria-modal')).toBeNull();
  });

  it('is body-portalled (DEFECT-006 idiom — zero flow height by construction, GEO-S018-1-1)', () => {
    render(<IntakeWizard onClose={() => {}} />);
    expect(screen.getByTestId('intake-wizard').parentElement).toBe(document.body);
  });

  it('A11Y-S018-1-3: focus moves to the wizard heading (tabindex=-1) on open', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const h = screen.getByTestId('intake-wizard-heading');
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(h);
  });

  it('A11Y-S018-1-1 / SEL-S018-1-3: three JTBD fields, each with a programmatic label (Situation / Motivation / Outcome)', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const f = fields();
    expect(f.situation).toBe(screen.getByTestId('jtbd-situation'));
    expect(f.motivation).toBe(screen.getByTestId('jtbd-motivation'));
    expect(f.outcome).toBe(screen.getByTestId('jtbd-outcome'));
    // label is a real <label for>, not placeholder-as-label
    for (const el of Object.values(f)) {
      expect(document.querySelector(`label[for="${el.id}"]`)).toBeTruthy();
    }
  });

  it('A11Y-S018-1-8 / SEL-S018-1-4: the preview is a role=status aria-live=polite region', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const p = screen.getByTestId('job-sentence-preview');
    expect(p.getAttribute('role')).toBe('status');
    expect(p.getAttribute('aria-live')).toBe('polite');
  });

  it('FIG-S018-1-3: all-empty initial open shows the neutral starter line, not a skeleton and not blank', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const p = screen.getByTestId('job-sentence-preview');
    expect(p.textContent).toMatch(/start typing/i);
    expect(p.textContent).not.toMatch(/undefined|null/);
    expect(p.textContent).not.toMatch(/^When /); // no placeholder-filled skeleton
  });

  it('AC-S018-1-2 / FIG-S018-1-1: typing updates the preview live into the exact human sentence', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const f = fields();
    type(f.situation, 'the loop starves');
    type(f.motivation, 'see the empty queue');
    type(f.outcome, 'replenish in time');
    expect(screen.getByTestId('job-sentence-preview').textContent).toBe(
      'When the loop starves, I want to see the empty queue, so I can replenish in time.',
    );
  });

  it('FIG-S018-1-2 / A11Y-S018-1-10: a partially-filled sentence keeps grammar with DISTINCTLY-MARKED placeholder slots', () => {
    render(<IntakeWizard onClose={() => {}} />);
    type(fields().motivation, 'see the empty queue');
    const p = screen.getByTestId('job-sentence-preview');
    expect(p.textContent).not.toMatch(/undefined|null/);
    expect(p.textContent).toMatch(/^When .*, I want to see the empty queue, so I can .*\.$/);
    // empty slots carry their own class so CSS can dim them distinctly from filled text
    expect(p.querySelectorAll('.job-sentence__slot').length).toBe(2);
  });

  it('A11Y-S018-1-9: step indicator — role=list "Intake steps"; step 1 current (aria-current="step"); steps 2-4 planned with visible "(soon)" text', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const list = screen.getByTestId('wizard-steps');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-label')).toBe('Intake steps');
    const s1 = screen.getByTestId('wizard-step-1');
    expect(s1.getAttribute('data-step-state')).toBe('current');
    expect(s1.getAttribute('aria-current')).toBe('step');
    for (const n of [2, 3, 4]) {
      const s = screen.getByTestId(`wizard-step-${n}`);
      expect(s.getAttribute('data-step-state')).toBe('planned');
      expect(s.getAttribute('aria-current')).toBeNull();
      expect(s.textContent).toMatch(/\(soon\)/);
    }
  });

  it('NAV-S018-1-1: Next advances to step 2 — indicator current, labelled placeholder region, no crash, fields unmounted', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const next = screen.getByRole('button', { name: /next/i });
    expect(next).toBe(screen.getByTestId('wizard-next'));
    expect(next.textContent).toMatch(/cost of delay/i);
    // Back is ABSENT on step 1 (SEL contract)
    expect(screen.queryByTestId('wizard-back')).toBeNull();
    fireEvent.click(next);
    const s2 = screen.getByTestId('wizard-step-2');
    expect(s2.getAttribute('data-step-state')).toBe('current');
    expect(s2.getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('wizard-step-1').getAttribute('data-step-state')).toBe('complete');
    const ph = screen.getByTestId('wizard-step-placeholder');
    expect(ph.textContent).toMatch(/cost-of-delay signals — coming/i);
    expect(screen.queryByTestId('jtbd-situation')).toBeNull();
  });

  it('NAV-S018-1-2: Back returns to step 1 with the entered draft preserved', () => {
    render(<IntakeWizard onClose={() => {}} />);
    type(fields().situation, 'a build fails');
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(screen.getByTestId('wizard-step-1').getAttribute('data-step-state')).toBe('current');
    expect(screen.getByTestId('jtbd-situation').value).toBe('a build fails');
  });

  it('A11Y-S018-1-4: Esc, the × close button, and Cancel each invoke onClose', () => {
    const onClose = vi.fn();
    const { unmount } = render(<IntakeWizard onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('intake-wizard'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('intake-wizard-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('A11Y-S018-1-4: focus RETURNS to the opener on unmount (the drawer focus-return contract)', () => {
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<IntakeWizard onClose={() => {}} />);
    expect(document.activeElement).not.toBe(opener); // heading took focus
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('A11Y-S018-1-3: DOM order is Situation → Motivation → Outcome → preview → Next → Cancel → × (close LAST in DOM, CSS-positioned top-right)', () => {
    render(<IntakeWizard onClose={() => {}} />);
    const f = fields();
    const order = [
      f.situation,
      f.motivation,
      f.outcome,
      screen.getByTestId('job-sentence-preview'),
      screen.getByTestId('wizard-next'),
      screen.getByRole('button', { name: /cancel/i }),
      screen.getByTestId('intake-wizard-close'),
    ];
    for (let i = 0; i < order.length - 1; i += 1) {
      const follows = order[i].compareDocumentPosition(order[i + 1]);
      expect(follows & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // × is literally the last element child of the dialog
    const dlg = screen.getByTestId('intake-wizard');
    expect(dlg.lastElementChild).toBe(screen.getByTestId('intake-wizard-close'));
    // the preview is reachable in the forward tab path (tabindex=0)
    expect(screen.getByTestId('job-sentence-preview').getAttribute('tabindex')).toBe('0');
  });

  it('NOWRITE-S018-1-1: open + type in all three fields + Next + Back issues ZERO network requests (no fetch at all — step 1 is pure client-side)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<IntakeWizard onClose={() => {}} />);
    const f = fields();
    type(f.situation, 's');
    type(f.motivation, 'm');
    type(f.outcome, 'o');
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
