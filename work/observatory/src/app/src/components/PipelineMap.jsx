// UC-S002-3 — Pipeline map RENDER (the first visible surface of Observatory).
//
// HEXAGONAL ROLE: this is a pure render component. It consumes the QueueState[]
// produced by the UC2 domain (state/queues.js) and the optional constraintQueue
// from UC5; it touches NO fetch/URL/CSV — that boundary is the API client
// adapter, the data shape is the domain's. Render decision: §11.2 Option A —
// HTML+CSS flex for the four boxes, inline SVG arrows (aria-hidden, decorative;
// topology is ALSO carried structurally by DOM order + region label, so meaning
// never depends on the SVG).
//
// IA (ui-design.md §1): a single labelled region "Pipeline map"; the three
// forward queues Intake → Ready → Deploy laid out left→right in a forward row,
// with Rework as a return loop BENEATH it. Each queue is a focusable role=group
// box carrying name + live count + buffer meta, and an accessible name that
// announces the count (and the state word when not ok) — A11Y-2.
//
// SCOPE BOUNDARY:
//   - UC-S002-3 exposed data-status="ok|starving|over-wip" on every box.
//   - UC-S002-4 mounts <BufferStateIndicator status={queue.status}/> inside
//     QueueBox — the starving/over-WIP badge (renders nothing when ok).
//   - UC-S002-5 now flips data-constraint + mounts <ConstraintBadge> on the box
//     matched as the ToC constraint (constraintQueue prop), and folds the
//     constraint into the box accessible name. The matching is done UPSTREAM
//     (parsers/baseline.js matchConstraintQueue) — constraintQueue is already
//     the matched queue name or null, so a non-queue constraint (the live
//     baseline names an agent, "tester") arrives here as null and highlights
//     nothing. The two badges occupy DISTINCT visual channels (corner ribbon vs
//     in-flow badge) so they co-occur without masking (A11Y-7).
//   - STILL OPEN: SSE live refresh (UC6) re-drives constraintQueue on a
//     baseline.md change so the highlight stays correct as the constraint moves.

import './pipeline-map.css';
import { BufferStateIndicator } from './BufferStateIndicator.jsx';
import { ConstraintBadge } from './ConstraintBadge.jsx';

const FORWARD = ['intake', 'ready', 'deploy'];

const LABELS = {
  intake: 'Intake',
  ready: 'Ready',
  deploy: 'Deploy',
  rework: 'Rework',
};

/** Human accessible name carrying count + state + constraint (A11Y-2 / A11Y-6). */
function accessibleName(queue, isConstraint = false) {
  const noun = queue.length === 1 ? 'item' : 'items';
  let name = `${LABELS[queue.name]} queue, ${queue.length} ${noun}`;
  if (queue.status === 'starving') name += ', starving';
  else if (queue.status === 'over-wip') name += ', over-WIP';
  // the constraint is announced LAST so it never masks the count/state words;
  // co-occurs with the state word for a constraint+starving box (A11Y-7).
  if (isConstraint) name += ', constraint';
  return name;
}

/** Buffer meta line ("floor 3", "cap 5", or both) — undefined thresholds omit. */
function bufferMeta(queue) {
  const parts = [];
  if (queue.min_items !== undefined) parts.push(`floor ${queue.min_items}`);
  if (queue.wip_limit !== undefined) parts.push(`cap ${queue.wip_limit}`);
  return parts.join(' · ');
}

/**
 * One queue box: name + live count + buffer meta + the buffer-state badge.
 * role=group, focusable (tabindex 0), NOT clickable (read-only; drill-down is
 * CHK-4). data-status drives both the badge and its redundant colour token.
 * UC-S002-4 mounts BufferStateIndicator here (renders nothing when ok). The
 * data-constraint="false" seed + ConstraintBadge attachment point stay for UC5.
 */
function QueueBox({ queue, isConstraint = false }) {
  const meta = bufferMeta(queue);
  return (
    <div
      class="queue-box"
      data-testid={`queue-${queue.name}`}
      role="group"
      aria-label={accessibleName(queue, isConstraint)}
      tabindex="0"
      data-status={queue.status}
      data-constraint={isConstraint ? 'true' : 'false'}
    >
      <span class="queue-name">{LABELS[queue.name]}</span>
      <span class="queue-count" data-testid="queue-count">
        {queue.length}
      </span>
      {meta ? (
        <span class="queue-meta" data-testid="queue-meta">
          {meta}
        </span>
      ) : null}
      <BufferStateIndicator status={queue.status} />
      <ConstraintBadge present={isConstraint} />
    </div>
  );
}

/**
 * Decorative inline-SVG arrow between two boxes. aria-hidden: the flow direction
 * is conveyed structurally (DOM order + region label), so a screen reader never
 * depends on this glyph. kind distinguishes the forward connector from the
 * rework return loop for styling.
 */
function FlowArrow({ from, to, kind = 'forward' }) {
  return (
    <svg
      class={`flow-arrow flow-arrow--${kind}`}
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

/**
 * The pipeline map. queues is 0..4 QueueState entries in flow order; an empty
 * array renders the graceful empty state (no active project) — never a blank or
 * a crash (AC3.4).
 */
export function PipelineMap({ queues = [], constraintQueue = null }) {
  const byName = Object.fromEntries(queues.map((q) => [q.name, q]));
  const forward = FORWARD.map((n) => byName[n]).filter(Boolean);
  const rework = byName.rework;
  // constraintQueue is the already-MATCHED queue name (or null); a box is the
  // constraint iff its name equals it.
  const isConstraint = (name) => constraintQueue != null && name === constraintQueue;

  return (
    <section
      class="pipeline-map"
      data-testid="pipeline-map"
      role="region"
      aria-label="Pipeline map"
    >
      {queues.length === 0 ? (
        <p class="pipeline-empty" data-testid="pipeline-empty">
          No active project — nothing to show on the pipeline map yet.
        </p>
      ) : (
        <>
          <div class="forward-row" data-testid="forward-row">
            {forward.map((q, i) => (
              <>
                <QueueBox queue={q} isConstraint={isConstraint(q.name)} />
                {i < forward.length - 1 ? (
                  <FlowArrow from={q.name} to={forward[i + 1].name} kind="forward" />
                ) : null}
              </>
            ))}
          </div>
          {rework ? (
            <div class="return-loop" data-testid="return-loop">
              <FlowArrow from="deploy" to="rework" kind="rework" />
              <QueueBox queue={rework} isConstraint={isConstraint('rework')} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
