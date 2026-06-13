// UC-S013-2 — DefectsPanel + DefectRow: the defects view-region (grouped
// CONFIRMED-first list of labelled defect figures).
//
// HEXAGONAL ROLE: DefectsPanel/DefectRow are PURE render of the DefectVM[]
// view-model (grouped + sorted upstream by useDefects). The
// DefectsPanelContainer below is the thin data→render wiring (hook → panel).
//
// GROUPS (GEO-S013-2-4 / S13-2-A11Y-6): the open (CONFIRMED) group leads and
// is present IFF ≥1 open row (an empty "Open (0)" reads as a broken state);
// group headings are <h3> under the panel's single <h2>.
//
// OPEN-ROW CUE (S13-2-A11Y-3 / S13-2-FIG-5, NON-COLOUR-REDUNDANT): visible
// text badge "OPEN" (authoritative, the operator's word; the CONFIRMED enum
// rides data-status) + ⚠ glyph (aria-hidden shape cue, the tree's DEF glyph)
// + --c-state-over band (colour, third cue) + data-open. CLOSED rows carry
// "CLOSED" text + ✓ glyph + done band.
//
// FIGURES (S13-2-FIG-1..6): every figure is a labelled <dt>/<dd> pair so no
// number/reference is announced bare; MTTR carries a unit or reads "open"
// (never "0"); null severity renders "—"; zero defects renders the labelled
// empty state, never a blank.
//
// COMPOSITION HOOK: each row carries data-defect-id (NOT data-item-id — that
// stays the tree/WIP unique contract) — the slot UC-S013-3's drill reads.
//
// HEADING FOCUS: a LAYOUT effect (sha 0c2b49c lesson — deterministic,
// synchronous with the mount commit; a deferred effect races re-renders and
// left focus elsewhere ~50% of opens in SteerPanel). The panel only mounts on
// view switch; refreshes update props without remounting, so focus is never
// stolen (S13-2-A11Y-2).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useDefects, DEFECTS_SOURCE_REF } from '../hooks/useDefects.js';
import { DefectDrillContainer } from './DefectDrillContainer.jsx';
import './defects-panel.css';

/** One defect row (UC-S013-2 — presentational; UC-S013-3 wires the reserved
 *  drill slot: the WHOLE row is the activation affordance — an inner
 *  role=button trigger wraps the figure <dl> (a native <button> cannot
 *  contain a <dl> — phrasing-content model), click + Enter/Space fire
 *  onSelectDefect(id), and the trigger focuses itself on activation so the
 *  drill's return-focus contract (S13-3-A11Y-3) is deterministic). */
export function DefectRow({ defect, onSelectDefect, isActive = false }) {
  const { id, title, status, statusLabel, isOpen, severity, severityText, mttrText } = defect;
  // S13-2-A11Y-5: the accessible name carries id + title + status + severity
  // + MTTR — never a bare reference. Null severity is announced "unknown".
  const accessibleName =
    `${id}, ${title}, status ${statusLabel}, ` +
    `severity ${severity ?? 'unknown'}, MTTR ${mttrText}`;
  const activate = (e) => {
    if (typeof onSelectDefect !== 'function') return;
    // focus the trigger so Esc/× can return focus to the originating row
    // (S13-3-A11Y-3) — browsers do not focus on click consistently
    e.currentTarget.focus();
    onSelectDefect(id);
  };
  const onKeyDown = (e) => {
    // role=button keyboard contract (S13-3-A11Y-1): Enter AND Space activate
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault(); // Space must not scroll
      activate(e);
    }
  };
  return (
    <li
      data-testid="defect-row"
      data-defect-id={id}
      data-status={status}
      data-open={isOpen ? 'true' : 'false'}
      data-severity={severity ?? ''}
      data-active={isActive ? 'true' : 'false'}
      class={`defect-row ${isOpen ? 'defect-row--open' : 'defect-row--closed'}`}
      aria-label={accessibleName}
    >
      <div
        role="button"
        tabIndex={0}
        class="defect-row__trigger"
        data-testid="defect-row-trigger"
        aria-label={accessibleName}
        aria-expanded={isActive ? 'true' : 'false'}
        onClick={activate}
        onKeyDown={onKeyDown}
      >
      <dl class="defect-row__figures">
        <div class="defect-row__figure">
          <dt>defect</dt>
          <dd data-testid="defect-id">{id}</dd>
        </div>
        <div class="defect-row__figure defect-row__figure--title">
          <dt>title</dt>
          <dd data-testid="defect-title">{title}</dd>
        </div>
        <div class="defect-row__figure">
          <dt>status</dt>
          <dd data-testid="defect-status">
            <span
              class={`defect-row__badge ${isOpen ? 'defect-row__badge--open' : 'defect-row__badge--closed'}`}
              data-testid="defect-status-badge"
            >
              <span aria-hidden="true">{isOpen ? '⚠' : '✓'}</span> {statusLabel}
            </span>
          </dd>
        </div>
        <div class="defect-row__figure">
          <dt>severity</dt>
          <dd data-testid="defect-severity">
            <span class="defect-row__badge defect-row__badge--severity" data-testid="defect-severity-badge">
              {severityText}
            </span>
          </dd>
        </div>
        <div class="defect-row__figure">
          <dt>MTTR</dt>
          <dd data-testid="defect-mttr">{mttrText}</dd>
        </div>
      </dl>
      </div>
    </li>
  );
}

