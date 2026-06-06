#!/usr/bin/env node
/**
 * ws-probe.js — WebSocket pairing probe for slice005 validation.
 *
 * Allowlisted entry point: node work/oxo-online/scripts/ws-probe.js <args>
 * Run from the project root (cwd must contain work/).
 *
 * Modes:
 *   Default (full pairing): opens a host WS, sends register, then opens a
 *   guest WS, sends join with the code. Waits for game-ready on both sides.
 *   Outputs JSON:
 *     {
 *       success: true,
 *       hostRole: "host",
 *       guestRole: "guest",
 *       hostConnId: "<connection-id>",
 *       guestConnId: "<connection-id>"
 *     }
 *
 *   Guest-only (--guest-only): opens a single guest WS and sends join with
 *   the code against an already-active game. Expects the connection to close
 *   with a defined error code (4041). Outputs JSON:
 *     { success: false, closeCode: 4041 }
 *
 * Arguments:
 *   --ws-url <wss://…>   WebSocket endpoint (required)
 *   --game-id <uuid>     gameId for the register message (required unless --guest-only)
 *   --code <CODE>        6-char join code (required)
 *   --guest-only         skip the host-register step; just send a join and
 *                        report the close code
 *   --timeout <ms>       max wait in ms before failure (default 5000)
 *
 * Uses the Node.js built-in `WebSocket` (Node 21+) or the `ws` package if
 * available. Falls back gracefully with an error JSON if neither is available.
 *
 * The connectionId injected into game-ready frames is the connectionId that
 * API Gateway assigned; this script captures it from the request-context echo
 * in the initial frame or from the connection headers. Since API GW does not
 * send the connectionId to the client, we read it from the DynamoDB item via
 * the caller (T2/T3/T5 in the spec). We include a best-effort capture from
 * the probe itself by reading the register/join confirmation echo if the lambda
 * sends one — otherwise the IDs are left null and the caller uses get-item.
 *
 * Note on connectionId discovery: API Gateway assigns the connectionId server-
 * side and does not echo it to the client in the WS protocol. The only reliable
 * way to capture it from a client-only probe is to have the Lambda echo it back
 * in a confirmation frame. The oxo-ws-fn does NOT echo connectionId (T6 —
 * connectionId is never sent to the client). Therefore hostConnId/guestConnId
 * are set to the value read from the DynamoDB Games record AFTER pairing, which
 * the spec does via get-item. The probe itself cannot know the connectionId.
 * We set them to null here; the spec reads them from DynamoDB.
 */

'use strict';

// Parse arguments.
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(name);

const wsUrl = getArg('--ws-url');
const gameId = getArg('--game-id');
const code = getArg('--code');
const guestOnly = hasFlag('--guest-only');
const timeoutMs = parseInt(getArg('--timeout') ?? '5000', 10);

if (!wsUrl) {
  console.log(JSON.stringify({ success: false, error: '--ws-url is required' }));
  process.exit(1);
}
if (!code) {
  console.log(JSON.stringify({ success: false, error: '--code is required' }));
  process.exit(1);
}
if (!guestOnly && !gameId) {
  console.log(JSON.stringify({ success: false, error: '--game-id is required unless --guest-only' }));
  process.exit(1);
}

// Resolve WebSocket implementation.
let WS;
try {
  // Node 21+ has a global WebSocket; earlier versions need the 'ws' package.
  if (typeof WebSocket !== 'undefined') {
    WS = WebSocket;
  } else {
    WS = require('ws');
  }
} catch {
  console.log(JSON.stringify({
    success: false,
    error: 'No WebSocket implementation available. Install "ws" package or use Node 21+.',
  }));
  process.exit(1);
}

/**
 * Open a WebSocket connection to wsUrl. Returns a Promise that resolves with
 * { ws, opened: true } when the connection is open, or rejects on error/timeout.
 */
