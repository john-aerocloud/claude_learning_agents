// UC-S014-2 — SteerPanel: the right-anchored NON-MODAL floating drawer the
// SteerMenu opens (item context block + intent-note textarea + guarded
// "Generate prompt"). Reuses the DEFECT-006 DetailPane drawer IDIOM (not the
// component): position:fixed + portalled to document.body + drawer tokens, so
// opening it adds ZERO flow height and reflows nothing (GEO-S014-2-1..4).
//
// HEXAGONAL ROLE: render layer. SteerPanel is a pure function of resolved
// props ({status, context} from useSteerContext + the chosen action type);
// the only impure behaviour is managed focus (move to heading on open, return
// to the opener on close — S14-2-A11Y-2) and the Esc handler, both DOM
// concerns proper to the render layer. SteerPanelContainer below is the thin
// wiring seam (hook → panel) that ObservatoryView mounts.
//
// NON-MODAL (S14-2-A11Y-5): role="dialog" WITHOUT aria-modal, no scrim, no
// focus trap — the operator keeps seeing/operating the VSM + tree they are
// steering FROM ("the whole and the part"). Esc / × / Cancel close.
//
// TAB ORDER (S14-2-A11Y-1): heading(focus target, tabindex=-1) → intent
// textarea → Generate → Cancel → ×. The × is LAST IN DOM (so the close control
// never precedes the form in the keyboard path) but positioned top-right via
// CSS — the visual header slot.
//
// GENERATE GUARD (F-4): aria-disabled (not disabled) until ≥1 char so the
// control stays discoverable to AT; activation while guarded is a no-op. On
// activation it hands UC-S014-3 everything it needs:
//   onGenerate(intentNote, { itemId, actionType, context })
// UC-S014-3's prompt output renders into the marked slot below the action row.
//
// STATES: loading (labelled skeleton, textarea disabled) · ready · not-found
// ("Item <id> not found" — stale/queue-only id, fail-soft, S14-2-FIG-4) ·
// error ("Could not load item context — try again"). Not-found/error hide the
// textarea + Generate; Cancel/× always available.

import { useState, useLayoutEffect, useRef, useId } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { STEER_ACTIONS } from './SteerMenu.jsx';
import { useSteerContext } from '../hooks/useSteerContext.js';
import './steer-panel.css';

/** Human label for a steer action type — NEVER the enum value (S14-2-FIG-1). */
function actionLabel(actionType) {
  const a = STEER_ACTIONS.find((x) => x.type === actionType);
  return a ? a.label : actionType;
}

/** Unknown ≠ blank (S14-2-FIG-3): absent/empty values render as an em dash. */
function dash(v) {
  return typeof v === 'string' && v.length > 0 ? v : '—';
}

/**
 * @param {object} props
 * @param {string} props.itemId
 * @param {string} props.actionType - steer action enum ('re-slice', …)
 * @param {'loading'|'ready'|'not-found'|'error'} props.status
 * @param {object|null} props.context - SteerContext from useSteerContext
 * @param {() => void} props.onCancel
 * @param {(intentNote:string, seam:{itemId:string,actionType:string,context:object|null}) => void} [props.onGenerate]
 */
