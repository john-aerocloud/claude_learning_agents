#!/usr/bin/env node
/**
 * uniqueness-probe.js — s005-h3 §11a code-uniqueness prod probe (delta 009, OI-3).
 *
 * Allowlisted entry point: node work/oxo-online/scripts/uniqueness-probe.js <args>
 * Run from the project root (cwd must contain work/).
 *
 * Drives the DEPLOYED create-game path with the REAL client technology for THIS
 * surface — the create endpoint is a backend HTTP API (POST /api/games), so the
 * real client is an HTTP request, not a browser (there is no CSP/transport layer
 * between a server-to-server create call and the API; the browser concern that
 * makes a node probe a FALSE GREEN for WS/SPA surfaces does not apply here).
 *
 * It fires N concurrent POST /api/games and asserts the STORAGE-ENFORCED
 * uniqueness invariant the conditional-PutItem CAS guarantees (SM-2 proof,
 * skeleton-gated): ALL returned codes are distinct. This is the proof the CAS
 * truly guarantees uniqueness under concurrency — not just that it looks atomic.
 * The tester runs the full SM-2 50-concurrent + Codes-table no-duplicate-PK scan;
 * this committed probe is the engineer's standing §11a gate (default N=10).
 *
 * Arguments:
 *   --api-base <https://…>   Origin serving POST /api/games (required), e.g.
 *                            https://d3pf3kcvzpau1x.cloudfront.net
 *   --count <N>              Concurrent creates to fire (default 10)
 *   --timeout <ms>           Per-request timeout (default 8000)
 *
 * Output (single JSON line) + exit code:
 *   { "ok": true,  "count": N, "distinct": N }                    exit 0
 *   { "ok": false, "count": N, "distinct": M, "duplicates": [..] } exit 1
 *   { "ok": false, "error": "<message>" }                          exit 2 (bad input/transport)
 */

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--api-base') args.apiBase = argv[++i];
    else if (argv[i] === '--count') args.count = Number(argv[++i]);
    else if (argv[i] === '--timeout') args.timeout = Number(argv[++i]);
  }
  return args;
}

async function createOne(apiBase, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    if (res.status !== 201) {
      const text = await res.text().catch(() => '');
      return { error: `status ${res.status}: ${text.slice(0, 120)}` };
    }
    const body = await res.json();
    if (!body.code) return { error: 'no code in 201 body' };
    return { code: body.code };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { apiBase, count = 10, timeout = 8000 } = parseArgs(process.argv);
  if (!apiBase) {
    console.log(JSON.stringify({ ok: false, error: 'missing --api-base' }));
    process.exit(2);
  }

  const results = await Promise.all(
    Array.from({ length: count }, () => createOne(apiBase, timeout)),
  );

  const errors = results.filter((r) => r.error).map((r) => r.error);
  if (errors.length > 0) {
    console.log(JSON.stringify({ ok: false, error: `create failures: ${errors.length}`, samples: errors.slice(0, 3) }));
    process.exit(2);
  }

  const codes = results.map((r) => r.code);
  const seen = new Map();
  for (const c of codes) seen.set(c, (seen.get(c) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  const distinct = seen.size;

  if (duplicates.length > 0) {
    // A duplicate code under concurrency = the CAS uniqueness invariant FAILED.
    console.log(JSON.stringify({ ok: false, count, distinct, duplicates }));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, count, distinct }));
  process.exit(0);
}

main();
