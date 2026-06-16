// UC-S018-3 — QueueRankStep: the queue-rank preview surface, mounted by
// IntakeWizard into its EXISTING step-3 slot (replacing the UC-S018-1
// wizard-step-placeholder for currentStep === 3). Owns NO drawer, NO step
// machine, NO fetch — a PURE RENDER of the wizard's lifted CodScore + the
// useQueueRank fetch state + the pure rankPreview domain fn.
//
// THE LIFT (UC-S018-4 contract): the READ lives in the WIZARD (it calls
// useQueueRank itself, always mounted, enabled when step >= 3) so the items are
// fetched ONCE per session and cached across a Back→forward round trip
// (AC-S018-3-2/3, NOWRITE-S018-3-1). The wizard passes the {status, items}
// state down as `rankState`; this component derives the RankPreview and renders
// it. (For standalone/test use the component can call the hook itself via the
// injectable `useRankHook`.)
//
// FOUR TEXTUALLY-DISTINCT STATES (FIG-S018-3-3), each its own testid:
//   - GATED   (score.complete === false): a PROMPT to finish step 2 — never a
//             fabricated rank (rank-gated; rank-preview absent).
//   - LOADING (complete && status==='loading'): "Reading the live queue…"
//             (rank-loading).
//   - ERROR   (complete && status==='error'): fail-soft "couldn't read the live
//             queue" — never a fabricated rank (rank-error).
//   - READY   (complete && status==='ready'): the directional rank sentence, or
//             the empty-queue sentence when the backlog has no competing items
//             (rank-preview, with data-rank-ahead/-behind/-total cross-checks).
//
// HEXAGONAL ROLE: render layer. The rank rule is the pure domain fn
// lib/queueRank.js; the read is the hook useQueueRank.js. This file owns only
// DOM concerns (the state→figure mapping + the labelled region).
import { useQueueRank } from '../hooks/useQueueRank.js';
import { rankPreview } from '../lib/queueRank.js';
import './intake-wizard.css';

/** RankPreviewSentence — THE FIG surface: the live human directional sentence
 * as a labelled status region. Counts carry the unit "items", the tier is a
 * WORD; the numeric cross-check hooks (data-rank-*) let the tester match the
 * live items.csv comparison-set counts. */
function RankPreviewSentence({ rank }) {
  return (
    <p
      class="rank-preview"
      data-testid="rank-preview"
      role="status"
      aria-live="polite"
      data-rank-ahead={rank.ahead}
      data-rank-behind={rank.behind}
      data-rank-total={rank.total}
    >
      {rank.sentence}
    </p>
  );
}

/**
 * @param {object} props
 * @param {{token:('HIGH'|'MED'|'LOW'|null), complete:boolean}} props.score
 *   — the wizard's lifted CodScore (the gate + the wizard item's tier).
 * @param {{status:'loading'|'ready'|'error', items:Array}} [props.rankState]
 *   — the fetch state lifted from the wizard's useQueueRank call. When omitted,
 *   the component calls the hook itself (standalone/test use).
 * @param {object|null} [props.rank] - the RankPreview the wizard already
 *   derived (the LIFTED, author-once object UC-S018-4 also reads). When the
 *   wizard supplies it, this component renders it rather than re-deriving — the
 *   single compute site is the shell.
 * @param {() => {status:string, items:Array}} [props.useRankHook] - injectable
 *   hook for standalone unit tests; only used when rankState is omitted.
 * @param {string} props.uid - the wizard's useId, for a stable heading id.
 */
export function QueueRankStep({ score, rankState, rank: liftedRank, useRankHook = useQueueRank, uid }) {
  // If the wizard lifted the state, render it; otherwise call the hook here.
  const ownState = useRankHook(rankState ? { enabled: false } : undefined);
  const { status, items } = rankState || ownState;

  const headingId = `rank-step-h-${uid}`;
  const complete = !!score?.complete;
  const token = complete ? score.token : null;
  // Prefer the wizard's lifted RankPreview (single compute site / UC-S018-4
  // contract); fall back to deriving it here in standalone/test use.
  const rank =
    liftedRank !== undefined
      ? liftedRank
      : complete && status === 'ready'
        ? rankPreview({ token, items })
        : null;

  return (
    <section
      class="rank-step"
      role="group"
      aria-labelledby={headingId}
      data-testid="queue-rank-step"
      data-step="rank"
    >
      {/* <h3> under the wizard <h2> — no skipped heading level (A11Y-S018-3-2) */}
      <h3 id={headingId} class="rank-step__h" data-testid="rank-step-heading">Queue rank</h3>

      {!complete ? (
        <p class="rank-gated" data-testid="rank-gated" role="status" aria-live="polite">
          Choose a value and urgency on the previous step to see where your item would rank.
        </p>
      ) : status === 'loading' ? (
        <p class="rank-loading" data-testid="rank-loading" role="status" aria-live="polite">
          Reading the live queue…
        </p>
      ) : status === 'error' ? (
        <p class="rank-error" data-testid="rank-error" role="status" aria-live="polite">
          Couldn&rsquo;t read the live queue — your rank preview is unavailable. You can still
          generate the prompt.
        </p>
      ) : (
        <RankPreviewSentence rank={rank} />
      )}
    </section>
  );
}
