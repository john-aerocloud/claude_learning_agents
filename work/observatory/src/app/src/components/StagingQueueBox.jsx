// DEFECT-012 — the staging buffer box: "Decomposed — awaiting triage".
//
// HEXAGONAL ROLE: pure render component. Consumes the staging envelope from
// GET /api/projects/:id/queues/staging ({ queue, depth, rows }) via the
// VsmContainer adapter; touches no fetch/URL.
//
// WHY: between product's decompose completion and the flow-manager's triage
// sweep, produced items sit in queues/staging.csv. That handoff is a REAL
// buffer (lean rule: every handoff is a buffer, and buffers are visible) —
// the board renders it BETWEEN Decompose and Ready so decomposed work is
// never invisible (the DEFECT-012 symptom: 4 UCs existed nowhere on the
// board for ~35min).
//
// LEGIBILITY (empty ≠ zero-confusion): the depth figure is always present
// ("N awaiting triage"); at depth 0 an explicit drained empty-state line is
// shown — the HAPPY state, distinguishable from missing data. Rows show
// id + job (human-meaningful). The box is intentionally NOT focusable and
// carries no `stage-` testid / data-metric hook so the existing A11Y-3 tab
// walk, the 10-node guard, and the SRC-1 metric guard stay intact.

import './staging-queue-box.css';

// Mirror StageNode's MAX_QUEUE_ITEMS_SHOWN: first 3 rows, then "+N more",
// so a full buffer (wip_limit 20) cannot blow the lane geometry up.
const MAX_STAGING_ITEMS_SHOWN = 3;

/**
 * @param {{ staging?: { depth?: number, rows?: Array<{item_id: string, job?: string}> } | null }} props
 */
export function StagingQueueBox({ staging }) {
  const rows = staging && Array.isArray(staging.rows) ? staging.rows : [];
  const rawDepth = staging ? Number(staging.depth) : 0;
  const depth = Number.isFinite(rawDepth) && rawDepth > 0 ? rawDepth : rows.length;
  const shown = rows.slice(0, MAX_STAGING_ITEMS_SHOWN);
  const moreCount = depth - shown.length;
  const name = `Staging buffer (decomposed, awaiting triage), ${depth} awaiting triage`;

  return (
    <div
      class="staging-queue-box"
      data-testid="staging-buffer"
      role="group"
      aria-label={name}
      data-depth={String(depth)}
      data-empty={depth === 0 ? 'true' : 'false'}
    >
      <div class="staging-queue-box__head">
        <span class="staging-queue-box__name">Staging</span>
        <span class="staging-queue-box__sub">awaiting triage</span>
      </div>
      <p class="staging-queue-box__depth" data-testid="staging-depth">
        {depth} awaiting triage
      </p>
      {depth === 0 ? (
        <p class="staging-queue-box__empty" data-testid="staging-empty">
          drained — no decomposed items waiting
        </p>
      ) : (
        <ul class="staging-items" data-testid="staging-items">
          {shown.map((r) => (
            <li
              class="staging-item"
              key={r.item_id}
              data-testid={`staging-item-${r.item_id}`}
              title={`${r.item_id} — ${r.job || ''}`}
            >
              <span class="staging-item__id">{r.item_id}</span>{' '}
              <span class="staging-item__job">{r.job}</span>
            </li>
          ))}
          {moreCount > 0 ? (
            <li class="staging-item staging-item--more" data-testid="staging-more">
              ... +{moreCount} more
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
