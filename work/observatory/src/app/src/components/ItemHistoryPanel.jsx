// UC-S005-5 — ItemHistoryPanel: the item's ledger event history, the primary
// interrogation affordance (the SM1 answer mechanism). Mounts into the detail
// pane's `data-testid="item-history-slot"`.
//
// HEXAGONAL ROLE: pure render. Given the item's ledger ROWS (fetched by the
// container via api/client getItemLedger → GET /api/projects/:id/ledger?item_id=<id>,
// already newest-first) and the itemId, it renders each row as a READABLE line —
// the SAME human-readable style as the DEFECT-005 source reveal
// ("HH:MM · agent · event · outcome · note"), NOT raw row indices. It owns NO
// fetch and never throws on null/empty input.
//
// CONTRACT (acceptance.md UC-S005-5 + ui-design.md ItemHistoryPanel):
//   - role="region" aria-label="Item history: <id>"; data-testid="item-history".
//   - rows are a role="list"; each row data-testid="history-row" + data-timestamp.
//   - each row shows timestamp · agent · event · outcome (+ duration_s, note when
//     present) — AC-S005-5-3; newest-first preserved from the endpoint (AC-S005-5-2).
//   - empty / null rows → "no history yet" placeholder, no crash (AC-S005-5-4).
//   - GEO-S005-2: rows STACK vertically (a list, not a grid).
//   - data-source="process/dora/ledger.csv#item_id=<id>" (the source convention).

import './item-history-panel.css';

const SOURCE_FILE = 'process/dora/ledger.csv';

/** Render an ISO timestamp as a local HH:MM; falls back to the raw value. */
function formatTime(ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return typeof ts === 'string' ? ts : '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** A stable audit ref for a row (the ledger fields, not an internal index). */
function auditRef(r) {
  return [r.timestamp, r.agent, r.event, r.outcome].filter(Boolean).join('|');
}

/**
 * @param {object} props
 * @param {Array<{timestamp:string,agent:string,event:string,duration_s?:string,outcome?:string,note?:string}>|null} props.rows
 * @param {string} props.itemId
 */
export function ItemHistoryPanel({ rows, itemId }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const hasRows = list.length > 0;

  return (
    <section
      class="item-history"
      role="region"
      aria-label={`Item history: ${itemId}`}
      data-testid="item-history"
      data-source={`${SOURCE_FILE}#item_id=${itemId}`}
    >
      <header class="item-history__head">
        <span class="item-history__title">history</span>
        <span class="item-history__file" aria-hidden="true">{SOURCE_FILE}</span>
      </header>
      {hasRows ? (
        <ol class="item-history__list" role="list">
          {list.map((r) => (
            <li
              class="item-history__row"
              data-testid="history-row"
              data-timestamp={r.timestamp}
            >
              <span class="item-history__time">{formatTime(r.timestamp)}</span>
              <span class="item-history__sep" aria-hidden="true">·</span>
              <span class="item-history__agent">{r.agent}</span>
              <span class="item-history__sep" aria-hidden="true">·</span>
              <span class="item-history__event">{r.event}</span>
              {r.outcome && r.outcome !== 'na' ? (
                <>
                  <span class="item-history__sep" aria-hidden="true">·</span>
                  <span class="item-history__outcome" data-outcome={r.outcome}>
                    {r.outcome}
                  </span>
                </>
              ) : null}
              {r.duration_s ? (
                <>
                  <span class="item-history__sep" aria-hidden="true">·</span>
                  <span class="item-history__dur">{r.duration_s}s</span>
                </>
              ) : null}
              {r.note ? (
                <span class="item-history__note" title={r.note} data-audit={auditRef(r)}>
                  {r.note}
                </span>
              ) : (
                <span class="item-history__audit" data-audit={auditRef(r)} hidden />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p class="item-history__empty">no history yet for this item</p>
      )}
    </section>
  );
}
