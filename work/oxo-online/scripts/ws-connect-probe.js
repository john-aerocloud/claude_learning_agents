#!/usr/bin/env node
/**
 * ws-connect-probe.js — $connect authorizer walking-skeleton probe (s005-h2 T6).
 *
 * Allowlisted entry point: node work/oxo-online/scripts/ws-connect-probe.js <args>
 * Run from the project root (cwd must contain work/).
 *
 * Opens a single WebSocket to the given URL and reports ONLY the connection
 * outcome — no frames are sent. Used to verify the REQUEST authorizer gate:
 * a denied $connect surfaces as an upgrade failure (HTTP 403) before any
 * game-logic Lambda runs; an allowed $connect surfaces as a clean open.
 *
 * Arguments:
 *   --ws-url <wss://…>   Full WebSocket URL including any ?wsToken=/?code=
 *                        query credential (required)
 *   --timeout <ms>       Max wait before reporting timeout (default 5000)
 *
 * Output (single JSON line):
 *   { "opened": true }                          — upgrade accepted
 *   { "opened": false, "error": "<message>" }   — upgrade rejected/failed
 *
 * Uses the Node.js built-in `WebSocket` (Node 21+).
 */

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--ws-url') args.wsUrl = argv[++i];
    else if (argv[i] === '--timeout') args.timeout = Number(argv[++i]);
  }
  return args;
}

const { wsUrl, timeout = 5000 } = parseArgs(process.argv);
if (!wsUrl) {
  console.log(JSON.stringify({ opened: false, error: 'missing --ws-url' }));
  process.exit(2);
}
if (typeof WebSocket === 'undefined') {
  console.log(JSON.stringify({ opened: false, error: 'built-in WebSocket unavailable (need Node 21+)' }));
  process.exit(2);
}

const ws = new WebSocket(wsUrl);
const timer = setTimeout(() => {
  console.log(JSON.stringify({ opened: false, error: `timeout after ${timeout}ms` }));
  try { ws.close(); } catch { /* already closed */ }
  process.exit(1);
}, timeout);

ws.addEventListener('open', () => {
  clearTimeout(timer);
  console.log(JSON.stringify({ opened: true }));
  ws.close();
  process.exit(0);
});

ws.addEventListener('error', (event) => {
  clearTimeout(timer);
  const message = (event && event.message) || 'connection failed';
  console.log(JSON.stringify({ opened: false, error: message }));
  process.exit(1);
});
