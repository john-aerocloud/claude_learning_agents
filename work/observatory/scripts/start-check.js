// start:check — clean-checkout smoke / local "deploy" probe (capabilities.md §4).
//
// Starts the real server (src/server/server.js) on a free port, polls
// GET /api/projects with bounded retries (jittered backoff), asserts HTTP 200,
// then SIGTERMs the server and exits 0. Any failure exits non-zero with a
// categorised structured log so a support engineer can act:
//   - server never came up / connection refused after retries  → availability
//     (category=internal-service: the server is one WE OWN, so this is a defect
//     signal, not terminal handling)
//   - server up but /api/projects not 200                      → internal defect
//
// This is the committed, parameterised probe for UC-S001-1's deployable surface.

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
    if (result.ok) {
      log({ outcome: 'pass', path: PATH, port: PORT, attempt: result.attempt });
      exitCode = 0;
    } else if (result.status !== undefined) {
      // server answered with a non-200: we built a bad response → internal defect
      log({ outcome: 'fail', category: 'internal-service', reason: 'non-200', status: result.status, path: PATH });
    } else {
      // never came up after retries: self-owned availability failure → defect signal
      log({ outcome: 'fail', category: 'internal-service', reason: 'no-listen', error: result.error, attempts: result.attempts });
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
