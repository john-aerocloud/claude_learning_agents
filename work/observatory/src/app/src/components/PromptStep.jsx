// UC-S018-4 — PromptStep: the FINAL step-4 content surface, mounted by
// IntakeWizard into its EXISTING step-4 slot (replacing the surviving
// wizard-step-placeholder for currentStep === 4 — after this UC NO placeholder
// branch remains; all four steps built). It composes the captured JTBD + CoD +
// rank into a copy-ready /intake prompt the operator hands to Claude — so new
// work enters through the SAME human-accept intake gate as steer actions, never
// written by the UI.
//
// HEXAGONAL ROLE: render layer. The prompt-composition rule is the pure domain
// fn lib/intakePromptBuilder.js; this file owns only DOM concerns (the Generate
// trigger, the frozen-prompt render, the reused copy/toast wiring, the terminal
// affordance). Owns NO drawer, NO step machine, NO fetch.
//
// REUSE, NOT FORK (the brief's hard rule): the prompt is rendered into the SAME
// prompt-output-slot + .prompt-output <pre> markup SteerPanel uses, copied by the
// VERBATIM s014 CopyPromptButton, and confirmed by the VERBATIM s014 CopyToast.
// The byte-equal clipboard path is unchanged.
//
// PROMPT-FREEZE (EXP-036 / FREEZE-S018-4-1..3): the prompt string mutates ONLY
// on a Generate press (the parent owns `prompt`/`dirty`/`toastVisible` + the
// snapshot; this component is a pure render of them). When the current lifted
// inputs DIVERGE from the generate snapshot (`dirty`), the RegenerateCue (the
// ContextRefreshCue idiom) tells the operator the shown prompt is stale — it is
// NEVER silently refreshed.
//
// NO-WRITE (NOWRITE-S018-4-1/2/3): zero fetch on entry/Generate/Copy/Done/
// Start-another; the clipboard is the only write surface; a visible
// NoWriteAffordance makes the "the UI writes nothing" promise legible.
import { CopyPromptButton } from './CopyPromptButton.jsx';
import { CopyToast } from './CopyToast.jsx';
import { ContextRefreshCue } from './ContextRefreshCue.jsx';
import './steer-panel.css'; // reuse .prompt-output / .steer-panel__output-slot
import './intake-wizard.css';

/** NoWriteAffordance — the always-visible "this hands off to Claude, the UI
 * writes nothing" note (NOWRITE-S018-4-3). Glyph aria-hidden; the TEXT is
 * authoritative (the caption idiom). */
function NoWriteAffordance() {
  return (
    <p class="intake-nowrite-note" data-testid="intake-nowrite-note">
      <span class="intake-nowrite-note__glyph" aria-hidden="true">✋</span>
      The dashboard writes nothing — copy this prompt and paste it to Claude to enter it
      through the intake gate.
    </p>
  );
}

/**
 * @param {object} props
 * @param {{situation:string,motivation:string,outcome:string}} props.jtbd
 * @param {{token:string|null,band:string|null,complete:boolean,reason:string}} props.codScore
 * @param {{urgencyWhy:string,riskOfDelay:string,value:string|null,timeCritical:boolean|null}} props.cod
 * @param {object|null} props.rank - the lifted RankPreview (or null)
 * @param {string|null} props.prompt - the FROZEN prompt; null before first Generate
 * @param {boolean} [props.dirty] - inputs diverged from the generate snapshot
 * @param {boolean} [props.toastVisible] - the reused CopyToast visibility
 * @param {() => void} props.onGenerate - the ONLY prompt mutation point (freeze)
 * @param {() => void} [props.onCopied] - fires after a successful clipboard write
 * @param {() => void} props.onReset - "Start another": clear draft, return to step 1
 * @param {() => void} props.onClose - "Done": close the wizard (focus → launcher)
 * @param {string} props.uid - the wizard's useId, for a stable heading id
 */
export function PromptStep({
  prompt,
  dirty = false,
  toastVisible = false,
  onGenerate,
  onCopied,
  onReset,
  onClose,
  uid,
}) {
  const headingId = `prompt-step-h-${uid}`;
  const hasPrompt = typeof prompt === 'string' && prompt.length > 0;

  return (
    <section
      class="prompt-step"
      role="group"
      aria-labelledby={headingId}
      data-testid="prompt-step"
      data-step="prompt"
    >
      {/* <h3> under the wizard <h2> — no skipped heading level (A11Y-S018-4-1) */}
      <h3 id={headingId} class="prompt-step__h" data-testid="prompt-step-heading">
        Generate prompt
      </h3>

      <NoWriteAffordance />

      {hasPrompt ? (
        <p class="prompt-step__lead">Your intake prompt is ready — copy it, then hand it to Claude.</p>
      ) : null}

      <div class="prompt-step__generate-row">
        <button
          type="button"
          class="intake-generate"
          data-testid="intake-generate"
          onClick={() => onGenerate && onGenerate()}
        >
          {hasPrompt ? 'Re-generate prompt' : 'Generate intake prompt'}
        </button>
        {/* RegenerateCue (the ContextRefreshCue idiom) — shown ONLY when a prompt
            exists AND the inputs diverged; the shown prompt stays frozen until
            Generate is pressed again (FREEZE-S018-4-3). Never colour-only. */}
        {hasPrompt && dirty ? (
          <ContextRefreshCue
            state="updated"
            testId="intake-regenerate-cue"
            texts={{ updated: 'Inputs changed — regenerate to refresh the prompt' }}
            labels={{ updated: 'Intake prompt: inputs changed — regenerate to refresh' }}
          />
        ) : null}
      </div>

      {/* PROMPT OUTPUT SLOT — the REUSED s014 markup (prompt-output-slot +
          .prompt-output <pre> + CopyPromptButton). Present ONLY with a prompt
          (the slot rule — absent, never empty, otherwise: FREEZE-S018-4-1). */}
      <div class="steer-panel__output-slot" data-testid="prompt-output-slot">
        {hasPrompt ? (
          <>
            <pre
              class="prompt-output"
              data-testid="prompt-output"
              aria-label="Generated prompt"
              tabindex="0"
            >
              {prompt}
            </pre>
            <CopyPromptButton prompt={prompt} onCopied={onCopied} />
          </>
        ) : null}
      </div>

      {/* The reused polite copy toast — portalled, zero flow height. */}
      <CopyToast visible={toastVisible} />

      {/* WizardComplete — the terminal affordance, shown once a prompt exists.
          Done closes (focus → launcher, the inherited drawer contract); Start
          another clears the draft + returns to step 1 (NAV-S018-4-3/4). */}
      {hasPrompt ? (
        <div class="prompt-step__terminal">
          <button
            type="button"
            class="intake-done"
            data-testid="intake-done"
            onClick={() => onClose && onClose()}
          >
            Done
          </button>
          <button
            type="button"
            class="intake-start-another"
            data-testid="intake-start-another"
            onClick={() => onReset && onReset()}
          >
            Start another
          </button>
        </div>
      ) : null}
    </section>
  );
}
