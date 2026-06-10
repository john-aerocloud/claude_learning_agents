// UC-S004-5 + DEFECT-005 — the metric TRACEABILITY reveal (components.md MetricSource).
//
// HEXAGONAL ROLE: pure render. Given a metric's contributing ledger EVENTS
// (source_events from the UC-S004-1 endpoint), it renders a role="tooltip" panel
// the operator opens (focus+Enter or hover on the owning node) to see WHERE the
// number came from in HUMAN-READABLE form — so they can open ledger.csv and
// verify the claim independently (SM3 traceability).
//
// DEFECT-005: the reveal previously dumped raw "row:N" CSV line indices —
// meaningless to a human. It now renders each contributing event as a readable
// line "HH:MM · <agent> · <event> · <item_id>", names the source file, and caps
// the visible list to the most recent few + "…and N more" so a busy stage
// (85 engineer task_starts) does not dump 85 lines.
//
// CONTRACT (acceptance.md UC-S004-5 + A11Y-10):
//   - role="tooltip", referenced by its metric value via aria-describedby (the
//     `id` prop matches the metric's aria-describedby).
//   - value>0 → readable event lines (NOT row:N), behind a visible "↗ source"
//     caption (text + glyph, never colour-only — reuses the s003 SourceLink convention).
//   - value=0 (no events) → "no events recorded" (AC5.3), not blank/broken.
//   - hidden until the owning node reveals it (`open`); dismissible via Esc /
//     mouse-leave handled by the owning StageNode.
//   - data-testid="metric-source-<stage>-<kind>" (stable selector); each line
//     carries a data-source-row audit attribute.

import './metric-source.css';

const SOURCE_FILE = 'process/dora/ledger.csv';
// Show the most recent few events; the rest collapse into "…and N more".
const MAX_EVENTS_SHOWN = 8;

/** Render an ISO timestamp as a local HH:MM; falls back to the raw value. */
function formatTime(ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return typeof ts === 'string' ? ts : '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** One readable source line: "HH:MM · agent · event · item_id" (item omitted if blank). */
function eventLine(e) {
  const parts = [formatTime(e.ts), e.agent, e.event];
  if (e.item_id) parts.push(e.item_id);
  return parts.filter(Boolean).join(' · ');
}

/** A stable audit ref for a line (the ledger fields, not an internal index). */
function auditRef(e) {
  return [e.ts, e.agent, e.event, e.item_id].filter(Boolean).join('|');
}

/**
 * @param {{
 *   id: string; stage: string; kind: string; open?: boolean;
 *   sourceEvents?: Array<{ts:string,agent:string,event:string,item_id:string}>;
 *   sourceTotal?: number; sourceRows?: string[];
 * }} props
 */
export function MetricSource({ id, stage, kind, sourceEvents, sourceTotal, open }) {
  const events = Array.isArray(sourceEvents) ? sourceEvents.filter(Boolean) : [];
  const total = Number.isFinite(sourceTotal) ? sourceTotal : events.length;
  const hasEvents = events.length > 0;
  const shown = events.slice(0, MAX_EVENTS_SHOWN);
  const moreCount = Math.max(total - shown.length, 0);

  return (
    <div
      id={id}
      class="metric-source"
      data-testid={`metric-source-${stage}-${kind}`}
      role="tooltip"
      hidden={open ? undefined : true}
    >
      <span class="metric-source__caption">
        <span class="metric-source__glyph" aria-hidden="true">↗</span>
        <span>source</span>
      </span>
      <span class="metric-source__file" data-testid={`source-file-${stage}-${kind}`}>
        {SOURCE_FILE}
      </span>
      {hasEvents ? (
        <ul class="metric-source__events">
          {shown.map((e) => (
            <li
              class="metric-source__event"
              data-testid="source-event"
              data-source-row={auditRef(e)}
            >
              {eventLine(e)}
            </li>
          ))}
          {moreCount > 0 ? (
            <li
              class="metric-source__more"
              data-testid={`source-more-${stage}-${kind}`}
            >
              …and {moreCount} more
            </li>
          ) : null}
        </ul>
      ) : (
        <span class="metric-source__empty">no events recorded</span>
      )}
    </div>
  );
}
