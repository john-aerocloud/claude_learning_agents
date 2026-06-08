/**
 * server.ts — the UC5 local stand-up WS server (OI-28, principles/02).
 *
 * Stands the move-relay system up locally with NO cloud creds: a `ws` server
 * wiring the local adapters (LocalGameStore + LocalRelay) behind the SAME
 * domain-defined ports the cloud adapters implement (§41), driving the REAL
 * domain `applyMove` via the SAME `handleLocalMove` orchestration the unit tests
 * exercise. The SPA (vite dev server) connects here over the GameSocket seam and
 * faces the identical move-send / render-on-broadcast / board-lock contract it
 * will face in cloud.
 *
 * Connection binding (server-derived, never a client field — S1): the first
 * connection to a game code is the HOST (X), the second is the GUEST (O). The
 * server creates the game on the first connect and sends `game-ready` to each
 * side as it binds, then a `board-update` with the initialised empty board.
 *
 * This module is thin WIRING only — all move logic lives in the tested
 * `handleLocalMove` + the local adapters + the real domain. It is run by node
 * directly (Node strips the TS types); it is not part of the SPA bundle.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { LocalGameStore } from './adapters/local-store.ts';
import { LocalRelay } from './adapters/local-relay.ts';
import { LocalConnectionStore } from './adapters/local-connection-store.ts';
import { handleLocalMove } from './move-handler.ts';
import { handleLocalChat } from './chat-handler.ts';
import { handleLocalDisconnect } from './disconnect-handler.ts';

const PORT = Number(process.env.LOCAL_WS_PORT ?? 8787);
const GAME_ID = 'g-1';

const store = new LocalGameStore();
const relay = new LocalRelay();
const connections = new LocalConnectionStore();

let hostConnectionId: string | null = null;
let guestConnectionId: string | null = null;
let seq = 0;

function send(ws: WebSocket, message: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[local-ws] listening on ws://localhost:${PORT} (game ${GAME_ID})`);

/** Seed the active game + broadcast the initial empty board once both bound. */
function startWhenReady(): void {
  if (!hostConnectionId || !guestConnectionId) return;
  store.seed({
    gameId: GAME_ID,
    board: '---------',
    currentTurn: 'X',
    status: 'active',
    version: 0,
    moveCount: 0,
    hostConnectionId,
    guestConnectionId,
  });
  relay.postToConnections([hostConnectionId, guestConnectionId], {
    type: 'board-update',
    board: '---------',
    currentTurn: 'X',
    status: 'active',
  });
}

wss.on('connection', (ws) => {
  const connectionId = `conn-${seq++}`;
  // Role is bound from the register/join ACTION frame (host=X, guest=O), not
  // connection arrival order — robust against dev StrictMode reconnects and
  // interleaving. (Server-derived; never from a client role field — S1.)

  // Wire this connection's relay sink so server frames reach this browser.
  relay.register(connectionId, (message) => send(ws, message));

  ws.on('message', async (raw) => {
    let frame: { action?: string; square?: number; gameId?: string; text?: string };
    try {
      frame = JSON.parse(String(raw)) as typeof frame;
    } catch {
      return;
    }

    if (frame.action === 'register') {
      hostConnectionId = connectionId;
      // Bind the Connections row (host) so $disconnect can resolve the game (S1).
      connections.put({ connectionId, gameId: GAME_ID, role: 'host' });
      // Seed the game in `waiting` so a host-only close is the thin-handling
      // branch (T5: stays waiting, 0 posts) — flipped to `active` once the guest
      // joins (startWhenReady).
      if (!(await store.getGame(GAME_ID))) {
        store.seed({
          gameId: GAME_ID,
          board: '---------',
          currentTurn: 'X',
          status: 'waiting',
          version: 0,
          moveCount: 0,
          hostConnectionId: connectionId,
        });
      }
      // GATE-AMEND: carry gameId so the client threads it into its move frames.
      send(ws, { type: 'game-ready', role: 'host', gameId: GAME_ID });
      startWhenReady();
      return;
    }
    if (frame.action === 'join') {
      guestConnectionId = connectionId;
      connections.put({ connectionId, gameId: GAME_ID, role: 'guest' });
      send(ws, { type: 'game-ready', role: 'guest', gameId: GAME_ID });
      startWhenReady();
      return;
    }
    if (frame.action === 'move' && typeof frame.square === 'number') {
      // The client supplies gameId (the non-trusted lookup key) in the frame; the
      // local stand-up holds one game, so it defaults to GAME_ID when absent.
      await handleLocalMove(
        { connectionId, gameId: frame.gameId ?? GAME_ID, square: frame.square },
        { store, relay },
      );
    }
    if (frame.action === 'chat') {
      // s014 UC1 local parity (delta 011 §5): drive the SAME chat decision over
      // the local adapters + the REAL domain text bound — relay the chat-message
      // to the OPPONENT + echo to the SENDER (2 posts), identity by connectionId
      // (never a body field), text normalised. A post to a closed local socket
      // (no registered sink) is the GoneException analogue: best-effort dropped by
      // LocalRelay, no retry, no crash. Without this case the two-browser local
      // send→relay→echo path cannot stand.
      await handleLocalChat(
        { connectionId, gameId: frame.gameId ?? GAME_ID, text: String(frame.text ?? '') },
        { store, relay },
      );
    }
  });

  ws.on('close', () => {
    // s007 UC1-S6: drive the SAME $disconnect decision over the local adapters —
    // abandon an active game + notify the ONE survivor (exactly 1 post), terminal/
    // waiting → 0 (T5). Run BEFORE unregistering the OTHER connection's sink so the
    // survivor still receives the opponent-disconnected frame.
    void handleLocalDisconnect(connectionId, { connections, store, relay })
      .catch((err) => console.error('[local-ws] disconnect error', err))
      .finally(() => {
        relay.unregister(connectionId);
        if (connectionId === hostConnectionId) hostConnectionId = null;
        if (connectionId === guestConnectionId) guestConnectionId = null;
      });
  });
});
