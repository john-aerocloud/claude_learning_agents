// UC-S015-3 — ReslicePreviewPanel: the two-column before/after re-slice
// preview drawer the SteerMenu's "Request re-slice / split" action opens.
//
// DRAWER FAMILY, NOT A FORK (ui-design UC-S015-3): a SIBLING of SteerPanel —
// it REUSES the steer-panel.css drawer idiom (position:fixed, body portal,
// --z-drawer + 1, non-modal, focus-move-on-open + focus-return-on-close,
// Esc/×/Cancel, the dt/dd labelled-figure pattern, the aria-disabled Generate
// guard styling) via shared classes; reslice-preview-panel.css adds ONLY the
// two-column geometry. Opening it adds ZERO flow height (GEO-S015-3-1).
//
// HEXAGONAL ROLE: render layer. The panel is a PURE function of resolved
// props — {status, context} from useSteerContext (the s014 six-field contract,
// rendered VERBATIM in the Before column) + the useReslicePreview After state.
// The only impure behaviour is managed focus + Esc, both DOM concerns proper
// to the render layer. ReslicePreviewPanelContainer below is the thin wiring
// seam (hooks → panel) the ObservatoryView dispatch mounts.
//
// PREVIEW-ONLY (RESLICE-PREVIEW-1): the panel WRITES NOTHING — no items.csv
// edit, no split, no server call. Generate's ONLY output is
//   onGenerate({ itemId, context, partAJob, partBJob, intentNote })
// — the UC-S015-4 handoff seam (the enriched buildPrompt's inputs).
//
// UC-S015-4 — the reserved prompt-output slot now renders the ENRICHED
// re-slice/split prompt (the `prompt` prop, container-owned): the s014
// PromptOutput presentation (mono/40vh/selectable <pre>, steer-panel.css
// REUSED), the DELIVERED CopyPromptButton + CopyToast (byte-equal clipboard,
// polite toast — components reused, not forked). The clipboard stays the
// app's ONLY write surface. Without a prompt the slot stays EMPTY exactly as
// UC-S015-3 pinned it.
//
// TAB ORDER (S15-3-A11Y-1): heading(focus target, tabindex=-1) → Part A →
// Part B → intent → Generate → Cancel → ×. The × is LAST IN DOM but
// CSS-positioned top-right (the SteerPanel discipline).
//
// STATES: loading (Before placeholder, After fields disabled) · ready ·
// not-found ("Item <id> not found" — After + Generate hidden, fail-soft,
// S15-3-FIG-4) · error ("Could not load item context — try again").

import { useState, useEffect, useLayoutEffect, useRef, useId } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useSteerContext } from '../hooks/useSteerContext.js';
import { useReslicePreview } from '../hooks/useReslicePreview.js';
import { buildPrompt } from '../lib/promptBuilder.js';
import { CopyPromptButton } from './CopyPromptButton.jsx';
import { CopyToast, toastDurationMs } from './CopyToast.jsx';
import './steer-panel.css';
import './reslice-preview-panel.css';

/** Unknown ≠ blank (S15-3-FIG-1, the s014 dash discipline). */
function dash(v) {
  return typeof v === 'string' && v.length > 0 ? v : '—';
}

/**
 * @param {object} props
 * @param {string} props.itemId
 * @param {'loading'|'ready'|'not-found'|'error'} props.status
 * @param {object|null} props.context - the useSteerContext six-field contract
 * @param {string} props.partAJob
 * @param {string} props.partBJob
 * @param {string} props.intentNote
 * @param {boolean} props.canGenerate - F-S3-4 guard (all three fields non-empty)
 * @param {string|null} props.costNote - directional note; null until both parts non-empty
 * @param {(v:string)=>void} props.onPartAChange
 * @param {(v:string)=>void} props.onPartBChange
 * @param {(v:string)=>void} props.onIntentChange
 * @param {() => void} props.onCancel
 * @param {(seam:{itemId:string,context:object|null,partAJob:string,partBJob:string,intentNote:string}) => void} [props.onGenerate]
 * @param {string|null} [props.prompt] - UC-S015-4: the enriched re-slice prompt to render in the output slot
 */
