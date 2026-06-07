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
 *   the code against an already-active game. Expects the server to deliver an
 *   error MESSAGE frame { type:'error', code:4041, message } and then DELETE the
 *   connection (DEFECT-005-001 Bug B — custom WS close codes are undeliverable
 *   via API Gateway @connections, so the code travels as a frame payload). The
 *   probe reports the code from the error frame. Outputs JSON:
 *     { success: false, closeCode: 4041 }
 *
 * Arguments:
 *   --ws-url <wss://…>   WebSocket endpoint base (required; must NOT include a query string)
 *   --game-id <uuid>     gameId for the register message (required unless --guest-only)
 *   --code <CODE>        6-char join code (required)
 *   --ws-token <token>   s005-h2: wsToken from POST /api/games; if supplied the host WS
 *                        URL gets ?wsToken=<token> appended and the guest WS URL gets
 *                        ?code=<CODE> appended. Required in prod after s005-h2 deploy.
 *                        If omitted the probe connects with no credential (pre-h2 behaviour).
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

const wsUrlBase = getArg('--ws-url');
const gameId = getArg('--game-id');
const code = getArg('--code');
const wsToken = getArg('--ws-token');   // s005-h2: host credential
const guestOnly = hasFlag('--guest-only');
const timeoutMs = parseInt(getArg('--timeout') ?? '5000', 10);

if (!wsUrlBase) {
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

// s005-h2: build credentialed URLs.
// Host connects with ?wsToken=<token> (signed HMAC, proves game ownership).
// Guest connects with ?code=<CODE> (game code, authorizer validates via GSI lookup).
// If --ws-token is not supplied the URLs are used as-is (pre-h2 behaviour, will fail
// in prod after s005-h2 deploy).
const hostWsUrl = wsToken
  ? `${wsUrlBase.replace(/\?.*$/, '')}?wsToken=${wsToken}`
  : wsUrlBase;
const guestWsUrl = code
  ? `${wsUrlBase.replace(/\?.*$/, '')}?code=${code}`
  : wsUrlBase;

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
 * Open a WebSocket connection to the given url. Returns a Promise that resolves
 * with { ws, opened: true } when the connection is open, or rejects on error/timeout.
 * s005-h2: url must include ?wsToken=... (host) or ?code=... (guest) credentials.
 */
function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WS(url ?? hostWsUrl); // fallback to hostWsUrl for backward compat
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
 *
 * DEFECT-005-001 Bug B: the server reports errors as a normal MESSAGE frame
 * { type:'error', code, message } (then DELETEs the connection). Any such error
 * frame is treated as a terminal event regardless of expectedMessageType, so
 * callers waiting for `game-ready` still observe a failure rather than hanging
 * until timeout.
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
        // An error frame is always terminal — surface the carried code.
        if (data.type === 'error') {
          cleanup();
          resolve({ type: 'error', code: data.code, data });
          return;
        }
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
    // s005-h2: guest-only connects with guestWsUrl (?code=<CODE>).
    let wsConn;
    try {
      const { ws } = await openWs(guestWsUrl);
      wsConn = ws;
    } catch (err) {
      console.log(JSON.stringify({ success: false, error: `failed to open guest WS: ${String(err)}` }));
      process.exit(0);
    }

    // Send join immediately.
    wsConn.send(JSON.stringify({ action: 'join', code }));

    // Wait for an error frame (Bug B) or a close. The defined code (e.g. 4041)
    // now arrives as the error frame's `code`, not as a WS close code.
    const result = await waitForEvent(wsConn, null, timeoutMs);
    wsConn.close?.();

    if (result.type === 'error') {
      // Expected failure: the server delivered { type:'error', code } then will
      // DELETE the socket. Report the carried code as closeCode for the spec.
      console.log(JSON.stringify({ success: false, closeCode: result.code }));
    } else if (result.type === 'close') {
      // A bare close with no error frame — surface its (generic) code.
      console.log(JSON.stringify({ success: false, closeCode: result.code }));
    } else if (result.type === 'timeout') {
      console.log(JSON.stringify({ success: false, error: 'timeout waiting for error frame on guest-only probe' }));
    } else {
      console.log(JSON.stringify({ success: false, error: 'unexpected message on guest-only probe', data: result.data }));
    }
    process.exit(0);
  }

  // Full pairing mode.
  let hostWs, guestWs;

  try {
    // Open host WS. s005-h2: hostWsUrl includes ?wsToken=<token>.
    const hostConn = await openWs(hostWsUrl);
    hostWs = hostConn.ws;

    // Send register — binds this connection to the game.
    hostWs.send(JSON.stringify({ action: 'register', gameId }));

    // Brief pause to let the register propagate before the guest joins.
    await new Promise((res) => setTimeout(res, 300));

    // Open guest WS. s005-h2: guestWsUrl includes ?code=<CODE>.
    const guestConn = await openWs(guestWsUrl);
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
