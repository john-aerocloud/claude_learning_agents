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
import './value-stream-map.css';

const GATES = new Set(['intake', 'deploy']);

/** Humanise a dwell in seconds: <60s → "Ns", <3600s → "Xm", else "Xh" (AC3.3). */
export function humaniseDwell(seconds) {
  const s = Number(seconds) || 0;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

/** Join source_rows into a non-empty data-source string ("no events recorded" at 0). */
export function sourceAttr(sourceRows) {
  if (Array.isArray(sourceRows) && sourceRows.length > 0) return sourceRows.join(' ');
  return 'no events recorded';
}

/** A single labelled figure (label + value) + its MetricSource traceability
 * reveal. Never a bare number (AC3.1). The value is wired to its source panel
 * via aria-describedby (A11Y-10) and carries the programmatic data-source (SRC-1). */
function StageMetric({ stage, kind, label, value, sourceRows, open }) {
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
        sourceRows={sourceRows}
        open={open}
      />
    </div>
  );
}

/** The prominent non-colour-redundant in-flight indicator (replaces the plain
 * WIP metric when wip>0). Visible text "● N in-flight"; glyph aria-hidden. It
 * ALSO carries the wip MetricSource reveal so the operator can trace WIP. */
function InFlightBadge({ stage, count, sourceRows, open }) {
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
      <MetricSource id={panelId} stage={stage} kind="wip" sourceRows={sourceRows} open={open} />
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
export function StageNode({ data }) {
  const { stage, label, throughput, dwell_median_s, wip, rework, source_rows } = data;
  const isGate = GATES.has(stage);
  const wipActive = Number(wip) > 0;
  const dwell = humaniseDwell(dwell_median_s);

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

  // accessible name carries the key figures (A11Y-2/A11Y-4) — number never bare.
  const wipPhrase = wipActive ? `WIP ${wip}, ${wip} in-flight` : `WIP ${wip}`;
  let name = `${label} stage, throughput ${throughput}, dwell ${dwell}, ${wipPhrase}, rework ${rework}`;
  if (isGate) name = `gate: ${name}`;

  return (
    <div
      class="stage-node"
      data-testid={`stage-${stage}`}
      role="group"
      aria-label={name}
      tabindex="0"
      data-stage-kind={isGate ? 'gate' : 'work'}
      data-wip={String(wip)}
      data-wip-active={wipActive ? 'true' : 'false'}
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
      <dl class="stage-figs">
        <StageMetric stage={stage} kind="throughput" label="Throughput" value={String(throughput)} sourceRows={source_rows} open={open} />
        <StageMetric stage={stage} kind="dwell" label="Dwell" value={dwell} sourceRows={source_rows} open={open} />
        {wipActive
          ? <InFlightBadge stage={stage} count={wip} sourceRows={source_rows} open={open} />
          : <StageMetric stage={stage} kind="wip" label="WIP" value={String(wip)} sourceRows={source_rows} open={open} />}
        <StageMetric stage={stage} kind="rework" label="Rework" value={String(rework)} sourceRows={source_rows} open={open} />
      </dl>
    </div>
  );
}
