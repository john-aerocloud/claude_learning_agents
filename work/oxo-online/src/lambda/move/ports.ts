/**
 * ports.ts (move) — DOMAIN-defined ports for the server-authoritative move flow,
 * expressed in domain terms (§41 hexagonal). Adapters (DynamoDB Games store,
 * @connections relay, connection→game lookup) implement these interfaces over
 * concrete external systems under ../ws/adapters. Domain code (move.ts) imports
 * NOTHING concrete: no AWS SDK, no APIGW event type, no DynamoDB AttributeValue.
 * It is unit-tested with fakes of these interfaces.
 *
 * OI-17 hexagonal seed for s006. UC3's handler wires the real adapters; UC5's
 * local stand-up wires in-memory/stub adapters behind the SAME interfaces.
 */

/** A player role. Host is always X, guest is always O (fixed at s005 game-ready). */
export type Role = 'X' | 'O';

/** Terminal/active state of a game, in domain terms. */
export type GameStatus = 'active' | 'won' | 'drawn';

/**
 * The authoritative game state the move flow reads and mutates, expressed in
 * domain terms (no persistence concepts). `board` is a fixed 9-char string of
 * 'X' | 'O' | '-'; squares are index 0..8.
 */
export interface GameState {
  gameId: string;
  board: string;
  currentTurn: Role;
  status: GameStatus;
  version: number;
  moveCount: number;
  hostConnectionId?: string;
  guestConnectionId?: string;
}

/**
 * The atomic patch produced by an accepted domain move, to be applied by the
 * store adapter as a single compare-and-swap write conditioned on the
 * (status, currentTurn, version) read the domain computed against.
 */
export interface MovePatch {
  board: string;
  nextTurn: Role;
  /** Set only when the move was terminal. */
  status?: GameStatus;
  /** Set only on a win. Absent on draw / in-play. */
  winner?: Role;
}

/**
 * Games store port — the authoritative game item behind an interface.
 *
 * `applyMoveWrite` performs a SINGLE conditional UpdateItem: the
 * ConditionExpression carries the turn gate + status='active' + version CAS;
 * the UpdateExpression sets board/currentTurn/version+1/moveCount+1 (and the
 * terminal status/winner in the SAME write). On a failed condition it surfaces
 * a typed reject (no partial write) — the adapter does not blindly retry
 * (reject-over-retry; §5a). `expectedVersion`/`expectedTurn` are the values the
 * domain read against, so the write is a true compare-and-swap.
 */
export interface GameStorePort {
  getGame(gameId: string): Promise<GameState | null>;
  applyMoveWrite(args: {
    gameId: string;
    expectedVersion: number;
    expectedTurn: Role;
    patch: MovePatch;
  }): Promise<void>;
}

/** Raised by GameStorePort.applyMoveWrite when the CAS condition fails. */
export class MoveConditionFailed extends Error {
  constructor(message = 'move condition failed') {
    super(message);
    this.name = 'MoveConditionFailed';
  }
}

/**
 * Relay port — pushes a server frame to a set of bound connections. The handler
 * passes the TWO bound connectionIds (host+guest); never a broadcast. A failed
 * post to one connection is best-effort: it is logged and the other proceeds
 * (no per-post retry this slice — recovery deferred to s007).
 */
export interface RelayPort {
  postToConnections(connectionIds: string[], message: unknown): Promise<void>;
}

/**
 * Looks the game up by the connection that sent a message, so the server can
 * derive `senderRole` from the connectionId↔game binding — NEVER from a
 * client-supplied field (S1). Returns null when the connection is bound to no
 * game (spectator / stale / wrong game).
 */
export interface GameLookupByConnectionPort {
  findGameByConnection(connectionId: string): Promise<GameState | null>;
}
