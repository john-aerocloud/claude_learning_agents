/**
 * decide.ts — the PURE $disconnect decision (UC1-S2, §41 domain centre).
 *
 * Given the disconnecting connectionId and the game item it is bound to (or null
 * if the Games row is absent), decide:
 *   - abandon:     do we flip this game active→abandoned? (only an ACTIVE game
 *                  with both players bound, and only for a connection that is one
 *                  of the two bound players — S1: connectionId IS the identity, no
 *                  cross-game force-abandon)
 *   - survivorId:  the bound connection that is NOT the disconnecting one (whom we
 *                  notify); null when there is no identifiable opponent
 *   - notify:      do we post exactly ONE opponent-disconnected frame? (only when
 *                  we abandon AND a survivor exists — S3 amplification bound = 1)
 *
 * terminal (won/drawn) / already-abandoned / waiting / missing-game → no-op
 * (T4 terminal-not-overwritten; T5 waiting thin handling; the won/drawn guard is
 * ALSO enforced as a DDB ConditionExpression at the write — S2 — this pure
 * decision is the in-handler short-circuit, not the only guard).
 *
 * ZERO AWS / SDK / transport imports — fully unit-testable locally.
 */

/** The minimal game shape the decision reads (no persistence/SDK concepts). */
export interface DisconnectGameItem {
  gameId: string;
  /** Raw stored status — may be any of active/won/drawn/waiting/abandoned. */
  status: string;
  hostConnectionId?: string;
  guestConnectionId?: string;
}

/** The decision the handler acts on. */
export interface DisconnectDecision {
  abandon: boolean;
  survivorId: string | null;
  notify: boolean;
}

const NOOP: DisconnectDecision = { abandon: false, survivorId: null, notify: false };

export function decideDisconnect(
  disconnectingConnectionId: string,
  game: DisconnectGameItem | null,
): DisconnectDecision {
  // Missing Games row (24h-TTL-reaped) → nothing to abandon or notify (AC1.5).
  if (!game) return NOOP;

  // Only an ACTIVE game is abandoned. terminal/waiting/already-abandoned → no-op
  // (T4 / T5 / AC1.7 second-arm). The won/drawn guard is also the write condition.
  if (game.status !== 'active') return NOOP;

  // S1: the disconnector must be one of the two bound players of THIS game. A
  // connection bound to neither slot never force-abandons (defensive — should not
  // occur, the Connections row resolved this gameId).
  const isHost = game.hostConnectionId === disconnectingConnectionId;
  const isGuest = game.guestConnectionId === disconnectingConnectionId;
  if (!isHost && !isGuest) return NOOP;

  // The survivor is the OTHER bound slot. If the opponent is not bound (active
  // game with one player) there is nobody to notify and no point abandoning.
  const survivorId = isHost ? game.guestConnectionId : game.hostConnectionId;
  if (!survivorId) return NOOP;

  // Active two-player game, disconnector is a real player, opponent is bound:
  // abandon and notify the ONE survivor (S3 amplification bound = 1).
  return { abandon: true, survivorId, notify: true };
}
