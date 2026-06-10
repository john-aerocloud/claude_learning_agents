// UC-S004-2/3/4 — Value-stream map RENDER (the DEFECT-001 real-data primary
// surface that REPLACES the empty queue-depth PipelineMap).
//
// HEXAGONAL ROLE: pure render component. It consumes the stage-flow array
// produced by the UC-S004-1 endpoint (one object per canonical stage, in flow
// order) and touches NO fetch/URL — the VsmContainer adapter does the loading.
// Render: HTML+CSS flex lanes for the nodes, inline SVG connectors (aria-hidden,
// decorative) — the flow direction is ALSO carried structurally by DOM order +
// lane labels so meaning never depends on the SVG.
//
// WHY THIS FIXES THE DEFECT: the old PipelineMap rendered queue DEPTHS from
// queues/*.csv, which are ~0 in a pull system (work is in-flight, not queued).
// This map renders per-stage THROUGHPUT + in-flight WIP from /stage-flow, so the
// real work the operator is doing right now is visible (engineer throughput 7,
// wip 2, etc.) — not 0,0,0,0.
//
// TOPOLOGY (ui-design.md §2): the endpoint returns 11 entries (10 canonical
// stages + a `rework` aggregate). The MAP renders the 10 stages as nodes in
// three lanes; `rework` is a LOOP (ReworkLoopConnector), not an 11th node. Each
// node carries four labelled figures; a node with wip>0 promotes its WIP figure
// to a prominent, non-colour-redundant in-flight badge (the crux of the fix:
// pulled-but-not-done work must be impossible to miss).

import './value-stream-map.css';
import { StageNode } from './StageNode.jsx';

// Canonical 10-stage flow order = the geometry contract (GEO-3 / AC2.2).
const FLOW_ORDER = [
  'intake', 'decompose', 'ready', 'capabilities', 'ui-design',
  'engineer', 'ui-validate', 'deploy', 'validate', 'done',
];

// Lane assignment (queue / build / release) — maps to the operator's mental
// model and the CORE-job wording. Order within a lane is FLOW_ORDER.
const LANES = [
  { id: 'queue', label: 'Intake & Ready', stages: ['intake', 'decompose', 'ready'] },
  { id: 'build', label: 'Build', stages: ['capabilities', 'ui-design', 'engineer', 'ui-validate'] },
  { id: 'release', label: 'Release', stages: ['deploy', 'validate', 'done'] },
];

/** Decorative forward connector (reused intent from s002 FlowArrow). */
function FlowArrow({ from, to }) {
  return (
    <svg
      class="flow-arrow flow-arrow--forward"
      data-testid="flow-arrow"
      data-from={from}
      data-to={to}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 40 24"
      width="40"
      height="24"
    >
      <line x1="2" y1="12" x2="30" y2="12" stroke="currentColor" stroke-width="2" />
      <path d="M30 6 L38 12 L30 18 Z" fill="currentColor" />
    </svg>
  );
}

/** The rework loop: a returning right→left SVG path (aria-hidden, decorative)
 * + a visible "Rework" text node OUTSIDE the svg (A11Y-6 / GEO-5). */
function ReworkLoopConnector({ from = 'validate', to = 'engineer' }) {
  return (
    <div class="rework-loop" data-testid="rework-loop" data-from={from} data-to={to}>
      <svg
        class="rework-loop__path"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 80 24"
        width="80"
        height="24"
      >
        {/* runs right→left: starts at x=78 (validate side), ends at x=2 (build
            side) with the arrowhead at the LEFT — a measurable return (GEO-5). */}
        <path d="M78 18 C 50 24, 30 24, 10 12" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M10 6 L2 12 L10 18 Z" fill="currentColor" />
      </svg>
      <span class="rework-loop__label">Rework</span>
    </div>
  );
}

/** All-zeros skeleton row when stages is null/empty (fail-soft) — the full 10
 * labelled nodes at zero, NOT a blank region (AC2.6 / GEO-8 / CC1). */
const ZERO_STAGES = FLOW_ORDER.map((stage) => ({
  stage, label: stage, throughput: 0, dwell_median_s: 0, wip: 0, rework: 0, source_rows: [],
}));

/**
 * The value-stream map. `stages` is the /stage-flow array (11 entries incl.
 * rework) or null/[] (fail-soft → all-zeros skeleton).
 *
 * DEFECT-003 — `stale` (default false) marks the figures as NOT-CURRENT when the
 * live channel is lost: it stamps `data-stale="true"` (the machine-readable cue
 * the container/tests assert) and dims the figures via the `value-stream-map--stale`
 * class. Staleness meaning is carried authoritatively by the container's text
 * banner + LiveStatusDot, never colour/dim alone.
 * @param {{ stages?: Array|null, stale?: boolean }} props
 */
export function ValueStreamMap({ stages, stale = false }) {
  const src = Array.isArray(stages) && stages.length > 0 ? stages : ZERO_STAGES;
  const byStage = Object.fromEntries(src.map((s) => [s.stage, s]));
  // Only the 10 canonical nodes render (rework is the loop, not a node).
  const nodeFor = (stage) =>
    byStage[stage] || { stage, label: stage, throughput: 0, dwell_median_s: 0, wip: 0, rework: 0, source_rows: [] };

  return (
    <section
      class={`value-stream-map${stale ? ' value-stream-map--stale' : ''}`}
      data-testid="value-stream-map"
      data-stale={stale ? 'true' : 'false'}
      aria-busy={stale ? 'true' : 'false'}
      role="region"
      aria-label="Value-stream map"
    >
      <h2 class="value-stream-map__h">Value-stream map</h2>
      {LANES.map((lane) => (
        <div
          class="vsm-lane"
          data-testid={`vsm-lane-${lane.id}`}
          role="group"
          aria-label={`${lane.label} lane`}
        >
          <span class="vsm-lane__h">{lane.label}</span>
          <div class="vsm-lane__flow">
            {lane.stages.map((stage, i) => (
              <>
                <StageNode data={nodeFor(stage)} />
                {i < lane.stages.length - 1
                  ? <FlowArrow from={stage} to={lane.stages[i + 1]} />
                  : null}
              </>
            ))}
            {/* the rework loop sits in the build lane (back-path into engineer) */}
            {lane.id === 'build' ? <ReworkLoopConnector from="validate" to="engineer" /> : null}
          </div>
        </div>
      ))}
    </section>
  );
}
