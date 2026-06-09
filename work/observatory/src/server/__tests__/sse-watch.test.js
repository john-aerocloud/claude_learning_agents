// @covers UC5 — SSE HTTP adapter (routes/events.js): GET /api/events.
// Acceptance: AC5.1 (event-stream header), AC5.3 (<1s change frame over HTTP),
// AC5.4 (fan-out to 2 clients), AC5.5 (disconnect → no crash on next change),
// AC5.6 (no wildcard ACAO). F6, T-READ-5, T-READ-15, T-READ-16.
//
// We mount the events router into the real createApp via extraRouters (the UC6
// mount seam) so this test also proves the wiring contract UC6 will use. The SSE
// stream is long-lived, so we drive it with a raw http GET and read the response
// stream incrementally — supertest buffers full responses and would hang on an
// open stream. Every test closes its client sockets, stops the watcher, and
// closes the server so the suite exits with no open handles.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { createWatcher } from '../watcher.js';
import { createEventsRouter } from '../routes/events.js';

// Open a streaming SSE client against host:port. Returns the live request, the
// response, and a `waitForData(predicate, ms)` that resolves on the first
// chunk-accumulated SSE frame matching the predicate (parsed `data:` JSON).
function openSseClient({ port, path = '/api/events', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let buf = '';
      const waiters = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        // SSE frames are separated by a blank line.
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue; // heartbeat comment frame (":\n\n"); ignore
          let payload;
          try { payload = JSON.parse(line.slice(5).trim()); } catch { continue; }
          for (const w of [...waiters]) {
            if (w.predicate(payload)) {
              clearTimeout(w.timer);
              waiters.splice(waiters.indexOf(w), 1);
              w.resolve({ payload, at: Date.now() });
            }
          }
        }
      });
      resolve({
        req,
        res,
        waitForData(predicate, ms) {
          return new Promise((res2, rej2) => {
            const timer = setTimeout(() => rej2(new Error(`no SSE frame within ${ms}ms`)), ms);
            waiters.push({ predicate, timer, resolve: res2 });
          });
        },
        close() {
          req.destroy();
        },
      });
    });
    req.on('error', reject);
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('GET /api/events — SSE live-refresh', () => {
  let root;
  let watcher;
  let server;
  const clients = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'obs-sse-'));
    mkdirSync(join(root, 'work'), { recursive: true });
    watcher = createWatcher({ repoRoot: root });
    await watcher.ready();
    const app = createApp({ repoRoot: root, extraRouters: [createEventsRouter({ watcher })] });
    server = await listen(app);
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    if (watcher) await watcher.stop();
    if (server) await new Promise((r) => server.close(r));
  });

  function port() {
    return server.address().port;
  }

  it('AC5.1: responds with Content-Type text/event-stream + no-cache', async () => {
    const c = await openSseClient({ port: port() });
    clients.push(c);
    expect(c.res.statusCode).toBe(200);
    expect(c.res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(c.res.headers['cache-control']).toMatch(/no-cache/);
  });

  it('AC5.3/F6/T-READ-5: a file write delivers a change frame within 1000ms', async () => {
    const c = await openSseClient({ port: port() });
    clients.push(c);
    const start = Date.now();
    const pending = c.waitForData(
      (p) => p.type === 'change' && p.path === join('work', 'live.txt'),
      1000,
    );
    writeFileSync(join(root, 'work', 'live.txt'), 'data');
    const { at } = await pending;
    expect(at - start).toBeLessThan(1000);
  });

  it('AC5.4/T-READ-15: both connected clients receive the change frame', async () => {
    const a = await openSseClient({ port: port() });
    const b = await openSseClient({ port: port() });
    clients.push(a, b);
    const pa = a.waitForData((p) => p.path === join('work', 'two.txt'), 1000);
    const pb = b.waitForData((p) => p.path === join('work', 'two.txt'), 1000);
    writeFileSync(join(root, 'work', 'two.txt'), 'fan');
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(ra.payload.type).toBe('change');
    expect(rb.payload.type).toBe('change');
  });

  it('AC5.5/T-READ-16: after one client disconnects, a change still reaches the survivor with no crash', async () => {
    const a = await openSseClient({ port: port() });
    const b = await openSseClient({ port: port() });
    clients.push(b);
    // Disconnect client a; give the server a beat to process the close event.
    a.close();
    await new Promise((r) => setTimeout(r, 100));
    const pb = b.waitForData((p) => p.path === join('work', 'survive.txt'), 1000);
    writeFileSync(join(root, 'work', 'survive.txt'), 'still here');
    const { payload } = await pb;
    expect(payload.type).toBe('change');
  });

  it('AC5.6: no wildcard Access-Control-Allow-Origin on the SSE response', async () => {
    const c = await openSseClient({ port: port() });
    clients.push(c);
    expect(c.res.headers['access-control-allow-origin']).not.toBe('*');
  });
});
