// @covers uc-s018-2
// @covers CodStep
// @covers CodValueSelect
// @covers CodUrgency
// @covers CodRiskOfDelay
// @covers CodScoreReadout
// @covers IntakeWizard
// UC-S018-2 — the real CoD signals step mounted into the shell's step-2 slot.
//
// What this file pins (acceptance.md UC-S018-2):
//   AC-S018-2-1/2/3  — the visible truth table through the UI
//   NAV-S018-2-1     — step 2 current; CodStep REPLACES the placeholder
//   NAV-S018-2-2     — Back/forward preserves BOTH drafts (JTBD + CoD)
//   A11Y-S018-2-1..4 — native radiogroups (names, full-description labels,
//                      no default check), labelled textareas
//   A11Y-S018-2-6    — <h3> sub-heading under the wizard <h2>
//   FIG-S018-2-1..3  — band as words; tokens never bare; empty ≠ score
//   NOWRITE-S018-2-1 — the whole step-2 interaction issues zero fetches
//   SEL-S018-2-1..5  — the cod-* selector contract
// The shell contract (drawer, focus, Esc, indicator, de-emphasis) is
// UC-S018-1's and is asserted unchanged by the existing specs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { IntakeWizard } from '../IntakeWizard.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const openStep2 = () => {
  render(<IntakeWizard onClose={() => {}} />);
  fireEvent.click(screen.getByTestId('wizard-next'));
  return screen.getByTestId('cod-step');
};
const pick = (testid) => fireEvent.click(screen.getByTestId(testid));

