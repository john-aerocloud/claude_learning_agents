// UC-S018-2 — CodStep: the cost-of-delay signals capture surface, mounted by
// IntakeWizard into its EXISTING step-2 slot (replacing the UC-S018-1
// wizard-step-placeholder for currentStep === 2). Owns NO drawer, NO step
// machine, NO state — a PURE RENDER of the wizard's lifted CoD field state +
// the CodScore the wizard computed via lib/codScorer.js (the same lift
// pattern the JTBD fields use, so UC-S018-3's useQueueRank and UC-S018-4's
// prompt builder read value/token/urgencyWhy/riskOfDelay from ONE place).
//
// INPUT IDIOMS (ui-design.md UC-S018-2, decisions recorded there):
//   - Value: native radios in fieldset/legend — three options with VISIBLE
//     plain-language descriptions (a select hides them; FIG-S018-2-2: the
//     bare token never stands alone). No default checked — an unset signal
//     reads as genuinely unset (A11Y-S018-2-3 / FIG empty≠score).
//   - Urgency: yes/no radios (the scorer's timeCritical input) + an OPTIONAL
//     labelled "why now" textarea (prompt prose, not a scorer input).
//   - Risk-of-delay: one OPTIONAL labelled textarea (prompt prose only).
//   - Readout: role=status polite live region — band AS WORDS + reason +
//     next-step hint when complete; a neutral prompt (never a defaulted MED,
//     never blank) when incomplete. data-cod-band only when scored.
//
// NO-WRITE (NOWRITE-S018-2-1): zero network calls — pure client-side render.
//
// HEXAGONAL ROLE: render layer; the scoring rule lives in the pure domain fn
// lib/codScorer.js (unit-tested with no DOM).

import './intake-wizard.css';

/** The three Value options — token + plain-language sentence as ONE visible
 * label (FIG-S018-2-2: the token never stands alone). */
const VALUE_OPTIONS = [
  { token: 'HIGH', key: 'high', sentence: "directly impacts the team's ability to deliver" },
  { token: 'MED', key: 'med', sentence: 'improves the experience but work continues without it' },
  { token: 'LOW', key: 'low', sentence: 'nice-to-have' },
];

/** CodValueSelect — the Value HIGH/MED/LOW radiogroup (single tab stop,
 * arrows select — native radio roving behaviour for free). */
