// UC-S004-2/3/4/5 — one canonical STAGE NODE of the value-stream map.
//
// HEXAGONAL ROLE: pure render component. Receives one stage-flow object (from the
// UC-S004-1 endpoint via VsmContainer) and renders the node head, the four
// labelled figures, the wip>0 in-flight badge, and — UC-S004-5 — the MetricSource
// TRACEABILITY reveal that shows WHERE each figure came from (the ledger
// source_rows) so an operator can open ledger.csv and verify the claim.
//
// Extracted from ValueStreamMap.jsx so the s004-5 traceability reveal lives in a
// focused, separately-testable unit (parallel-safe: this file + MetricSource.jsx
// are owned by UC-S004-5; VsmContainer.jsx is owned by UC-S004-6 and untouched).
//
// TRACEABILITY UX (acceptance.md UC-S004-5 + A11Y-8/10): the node is the single
// focusable tab stop (A11Y-3 keeps Tab visiting nodes in flow order — we add NO
// per-metric tab stops). Focusing the node and pressing Enter (or hovering it)
// REVEALS each figure's source panel; Esc dismisses. Every figure value is wired
// to its source panel via aria-describedby (A11Y-10). value>0 → real ledger row
// refs; value=0 → "no events recorded" (AC5.3), never blank/broken.

import { useState } from 'preact/hooks';
import { MetricSource } from './MetricSource.jsx';
import { SteerMenu } from './SteerMenu.jsx';
import './value-stream-map.css';

const GATES = new Set(['intake', 'deploy']);

// DEFECT-004 §3 — buffer (queue) stages hold items NOW. They render a Depth
// figure (queue_depth + per-item wait) instead of the plain WIP metric. The
// server marks a stage as a queue by sending a non-null queue_depth.
const MAX_QUEUE_ITEMS_SHOWN = 3;