describe('CodStep mounted in the wizard step-2 slot (UC-S018-2)', () => {
  it('NAV-S018-2-1 / SEL-S018-2-1: Next mounts the LIVE CodStep — placeholder GONE for step 2; step 2 current; <h3> sub-heading (A11Y-S018-2-6)', () => {
    const step = openStep2();
    expect(step).toBeTruthy();
    expect(screen.queryByTestId('wizard-step-placeholder')).toBeNull();
    const s2 = screen.getByTestId('wizard-step-2');
    expect(s2.getAttribute('data-step-state')).toBe('current');
    expect(s2.getAttribute('aria-current')).toBe('step');
    // region semantics: role=group labelled by the <h3> (NOT a second dialog)
    expect(step.getAttribute('role')).toBe('group');
    const h = screen.getByTestId('cod-step-heading');
    expect(h.tagName.toLowerCase()).toBe('h3');
    expect(step.getAttribute('aria-labelledby')).toBe(h.id);
    expect(screen.getAllByRole('dialog').length).toBe(1);
  });

  it('step 3 is now LIVE (QueueRankStep, UC-S018-3); only step 4 KEEPS the labelled placeholder (planned-not-dead survives for the one unbuilt step)', () => {
    openStep2();
    fireEvent.click(screen.getByTestId('wizard-next')); // → step 3 (live)
    expect(screen.queryByTestId('cod-step')).toBeNull();
    expect(screen.getByTestId('queue-rank-step')).toBeTruthy();
    expect(screen.queryByTestId('wizard-step-placeholder')).toBeNull();
    fireEvent.click(screen.getByTestId('wizard-next')); // → step 4 (placeholder)
    expect(screen.getByTestId('wizard-step-placeholder').textContent).toMatch(
      /intake prompt \+ copy handoff — coming/i,
    );
  });

  it('A11Y-S018-2-1 / SEL-S018-2-2: Value radiogroup — name /value/i; three radios whose accessible names are the FULL plain-language descriptions; data hooks', () => {
    openStep2();
    const group = screen.getByRole('radiogroup', { name: /value/i });
    expect(group).toBe(screen.getByTestId('cod-value'));
    const high = screen.getByRole('radio', { name: /HIGH — directly impacts the team's ability to deliver/i });
    const med = screen.getByRole('radio', { name: /MED — improves the experience but work continues without it/i });
    const low = screen.getByRole('radio', { name: /LOW — nice-to-have/i });
    expect(high).toBe(screen.getByTestId('cod-value-high'));
    expect(med).toBe(screen.getByTestId('cod-value-med'));
    expect(low).toBe(screen.getByTestId('cod-value-low'));
    // native single-select semantics: same name attribute (one group)
    expect(high.name).toBe(med.name);
    expect(med.name).toBe(low.name);
    expect(high.getAttribute('data-value')).toBe('HIGH');
    expect(med.getAttribute('data-value')).toBe('MED');
    expect(low.getAttribute('data-value')).toBe('LOW');
  });

  it('FIG-S018-2-2: each Value option LABEL shows token + plain-language sentence — the token never stands alone', () => {
    openStep2();
    for (const [tid, token, sentence] of [
      ['cod-value-high', 'HIGH', /directly impacts the team's ability to deliver/i],
      ['cod-value-med', 'MED', /improves the experience but work continues without it/i],
      ['cod-value-low', 'LOW', /nice-to-have/i],
    ]) {
      const radio = screen.getByTestId(tid);
      const label = document.querySelector(`label[for="${radio.id}"]`);
      expect(label, `${tid} needs a real <label for>`).toBeTruthy();
      expect(label.textContent).toContain(token);
      expect(label.textContent).toMatch(sentence);
      expect(label.textContent.trim()).not.toBe(token); // never bare
    }
  });

  it('A11Y-S018-2-2 / SEL-S018-2-3: Urgency radiogroup — name /urgency/i; Yes/No options with time-critical names; data hooks', () => {
    openStep2();
    const group = screen.getByRole('radiogroup', { name: /urgency/i });
    expect(group).toBe(screen.getByTestId('cod-urgency'));
    const yes = screen.getByRole('radio', { name: /time-critical/i });
    const no = screen.getByRole('radio', { name: /not time-sensitive/i });
    expect(yes).toBe(screen.getByTestId('cod-urgency-yes'));
    expect(no).toBe(screen.getByTestId('cod-urgency-no'));
    expect(yes.getAttribute('data-urgency')).toBe('yes');
    expect(no.getAttribute('data-urgency')).toBe('no');
    expect(yes.name).toBe(no.name);
  });

  it('A11Y-S018-2-3: NO default selection — on first render of step 2 no Value and no Urgency radio is checked (an unset signal is real)', () => {
    openStep2();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.checked, `${radio.getAttribute('data-testid')} must start unchecked`).toBe(false);
    }
  });

  it('A11Y-S018-2-4 / SEL-S018-2-4: the "why it matters now" and risk-of-delay textareas each have a real programmatic <label for> (optional, placeholder never the label)', () => {
    openStep2();
    const why = screen.getByRole('textbox', { name: /why it matters now/i });
    const risk = screen.getByRole('textbox', { name: /risk of delay|deferred/i });
    expect(why).toBe(screen.getByTestId('cod-urgency-why'));
    expect(risk).toBe(screen.getByTestId('cod-risk'));
    for (const el of [why, risk]) {
      expect(document.querySelector(`label[for="${el.id}"]`)).toBeTruthy();
      expect(el.required).toBe(false);
    }
  });

  it('FIG-S018-2-3 / SEL-S018-2-5: empty inputs ≠ a score — neutral prompt, role=status live region, data-cod-band ABSENT; choosing only Value still no band', () => {
    openStep2();
    const readout = screen.getByTestId('cod-score-readout');
    expect(readout.getAttribute('role')).toBe('status');
    expect(readout.getAttribute('aria-live')).toBe('polite');
    expect(readout.textContent).toMatch(/choose a value and urgency/i);
    expect(readout.textContent).not.toMatch(/\bMED\b|undefined|null|NaN|^0$/);
    expect(readout.querySelector('[data-cod-band]')).toBeNull();
    // one signal chosen → STILL incomplete (not a defaulted MED)
    pick('cod-value-high');
    expect(readout.textContent).toMatch(/choose a value and urgency/i);
    expect(readout.querySelector('[data-cod-band]')).toBeNull();
  });

  it('AC-S018-2-1 / FIG-S018-2-1: HIGH + Yes → band HIGH as WORDS with reason + next-step hint; data-cod-band="HIGH"', () => {
    openStep2();
    pick('cod-value-high');
    pick('cod-urgency-yes');
    const readout = screen.getByTestId('cod-score-readout');
    expect(readout.textContent).toMatch(/HIGH/);
    expect(readout.textContent).toMatch(/top tier/i);
    expect(readout.textContent).toMatch(/rank|next step/i); // forward hint
    expect(readout.textContent).not.toMatch(/undefined|null|NaN/);
    expect(readout.querySelector('[data-cod-band]').getAttribute('data-cod-band')).toBe('HIGH');
    // input cross-check hooks reflect the chosen signals
    expect(screen.getByTestId('cod-value').getAttribute('data-cod-value')).toBe('HIGH');
    expect(screen.getByTestId('cod-urgency-yes').checked).toBe(true);
  });

  it('AC-S018-2-2: LOW + No → band LOW (bottom tier)', () => {
    openStep2();
    pick('cod-value-low');
    pick('cod-urgency-no');
    const readout = screen.getByTestId('cod-score-readout');
    expect(readout.textContent).toMatch(/LOW/);
    expect(readout.textContent).toMatch(/bottom tier/i);
    expect(readout.querySelector('[data-cod-band]').getAttribute('data-cod-band')).toBe('LOW');
  });

  it('AC-S018-2-3: every other chosen combination → band MED (middle tier) — and re-choosing updates live', () => {
    openStep2();
    pick('cod-value-med');
    pick('cod-urgency-yes');
    const readout = screen.getByTestId('cod-score-readout');
    expect(readout.querySelector('[data-cod-band]').getAttribute('data-cod-band')).toBe('MED');
    expect(readout.textContent).toMatch(/middle tier/i);
    // flip the signals: HIGH + No is ALSO MED; then HIGH + Yes flips to HIGH — live
    pick('cod-value-high');
    pick('cod-urgency-no');
    expect(readout.querySelector('[data-cod-band]').getAttribute('data-cod-band')).toBe('MED');
    pick('cod-urgency-yes');
    expect(readout.querySelector('[data-cod-band]').getAttribute('data-cod-band')).toBe('HIGH');
  });

  it('NAV-S018-2-2: Back to step 1 preserves the JTBD draft; returning to step 2 preserves the chosen CoD signals AND textarea prose', () => {
    render(<IntakeWizard onClose={() => {}} />);
    fireEvent.input(screen.getByTestId('jtbd-situation'), { target: { value: 'a build fails' } });
    fireEvent.click(screen.getByTestId('wizard-next'));
    pick('cod-value-high');
    pick('cod-urgency-yes');
    fireEvent.input(screen.getByTestId('cod-urgency-why'), { target: { value: 'deadline' } });
    fireEvent.input(screen.getByTestId('cod-risk'), { target: { value: 'outage risk grows' } });
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(screen.getByTestId('jtbd-situation').value).toBe('a build fails');
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('cod-value-high').checked).toBe(true);
    expect(screen.getByTestId('cod-urgency-yes').checked).toBe(true);
    expect(screen.getByTestId('cod-urgency-why').value).toBe('deadline');
    expect(screen.getByTestId('cod-risk').value).toBe('outage risk grows');
    // the band survives the round-trip too (computed from the lifted state)
    expect(
      screen.getByTestId('cod-score-readout').querySelector('[data-cod-band]').getAttribute('data-cod-band'),
    ).toBe('HIGH');
  });

  it('A11Y-S018-2-5 (DOM order): Value group → Urgency group → why-now → risk → readout → Back → Next', () => {
    openStep2();
    const order = [
      screen.getByTestId('cod-value'),
      screen.getByTestId('cod-urgency'),
      screen.getByTestId('cod-urgency-why'),
      screen.getByTestId('cod-risk'),
      screen.getByTestId('cod-score-readout'),
      screen.getByTestId('wizard-back'),
      screen.getByTestId('wizard-next'),
    ];
    for (let i = 0; i < order.length - 1; i += 1) {
      const follows = order[i].compareDocumentPosition(order[i + 1]);
      expect(follows & Node.DOCUMENT_POSITION_FOLLOWING, `position ${i}`).toBeTruthy();
    }
  });

  it('NOWRITE-S018-2-1 (unit pin): the FULL step-2 interaction — radios, textareas, Back, Next — issues ZERO fetches', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    openStep2();
    pick('cod-value-high');
    pick('cod-value-med');
    pick('cod-urgency-yes');
    pick('cod-urgency-no');
    fireEvent.input(screen.getByTestId('cod-urgency-why'), { target: { value: 'w' } });
    fireEvent.input(screen.getByTestId('cod-risk'), { target: { value: 'r' } });
    fireEvent.click(screen.getByTestId('wizard-back'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next')); // step 3 placeholder
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