function CodValueSelect({ value, onChange, uid }) {
  const legendId = `cod-value-legend-${uid}`;
  return (
    <fieldset
      class="cod-fieldset"
      role="radiogroup"
      aria-labelledby={legendId}
      data-testid="cod-value"
      data-cod-value={value || undefined}
    >
      <legend id={legendId} class="cod-fieldset__legend">Value</legend>
      {VALUE_OPTIONS.map((opt) => {
        const id = `cod-value-${opt.key}-${uid}`;
        return (
          <div class="cod-option" key={opt.token}>
            <input
              type="radio"
              id={id}
              class="cod-radio"
              name={`cod-value-${uid}`}
              data-testid={`cod-value-${opt.key}`}
              data-value={opt.token}
              checked={value === opt.token}
              onChange={() => onChange('value', opt.token)}
            />
            <label class="cod-option__label" for={id}>
              <span class="cod-option__token">{opt.token}</span>
              {` — ${opt.sentence}`}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

/** CodUrgency — the time-critical yes/no radiogroup (scorer input) + the
 * optional "why now" textarea (prompt prose, UC-S018-4 material). */
function CodUrgency({ timeCritical, urgencyWhy, onChange, uid }) {
  const legendId = `cod-urgency-legend-${uid}`;
  const whyId = `cod-urgency-why-${uid}`;
  const OPTIONS = [
    { key: 'yes', label: 'Yes — time-critical', mapped: true },
    { key: 'no', label: 'No — not time-sensitive', mapped: false },
  ];
  return (
    <fieldset
      class="cod-fieldset"
      role="radiogroup"
      aria-labelledby={legendId}
      data-testid="cod-urgency"
    >
      <legend id={legendId} class="cod-fieldset__legend">Urgency</legend>
      {OPTIONS.map((opt) => {
        const id = `cod-urgency-${opt.key}-${uid}`;
        return (
          <div class="cod-option" key={opt.key}>
            <input
              type="radio"
              id={id}
              class="cod-radio"
              name={`cod-urgency-${uid}`}
              data-testid={`cod-urgency-${opt.key}`}
              data-urgency={opt.key}
              checked={timeCritical === opt.mapped}
              onChange={() => onChange('timeCritical', opt.mapped)}
            />
            <label class="cod-option__label" for={id}>{opt.label}</label>
          </div>
        );
      })}
      <div class="cod-field">
        <label class="cod-field__label" for={whyId}>Why it matters now (optional)</label>
        <textarea
          id={whyId}
          class="cod-field__input"
          data-testid="cod-urgency-why"
          rows={2}
          placeholder="a deadline, a decaying option, a waiting dependency"
          value={urgencyWhy}
          onInput={(e) => onChange('urgencyWhy', e.currentTarget.value)}
        />
      </div>
    </fieldset>
  );
}

/** CodRiskOfDelay — optional prose: what worsens if this is deferred?
 * NOT a scorer input this slice; carried for the UC-S018-4 prompt. */
function CodRiskOfDelay({ riskOfDelay, onChange, uid }) {
  const id = `cod-risk-${uid}`;
  return (
    <div class="cod-field">
      <label class="cod-field__label" for={id}>
        Risk of delay — what worsens if this is deferred? (optional)
      </label>
      <textarea
        id={id}
        class="cod-field__input"
        data-testid="cod-risk"
        rows={2}
        placeholder="e.g. the defect class keeps recurring; the queue starves"
        value={riskOfDelay}
        onInput={(e) => onChange('riskOfDelay', e.currentTarget.value)}
      />
    </div>
  );
}

const TIER_WORD = { HIGH: 'top', MED: 'middle', LOW: 'bottom' };

/** CodScoreReadout — THE FIG surface: the live band readout. Band AS WORDS +
 * reason + next-step hint when scored; a neutral prompt when incomplete
 * (never a defaulted MED, never 0, never blank — FIG-S018-2-3). In the
 * forward tab path (tabindex=0) per A11Y-S018-2-5, the preview idiom. */
function CodScoreReadout({ score }) {
  return (
    <p
      class="cod-score-readout"
      data-testid="cod-score-readout"
      role="status"
      aria-live="polite"
      tabindex="0"
    >
      {score.complete ? (
        <>
          <strong
            class={`cod-band cod-band--${score.band.toLowerCase()}`}
            data-cod-band={score.band}
          >
            {score.band}
          </strong>
          {` — your item would rank in the ${TIER_WORD[score.band]} tier (see the rank preview on the next step). `}
          <span class="cod-reason">{score.reason}</span>
        </>
      ) : (
        <span class="cod-score-neutral">
          Choose a value and urgency to see where this item would rank.
        </span>
      )}
    </p>
  );
}

/**
 * @param {object} props - pure render of the wizard's lifted CoD state.
 * @param {'HIGH'|'MED'|'LOW'|null} props.value
 * @param {boolean|null} props.timeCritical
 * @param {string} props.urgencyWhy
 * @param {string} props.riskOfDelay
 * @param {{token:string|null, band:string|null, complete:boolean, reason:string}} props.score
 *   — the CodScore the wizard computed via scoreCod (the UC-S018-3/4 contract).
 * @param {(field: string, value: unknown) => void} props.onChange
 * @param {string} props.uid - the wizard's useId, for stable label/input ids.
 */
export function CodStep({ value, timeCritical, urgencyWhy, riskOfDelay, score, onChange, uid }) {
  const headingId = `cod-step-h-${uid}`;
  return (
    <section
      class="cod-step"
      role="group"
      aria-labelledby={headingId}
      data-testid="cod-step"
      data-step="cod"
    >
      {/* <h3> under the wizard <h2> — no skipped heading level (A11Y-S018-2-6) */}
      <h3 id={headingId} class="cod-step__h" data-testid="cod-step-heading">Cost of delay</h3>
      <CodValueSelect value={value} onChange={onChange} uid={uid} />
      <CodUrgency timeCritical={timeCritical} urgencyWhy={urgencyWhy} onChange={onChange} uid={uid} />
      <CodRiskOfDelay riskOfDelay={riskOfDelay} onChange={onChange} uid={uid} />
      <CodScoreReadout score={score} />
    </section>
  );
}
