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
import { handleLocalMove } from './move-handler.ts';

const PORT = Number(process.env.LOCAL_WS_PORT ?? 8787);
const GAME_ID = 'g-1';

const store = new LocalGameStore();
const relay = new LocalRelay();

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
    let frame: { action?: string; square?: number };
    try {
      frame = JSON.parse(String(raw)) as typeof frame;
    } catch {
      return;
    }

    if (frame.action === 'register') {
      hostConnectionId = connectionId;
      send(ws, { type: 'game-ready', role: 'host' });
      startWhenReady();
      return;
    }
    if (frame.action === 'join') {
      guestConnectionId = connectionId;
      send(ws, { type: 'game-ready', role: 'guest' });
      startWhenReady();
      return;
    }
    if (frame.action === 'move' && typeof frame.square === 'number') {
      await handleLocalMove({ connectionId, square: frame.square }, { store, relay });
    }
  });

  ws.on('close', () => {
    relay.unregister(connectionId);
    if (connectionId === hostConnectionId) hostConnectionId = null;
    if (connectionId === guestConnectionId) guestConnectionId = null;
  });
});
