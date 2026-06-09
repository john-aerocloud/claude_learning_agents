// start:check — clean-checkout smoke / local "deploy" probe (capabilities.md §4).
//
// Starts the real server (src/server/server.js) on a free port, polls
// GET /api/projects with bounded retries (jittered backoff) to confirm the
// server is up, THEN (UC6) probes ONE representative endpoint per UC family so
// the smoke proves the full INTEGRATED route table is mounted — not just that
// the process listens. All probed endpoints must return 200; then it SIGTERMs
// the server and exits 0. Any failure exits non-zero with a categorised
// structured log so a support engineer can act:
//   - server never came up / connection refused after retries  → availability
//     (category=internal-service: the server is one WE OWN, so this is a defect
//     signal, not terminal handling)
//   - server up but a probed endpoint not 200                  → internal defect
//
// This is the committed, parameterised probe for UC-S001-6's deployable surface
// (and UC-S001-1's; one entry point, now asserting the whole composition).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(HERE, '..', 'src', 'server', 'server.js');

const PORT = Number(process.env.PORT) || 3010; // avoid clashing with a running :3001
const PATH = process.env.START_CHECK_PATH || '/api/projects';
const MAX_ATTEMPTS = Number(process.env.START_CHECK_ATTEMPTS) || 10;
const BASE_DELAY_MS = 150;

function log(obj) {
  console.log(JSON.stringify({ probe: 'start-check', ...obj }));
}

function getStatus(port, path) {
  return new Promise((resolveP, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 2000 }, (res) => {
      res.resume(); // drain
      resolveP(res.statusCode);
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

// GET a JSON endpoint and return { status, body }. Bounded by a request timeout.
function getJson(port, path) {
  return new Promise((resolveP, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 2000 }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(buf); } catch { /* non-JSON: leave null */ }
        resolveP({ status: res.statusCode, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

// Probe the long-lived SSE endpoint: assert 200 + text/event-stream header, then
// destroy the socket (do NOT wait for body — the stream never ends). Returns the
// status code so a non-200 mount failure is caught.
function probeSse(port, path) {
  return new Promise((resolveP, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 2000 }, (res) => {
      const ct = res.headers['content-type'] || '';
      res.resume();
      req.destroy();
      resolveP({ status: res.statusCode, eventStream: /text\/event-stream/.test(ct) });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    // a tidy destroy after headers can surface a benign reset — only reject if we
    // never got headers (handled by the caller's missing-result branch).
    req.on('error', (e) => reject(e));
  });
}

async function pollUntil200(port, path) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const status = await getStatus(port, path);
      if (status === 200) return { ok: true, attempt };
      // up but wrong status → our own bad response: internal defect, do not retry forever
      return { ok: false, status, attempt };
    } catch (err) {
      lastErr = err; // connection refused while still starting → retry
      const jitter = Math.random() * 50;
      const delay = BASE_DELAY_MS * attempt + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return { ok: false, error: String(lastErr && lastErr.message), attempts: MAX_ATTEMPTS };
}

async function main() {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let exitCode = 1;
  try {
    const result = await pollUntil200(PORT, PATH);
    if (!result.ok) {
      if (result.status !== undefined) {
        // server answered with a non-200: we built a bad response → internal defect
        log({ outcome: 'fail', category: 'internal-service', reason: 'non-200', status: result.status, path: PATH });
      } else {
        // never came up after retries: self-owned availability failure → defect signal
        log({ outcome: 'fail', category: 'internal-service', reason: 'no-listen', error: result.error, attempts: result.attempts });
      }
    } else {
      // Server is up. UC6: assert the FULL integrated route table — one
      // representative endpoint per UC family must answer 200 through this one
      // process. Discover a project id (fail-soft endpoints tolerate any id, but
      // a real one keeps the probe representative).
      const projects = await getJson(PORT, '/api/projects');
      const pid = (Array.isArray(projects.body) && projects.body[0] && projects.body[0].id) || 'observatory';

      const checks = [
        { uc: 'UC1', path: '/api/active' },
        { uc: 'UC2', path: `/api/projects/${pid}/items` },
        { uc: 'UC2', path: `/api/projects/${pid}/queues/intake` },
        { uc: 'UC3', path: '/api/dora/baseline' },
        { uc: 'UC3', path: `/api/projects/${pid}/dora/flow` },
        { uc: 'UC4', path: `/api/projects/${pid}/slices` },
      ];

      let allGreen = projects.status === 200;
      const failures = [];
      if (projects.status !== 200) failures.push({ uc: 'UC1', path: '/api/projects', status: projects.status });
      for (const c of checks) {
        const r = await getJson(PORT, c.path);
        if (r.status !== 200) {
          allGreen = false;
          failures.push({ uc: c.uc, path: c.path, status: r.status });
        }
      }

      // UC5: SSE mount probe (headers only; never wait for the unbounded body).
      let sse;
      try {
        sse = await probeSse(PORT, '/api/events');
      } catch (e) {
        sse = { status: undefined, error: String(e && e.message) };
      }
      if (!sse || sse.status !== 200 || !sse.eventStream) {
        allGreen = false;
        failures.push({ uc: 'UC5', path: '/api/events', status: sse && sse.status, eventStream: sse && sse.eventStream });
      }

      if (allGreen) {
        log({ outcome: 'pass', port: PORT, probed: ['/api/projects', ...checks.map((c) => c.path), '/api/events'] });
        exitCode = 0;
      } else {
        // an endpoint is mounted-but-not-200, or a family is missing from the
        // composed table → our own integration defect (internal-service).
        log({ outcome: 'fail', category: 'internal-service', reason: 'endpoint-not-200', failures });
      }
    }
  } finally {
    child.kill('SIGTERM');
    // give the server a moment to close gracefully, then hard-exit this script
    await new Promise((r) => setTimeout(r, 300));
    if (!child.killed) child.kill('SIGKILL');
  }
  process.exit(exitCode);
}

main();
