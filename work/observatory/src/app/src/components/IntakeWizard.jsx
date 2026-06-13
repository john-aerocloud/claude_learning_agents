// UC-S018-1 — IntakeWizard: the body-portalled NON-modal floating drawer
// hosting the guided cost-of-delay intake flow. THIS UC delivers the SHELL
// (heading + 4-step indicator + step-index state machine + step nav) and
// STEP 1 (JTBD three-field capture + live job-sentence preview). Steps 2–4
// are visibly-PLANNED slots: Next advances the state machine to a labelled
// placeholder region (no crash, no dead button, no write) — UC-S018-2/3/4
// mount their real steps into these slots without re-architecting the shell.
//
// DRAWER IDIOM (DEFECT-006 / SteerPanel family — css idiom REUSE, not
// component composition; fifth consumer after DetailPane / SteerPanel /
// ReslicePreviewPanel / DefectDrillContainer): position:fixed, portalled to
// document.body, drawer tokens, NON-modal (no aria-modal, no scrim, no focus
// trap), zero flow height → opening it can never reflow the map or any view
// (GEO-S018-1-1 by construction).
//
// MANAGED FOCUS (A11Y-S018-1-3/4, the SteerPanel useLayoutEffect idiom):
// capture the opener (the IntakeLauncher) synchronously with the mount
// commit, move focus to the heading, RETURN focus to the opener on unmount.
// Esc / × / Cancel all close via onClose.
//
// NO-WRITE (NOWRITE-S018-1-1): step 1 is pure client-side field state +
// sentence assembly — zero network requests of any kind across the whole
// step-1 interaction; the first read call (GET /items) arrives in UC-S018-3.
//
// HEXAGONAL ROLE: render layer. The sentence-assembly rule is the pure
// domain fn lib/jobSentence.js; this file only owns DOM concerns (focus,
// Esc, the step state machine the seam note assigns to the shell).

import { useState, useLayoutEffect, useRef, useId } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { composeJobSentence, EMPTY_SENTENCE_PROMPT } from '../lib/jobSentence.js';
import { scoreCod } from '../lib/codScorer.js';
import { CodStep } from './CodStep.jsx';
import './intake-wizard.css';

/** The four steps of the intake flow (operator language). Steps 1 (UC-S018-1)
 * and 2 (UC-S018-2: CodStep) are built; 3–4 are planned-not-dead (visible
 * "(soon)" indicator + labelled placeholder region on Next). */
export const INTAKE_STEPS = [
  { n: 1, key: 'jtbd', label: 'Describe the job', built: true },
  { n: 2, key: 'cod', label: 'Cost of delay', built: true },
  { n: 3, key: 'rank', label: 'Queue rank', built: false },
  { n: 4, key: 'prompt', label: 'Generate prompt', built: false },
];

/** Labelled placeholder copy for the planned (not-yet-built) step regions. */
const PLANNED_STEP_COPY = {
  3: 'Queue-rank preview — coming in this wizard (next use case)',
  4: 'Intake prompt + copy handoff — coming in this wizard (next use case)',
};

/** WizardStepIndicator — the 4-step progress list (A11Y-S018-1-9: state is
 * number + text + aria-current + data-step-state, never colour alone;
 * planned steps carry visible "(soon)" text). */
