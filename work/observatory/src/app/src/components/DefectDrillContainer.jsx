// UC-S013-3 — DefectDrillContainer: the floating-drawer shell for the defect
// drill. REUSES the DEFECT-006 drawer IDIOM — position:fixed, portalled to
// document.body, the existing drawer tokens, NON-modal, no scrim — NOT the
// DetailPane component body: DetailPane.jsx is ItemRecord-coupled and shared
// with UC-S005-3 (a READ-ONLY reuse slot; ui-design.md drawer-reuse decision).
// Third consumer of the idiom after DetailPane + SteerPanel.
//
// HEXAGONAL ROLE: render layer. Pure-ish function of the SELECTED raw defect
// record (already in useDefects state — the drill is a pure projection, NO
// extra fetch); the only impure behaviour is managed focus (heading on open,
// opener on close — S13-3-A11Y-2/3) and the Esc handler, DOM concerns proper
// to the render layer.
//
// FOCUS (S13-3-A11Y-2/3): useLAYOUTEffect, not useEffect (sha 0c2b49c lesson —
// a deferred effect races re-renders; layout effects run synchronously with
// the mount commit, deterministic in every execution order). The opener
// (the activated DefectRow trigger — it focuses itself on activation) is
// captured at mount and re-focused on unmount.
//
// NON-MODAL: a labelled region (not aria-modal), no focus trap — the defects
// list stays operable while the drill is open ("the whole and the part").
//
// KEYBOARD ORDER: heading (focus target) → DefectDetail fields → MttrCard →
// × close. The × is LAST IN DOM but CSS-positioned top-right (the SteerPanel
// idiom: the close control never precedes the record in the keyboard path).
import { useLayoutEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { DefectDetail } from './DefectDetail.jsx';
import { MttrCard } from './MttrCard.jsx';
import { ContextRefreshCue } from './ContextRefreshCue.jsx';
import './defect-drill.css';

// UC-S013-4 — the drill's record-freeze cue (EXP-036, the ContextRefreshCue
// idiom, second consumer): the drawer renders a SNAPSHOT of the record taken
// at activation; when an SSE refresh changes the record underneath, the
// container flips refreshState to 'updated' and this cue announces it — the
// content itself NEVER silently mutates. Re-activating the originating row
// (already focused by the return-focus contract) is the explicit refresh.
const DRILL_CUE_TEXTS = {
  live: 'Live',
  updated: 'Record updated — re-open to refresh',
};
const DRILL_CUE_LABELS = {
  live: 'Defect record: live',
  updated: 'Defect record: updated — re-open to refresh',
};

function DefectDrill({ defect, onClose, now, refreshState = 'live' }) {
  const headingRef = useRef(null);
  const returnFocusRef = useRef(null);

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
      onClose && onClose();
    }
  };

  return createPortal(
    <section
      class="defect-drill"
      aria-label={`Defect: ${defect.id}`}
      data-testid="defect-drill"
      data-defect-id={defect.id}
      onKeyDown={onKeyDown}
    >
      {/* div, not <header> — inside an overlay a <header> still maps to a
          page-level banner landmark (the SteerPanel axe lesson) */}
      <div class="defect-drill__head">
        <h2
          class="defect-drill__h"
          data-testid="defect-drill-heading"
          ref={headingRef}
          tabindex="-1"
        >
          {`${defect.id} — ${defect.title}`}
        </h2>
        <ContextRefreshCue
          state={refreshState}
          testId="defect-drill-cue"
          texts={DRILL_CUE_TEXTS}
          labels={DRILL_CUE_LABELS}
        />
      </div>

      <DefectDetail defect={defect} />

      <MttrCard
        defectId={defect.id}
        reportedTs={defect.reported_ts ?? null}
        recoveredTs={defect.recovered_ts ?? null}
        mttrS={typeof defect.mttr_s === 'number' ? defect.mttr_s : null}
        mttrUnits={defect.mttr_units ?? null}
        now={now}
      />

      {/* × LAST in DOM (keyboard order), top-right visually (CSS) */}
      <button
        type="button"
        class="defect-drill__close"
        data-testid="defect-drill-close"
        aria-label={`Close defect ${defect.id}`}
        onClick={() => onClose && onClose()}
      >
        <span aria-hidden="true">×</span>
      </button>
    </section>,
    // PORTAL: document.body — own stacking context, zero flow height; opening
    // the drawer can never reflow the defects panel / tree / page (GEO-S013-3-1).
    document.body,
  );
}

/**
 * @param {object} props
 * @param {object|null} props.defect - raw UC-S013-1 record (the activation
 *   SNAPSHOT — the container freezes it; UC-S013-4); null = closed
 * @param {() => void} props.onClose
 * @param {number} [props.now] - injectable clock for the open elapsed figure
 * @param {'live'|'updated'} [props.refreshState] - the EXP-036 record cue state
 */
export function DefectDrillContainer({ defect, onClose, now, refreshState = 'live' }) {
  if (!defect) return null;
  // key by id: drilling straight from one defect to another remounts the
  // drawer so the heading-focus contract holds per record. A same-id
  // re-activation (the explicit refresh) updates props WITHOUT remounting —
  // heading focus is not stolen.
  return (
    <DefectDrill
      key={defect.id}
      defect={defect}
      onClose={onClose}
      now={now}
      refreshState={refreshState}
    />
  );
}
