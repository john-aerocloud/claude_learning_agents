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

/**
 * A server-to-client frame announcing the game is paired and ready to play.
 *
 * `gameId` (GATE-AMEND 2026-06-07, s006): the opaque server-generated game id,
 * carried so BOTH sides — crucially the GUEST, which joined by `code` and has no
 * gameId client-side — can thread it into every `move` frame as the non-trusted
 * GetItem lookup key. It is NOT the join `code` and discloses no opponent
 * connection detail (data-classification unchanged). The SPA stores this as its
 * single consistent source of gameId.
 */
export interface GameReadyMessage {
  type: 'game-ready';
  role: 'host' | 'guest';
  gameId: string;
}

/**
 * An error frame (DEFECT-005-001 Bug B). The platform cannot deliver a custom
 * WebSocket close code, so the server reports a failed join/register as a normal
 * MESSAGE frame carrying the (former close) code as a payload value plus the
 * customer-facing message, then DELETEs the connection. The SPA maps `code` to
 * the same three messages it previously keyed off close codes.
 */
export interface ServerErrorMessage {
  type: 'error';
  /** 4040 (unknown code) | 4041 (no longer available) | 4500 (internal). */
  code: number;
  /** Customer-facing message text (S3 — never internal detail). */
  message: string;
}

/**
 * Server-authoritative board broadcast (s006/UC4). The server is the ONLY writer
 * of the board: on every accepted move it posts this frame to BOTH connections.
 * The SPA renders the board STRICTLY from `board` here — never optimistically
 * from the local click. `board` is the 9-char fixed-width string (`X`/`O`/`-`),
 * `currentTurn` is whose move the server will accept next.
 */
export interface BoardUpdateMessage {
  type: 'board-update';
  /** 9 chars, index 0..8, each `X` | `O` | `-`. */
  board: string;
  currentTurn: 'X' | 'O';
  status: 'active' | 'won' | 'drawn';
}

/** Terminal result broadcast (s006/UC4). Locks the board and shows the result. */
export interface GameOverMessage {
  type: 'game-over';
  result: 'X-wins' | 'O-wins' | 'draw';
}

/**
 * Survivor notification (s007/UC1→UC3). The `$disconnect` handler posts exactly
 * ONE of these to the surviving connection when an ACTIVE game is abandoned
 * because the opponent's socket closed (tab close, network loss, or the APIGW
 * 10-min idle close). It carries no payload — the disconnecting connection IS
 * the identity server-side (S1); the survivor only needs to know the opponent is
 * gone. It is never sent on a terminal (won/drawn) or waiting game, and never on
 * a `GoneException` survivor post (amplification bound = 1, S3).
 */
export interface OpponentDisconnectedMessage {
  type: 'opponent-disconnected';
}

export type ServerMessage =
  | GameReadyMessage
  | ServerErrorMessage
  | BoardUpdateMessage
  | GameOverMessage
  | OpponentDisconnectedMessage;

/** A client-to-server action frame. */
export type ClientFrame =
  | { action: 'join'; code: string }
  | { action: 'register'; gameId: string }
  // GATE-AMEND (s006): the move frame carries gameId as a non-trusted lookup key
  // (the server uses it ONLY as the GetItem key; identity stays connectionId).
  | { action: 'move'; gameId: string; square: number };

export interface GameSocket {
  /** Send an action frame to the server. */
  send(frame: ClientFrame): void;
  /** Tear down the connection. Safe to call more than once. */
  close(): void;
}

/**
 * The $connect credential threaded to the transport (s005-h2). The host carries
 * the `wsToken` minted by `POST /api/games`; the guest carries the game `code`
 * it entered. Exactly one is set per connection. When neither is present the
 * socket opens with no credential param — the host's graceful-degradation path
 * for a degraded mint (DEFECT-H2-001), where the create legitimately omits the
 * token. The factory appends it as a query param the deployed `$connect`
 * authorizer reads from `event.queryStringParameters`.
 */
export type ConnectCredential = { wsToken: string } | { code: string };

export interface ConnectOptions {
  /** Called for each inbound server message. */
  onMessage(message: ServerMessage): void;
  /** Called once when the socket closes, with the close code. */
  onClose(code: number): void;
  /**
   * $connect credential (host `wsToken` or guest `code`). Omitted on a degraded
   * mint — the host then connects without the param rather than being blocked.
   */
  credential?: ConnectCredential;
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
 * Appends the $connect credential to the configured wss URL as a query param
 * (s005-h2, UC3/UC4). The host carries `?wsToken=<token>`; the guest carries
 * `?code=<CODE>`. Values are URL-encoded. With no credential (degraded mint) the
 * base URL is returned unchanged so the host still connects. The query string is
 * added to the already-permitted `connect-src` wss origin — no new CSP directive.
 */
function withCredential(baseUrl: string, credential?: ConnectCredential): string {
  if (!credential) return baseUrl;
  const [name, value] =
    'wsToken' in credential
      ? (['wsToken', credential.wsToken] as const)
      : (['code', credential.code] as const);
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}${name}=${encodeURIComponent(value)}`;
}

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
  return ({ onMessage, onClose, credential }) => {
    const baseUrl = window.OXO_CONFIG?.wsUrl;

    if (!baseUrl) {
      // No transport available — surface a generic failure, open nothing.
      onClose(INTERNAL_CLOSE);
      return { send: () => {}, close: () => {} };
    }

    const url = withCredential(baseUrl, credential);
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
