// UC-S013-3 — MttrCard: the reported→recovered timeline + the MTTR figure
// (the one genuinely new leaf of the defect drill). The card OWNS the duration
// humanisation so the figure is correct at the leaf (reuses formatMttr — the
// one duration humaniser, from useDefects).
//
// HEXAGONAL ROLE: pure render of raw endpoint fields (reported_ts /
// recovered_ts / mttr_s / mttr_units). `now` is injectable for deterministic
// tests; default Date.now() (a read-time clock, not state).
//
// STATES (data-mttr-state):
//   resolved — recoveredTs + mttrS set → timeline + unit-bearing MTTR figure.
//   open     — recoveredTs/mttrS null → "Not yet resolved" + a running
//              elapsed-open figure ("open for 13 min") that is EXPLICITLY NOT
//              labelled "MTTR" (an MTTR is a CLOSED span; elapsed-open is a
//              running clock — the DEFECT-007 mislabelled-metric lesson;
//              S13-3-FIG-2). No live open instance exists today (all 12 live
//              defects CLOSED) — the open path is exercised via fixture.
//   unknown  — reportedTs null (defensive) → "—", no crash (S13-3-FIG-5).
//
// FIGURES: every timestamp + the duration is a labelled <dt>/<dd> pair (no
// bare figure, S13-3-A11Y-4); timestamps human-readable date + UTC clock
// (S13-3-FIG-3); empty/open ≠ zero (never "0 s"). data-source carries the
// ledger provenance for the span (S13-3-FIG-7).
import { formatMttr } from '../hooks/useDefects.js';

/** ISO "2026-06-10T06:17:47Z" → human "2026-06-10 06:17:47 UTC"; else "—". */
export function formatTimestamp(ts) {
  const m = typeof ts === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(ts) : null;
  return m ? `${m[1]} ${m[2]} UTC` : '—';
}

/**
 * @param {object} props
 * @param {string} props.defectId       - for the ledger data-source ref
 * @param {string|null} props.reportedTs
 * @param {string|null} props.recoveredTs
 * @param {number|null} props.mttrS
 * @param {string|null} props.mttrUnits - always "s" live; mttrS is seconds
 * @param {number} [props.now]          - injectable clock (ms) for the open state
 */
export function MttrCard({ defectId, reportedTs, recoveredTs, mttrS, mttrUnits, now }) {
  const resolved = Number.isFinite(mttrS) && typeof recoveredTs === 'string' && recoveredTs;
  const reportedMs = typeof reportedTs === 'string' ? Date.parse(reportedTs) : NaN;
  const state = resolved ? 'resolved' : Number.isFinite(reportedMs) ? 'open' : 'unknown';

  // open state: a RUNNING clock, labelled "Elapsed open" — never "MTTR".
  let openFigure = '—';
  if (state === 'open') {
    const elapsedS = ((Number.isFinite(now) ? now : Date.now()) - reportedMs) / 1000;
    const human = formatMttr(elapsedS);
    openFigure = human === '—' ? '—' : `open for ${human}`;
  }

  return (
    <section
      class="mttr-card"
      role="group"
      aria-label="MTTR — mean time to recovery"
      data-testid="mttr-card"
      data-mttr-state={state}
      data-source={`process/dora/ledger.csv#ref=${defectId}`}
    >
      <h3 class="mttr-card__h">MTTR — mean time to recovery</h3>
      {/* two-point timeline: reported ● → recovered ● (DOM order = GEO-S013-3-4
          order=meaning; the recovered point is dimmed in the open state) */}
      <dl class="mttr-card__timeline">
        <div class="mttr-card__point mttr-card__point--reported">
          <dt>
            <span aria-hidden="true" class="mttr-card__dot">●</span> Reported
          </dt>
          <dd data-testid="mttr-reported">
            {state === 'unknown' ? 'Reported time not recorded' : formatTimestamp(reportedTs)}
          </dd>
        </div>
        <div
          class={`mttr-card__point mttr-card__point--recovered ${
            resolved ? '' : 'mttr-card__point--pending'
          }`}
        >
          <dt>
            <span aria-hidden="true" class="mttr-card__dot">{resolved ? '●' : '○'}</span> Recovered
          </dt>
          {/* open ≠ zero (S13-3-FIG-2): visible TEXT, never "0 s"/blank */}
          <dd data-testid="mttr-recovered">
            {resolved ? formatTimestamp(recoveredTs) : 'Not yet resolved'}
          </dd>
        </div>
        <div class="mttr-card__figure-row">
          {/* the figure's label: "MTTR" ONLY for the resolved closed span;
              the open running figure is "Elapsed open" (DEFECT-007 lesson) */}
          <dt>{resolved ? 'MTTR' : 'Elapsed open'}</dt>
          <dd
            data-testid="mttr-figure"
            class="mttr-card__figure"
            {...(resolved ? { 'data-mttr-seconds': String(mttrS) } : {})}
          >
            {resolved ? formatMttr(mttrS) : openFigure}
          </dd>
        </div>
      </dl>
    </section>
  );
}
