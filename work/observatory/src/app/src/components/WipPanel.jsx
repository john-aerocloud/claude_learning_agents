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
// COMPOSITION HOOK: each row carries data-item-id (the live id) — the slot
// UC-S015-2's SteerMenu composes against. No steer affordance here.
import { useEffect, useRef } from 'preact/hooks';
import { useWipItems, formatHorizon, WIP_SOURCE_REF } from '../hooks/useWipItems.js';
import './wip-panel.css';

/** One in-flight item row (UC-S015-1 — presentational). */
export function WipRow({ item, horizonMs }) {
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
 */
export function WipPanel({ items = [], status = 'loading', horizonMs = null, sourceRef = WIP_SOURCE_REF }) {
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
            <WipRow key={`${item.stage}:${item.id}`} item={item} horizonMs={horizonMs} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Data→render container: useWipItems → WipPanel. Loaders/subscribe injectable
 * for tests; defaults are the real API adapter (api/client.js).
 */
export function WipPanelContainer(props) {
  const state = useWipItems(props);
  return (
    <WipPanel
      items={state.items}
      status={state.status}
      horizonMs={state.horizonMs}
      sourceRef={state.sourceRef}
    />
  );
}
