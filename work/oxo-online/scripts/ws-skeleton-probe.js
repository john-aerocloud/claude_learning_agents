#!/usr/bin/env node
/**
 * ws-skeleton-probe.js — $connect authorizer walking-skeleton ACCEPTANCE probe
 * (s005-h2 T6). Drives the FULL four-path T6 acceptance in ONE asserting run.
 *
 * Allowlisted entry point (via the root Makefile `ws-skeleton` target):
 *   node work/oxo-online/scripts/ws-skeleton-probe.js <args>
 * Run from the project root.
 *
 * WHY a separate asserting script (not the unit suite): this probe needs a LIVE
 * deployed CloudFront + WS API and a freshly minted, short-lived (60s) wsToken.
 * It therefore CANNOT run in `make test-infra` / `make test-app` (no network,
 * no live endpoint) — that is exactly the "run at the appropriate point, not
 * when it should not" boundary. It is the post-deploy gate, peer to `waf-probe`.
 * The single-connection helper (ws-connect-probe.js) stays for ad-hoc operator
 * pokes; THIS script is the regression form: it asserts all four outcomes and
 * exits nonzero on any mismatch.
 *
 * T6 acceptance (DEFECT-H2-002 — authorizer invoked, either-or honoured):
 *   1. POST <api>/api/games            -> mint { wsToken, code }
 *   2. WS ?wsToken=<valid>             -> EXPECT opened   (host allowed)
 *   3. WS ?code=<valid>                -> EXPECT opened   (guest allowed)
 *   4. WS (no query string)            -> EXPECT closed   (deny: no-credential)
 *   5. WS ?wsToken=garbage.token       -> EXPECT closed   (deny: bad-signature)
 *
 * Arguments:
 *   --api-base <https://…>   CloudFront base for POST /api/games (required)
 *   --ws-url   <wss://…>     WS API base WITHOUT query string      (required)
 *   --timeout  <ms>          Per-connection wait (default 5000)
 *
 * Output: a JSON result line per case, then a final
 *   { "t6": "pass" }  (exit 0)   or   { "t6": "fail", "cases": [...] }  (exit 1)
 *
 * Uses Node built-ins: fetch + WebSocket (Node 21+).
 */

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--api-base') a.apiBase = argv[++i];
    else if (argv[i] === '--ws-url') a.wsUrl = argv[++i];
    else if (argv[i] === '--timeout') a.timeout = Number(argv[++i]);
  }
  return a;
}

function probeConnect(url, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* already closed */ }
      finish({ opened: false, error: `timeout after ${timeout}ms` });
    }, timeout);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      finish({ opened: true });
    });
    ws.addEventListener('error', (event) => {
      clearTimeout(timer);
      finish({ opened: false, error: (event && event.message) || 'connection failed' });
    });
  });
}

async function main() {
  const { apiBase, wsUrl, timeout = 5000 } = parseArgs(process.argv);
  if (!apiBase || !wsUrl) {
    console.log(JSON.stringify({ t6: 'fail', error: 'missing --api-base or --ws-url' }));
    process.exit(2);
  }
  if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
    console.log(JSON.stringify({ t6: 'fail', error: 'need Node 21+ (built-in fetch + WebSocket)' }));
    process.exit(2);
  }
  const base = wsUrl.replace(/\?.*$/, '').replace(/\/$/, '');

  // 1. Mint a fresh token + code (token lives ~60s — connect immediately).
  const resp = await fetch(`${apiBase.replace(/\/$/, '')}/api/games`, { method: 'POST' });
  if (!resp.ok) {
    console.log(JSON.stringify({ t6: 'fail', step: 'mint', status: resp.status }));
    process.exit(1);
  }
  const { wsToken, code } = await resp.json();

  // 2-5. The four T6 cases: each names what it asserts.
  const cases = [
    { name: 'host-wsToken-allowed', url: `${base}?wsToken=${wsToken}`, expectOpened: true },
    { name: 'guest-code-allowed', url: `${base}?code=${code}`, expectOpened: true },
    { name: 'no-credential-denied', url: base, expectOpened: false },
    { name: 'garbage-token-denied', url: `${base}?wsToken=garbage.token`, expectOpened: false },
  ];

  const results = [];
  let allPass = true;
  for (const c of cases) {
    const r = await probeConnect(c.url, timeout);
    const pass = r.opened === c.expectOpened;
    allPass = allPass && pass;
    const row = { case: c.name, expectOpened: c.expectOpened, opened: r.opened, pass };
    if (r.error) row.error = r.error;
    results.push(row);
    console.log(JSON.stringify(row));
  }

  if (allPass) {
    console.log(JSON.stringify({ t6: 'pass' }));
    process.exit(0);
  }
  console.log(JSON.stringify({ t6: 'fail', cases: results.filter((r) => !r.pass) }));
  process.exit(1);
}

main().catch((e) => {
  console.log(JSON.stringify({ t6: 'fail', error: String((e && e.message) || e) }));
  process.exit(1);
});