function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket open timed out'));
    }, timeoutMs);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve({ ws, opened: true });
    };
    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${err.message ?? String(err)}`));
    };
  });
}

/**
 * Wait for a specific message type or a close event on a WebSocket.
 * Returns { type: 'message', data } or { type: 'close', code }.
 */
function waitForEvent(ws, expectedMessageType, timeoutMsLocal) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ type: 'timeout' });
    }, timeoutMsLocal);

    const cleanup = () => clearTimeout(timer);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(
          typeof event.data === 'string'
            ? event.data
            : event.data.toString('utf8'),
        );
        if (!expectedMessageType || data.type === expectedMessageType) {
          cleanup();
          resolve({ type: 'message', data });
        }
      } catch {
        // Ignore parse errors.
      }
    };
    ws.onclose = (event) => {
      cleanup();
      resolve({ type: 'close', code: event.code });
    };
  });
}

async function runProbe() {
  if (guestOnly) {
    // Guest-only mode: open a WS, send join, expect a close with 4041.
    let wsConn;
    try {
      const { ws } = await openWs();
      wsConn = ws;
    } catch (err) {
      console.log(JSON.stringify({ success: false, error: `failed to open guest WS: ${String(err)}` }));
      process.exit(0);
    }

    // Send join immediately.
    wsConn.send(JSON.stringify({ action: 'join', code }));

    // Wait for a close or a message (expecting close 4041).
    const result = await waitForEvent(wsConn, null, timeoutMs);
    wsConn.close?.();

    if (result.type === 'close') {
      const closeCode = result.code;
      const success = false; // A close on a "join" guest-only probe is expected failure.
      console.log(JSON.stringify({ success, closeCode }));
    } else if (result.type === 'timeout') {
      console.log(JSON.stringify({ success: false, error: 'timeout waiting for close on guest-only probe' }));
    } else {
      // Unexpected message — still report the close code if we get one.
      console.log(JSON.stringify({ success: false, error: 'unexpected message on guest-only probe', data: result.data }));
    }
    process.exit(0);
  }

  // Full pairing mode.
  let hostWs, guestWs;

  try {
    // Open host WS.
    const hostConn = await openWs();
    hostWs = hostConn.ws;

    // Send register — binds this connection to the game.
    hostWs.send(JSON.stringify({ action: 'register', gameId }));

    // Brief pause to let the register propagate before the guest joins.
    await new Promise((res) => setTimeout(res, 300));

    // Open guest WS.
    const guestConn = await openWs();
    guestWs = guestConn.ws;

    // Listen for game-ready on host (may arrive before or after guest join).
    const hostGameReadyPromise = waitForEvent(hostWs, 'game-ready', timeoutMs);

    // Send join from guest.
    guestWs.send(JSON.stringify({ action: 'join', code }));

    // Wait for guest game-ready.
    const guestResult = await waitForEvent(guestWs, 'game-ready', timeoutMs);

    if (guestResult.type !== 'message') {
      const closeCode = guestResult.code ?? null;
      console.log(JSON.stringify({
        success: false,
        error: `guest did not receive game-ready; event=${guestResult.type}`,
        closeCode,
      }));
      process.exit(0);
    }

    // Wait for host game-ready.
    const hostResult = await hostGameReadyPromise;

    if (hostResult.type !== 'message') {
      console.log(JSON.stringify({
        success: false,
        error: `host did not receive game-ready; event=${hostResult.type}`,
      }));
      process.exit(0);
    }

    const hostRole = hostResult.data?.role ?? null;
    const guestRole = guestResult.data?.role ?? null;

    // Payload must carry only { type, role } — no connectionId or extra fields (T1).
    const hostPayloadKeys = Object.keys(hostResult.data ?? {}).sort();
    const guestPayloadKeys = Object.keys(guestResult.data ?? {}).sort();

    const hostPayloadClean = JSON.stringify(hostPayloadKeys) === JSON.stringify(['role', 'type']);
    const guestPayloadClean = JSON.stringify(guestPayloadKeys) === JSON.stringify(['role', 'type']);

    // Note: connectionIds are server-assigned and not visible to the client.
    // The caller reads them from DynamoDB after the probe completes.
    console.log(JSON.stringify({
      success: true,
      hostRole,
      guestRole,
      hostConnId: null, // not available client-side by design (T6)
      guestConnId: null, // not available client-side by design (T6)
      hostPayloadKeys,
      guestPayloadKeys,
      hostPayloadClean,
      guestPayloadClean,
    }));
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: String(err) }));
  } finally {
    hostWs?.close?.();
    guestWs?.close?.();
  }
  process.exit(0);
}

runProbe().catch((err) => {
  console.log(JSON.stringify({ success: false, error: String(err) }));
  process.exit(0);
});
