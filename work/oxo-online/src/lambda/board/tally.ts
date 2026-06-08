/**
 * tally.ts (board DOMAIN) — the pure outcome function for the arcade scoreboard
 * (§41 hexagonal centre). Given a Games status TRANSITION (old + new status,
 * the two participant names, and the gameId) it returns the list of tally
 * operations to apply — each `{ name, field, gameId }`. PURE: zero SDK, zero
 * transport, zero DynamoDB type. Unit-tested with no infra (delta §6 — stands
 * fully locally).
 *
 * s009 (delta 010 §3). The stream event-source mapping filter already screens
 * to active→{won,drawn} MODIFYs, but the domain re-checks the transition itself
 * (defence in depth, SM-5): only an active→won/drawn transition yields ops; any
 * other status combination yields ZERO ops. The handler/adapter turns each op
 * into a single conditional UpdateItem (the idempotency CAS); this function
 * never touches a store.
 */

/** The durable counter fields on a Leaderboard name row. */
export type TallyField = 'wins' | 'draws' | 'losses';

/** One tally operation: increment `field` on `name`'s row, marked with gameId. */
export interface TallyOp {
  name: string;
  field: TallyField;
  gameId: string;
}

export interface Transition {
  oldStatus: string;
  newStatus: string;
  winnerName?: string;
  loserName?: string;
  gameId: string;
}

/** Arcade default name (SM-3) — applied belt-and-braces if a name is absent. */
const DEFAULT_NAME = 'AAA';

function orDefault(name?: string): string {
  const trimmed = (name ?? '').trim();
  return trimmed === '' ? DEFAULT_NAME : trimmed;
}

/**
 * Compute the tally ops for a Games status transition.
 *
 * Only an `active → won` (winner +1 win, loser +1 loss) or `active → drawn`
 * (both +1 draw) transition produces ops. Every other combination — still
 * active, abandoned, or a transition that did not originate from `active` —
 * produces an empty list.
 */
export function tally(t: Transition): TallyOp[] {
  if (t.oldStatus !== 'active') return [];

  const winner = orDefault(t.winnerName);
  const loser = orDefault(t.loserName);

  if (t.newStatus === 'won') {
    return [
      { name: winner, field: 'wins', gameId: t.gameId },
      { name: loser, field: 'losses', gameId: t.gameId },
    ];
  }
  if (t.newStatus === 'drawn') {
    return [
      { name: winner, field: 'draws', gameId: t.gameId },
      { name: loser, field: 'draws', gameId: t.gameId },
    ];
  }
  return [];
}
