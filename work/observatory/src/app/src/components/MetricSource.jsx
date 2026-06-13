// UC-S004-5 + DEFECT-005 + DEFECT-014 — the metric TRACEABILITY reveal
// (components.md MetricSource).
//
// HEXAGONAL ROLE: pure render. Given each metric's contributing ledger EVENTS
// (source_events from the UC-S004-1 endpoint), it renders the role="tooltip"
// panel the operator opens (focus+Enter or hover on the owning node) to see
// WHERE the numbers came from in HUMAN-READABLE form — so they can open
// ledger.csv and verify the claim independently (SM3 traceability).
//
// DEFECT-014 (ui-designer ruling, option b): the reveal was rendered ONCE PER
// FIGURE — node hover opened FOUR absolutely-positioned panels in an
// overlapping stack. It is now split into:
//   - MetricSourcePanel  — the ONE node-scoped overlay container
//     (role="tooltip", `hidden` from `open`, data-testid="metric-source-<stage>",
//     pointer-events:none via .metric-source). StageNode renders exactly one.
//   - MetricSourceSection — the old per-kind body (caption/file/summary/events/
//     empty), one per metric INSIDE the panel. It keeps the per-kind
//     data-testid "metric-source-<stage>-<kind>" and the `src-<stage>-<kind>`
//     id the metric value's aria-describedby points at — the value→provenance
//     wiring and all existing tester selectors survive unchanged.
//
// DEFECT-005: each contributing event renders as a readable line
// "HH:MM · <agent> · <event> · <item_id>", names the source file, and caps the
// visible list to the most recent few + "…and N more".
//
// CONTRACT (acceptance.md UC-S004-5 + A11Y-10 + DEFECT-014 D14-AC-1..6):
//   - the PANEL has role="tooltip"; each metric value references its SECTION
//     via aria-describedby (the section `id` prop).
//   - value>0 → readable event lines (NOT row:N) behind a visible
//     "↗ <Metric> source" caption (text + glyph, never colour-only).
//   - value=0 (no events) → "no events recorded" (AC5.3), not blank/broken.
//   - the panel is hidden until the owning node reveals it (`open`);
//     dismissible via Esc / mouse-leave / blur handled by the owning StageNode.
//   - sections keep data-testid="metric-source-<stage>-<kind>"; each event line
//     carries a data-source-row audit attribute.

import './metric-source.css';

const SOURCE_FILE = 'process/dora/ledger.csv';
// Show the most recent few events; the rest collapse into "…and N more".
const MAX_EVENTS_SHOWN = 8;
// DEFECT-008: a note carries the human "why" but can be long — trim and
// ellipsise so one reveal line does not blow out. The server keeps the full note.
const MAX_NOTE_LEN = 120;

/** Trim and ellipsise a note for a single reveal line; "" when there is none. */
function shortNote(note) {
  if (typeof note !== 'string') return '';
  const n = note.trim();
  if (n === '') return '';
  return n.length > MAX_NOTE_LEN ? `${n.slice(0, MAX_NOTE_LEN - 1)}…` : n;
}

/** Render an ISO timestamp as a local HH:MM; falls back to the raw value. */
function formatTime(ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return typeof ts === 'string' ? ts : '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * One readable source line: "HH:MM · agent · event · item_id — note"
 * (item omitted if blank; DEFECT-008 appends the human "why" note after an
 * em-dash; when the note is empty the em-dash is dropped — clean fall-back to id).
 */
function eventLine(e) {
  const parts = [formatTime(e.ts), e.agent, e.event];
  if (e.item_id) parts.push(e.item_id);
  const head = parts.filter(Boolean).join(' · ');
  const note = shortNote(e.note);
  return note ? `${head} — ${note}` : head;
}

/** A stable audit ref for a line (the ledger fields, not an internal index). */
function auditRef(e) {
  return [e.ts, e.agent, e.event, e.item_id].filter(Boolean).join('|');
}

/**
 * DEFECT-014 — the ONE node-scoped overlay container. StageNode renders exactly
 * one per node (sibling of the figures list); the per-metric sections live
 * inside it. `hidden` removes it from layout AND the a11y tree until the node
 * opens it, so the open-node invariant is exactly-one-visible-tooltip.
 *
 * @param {{ id?: string; stage: string; open?: boolean; children: any }} props
 */
export function MetricSourcePanel({ id, stage, open, children }) {
  return (
    <div
      id={id}
      class="metric-source"
      data-testid={`metric-source-${stage}`}
      role="tooltip"
      hidden={open ? undefined : true}
    >
      {children}
    </div>
  );
}

/**
 * DEFECT-014 — one metric's provenance SECTION (the pre-014 panel body):
 * labelled caption, source file, optional DEFECT-007 summary, readable event
 * lines or the AC5.3 empty state. Carries the per-kind selectors and the id
 * the metric value's aria-describedby points at.
 *
 * @param {{
 *   id: string; stage: string; kind: string; label?: string;
 *   sourceEvents?: Array<{ts:string,agent:string,event:string,item_id:string,note?:string}>;
 *   sourceTotal?: number; sourceRows?: string[]; summary?: string;
 * }} props
 */
export function MetricSourceSection({ id, stage, kind, label, sourceEvents, sourceTotal, summary }) {
  const events = Array.isArray(sourceEvents) ? sourceEvents.filter(Boolean) : [];
  const total = Number.isFinite(sourceTotal) ? sourceTotal : events.length;
  const hasEvents = events.length > 0;
  const shown = events.slice(0, MAX_EVENTS_SHOWN);
  const moreCount = Math.max(total - shown.length, 0);
  const caption = label ? `${label} source` : 'source';

  return (
    <section
      id={id}
      class="metric-source__section"
      data-testid={`metric-source-${stage}-${kind}`}
      aria-label={caption}
    >
      <span class="metric-source__caption">
        <span class="metric-source__glyph" aria-hidden="true">↗</span>
        <span>{caption}</span>
      </span>
      <span class="metric-source__file" data-testid={`source-file-${stage}-${kind}`}>
        {SOURCE_FILE}
      </span>
      {/* DEFECT-007 D7-AC-4 — the throughput raw COUNT is demoted here (numerator
          of the headline rate), e.g. "13 items over 2 active days (6.5 items/day)". */}
      {typeof summary === 'string' && summary !== '' ? (
        <span
          class="metric-source__summary"
          data-testid={`metric-source-summary-${stage}-${kind}`}
        >
          {summary}
        </span>
      ) : null}
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
    </section>
  );
}
