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

/** Runtime config injected into the SPA at deploy time (see deploy phase E3). */
interface OxoConfig {
  wsUrl?: string;
}

declare global {
  interface Window {
    OXO_CONFIG?: OxoConfig;
  }
}

/** Internal-error close code mirrored from the server contract (S3). */
const INTERNAL_CLOSE = 4500;

/**
 * The real WebSocket-backed factory (C2). Reads the WSS endpoint from
 * `window.OXO_CONFIG.wsUrl`. When no URL is configured (e.g. the config artifact
 * is missing), it degrades gracefully in the s004 style — it opens no socket and
 * reports a 4500 close so the screens render the generic error rather than
 * white-screening. Inbound frames are parsed JSON and delivered to `onMessage`;
 * the close `code` is delivered to `onClose`. Outbound `send`s are buffered until
 * the socket is open. `close()` is idempotent.
 */
export function createRealSocketFactory(): GameSocketFactory {
  return ({ onMessage, onClose }) => {
    const url = window.OXO_CONFIG?.wsUrl;

    if (!url) {
      // No transport available — surface a generic failure, open nothing.
      onClose(INTERNAL_CLOSE);
      return { send: () => {}, close: () => {} };
    }

    const ws = new WebSocket(url);
    let open = false;
    let closed = false;
    const pending: ClientFrame[] = [];

    ws.onopen = () => {
      open = true;
      for (const frame of pending) ws.send(JSON.stringify(frame));
      pending.length = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        onMessage(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // A malformed frame is ignored rather than crashing the UI.
      }
    };

    ws.onclose = (event: CloseEvent) => {
      onClose(event.code);
    };

    return {
      send(frame: ClientFrame) {
        if (open) {
          ws.send(JSON.stringify(frame));
        } else {
          pending.push(frame);
        }
      },
      close() {
        if (closed) return;
        closed = true;
        ws.close();
      },
    };
  };
}