/**
 * The Defects view region (presentational).
 * @param {object} props
 * @param {Array} props.defects   grouped DefectVM[] (open-first, id-ascending)
 * @param {'loading'|'ready'|'empty'} props.status
 * @param {number} props.openCount
 * @param {string} [props.sourceRef]
 * @param {(id:string) => void} [props.onSelectDefect] - UC-S013-3 drill slot
 * @param {string|null} [props.activeDefectId] - the drilled defect (data-active/aria-expanded)
 */
export function DefectsPanel({
  defects = [],
  status = 'loading',
  openCount = 0,
  sourceRef = DEFECTS_SOURCE_REF,
  onSelectDefect,
  activeDefectId = null,
}) {
  // S13-2-A11Y-2: switching to the Defects view lands the reader in the panel
  // — the heading takes focus on mount, as a LAYOUT effect (see header note).
  const headingRef = useRef(null);
  useLayoutEffect(() => {
    if (headingRef.current && typeof headingRef.current.focus === 'function') {
      headingRef.current.focus();
    }
  }, []);

  const open = defects.filter((d) => d.isOpen);
  const closed = defects.filter((d) => !d.isOpen);
  const count = defects.length;

  return (
    <section
      aria-label="Defects"
      data-testid="defects-panel"
      data-source={sourceRef}
      class="defects-panel"
    >
      <h2 class="defects-panel__heading" tabIndex={-1} ref={headingRef}>
        Defects
      </h2>
      {/* S13-2-A11Y-7: the count lives in a polite live region so SSE-driven
          changes (UC-S013-4) are announced once, without spam. S13-2-FIG-6:
          both numbers carry a noun — "N defects, M open", never bare. */}
      <p role="status" aria-live="polite" data-testid="defects-count" class="defects-panel__count">
        {status === 'loading'
          ? 'Loading defects…'
          : `${count} defect${count === 1 ? '' : 's'}, ${openCount} open`}
      </p>
      {status !== 'loading' && count === 0 ? (
        <p class="defects-panel__empty" data-testid="defects-empty">
          No defects recorded
        </p>
      ) : null}
      {open.length > 0 ? (
        <>
          <h3 class="defects-panel__group" data-testid="defects-group-open">
            Open — needs attention
          </h3>
          <ul role="list" class="defects-panel__list">
            {open.map((d) => (
              <DefectRow
                key={d.id}
                defect={d}
                onSelectDefect={onSelectDefect}
                isActive={d.id === activeDefectId}
              />
            ))}
          </ul>
        </>
      ) : null}
      {closed.length > 0 ? (
        <>
          <h3 class="defects-panel__group" data-testid="defects-group-closed">
            Closed
          </h3>
          <ul role="list" class="defects-panel__list">
            {closed.map((d) => (
              <DefectRow
                key={d.id}
                defect={d}
                onSelectDefect={onSelectDefect}
                isActive={d.id === activeDefectId}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * Data→render container: useDefects → DefectsPanel. Loaders injectable for
 * tests; defaults are the real API adapter (api/client.js).
 *
 * UC-S013-3: the container OWNS the drill selection — activating a row
 * selects its id and the DefectDrillContainer renders the SAME raw record the
 * list hook already holds (pure projection, NO extra fetch; ui-design.md
 * build contract #1). ObservatoryView needs no change (the drawer is
 * body-portalled). If a refresh drops the selected id the drill closes
 * gracefully.
 *
 * UC-S013-4 FREEZE DISCIPLINE (EXP-036, the PROMPT-FREEZE idiom): the
 * selection is a SNAPSHOT {id, record} taken at activation. An SSE refresh
 * never silently mutates the open drawer — when the live record diverges from
 * the snapshot the drill's cue flips to 'updated' ("Record updated — re-open
 * to refresh") and the content stays frozen; an EXPLICIT re-activation of the
 * row re-snapshots (same id → no remount, no focus steal). This is the
 * smaller honest behaviour: no new interactive control — the originating row
 * trigger (already focused by the return-focus contract) is the refresh
 * affordance.
 */
export function DefectsPanelContainer(props) {
  const state = useDefects(props);
  const [selected, setSelected] = useState(null); // {id, record} activation snapshot
  const live = selected ? state.defects.find((d) => d.id === selected.id) || null : null;
  // graceful close when the refresh dropped the id (live=null → drill closed);
  // stale when the live record's content diverged from the frozen snapshot.
  const isStale =
    !!(selected && live) &&
    live.record !== selected.record &&
    JSON.stringify(live.record) !== JSON.stringify(selected.record);
  const select = (id) => {
    const d = state.defects.find((x) => x.id === id);
    setSelected(d ? { id, record: d.record } : null);
  };
  return (
    <>
      <DefectsPanel
        defects={state.defects}
        status={state.status}
        openCount={state.openCount}
        sourceRef={state.sourceRef}
        onSelectDefect={select}
        activeDefectId={selected && live ? selected.id : null}
      />
      <DefectDrillContainer
        defect={selected && live ? selected.record : null}
        onClose={() => setSelected(null)}
        refreshState={isStale ? 'updated' : 'live'}
      />
    </>
  );
}
