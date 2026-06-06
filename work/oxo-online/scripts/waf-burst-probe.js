#!/usr/bin/env node
/**
 * waf-burst-probe.js — WALKING-SKELETON-WAF probe for slice s005-h1-waf.
 *
 * Allowlisted entry point: node work/oxo-online/scripts/waf-burst-probe.js <args>
 * Run from the project root. Root Makefile target: `make waf-probe`.
 *
 * PURPOSE (route Step 9 / WALKING-SKELETON-WAF):
 *   Drive ONE real flow through the deployed CloudFront global WAFv2 WebACL
 *   (OxoOnlineWafUsEast1 -> OxoOnlineProd distribution webAclId) to prove the
 *   ACL is real, associated, fires its rate-based rule at the configured
 *   threshold, and is TRANSPARENT to a single legitimate request
 *   (default action Allow).
 *
 * SCOPE — HTTP HALF ONLY. The WS connect-burst half of this probe is RETIRED
 *   with UC2 (GATE-AMEND-H1-A, human-approved Option A): WAFv2 cannot associate
 *   with an API Gateway v2 (WebSocket) stage — the WsWebAclAssociation deploy
 *   failed with an invalid-ARN/unsupported-resource-type error (run
 *   27066828546). There is therefore no WS WAF ACL to probe; the WS transport's
 *   abuse floor is the prod-stage default-route throttle, validated separately.
 *
 * PROBE-CLIENT JUSTIFICATION (§17): a node `fetch` probe is acceptable here even
 *   though §17 normally demands a real browser, because WAF acts BELOW the
 *   browser-layer concerns §17 protects (CSP connect-src, window.OXO_CONFIG
 *   injection ordering, mixed-content). WAF inspects IP rate + reputation at the
 *   CloudFront edge; this slice changes no served surface, so a node probe gives
 *   a TRUE green for the WAF mechanism. Browser smoke (UC3) still covers the
 *   browser-layer concerns.
 *
 * FLOW:
 *   1. HTTP BURST: fire `burst` (default 160) POST /api/games as fast as the
 *      event loop allows from this single source IP, well past the rate rule's
 *      100 req / 5-min window. Expect >= 1 HTTP 403 returned by WAF BEFORE the
 *      Lambda runs (the AWS WAF block response, not an application 4xx).
 *   2. COOL-DOWN: brief pause, then ONE clean POST /api/games is allowed to
 *      verify the default-allow ACL is transparent to legit traffic — expect
 *      201 with a game payload. (If still rate-limited from the burst, the probe
 *      reports normalFlow.note so the operator can re-run after the window.)
 *
 * A WAF 403 is distinguished from an application 403 by the response body /
 * absence of the app's JSON shape: AWS WAF returns a short HTML/empty body with
 * no `code`/`gameId` field. We classify any 403 in the burst as a WAF block
 * (the create handler never returns 403; it returns 201 or 5xx).
 *
 * Arguments:
 *   --base-url <https://…>   CloudFront origin base (required), e.g.
 *                            https://d3pf3kcvzpau1x.cloudfront.net
 *   --burst <n>              number of burst requests (default 160)
 *   --concurrency <n>        max in-flight requests (default 40)
 *   --cooldown <ms>          pause before the clean request (default 3000)
 *   --timeout <ms>           per-request timeout (default 8000)
 *
 * Output (JSON):
 *   {
 *     burst: { sent, status2xx, status403, status5xx, statusOther, wafBlocked },
 *     normalFlow: { ok, status, hasGamePayload, note? },
 *     pass: boolean   // true iff wafBlocked >= 1 AND normalFlow.ok
 *   }
 *
 * Exit code 0 always (machine-readable JSON is the contract); `pass` carries the
 * gate result so the caller / DORA row records it.
 */

'use strict';

const args = process.argv.slice(2);
function getArg(name, dflt) {
  const idx = args.indexOf(name);
  if (idx === -1) return dflt;
  return args[idx + 1];
}

const baseUrl = getArg('--base-url');
const burst = parseInt(getArg('--burst', '160'), 10);
const concurrency = parseInt(getArg('--concurrency', '40'), 10);
const cooldownMs = parseInt(getArg('--cooldown', '3000'), 10);
const timeoutMs = parseInt(getArg('--timeout', '8000'), 10);

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
    try {
      body = await res.text();
    } catch {
      body = '';
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: '', error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Run `total` POSTs with bounded concurrency; collect each result.
async function runBurst(total, maxInFlight) {
  const results = [];
  let launched = 0;
  async function worker() {
    while (launched < total) {
      launched += 1;
      results.push(await postCreate());
    }
  }
  const workers = Array.from(
    { length: Math.min(maxInFlight, total) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function classify(results) {
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
  // The create handler returns 201 or 5xx — never 403. Any 403 in the burst is
  // therefore a WAF edge block, not an application response.
  return {
    sent: results.length,
    status2xx,
    status403,
    status5xx,
    statusOther,
    wafBlocked: status403,
  };
}

async function main() {
  const burstResults = await runBurst(burst, concurrency);
  const burstSummary = classify(burstResults);

  await new Promise((res) => setTimeout(res, cooldownMs));

  // One clean create — verify default-allow transparency.
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
      'clean request still WAF-blocked — source IP likely inside the 5-min ' +
      'rate window; re-run after the window to confirm default-allow transparency';
  }

  const pass = burstSummary.wafBlocked >= 1 && normalFlow.ok;

  console.log(
    JSON.stringify({ endpoint, burst: burstSummary, normalFlow, pass }, null, 2),
  );
  process.exit(0);
}

main().catch((err) => {
  console.log(JSON.stringify({ pass: false, error: String(err) }));
  process.exit(0);
});