/** Humanise a duration in seconds: <60s → "Ns", <3600s → "Xm", else "Xh" (AC3.3). */
export function humaniseDwell(seconds) {
  const s = Number(seconds) || 0;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

/** DEFECT-004 AC-1 — throughput COUNT label (singular "1 item"). Retained for the
 * source/hover summary; no longer the headline (DEFECT-007 made the headline a rate). */
export function throughputLabel(n) {
  const v = Number(n) || 0;
  return `${v} ${v === 1 ? 'item' : 'items'}`;
}

/**
 * DEFECT-007 — the headline throughput is a RATE (items per active-day). Format
 * rules (ruling §3):
 *   null            → "—"            (0 active days; nothing to rate)
 *   exactly 1.0     → "1 item/day"   (singular "item")
 *   integer (>1,0)  → "N items/day"  (drop trailing .0)
 *   non-integer     → "N.N items/day" (one decimal place)
 *   < 1 (e.g. 0.3)  → "0.3 items/day" (keep the decimal; never "<1")
 * The "/day" unit is ALWAYS shown — it is what makes this a rate.
 */
export function throughputRateLabel(rate) {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return '—';
  const v = Number(rate);
  // Minimum decimal places: whole numbers drop ".0"; otherwise one decimal.
  const isWhole = Number.isInteger(v);
  const text = isWhole ? String(v) : v.toFixed(1);
  const num = Number(text);
  const unit = num === 1 ? 'item/day' : 'items/day';
  return `${text} ${unit}`;
}

/** DEFECT-007 D7-AC-4 — the raw count is DEMOTED to the source/hover line, not lost:
 * "13 items over 2 active days (6.5 items/day)"; "0 items (no active days in window)"
 * when there are no active days. */
export function throughputSourceSummary(count, activeDays, rate) {
  const c = Number(count) || 0;
  const d = Number(activeDays) || 0;
  const itemWord = c === 1 ? 'item' : 'items';
  if (d === 0 || rate === null || rate === undefined) {
    return `${c} ${itemWord} (no active days in window)`;
  }
  const dayWord = d === 1 ? 'active day' : 'active days';
  return `${c} ${itemWord} over ${d} ${dayWord} (${throughputRateLabel(rate)})`;
}

/** DEFECT-004 AC-2 — dwell text: humanised when >= 2 completed pairs, else "—"
 * (unknown ≠ measured zero; never a misleading "0s"). */
export function dwellLabel(seconds, pairs) {
  return Number(pairs) >= 2 ? humaniseDwell(seconds) : '—';
}

/** Is this stage a queue (buffer) stage? The server sends a non-null queue_depth
 * for buffer stages and null for work stages (DEFECT-004 §3b). */
function isQueueStage(data) {
  return data && data.queue_depth !== null && data.queue_depth !== undefined;
}

/** Join source_rows into a non-empty data-source string ("no events recorded" at 0). */
export function sourceAttr(sourceRows) {
  if (Array.isArray(sourceRows) && sourceRows.length > 0) return sourceRows.join(' ');
  return 'no events recorded';
}

/** A single labelled figure (label + value) + its MetricSource traceability
 * reveal. Never a bare number (AC3.1). The value is wired to its source panel
 * via aria-describedby (A11Y-10) and carries the programmatic data-source (SRC-1). */
function StageMetric({ stage, kind, label, value, sourceRows, sourceEvents, sourceTotal, summary, open }) {
  const panelId = `src-${stage}-${kind}`;
  return (
    <div class="stage-metric" data-testid={`metric-${stage}-${kind}`}>
      <dt class="stage-metric__label">{label}</dt>
      <dd
        class="stage-metric__value"
        data-testid={`metric-value-${stage}-${kind}`}
        data-metric={kind}
        data-source={sourceAttr(sourceRows)}
        aria-describedby={panelId}
      >
        {value}
      </dd>
      <MetricSource
        id={panelId}
        stage={stage}
        kind={kind}
        sourceEvents={sourceEvents}
        sourceTotal={sourceTotal}
        sourceRows={sourceRows}
        summary={summary}
        open={open}
      />
    </div>
  );
}

/** The prominent non-colour-redundant in-flight indicator (replaces the plain
 * WIP metric when wip>0). Visible text "● N in-flight"; glyph aria-hidden. It
 * ALSO carries the wip MetricSource reveal so the operator can trace WIP. */
function InFlightBadge({ stage, count, sourceRows, sourceEvents, sourceTotal, open }) {
  const panelId = `src-${stage}-wip`;
  return (
    <div
      class="inflight-badge"
      data-testid={`inflight-${stage}`}
      data-inflight={count}
      data-metric="wip"
      data-source={sourceAttr(sourceRows)}
      aria-describedby={panelId}
    >
      <span class="inflight-badge__glyph" aria-hidden="true">●</span>
      <span>{count} in-flight</span>
      <MetricSource id={panelId} stage={stage} kind="wip" sourceEvents={sourceEvents} sourceTotal={sourceTotal} sourceRows={sourceRows} open={open} />
    </div>
  );
}

/** DEFECT-004 §3 — the QueueDepth figure for a buffer stage. Shows "N queued"
 * labelled "Depth" (NOT "WIP" — depth is sitting/waiting, WIP is in-flight) plus
 * each queued item's id + humanised accruing wait. First 3 items, then "+N more";
 * the depth badge always shows the full count. queue_depth 0 → "0 queued", no rows. */
function QueueDepth({ stage, depth, items, sourceRows, sourceEvents, sourceTotal, open, onSteer }) {
  const panelId = `src-${stage}-depth`;
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, MAX_QUEUE_ITEMS_SHOWN);
  const moreCount = list.length - shown.length;
  return (
    <div class="stage-metric stage-metric--depth" data-testid={`metric-${stage}-depth`}>
      <dt class="stage-metric__label">Depth</dt>
      <dd
        class="stage-metric__value"
        data-testid={`metric-value-${stage}-depth`}
        data-metric="depth"
        data-depth={String(depth)}
        data-source={sourceAttr(sourceRows)}
        aria-describedby={panelId}
      >
        {depth} queued
      </dd>
      {shown.length > 0 ? (
        <ul class="queue-items" data-testid={`queue-items-${stage}`}>
          {shown.map((q) => (
            <li
              class="queue-item"
              key={q.item_id}
              data-testid={`queued-item-${stage}-${q.item_id}`}
              data-wait-s={String(q.wait_s)}
            >
              <span class="queue-item__id">{q.item_id}</span>{' '}
              <span class="queue-item__wait">waiting {humaniseDwell(q.wait_s)}</span>
              {/* UC-S014-1 — trailing steer action; item-bearing chips ONLY
                  (never the "+N more" chip below). Read-only composition. */}
              <SteerMenu itemId={q.item_id} onSteer={onSteer} />
            </li>
          ))}
          {moreCount > 0 ? (
            <li class="queue-item queue-item--more" data-testid={`queue-more-${stage}`}>
              ... +{moreCount} more
            </li>
          ) : null}
        </ul>
      ) : null}
      <MetricSource id={panelId} stage={stage} kind="depth" sourceEvents={sourceEvents} sourceTotal={sourceTotal} sourceRows={sourceRows} open={open} />
    </div>
  );
}

/** Gate marker: "gate" text + ◇ glyph (glyph aria-hidden) — non-colour cues. */
function GateMarker({ gate }) {
  return (
    <span class="gate-marker" data-testid={`gate-${gate}`}>
      <span aria-hidden="true">◇</span>
      <span>gate</span>
    </span>
  );
}

/** One canonical stage node — name, optional gate marker, four labelled figures
 * (WIP promoted to an in-flight badge when wip>0), each carrying its MetricSource
 * traceability reveal. role=group, the single focusable tab stop (A11Y-3). */
