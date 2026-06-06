/**
 * Socket seam for the online game (slice 005, Set B).
 *
 * Set B drives the UI against a MOCK implementation of this interface; Set C
 * (C2) plugs a real `WebSocket` in behind the SAME `GameSocketFactory` without
 * touching any component — the components only ever see `GameSocket`.
 *
 * Contract for Set C:
 *  - `connect(opts)` opens the transport and returns a `GameSocket`.
 *    `opts.onMessage` is invoked for every inbound server frame (parsed JSON);
 *    `opts.onClose` is invoked once with the close `code` (e.g. 4040/4041/4500)
 *    when the transport closes.
 *  - `send(frame)` serialises and sends an outbound action frame
 *    (e.g. `{ action: 'join', code }` or `{ action: 'register', gameId }`).
 *  - `close()` tears the transport down (idempotent).
 */

/** A server-to-client frame. Slice 005 only emits `game-ready`. */
export interface GameReadyMessage {
  type: 'game-ready';
  role: 'host' | 'guest';
}

export type ServerMessage = GameReadyMessage;

/** A client-to-server action frame. */
export type ClientFrame =
  | { action: 'join'; code: string }
  | { action: 'register'; gameId: string };

export interface GameSocket {
  /** Send an action frame to the server. */
  send(frame: ClientFrame): void;
  /** Tear down the connection. Safe to call more than once. */
  close(): void;
}

export interface ConnectOptions {
  /** Called for each inbound server message. */
  onMessage(message: ServerMessage): void;
  /** Called once when the socket closes, with the close code. */
  onClose(code: number): void;
}

/**
 * Opens a connection and returns the live socket. Set C supplies a real
 * `WebSocket`-backed factory reading the URL from `window.OXO_CONFIG.wsUrl`;
 * Set B's tests supply an in-memory mock that drives `onMessage`/`onClose`.
 */
export type GameSocketFactory = (opts: ConnectOptions) => GameSocket;
