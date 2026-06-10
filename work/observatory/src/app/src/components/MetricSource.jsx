// UC-S004-5 — the metric TRACEABILITY reveal (components.md MetricSource).
//
// HEXAGONAL ROLE: pure render. Given a metric's `source_rows` (the ledger row
// refs the UC-S004-1 endpoint summed to produce the figure), it renders a
// role="tooltip" panel that the operator can open (focus+Enter or hover on the
// owning node) to see WHERE the number came from — so they can open ledger.csv
// and verify the claim independently (SM3 traceability).
//
// CONTRACT (acceptance.md UC-S004-5 + A11Y-10):
//   - role="tooltip", referenced by its metric value via aria-describedby (the
//     `id` prop matches the metric's aria-describedby).
//   - value>0 → lists the real ledger row refs as TEXT (AC5.1/5.2), behind a
//     visible "↗ source" caption (text + glyph, never colour-only — reuses the
//     s003 SourceLink convention).
//   - value=0 (empty source_rows) → "no events recorded" (AC5.3), not blank/broken.
//   - hidden until the owning node reveals it (`open`); dismissible via Esc /
//     mouse-leave handled by the owning StageNode.
//   - data-testid="metric-source-<stage>-<kind>" (stable selector).

import './metric-source.css';

/**
 * @param {{ id: string; stage: string; kind: string; sourceRows?: string[]; open?: boolean }} props
 */
export function MetricSource({ id, stage, kind, sourceRows, open }) {
  const rows = Array.isArray(sourceRows) ? sourceRows.filter(Boolean) : [];
  const hasRows = rows.length > 0;

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
      {hasRows ? (
        <ul class="metric-source__rows">
          {rows.map((r) => (
            <li class="metric-source__row" data-source-row={r}>
              {r}
            </li>
          ))}
        </ul>
      ) : (
        <span class="metric-source__empty">no events recorded</span>
      )}
    </div>
  );
}