export function ReslicePreviewPanel({
  itemId,
  status,
  context,
  partAJob,
  partBJob,
  intentNote,
  canGenerate,
  costNote,
  onPartAChange,
  onPartBChange,
  onIntentChange,
  onCancel,
  onGenerate,
  prompt = null,
}) {
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef(null);
  const headingRef = useRef(null);
  const returnFocusRef = useRef(null);
  const uid = useId();
  const headingId = `reslice-panel-h-${uid}`;
  const partAId = `part-a-${uid}`;
  const partBId = `part-b-${uid}`;
  const intentId = `reslice-intent-${uid}`;

  // UC-S015-4: the toast's auto-dismiss timer lives here (the SteerPanel
  // idiom — the panel owns the copy handler's UI consequence; CopyToast stays
  // pure). Cleaned on unmount.
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);
  const onCopied = () => {
    setToastVisible(true); // a polite status region — focus is untouched
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToastVisible(false); // auto-dismiss after --dur-toast
    }, toastDurationMs());
  };

  // Managed focus (S15-3-A11Y-2) — the SteerPanel layout-effect idiom
  // (sha 0c2b49c): synchronous with the mount commit so the heading is
  // focused before anything can observe the panel; focus RETURNS to the
  // opener (the SteerMenu trigger) on unmount.
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

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // topmost overlay handles its own Esc
      onCancel && onCancel();
    }
  };

  const generate = () => {
    if (!canGenerate || status !== 'ready') return; // aria-disabled guard (F-S3-4)
    if (typeof onGenerate === 'function') {
      onGenerate({ itemId, context, partAJob, partBJob, intentNote });
    }
  };

  // Columns + intent render while the context is loading (disabled) or ready;
  // not-found/error hide the form (fail-soft — Cancel/× remain).
  const showForm = status === 'ready' || status === 'loading';
  const fieldsDisabled = status !== 'ready';

  return createPortal(
    <section
      class="steer-panel reslice-preview-panel"
      role="dialog"
      aria-labelledby={headingId}
      data-testid="reslice-preview-panel"
      data-item-id={itemId}
      onKeyDown={onKeyDown}
    >
      <div class="steer-panel__head">
        <h2
          id={headingId}
          class="steer-panel__h"
          data-testid="reslice-heading"
          ref={headingRef}
          tabindex="-1"
        >
          {`Re-slice / split: ${itemId}`}
        </h2>
      </div>

      {status === 'loading' ? (
        <p class="steer-panel__placeholder" data-testid="reslice-context-loading">
          Loading item context…
        </p>
      ) : null}
      {status === 'error' ? (
        <p class="steer-panel__placeholder" data-testid="reslice-context-error">
          Could not load item context — try again
        </p>
      ) : null}
      {status === 'not-found' ? (
        <p class="steer-panel__placeholder" data-testid="reslice-context-notfound">
          {`Item ${itemId} not found`}
        </p>
      ) : null}

      {showForm ? (
        <div class="reslice-columns" data-testid="reslice-columns">
          {/* BEFORE — a PURE render of the useSteerContext six-field contract
              VERBATIM (the SteerContextBlock figure surface; S15-3-FIG-1,
              A11Y-7). Fields stack inside the column (GEO-S015-3-3). */}
          <section
            class="reslice-col reslice-before"
            data-testid="reslice-before"
            data-source={context ? context.sourceRef : undefined}
          >
            <h3 class="reslice-col__h">Current item</h3>
            {status === 'ready' && context ? (
              <>
                <dl class="steer-context reslice-before__fields">
                  <dt>Item</dt>
                  <dd data-testid="reslice-before-id">
                    {context.job ? `${context.id} — ${context.job}` : context.id}
                  </dd>
                  <dt>Job</dt>
                  <dd data-testid="reslice-before-job">{dash(context.job)}</dd>
                  <dt>Value</dt>
                  <dd data-testid="reslice-before-value">{dash(context.value)}</dd>
                  <dt>Cost</dt>
                  <dd data-testid="reslice-before-cost">{dash(context.cost)}</dd>
                  <dt>Current stage</dt>
                  <dd data-testid="reslice-before-stage">{dash(context.state)}</dd>
                </dl>
                <p class="reslice-before__note" data-testid="reslice-before-note">
                  After split, this item will be replaced by Part A and Part B
                </p>
              </>
            ) : null}
          </section>

          {/* AFTER — the proposed split (operator input). Part A / Part B /
              cost-note stack vertically (GEO-S015-3-3). */}
          <section class="reslice-col reslice-after" data-testid="reslice-after">
            <h3 class="reslice-col__h">Proposed split</h3>
            <label class="reslice-field__label" for={partAId}>Part A job sentence</label>
            <textarea
              id={partAId}
              class="intent-note reslice-part"
              data-testid="part-a-job"
              rows={3}
              placeholder="Describe what Part A will deliver…"
              disabled={fieldsDisabled}
              value={partAJob}
              onInput={(e) => onPartAChange && onPartAChange(e.currentTarget.value)}
            />
            <label class="reslice-field__label" for={partBId}>Part B job sentence</label>
            <textarea
              id={partBId}
              class="intent-note reslice-part"
              data-testid="part-b-job"
              rows={3}
              placeholder="Describe what Part B will deliver…"
              disabled={fieldsDisabled}
              value={partBJob}
              onInput={(e) => onPartBChange && onPartBChange(e.currentTarget.value)}
            />
            {/* Directional cost note — ONLY when both parts are non-empty
                (S15-3-FIG-3: an unfilled split is NOT a staged proposal). */}
            {typeof costNote === 'string' && costNote.length > 0 ? (
              <p class="reslice-cost-note" data-testid="reslice-cost-note">{costNote}</p>
            ) : null}
          </section>
        </div>
      ) : null}

      {showForm ? (
        <div class="steer-panel__intent">
          <label class="steer-panel__intent-label" for={intentId}>
            Why are you splitting this item?
          </label>
          <textarea
            id={intentId}
            class="intent-note"
            data-testid="reslice-intent"
            rows={3}
            placeholder="Explain the intent behind the split (e.g. too big to flow…)"
            disabled={fieldsDisabled}
            value={intentNote}
            onInput={(e) => onIntentChange && onIntentChange(e.currentTarget.value)}
          />
        </div>
      ) : null}

      <div class="steer-panel__actions">
        {showForm ? (
          <button
            type="button"
            class="steer-generate"
            data-testid="reslice-generate"
            aria-disabled={canGenerate && status === 'ready' ? 'false' : 'true'}
            onClick={generate}
          >
            Looks right — generate prompt
          </button>
        ) : null}
        <button
          type="button"
          class="steer-cancel"
          data-testid="reslice-cancel"
          onClick={() => onCancel && onCancel()}
        >
          Cancel
        </button>
      </div>

      {/* PROMPT OUTPUT SLOT (UC-S015-4) — the enriched re-slice/split prompt.
          The s014 idiom INHERITED: a read-only, whitespace-exact, SELECTABLE
          <pre> (steer-panel.css .prompt-output — mono, 40vh cap) with the
          one-click CopyPromptButton trailing it (tab order prompt → copy);
          both present ONLY with a prompt — the slot stays EMPTY otherwise
          (the UC-S015-3 pin, now scoped to the no-prompt state). */}
      <div class="steer-panel__output-slot" data-testid="prompt-output-slot">
        {typeof prompt === 'string' && prompt.length > 0 ? (
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

      {/* UC-S015-4: copy confirmation — the DELIVERED CopyToast (portalled
          fixed status region; zero flow height; never takes focus). */}
      <CopyToast visible={toastVisible} />

      {/* × LAST in DOM (keyboard path), CSS-positioned top-right. */}
      <button
        type="button"
        class="steer-panel__close"
        data-testid="reslice-close"
        aria-label={`Close re-slice preview for ${itemId}`}
        onClick={() => onCancel && onCancel()}
      >
        <span aria-hidden="true">×</span>
      </button>
    </section>,
    // PORTAL: document.body — zero flow height; opening the drawer can never
    // reflow the WIP list / VSM / tree behind it (GEO-S015-3-1).
    document.body,
  );
}

/**
 * ReslicePreviewPanelContainer — the thin wiring seam the ObservatoryView
 * `re-slice` dispatch branch mounts (the UC-S015-2 seam re-pointed here):
 * useSteerContext(itemId) feeds the Before column VERBATIM; useReslicePreview
 * owns the After state. Mirrors SteerPanelContainer.
 *
 * UC-S015-4: the container OWNS prompt generation — on the panel's onGenerate
 * it calls the ENRICHED pure buildPrompt('re-slice', context, intentNote,
 * { partAJob, partBJob }) (client-side only, no server request) and passes
 * the result back down as the `prompt` prop. `context` is the SAME
 * useSteerContext object the Before column rendered, so the prompt's
 * {{item_*}} tokens and the Before column are byte-consistent. A caller-
 * supplied onGenerate still fires (UC-S015-3 contract preserved).
 *
 * PROMPT-FREEZE-1 (inherited from s014) lives HERE: prompt state mutates ONLY
 * in handleGenerate (an explicit Generate press). useSteerContext's SSE
 * refresh re-renders the Before column; nothing on that path touches `prompt`.
 * @param {object} props
 * @param {string} props.itemId
 * @param {string|null} [props.project] - active project (hook resolves it when absent)
 * @param {(project:string)=>Promise<Array|null>} [props.loadItems] - injectable items loader
 * @param {(onChange:(evt:object)=>void) => (()=>void)} [props.subscribe] - injectable SSE channel
 * @param {number} [props.debounceMs] - SSE debounce window (tests)
 * @param {() => void} props.onCancel
 * @param {(seam:object) => void} [props.onGenerate] - the UC-S015-3 handoff seam (still fires)
 */
export function ReslicePreviewPanelContainer({ itemId, project = null, loadItems, subscribe, debounceMs, onCancel, onGenerate }) {
  const opts = { project };
  if (loadItems) opts.loadItems = loadItems;
  if (subscribe) opts.subscribe = subscribe;
  if (debounceMs !== undefined) opts.debounceMs = debounceMs;
  const { status, context } = useSteerContext(itemId, opts);
  const preview = useReslicePreview();
  const [prompt, setPrompt] = useState(null);
  const handleGenerate = (seam) => {
    setPrompt(buildPrompt('re-slice', seam.context, seam.intentNote, {
      partAJob: seam.partAJob,
      partBJob: seam.partBJob,
    }));
    if (typeof onGenerate === 'function') onGenerate(seam);
  };
  return (
    <ReslicePreviewPanel
      itemId={itemId}
      status={status}
      context={context}
      partAJob={preview.partAJob}
      partBJob={preview.partBJob}
      intentNote={preview.intentNote}
      canGenerate={preview.canGenerate}
      costNote={preview.costNote}
      onPartAChange={preview.setPartAJob}
      onPartBChange={preview.setPartBJob}
      onIntentChange={preview.setIntentNote}
      onCancel={onCancel}
      onGenerate={handleGenerate}
      prompt={prompt}
    />
  );
}
