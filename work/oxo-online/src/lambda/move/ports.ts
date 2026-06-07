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

/**
 * Lifecycle state of a game, in domain terms. `waiting` (host created, no guest
 * yet) and `abandoned` (s007 graceful-disconnect terminal) join the s006 trio.
 * The move flow only ever writes `active`/`won`/`drawn`; the $disconnect flow
 * reads `waiting`/`abandoned` and writes `abandoned`.
 */
export type GameStatus = 'active' | 'won' | 'drawn' | 'waiting' | 'abandoned';

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
  /**
   * s007 $disconnect abandon (UC1): a SINGLE conditional UpdateItem that flips
   * status active→abandoned, conditioned on `status = :active` (S2 — the won/
   * drawn/already-abandoned guard is the CONDITION, not code alone). On a failed
   * condition (the game was not active — terminal/waiting/already-abandoned, or a
   * simultaneous second disconnect already abandoned it) it raises a typed
   * AbandonConditionFailed; the adapter does NOT retry (reject-over-retry).
   */
  abandonGame(gameId: string): Promise<void>;
}

/** Raised by GameStorePort.applyMoveWrite when the CAS condition fails. */
export class MoveConditionFailed extends Error {
  constructor(message = 'move condition failed') {
    super(message);
    this.name = 'MoveConditionFailed';
  }
}

/**
 * Raised by GameStorePort.abandonGame when the `status = :active` condition fails
 * — the game was not active (terminal/waiting/already-abandoned, or a
 * simultaneous second $disconnect already abandoned it). A legitimate "not
 * active" outcome, swallowed by the handler (no notify, no retry — AC1.7/T4/S2).
 */
export class AbandonConditionFailed extends Error {
  constructor(message = 'abandon condition failed') {
    super(message);
    this.name = 'AbandonConditionFailed';
  }
}

/**
 * The role a connection holds in its bound game (Connections-table value).
 * `host` is always X, `guest` is always O — fixed at game-ready (s005).
 */
export type ConnectionRole = 'host' | 'guest';

/**
 * The binding the Connections table holds for one connectionId: which game it is
 * part of and which role it plays. Returned by ConnectionStorePort.getConnection.
 */
export interface ConnectionBinding {
  gameId: string;
  role: ConnectionRole;
}

/**
 * Connections store port (s007 — extended from s005's implicit put/delete).
 *
 * `getConnection(connectionId)` is the NEW $disconnect read: resolve the
 * disconnecting connection's own gameId+role from its primary key. There is NO
 * Query/Scan — a single GetItem of the connection's OWN row (S1: connectionId IS
 * the identity; no cross-game enumeration). `deleteConnection` is the existing
 * best-effort row delete used in ALL $disconnect branches.
 *
 * The cloud adapter (DdbConnectionStore) implements this over DynamoDB GetItem +
 * DeleteItem (backed by the UC2 Connections:GetItem grant — S5); the local
 * adapter is an in-memory map. Domain code imports nothing concrete from here.
 */
export interface ConnectionStorePort {
  getConnection(connectionId: string): Promise<ConnectionBinding | null>;
  deleteConnection(connectionId: string): Promise<void>;
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

/*
 * NOTE (GATE-AMEND 2026-06-07): there is deliberately NO connection→game lookup
 * port. The earlier GameLookupByConnectionPort/findGameByConnection (Scan/
 * Connections-read) approach is DEAD — it would have widened the move path's
 * IAM grant (S5) to read Connections. The amended design authorizes by
 * GetItem(Games, body.gameId) [an already-granted action], matching the REAL
 * event.requestContext.connectionId against the item's host/guestConnectionId.
 * The handler uses GameStorePort.getGame(gameId) directly; gameId is a
 * non-trusted lookup key (apigw-websocket.md S1).
 */