function WizardStepIndicator({ currentStep }) {
  return (
    <ol role="list" aria-label="Intake steps" class="wizard-steps" data-testid="wizard-steps">
      {INTAKE_STEPS.map((s) => {
        const state =
          s.n === currentStep
            ? 'current'
            : !s.built
              ? 'planned'
              : s.n < currentStep
                ? 'complete'
                : 'upcoming';
        return (
          <li
            key={s.n}
            class={`wizard-step wizard-step--${state}`}
            data-testid={`wizard-step-${s.n}`}
            data-step-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span class="wizard-step__n" aria-hidden="true">{s.n}</span>
            <span class="wizard-step__label">
              {s.label}
              {state === 'planned' ? <span class="wizard-step__soon"> (soon)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** JtbdFields — the three labelled JTBD prompting fields (A11Y-S018-1-1:
 * real <label for>, placeholders never the sole label; fields stack —
 * GEO-S018-1-4). */
function JtbdFields({ values, onChange, uid }) {
  const FIELDS = [
    {
      key: 'situation',
      label: 'Situation (when…)',
      placeholder: 'the loop starves because no UI work is queued',
    },
    {
      key: 'motivation',
      label: 'Motivation (I want to…)',
      placeholder: 'see which queue is empty at a glance',
    },
    {
      key: 'outcome',
      label: 'Outcome (so I can…)',
      placeholder: 'replenish before the constraint goes idle',
    },
  ];
  return (
    <div class="jtbd-fields">
      {FIELDS.map((f) => {
        const id = `jtbd-${f.key}-${uid}`;
        return (
          <div class="jtbd-field" key={f.key}>
            <label class="jtbd-field__label" for={id}>{f.label}</label>
            <textarea
              id={id}
              class="jtbd-field__input"
              data-testid={`jtbd-${f.key}`}
              rows={2}
              placeholder={f.placeholder}
              value={values[f.key]}
              onInput={(e) => onChange(f.key, e.currentTarget.value)}
            />
          </div>
        );
      })}
    </div>
  );
}

/** JobSentencePreview — the live composed-sentence figure (FIG-S018-1-1..3).
 * role=status polite live region; in the forward tab path (tabindex=0) per
 * A11Y-S018-1-3; empty slots are dimmed-but-readable placeholder spans. */
function JobSentencePreview({ situation, motivation, outcome }) {
  const composed = composeJobSentence({ situation, motivation, outcome });
  return (
    <p
      class="job-sentence-preview"
      data-testid="job-sentence-preview"
      role="status"
      aria-live="polite"
      tabindex="0"
    >
      {composed.allEmpty ? (
        <span class="job-sentence__starter">{EMPTY_SENTENCE_PROMPT}</span>
      ) : (
        composed.segments.map((seg, i) =>
          seg.kind === 'placeholder' ? (
            // eslint-disable-next-line react/no-array-index-key
            <span key={i} class="job-sentence__slot">{seg.text}</span>
          ) : seg.kind === 'filled' ? (
            // eslint-disable-next-line react/no-array-index-key
            <span key={i} class="job-sentence__filled">{seg.text}</span>
          ) : (
            seg.text
          ),
        )
      )}
    </p>
  );
}

/** WizardStepNav — forward/back controls. Next advances the step machine
 * (planned steps render a labelled placeholder, NAV-S018-1-1); Back is
 * absent on step 1; Cancel always closes. */
function WizardStepNav({ currentStep, onNext, onBack, onCancel }) {
  const nextStep = INTAKE_STEPS.find((s) => s.n === currentStep + 1) || null;
  return (
    <div class="wizard-nav">
      {currentStep > 1 ? (
        <button type="button" class="wizard-back" data-testid="wizard-back" onClick={onBack}>
          Back
        </button>
      ) : null}
      {nextStep ? (
        <button type="button" class="wizard-next" data-testid="wizard-next" onClick={onNext}>
          {`Next: ${nextStep.label}`}
        </button>
      ) : null}
      <button
        type="button"
        class="wizard-cancel"
        data-testid="intake-wizard-cancel"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * @param {object} props
 * @param {() => void} props.onClose - Esc / × / Cancel; the host unmounts the
 *   drawer (closing discards the draft — no cross-session persistence).
 */
export function IntakeWizard({ onClose }) {
  // The shell's owned step state machine (seam for UC-S018-2/3/4).
  const [step, setStep] = useState(1);
  // Step-1 draft — lives in the shell so Back/Next preserve it (NAV-S018-1-2).
  const [fields, setFields] = useState({ situation: '', motivation: '', outcome: '' });
  // Step-2 CoD draft (UC-S018-2) — LIFTED beside the JTBD draft so UC-S018-3's
  // useQueueRank and UC-S018-4's prompt builder read value/token/urgencyWhy/
  // riskOfDelay from ONE place, and step navigation preserves it (NAV-S018-2-2).
  const [cod, setCod] = useState({
    value: null, // 'HIGH' | 'MED' | 'LOW' | null — null = not yet chosen
    timeCritical: null, // boolean | null
    urgencyWhy: '', // prompt prose (UC-S018-4), NOT a scorer input
    riskOfDelay: '', // prompt prose (UC-S018-4), NOT a scorer input
  });
  // The shell computes the score (pure domain fn) and passes it down —
  // CodStep is a pure render; the CodScore is the UC-S018-3/4 contract.
  const codScore = scoreCod({ value: cod.value, timeCritical: cod.timeCritical });
  const headingRef = useRef(null);
  const returnFocusRef = useRef(null);
  const uid = useId();
  const headingId = `intake-wizard-h-${uid}`;

  // Managed focus — synchronous with the mount commit (the SteerPanel
  // useLayoutEffect idiom; deterministic, never racing a re-render).
  useLayoutEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (headingRef.current) headingRef.current.focus();
    return () => {
      const opener = returnFocusRef.current;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  const close = () => {
    if (typeof onClose === 'function') onClose();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // topmost overlay handles its own Esc
      close();
    }
  };

  const setField = (key, value) => setFields((prev) => ({ ...prev, [key]: value }));
  const setCodField = (key, value) => setCod((prev) => ({ ...prev, [key]: value }));
  const onNext = () => setStep((s) => Math.min(s + 1, INTAKE_STEPS.length));
  const onBack = () => setStep((s) => Math.max(s - 1, 1));

  return createPortal(
    <section
      class="intake-wizard"
      role="dialog"
      aria-labelledby={headingId}
      data-testid="intake-wizard"
      onKeyDown={onKeyDown}
    >
      {/* div, not <header> — inside role=dialog a <header> maps to a page
          banner landmark (the SteerPanel axe finding). */}
      <div class="intake-wizard__head">
        <h2
          id={headingId}
          class="intake-wizard__h"
          data-testid="intake-wizard-heading"
          ref={headingRef}
          tabindex="-1"
        >
          New work — describe the job
        </h2>
      </div>

      <WizardStepIndicator currentStep={step} />

      {step === 1 ? (
        <div class="intake-wizard__step" data-step="jtbd">
          <JtbdFields values={fields} onChange={setField} uid={uid} />
          <JobSentencePreview {...fields} />
        </div>
      ) : step === 2 ? (
        // UC-S018-2: the LIVE CoD signals step in the shell's step-2 slot
        // (replaces the UC-S018-1 placeholder; the step swap is an internal
        // content change inside the fixed drawer — GEO-S018-2-1).
        <CodStep
          value={cod.value}
          timeCritical={cod.timeCritical}
          urgencyWhy={cod.urgencyWhy}
          riskOfDelay={cod.riskOfDelay}
          score={codScore}
          onChange={setCodField}
          uid={uid}
        />
      ) : (
        // Planned-not-dead (NAV-S018-1-1): a labelled placeholder region —
        // UC-S018-3/4 replace this branch with their real steps.
        <p class="wizard-step-placeholder" data-testid="wizard-step-placeholder">
          {PLANNED_STEP_COPY[step]}
        </p>
      )}

      <WizardStepNav currentStep={step} onNext={onNext} onBack={onBack} onCancel={close} />

      {/* × LAST in DOM (keyboard path fields → preview → nav → ×) but
          CSS-positioned top-right (the drawer-family idiom). */}
      <button
        type="button"
        class="intake-wizard__close"
        data-testid="intake-wizard-close"
        aria-label="Close new work wizard"
        onClick={close}
      >
        <span aria-hidden="true">×</span>
      </button>
    </section>,
    // PORTAL: document.body — own stacking context above the dashboard;
    // zero flow height by construction (GEO-S018-1-1).
    document.body,
  );
}
