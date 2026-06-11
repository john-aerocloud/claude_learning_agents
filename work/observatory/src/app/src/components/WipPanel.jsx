// UC-S015-1 — WipPanel + WipRow: the in-flight WIP navigation list.
//
// HEXAGONAL ROLE: WipPanel/WipRow are PURE render of the WipItem[] view-model
// (sorted upstream by useWipItems — longest-in-stage first, F-4). The
// WipPanelContainer below is the thin data→render wiring (hook → panel).
//
// WIP SEMANTICS (S15-1-WIP-2 / DEFECT-011): the list shows EVERY open item
// regardless of age; a stale-open row (dwell > live horizon) leads the list by
// sort and is flagged with a NON-COLOUR-REDUNDANT cue — visible text badge
// "stale — over Nh" (authoritative) + ⏳ glyph (aria-hidden shape cue) +
// --c-state-over band (colour, third cue) + data-stale.
//
// FIGURES (S15-1-FIG-1..4): every figure is a labelled <dt>/<dd> pair so no
// number/reference is announced bare; dwell carries a unit; unknown renders "—"
// (never "0 s"); zero WIP renders the labelled empty state, never a blank.
//
// COMPOSITION HOOK (UC-S015-2): each row carries data-item-id (the live id)
// and hosts the DELIVERED s014 SteerMenu as the TRAILING element of the row
// content (the TreeNode/StageNode idiom) — the trigger rides
// data-steer-item-id, NEVER data-item-id (the row's unique strict-mode
// contract). onSteer is a PASS-THROUGH prop threaded
// WipPanelContainer → WipPanel → WipRow → SteerMenu; the dispatch itself
// (all four actions → SteerPanel, until UC-S015-3 re-points re-slice) lives in
// ObservatoryView — no routing logic here.
import { useEffect, useRef } from 'preact/hooks';
import { useWipItems, formatHorizon, WIP_SOURCE_REF } from '../hooks/useWipItems.js';
import { SteerMenu } from './SteerMenu.jsx';
import './wip-panel.css';

/** One in-flight item row (UC-S015-1 list; UC-S015-2 trailing steer affordance). */
export function WipRow({ item, horizonMs, onSteer }) {
  const { id, job, stage, stageLabel, value, cost, dwellText, isStale } = item;
  const horizonText = formatHorizon(horizonMs);
  const accessibleName =
    `${id} — ${job}, ${stageLabel}, in stage ${dwellText}` +
    (isStale ? `, stale, over ${horizonText}` : '');
  return (
    <li
      data-testid="wip-row"
      data-item-id={id}
      data-stale={isStale ? 'true' : 'false'}
      data-stage={stage}
      class={`wip-row${isStale ? ' wip-row--stale' : ''}`}
      aria-label={accessibleName}
    >
      {isStale ? (
        <span class="wip-row__stale-badge" data-testid="stale-badge">
          <span aria-hidden="true">⏳</span> stale — over {horizonText}
        </span>
      ) : null}
      {/* UC-S015-2 / GEO-S015-2-WIP-2: the figures + the trailing steer
          affordance share ONE flex band — "figures … steer", the trigger at
          the trailing edge, never interrupting the scannable figure line. */}
      <div class="wip-row__body">
      <dl class="wip-row__figures">
        <div class="wip-row__figure">
          <dt>item</dt>
          <dd data-testid="wip-id">{id}</dd>
        </div>
        <div class="wip-row__figure wip-row__figure--job">
          <dt>job</dt>
          <dd data-testid="wip-job">{job}</dd>
        </div>
        <div class="wip-row__figure">
          <dt>stage</dt>
          <dd data-testid="wip-stage">{stageLabel}</dd>
        </div>
        <div class="wip-row__figure">
          <dt>value</dt>
          <dd data-testid="wip-value">{value}</dd>
        </div>
        <div class="wip-row__figure">
          <dt>cost</dt>
          <dd data-testid="wip-cost">{cost}</dd>
        </div>
        <div class="wip-row__figure">
          <dt>time in stage</dt>
          <dd data-testid="wip-dwell">{dwellText}</dd>
        </div>
      </dl>
      {/* UC-S015-2: the delivered s014 SteerMenu, read-only reuse — portalled
          fixed popover (zero flow height, GEO-S015-2-WIP-1); accessible name
          carries the HUMAN reference id + job (S15-2-FIG-1). */}
      <SteerMenu itemId={id} itemLabel={job} onSteer={onSteer} />
      </div>
    </li>
  );
}

/**
 * The WIP view region (presentational).
 * @param {object} props
 * @param {Array} props.items     sorted WipItem[] (longest-in-stage first)
 * @param {'loading'|'ready'|'empty'} props.status
 * @param {number|null} props.horizonMs  live recency horizon (S15-1-WIP-1)
 * @param {string} [props.sourceRef]
 * @param {(itemId:string, actionType:string)=>void} [props.onSteer]  UC-S015-2 pass-through
 */
export function WipPanel({ items = [], status = 'loading', horizonMs = null, sourceRef = WIP_SOURCE_REF, onSteer }) {
  // S15-1-A11Y-2: switching to the WIP view lands the reader in the panel —
  // the heading takes focus on mount (the panel only mounts on view switch;
  // SSE refreshes update props, they do not remount, so focus is not stolen).
  const headingRef = useRef(null);
  useEffect(() => {
    if (headingRef.current && typeof headingRef.current.focus === 'function') {
      headingRef.current.focus();
    }
  }, []);

  const count = items.length;
  return (
    <section
      aria-label="In-flight WIP"
      data-testid="wip-panel"
      data-source={sourceRef}
      class="wip-panel"
    >
      <h2 class="wip-panel__heading" tabIndex={-1} ref={headingRef}>
        In-flight WIP
      </h2>
      {/* S15-1-A11Y-7: the count lives in a polite live region so SSE-driven
          changes are announced once, without spam (LiveStatusDot pattern). */}
      <p role="status" aria-live="polite" data-testid="wip-count" class="wip-panel__count">
        {status === 'loading'
          ? 'Loading in-flight items…'
          : `${count} item${count === 1 ? '' : 's'} in flight`}
      </p>
      {status !== 'loading' && count === 0 ? (
        <p class="wip-panel__empty" data-testid="wip-empty">
          No items currently in flight
        </p>
      ) : null}
      {count > 0 ? (
        <ul role="list" class="wip-panel__list" data-testid="wip-list">
          {items.map((item) => (
            <WipRow key={`${item.stage}:${item.id}`} item={item} horizonMs={horizonMs} onSteer={onSteer} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Data→render container: useWipItems → WipPanel. Loaders/subscribe injectable
 * for tests; defaults are the real API adapter (api/client.js).
 * onSteer (UC-S015-2) is render wiring, not a hook option — split it off.
 */
export function WipPanelContainer({ onSteer, ...hookOpts }) {
  const state = useWipItems(hookOpts);
  return (
    <WipPanel
      items={state.items}
      status={state.status}
      horizonMs={state.horizonMs}
      sourceRef={state.sourceRef}
      onSteer={onSteer}
    />
  );
}
