#!/usr/bin/env node
/**
 * waf-sustained-probe.js — AC3.1 sustained-rate probe for slice s005-h1-waf.
 *
 * Allowlisted entry point: node work/oxo-online/scripts/waf-sustained-probe.js <args>
 * Run from the project root. Called by the validation spec
 * tests/validation/slice005-h1-waf-ac3.1.spec.ts.
 *
 * PURPOSE (AC3.1 — sustained-rate WAF block):
 *   Drive POST /api/games at a SUSTAINED rate that exceeds the WAF rate-based
 *   rule threshold (100 requests / 300s sliding window / IP) from a single source
 *   IP. Unlike the walking-skeleton probe which bursts fast (all requests complete
 *   before the WAF detection window accumulates), this probe paces requests across
 *   the window at an honest rate that SHOULD trip the rule.
 *
 * WAF RATE-RULE MECHANICS (WAFv2 CLOUDFRONT scope):
 *   - The rate-based rule (Limit=100, EvaluationWindowSec=300, AggregateKeyType=IP)
 *     aggregates requests in a SLIDING 300s window per source IP.
 *   - WAF samples the count at ~30s intervals and BLOCKS on the NEXT request after
 *     the count exceeds the limit, not at the exact moment the limit is crossed.
 *   - Detection + propagation latency means a fast burst completes before the
 *     counter trips; the counter is evaluated periodically, not per-request.
 *   - To reliably trip the rule: send >100 requests spread over < 300s so that
 *     when WAF next evaluates the window, the count is over the limit AND there
 *     are more requests arriving to be blocked.
 *
 * STRATEGY:
 *   - Default: 110 requests paced at 1 request per 1.5s = 165s total.
 *     After 100 requests have been sent, the window still has ~165s of remaining
 *     requests. WAF's next evaluation cycle will see >100/300s from this IP and
 *     start blocking the subsequent requests.
 *   - After the sustained burst: a brief cool-down, then one clean POST to confirm
 *     default-allow transparency (may still be blocked if within the rate window).
 *
 * Arguments:
 *   --base-url <https://…>   CloudFront origin base (required)
 *   --count <n>              total requests to send (default 110)
 *   --pace-ms <n>            milliseconds between requests (default 1500)
 *   --timeout <ms>           per-request timeout (default 10000)
 *   --cooldown <ms>          pause after the burst before clean request (default 5000)
 *
 * Output (JSON):
 *   {
 *     sent: number,
 *     status2xx: number,
 *     status403: number,       // WAF blocks (create handler never returns 403)
 *     status5xx: number,       // Lambda concurrency exhaustion / errors
 *     statusOther: number,
 *     wafBlocked: number,      // alias for status403
 *     durationMs: number,      // total burst duration
 *     normalFlow: { ok, status, hasGamePayload, note? },
 *     pass: boolean            // wafBlocked >= 1 (normal flow ok is secondary)
 *   }
 *
 * Exit code 0 always; `pass` carries the result so the spec can decide.
 */

'use strict';

const args = process.argv.slice(2);
function getArg(name, dflt) {
  const idx = args.indexOf(name);
  if (idx === -1) return dflt;
  return args[idx + 1];
}

const baseUrl = getArg('--base-url');
const count = parseInt(getArg('--count', '110'), 10);
const paceMs = parseInt(getArg('--pace-ms', '1500'), 10);
const timeoutMs = parseInt(getArg('--timeout', '10000'), 10);
const cooldownMs = parseInt(getArg('--cooldown', '5000'), 10);

if (!baseUrl) {
  console.log(JSON.stringify({ pass: false, error: '--base-url is required' }));
  process.exit(0);
}

const endpoint = `${baseUrl.replace(/\/$/, '')}/api/games`;

async function postCreate() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      signal: ctrl.signal,
    });
    let body = '';
    try { body = await res.text(); } catch { body = ''; }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: '', error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const results = [];
  const startMs = Date.now();

  // Emit progress to stderr so the validation spec can see the probe is alive
  // without polluting the JSON stdout.
  process.stderr.write(
    `[waf-sustained-probe] Starting sustained burst: ${count} requests at ${paceMs}ms pace to ${endpoint}\n`,
  );

  for (let i = 0; i < count; i++) {
    const r = await postCreate();
    results.push(r);
    process.stderr.write(
      `[waf-sustained-probe] req ${i + 1}/${count} status=${r.status}\n`,
    );

    // Only sleep between requests, not after the last one.
    if (i < count - 1) {
      await sleep(paceMs);
    }
  }

  const durationMs = Date.now() - startMs;

  // Classify results.
  let status2xx = 0;
  let status403 = 0;
  let status5xx = 0;
  let statusOther = 0;
  for (const r of results) {
    if (r.status >= 200 && r.status < 300) status2xx += 1;
    else if (r.status === 403) status403 += 1;
    else if (r.status >= 500) status5xx += 1;
    else statusOther += 1;
  }

  // The create handler never returns 403 — any 403 is a WAF edge block.
  const wafBlocked = status403;

  // Cool-down then one clean request.
  process.stderr.write(`[waf-sustained-probe] Burst complete. Cooling down ${cooldownMs}ms...\n`);
  await sleep(cooldownMs);

  const clean = await postCreate();
  let hasGamePayload = false;
  try {
    const parsed = JSON.parse(clean.body || '{}');
    hasGamePayload =
      typeof parsed.code === 'string' || typeof parsed.gameId === 'string';
  } catch {
    hasGamePayload = false;
  }

  const normalFlow = {
    ok: clean.status === 201 && hasGamePayload,
    status: clean.status,
    hasGamePayload,
  };
  if (clean.status === 403) {
    normalFlow.note =
      'clean request still WAF-blocked — source IP is inside the 300s rate window; ' +
      'wait for the window to expire and re-run to confirm default-allow transparency';
  }

  const pass = wafBlocked >= 1;

  const output = {
    endpoint,
    sent: results.length,
    status2xx,
    status403,
    status5xx,
    statusOther,
    wafBlocked,
    durationMs,
    normalFlow,
    pass,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.log(JSON.stringify({ pass: false, error: String(err) }));
  process.exit(0);
});