export function StageNode({ data, onSteer }) {
  const {
    stage, label, throughput, throughput_per_active_day, active_days,
    dwell_median_s, dwell_pairs, wip, rework, source_rows,
    source_events, source_total,
    queue_depth, queue_items, coherence_warning, coherence_warnings,
  } = data;
  const isGate = GATES.has(stage);
  const isQueue = isQueueStage(data);
  const wipActive = Number(wip) > 0;
  // DEFECT-007: the headline throughput is now a RATE (items/day); the raw count
  // is demoted to the source/hover summary. DEFECT-004 AC-2 dwell still "—" when unknown.
  const throughputText = throughputRateLabel(throughput_per_active_day);
  const throughputSummary = throughputSourceSummary(throughput, active_days, throughput_per_active_day);
  const dwell = dwellLabel(dwell_median_s, dwell_pairs);
  const reworkText = `${Number(rework) || 0} rework`;
  const depth = Number(queue_depth) || 0;
  // DEFECT-013 — the API sends readable drift reasons; show THEM when present
  // (registry drift on a work stage is not a queue-count problem). A boolean-only
  // payload (DEFECT-004 legacy / older fixture) keeps the AC-6 queue text.
  const coherenceReasons = Array.isArray(coherence_warnings) ? coherence_warnings : [];
  const coherenceMismatch = coherence_warning === true || coherenceReasons.length > 0;

  // The reveal is node-scoped: focus+Enter or hover OPENS all four source panels
  // for this node; Esc or mouse-leave CLOSES them (A11Y-10 dismissible).
  const [open, setOpen] = useState(false);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((v) => !v);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // accessible name carries the key figures WITH UNITS (AC-7) — never bare.
  // Queue stages read "depth N queued (longest wait …)"; work stages "WIP …".
  let currentPhrase;
  if (isQueue) {
    const longest = Array.isArray(queue_items) && queue_items.length > 0
      ? humaniseDwell(Math.max(...queue_items.map((q) => Number(q.wait_s) || 0)))
      : null;
    currentPhrase = `depth ${depth} queued${longest ? ` (longest wait ${longest})` : ''}`;
  } else {
    currentPhrase = wipActive ? `WIP ${wip}, ${wip} in-flight` : `WIP ${wip}`;
  }
  let name = `${label} stage, throughput ${throughputText}, dwell ${dwell}, ${currentPhrase}, rework ${reworkText}`;
  if (coherenceMismatch) {
    name += coherenceReasons.length > 0
      ? `, coherence warning: ${coherenceReasons.join('; ')}`
      : ', queue count mismatch';
  }
  if (isGate) name = `gate: ${name}`;

  return (
    <div
      class="stage-node"
      data-testid={`stage-${stage}`}
      role="group"
      aria-label={name}
      tabindex="0"
      data-stage-kind={isGate ? 'gate' : 'work'}
      data-queue={isQueue ? 'true' : 'false'}
      data-wip={String(wip)}
      data-wip-active={wipActive ? 'true' : 'false'}
      data-coherence={coherenceMismatch ? 'warning' : 'ok'}
      data-source-open={open ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={() => setOpen(false)}
    >
      <div class="stage-node__head">
        <span class="stage-node__name">{label}</span>
        {isGate ? <GateMarker gate={stage} /> : null}
      </div>
      {coherenceMismatch ? (
        <p class="stage-node__coherence" data-testid={`coherence-${stage}`} role="status">
          {coherenceReasons.length > 0
            ? coherenceReasons.join('; ')
            : 'queue count mismatch — see tree'}
        </p>
      ) : null}
      <dl class="stage-figs">
        <StageMetric stage={stage} kind="throughput" label="Throughput" value={throughputText} sourceRows={source_rows} sourceEvents={source_events} sourceTotal={source_total} summary={throughputSummary} open={open} />
        <StageMetric stage={stage} kind="dwell" label="Dwell" value={dwell} sourceRows={source_rows} sourceEvents={source_events} sourceTotal={source_total} open={open} />
        {isQueue
          ? <QueueDepth stage={stage} depth={depth} items={queue_items} sourceRows={source_rows} sourceEvents={source_events} sourceTotal={source_total} open={open} onSteer={onSteer} />
          : wipActive
            ? <InFlightBadge stage={stage} count={wip} sourceRows={source_rows} sourceEvents={source_events} sourceTotal={source_total} open={open} />
            : <StageMetric stage={stage} kind="wip" label="WIP" value={String(wip)} sourceRows={source_rows} sourceEvents={source_events} sourceTotal={source_total} open={open} />}
        <StageMetric stage={stage} kind="rework" label="Rework" value={reworkText} sourceRows={source_rows} sourceEvents={source_events} sourceTotal={source_total} open={open} />
      </dl>
    </div>
  );
}