export function SteerPanel({ itemId, actionType, status, context, onCancel, onGenerate }) {
  const [note, setNote] = useState('');
  const headingRef = useRef(null);
  const returnFocusRef = useRef(null);
  const uid = useId();
  const headingId = `steer-panel-h-${uid}`;
  const noteId = `intent-note-${uid}`;

  // Managed focus (S14-2-A11Y-2): capture the opener (the SteerMenu trigger —
  // it re-focused itself when the menu closed), move focus to the heading on
  // open, and RETURN focus to the opener on unmount.
  // useLAYOUTEffect, not useEffect (UC-S014-2 rework, WCAG 2.4.3): a deferred
  // post-paint effect leaves a frame where focus is still on the steer trigger
  // (close(true) focused it synchronously in the click handler) — the ~50%
  // intermittent S14-2-A11Y-2 failure. Layout effects run synchronously with
  // the mount commit, so the heading is focused before anything can observe
  // the panel — deterministic in every execution order. Pinned by the
  // raw-render unit spec in SteerPanel.test.jsx.
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

  const canGenerate = status === 'ready' && note.length > 0;
  const generate = () => {
    if (!canGenerate) return; // aria-disabled guard (F-4) — non-activatable
    if (typeof onGenerate === 'function') {
      onGenerate(note, { itemId, actionType, context });
    }
  };

  const showForm = status === 'ready' || status === 'loading';
  const label = actionLabel(actionType);

  return createPortal(
    <section
      class="steer-panel"
      role="dialog"
      aria-labelledby={headingId}
      data-testid="steer-panel"
      data-item-id={itemId}
      data-action={actionType}
      onKeyDown={onKeyDown}
    >
      {/* div, not <header>: inside a role=dialog a <header> still maps to a
          page-level banner landmark (axe landmark-no-duplicate-banner — the
          app header owns that role). Found by the live axe drive. */}
      <div class="steer-panel__head">
        <h2
          id={headingId}
          class="steer-panel__h"
          data-testid="steer-panel-heading"
          ref={headingRef}
          tabindex="-1"
        >
          {`Steer: ${itemId}`}
        </h2>
        <p class="steer-panel__sub">{label}</p>
      </div>

      {/* ITEM CONTEXT BLOCK — the figure surface (S14-2-FIG-1/2/3, A11Y-7).
          Every value is a labelled dt/dd pair; single column so the fields
          STACK (GEO-S014-2-4 stacked-list guard). */}
      {status === 'loading' ? (
        <p class="steer-panel__placeholder" data-testid="steer-context-loading">
          Loading item context…
        </p>
      ) : null}
      {status === 'error' ? (
        <p class="steer-panel__placeholder" data-testid="steer-context-error">
          Could not load item context — try again
        </p>
      ) : null}
      {status === 'not-found' ? (
        <p class="steer-panel__placeholder" data-testid="steer-context-notfound">
          {`Item ${itemId} not found`}
        </p>
      ) : null}
      {status === 'ready' && context ? (
        <dl
          class="steer-context"
          data-testid="steer-context"
          data-source={context.sourceRef}
        >
          <dt>Item</dt>
          <dd data-testid="steer-ctx-id">
            {context.job ? `${context.id} — ${context.job}` : context.id}
          </dd>
          <dt>Job</dt>
          <dd data-testid="steer-ctx-job">{dash(context.job)}</dd>
          <dt>State</dt>
          <dd data-testid="steer-ctx-state">{dash(context.state)}</dd>
          <dt>Value</dt>
          <dd data-testid="steer-ctx-value">{dash(context.value)}</dd>
          <dt>Cost</dt>
          <dd data-testid="steer-ctx-cost">{dash(context.cost)}</dd>
          <dt>Steering action</dt>
          <dd data-testid="steer-ctx-action">{label}</dd>
        </dl>
      ) : null}

      {showForm ? (
        <div class="steer-panel__intent">
          <label class="steer-panel__intent-label" for={noteId}>Intent</label>
          <textarea
            id={noteId}
            class="intent-note"
            data-testid="intent-note"
            rows={4}
            placeholder="Describe what you want to happen (e.g. split this UC into two…)"
            disabled={status !== 'ready'}
            value={note}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
        </div>
      ) : null}

      <div class="steer-panel__actions">
        {showForm ? (
          <button
            type="button"
            class="steer-generate"
            data-testid="steer-generate"
            aria-disabled={canGenerate ? 'false' : 'true'}
            onClick={generate}
          >
            Generate prompt
          </button>
        ) : null}
        <button
          type="button"
          class="steer-cancel"
          data-testid="steer-cancel"
          onClick={() => onCancel && onCancel()}
        >
          Cancel
        </button>
      </div>

      {/* PROMPT OUTPUT SLOT — UC-S014-3 renders the generated prompt here
          (data-testid="prompt-output"); deliberately empty in UC-S014-2. */}
      <div class="steer-panel__output-slot" data-testid="prompt-output-slot" />

      {/* × is LAST in DOM (keyboard path: textarea → Generate → Cancel → ×)
          but CSS-positioned top-right in the header (S14-2-A11Y-1). */}
      <button
        type="button"
        class="steer-panel__close"
        data-testid="steer-panel-close"
        aria-label={`Close steer panel for ${itemId}`}
        onClick={() => onCancel && onCancel()}
      >
        <span aria-hidden="true">×</span>
      </button>
    </section>,
    // PORTAL: document.body — own stacking context above the dashboard
    // (GEO-S014-2-3); opening the drawer can never reflow the host surfaces.
    document.body,
  );
}

/**
 * SteerPanelContainer — the thin wiring seam ObservatoryView mounts: resolves
 * the item context via useSteerContext and renders the pure SteerPanel.
 * @param {object} props
 * @param {string} props.itemId
 * @param {string} props.actionType
 * @param {string|null} [props.project] - active project (hook resolves it when absent)
 * @param {(project:string)=>Promise<Array|null>} [props.loadItems] - injectable items loader
 * @param {() => void} props.onCancel
 * @param {(intentNote:string, seam:object) => void} [props.onGenerate]
 */
export function SteerPanelContainer({ itemId, actionType, project = null, loadItems, onCancel, onGenerate }) {
  const opts = { project };
  if (loadItems) opts.loadItems = loadItems;
  const { status, context } = useSteerContext(itemId, opts);
  return (
    <SteerPanel
      itemId={itemId}
      actionType={actionType}
      status={status}
      context={context}
      onCancel={onCancel}
      onGenerate={onGenerate}
    />
  );
}
