// @covers UC6 — full-server integration: all routers mounted, CORS, read-only guard.
// Acceptance: AC6.2, AC6.3 (read-only), AC6.4, AC6.5 (CORS), F7; plus a live-mount
// probe that every UC1-UC5 endpoint family responds through ONE composed server.
//
// This is the SERIAL-LAST integration test. It does NOT re-prove each parser
// (UC1-UC5 own those); it proves the COMPOSITION: a single server boots with the
// whole route table, enforces the app-level CORS + read-only posture, and tears
// down cleanly (watcher.stop()) so the suite exits with no open handles.
//
// We use buildServerApp({ repoRoot }) — the UC6 composition seam that constructs
// the watcher, wires UC2-UC5 routers via createApp's extraRouters, and returns
// { app, watcher } so the caller (server.js OR this test) owns teardown.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServerApp } from '../compose.js';

// A fixture repo tree exercising one real source per UC so each endpoint family
// returns a meaningful 200 (not just "route exists").
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'obs-integ-'));
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'ACTIVE'), 'demo');

  const proj = join(work, 'demo');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'project.md'), '---\nstatus: active\ncreated: 2026-01-01\n---\n');

  // UC2 items + a queue CSV
  mkdirSync(join(proj, 'items'), { recursive: true });
  writeFileSync(
    join(proj, 'items', 'items.csv'),
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref\n' +
      'i1,chunk,,,do a thing,done,5,2,2.5,t,t,r\n',
  );
  mkdirSync(join(proj, 'queues'), { recursive: true });
  writeFileSync(
    join(proj, 'queues', 'intake.csv'),
    'item_id,enqueued_ts,value,cost,vc_ratio,position,reason\n' + 'i1,t,5,2,2.5,1,seed\n',
  );

  // UC3 dora flow + deps mmd + global baseline
  mkdirSync(join(proj, 'dora'), { recursive: true });
  writeFileSync(join(proj, 'dora', 'flow.md'), '# flow\nline');
  mkdirSync(join(proj, 'architecture', 'dependencies'), { recursive: true });
  writeFileSync(join(proj, 'architecture', 'dependencies', 'class-deps.mmd'), 'graph TD\n A-->B');
  mkdirSync(join(root, 'process', 'dora'), { recursive: true });
  writeFileSync(join(root, 'process', 'dora', 'baseline.md'), '# baseline\nmetrics');

  // UC4 slice artifact
  mkdirSync(join(proj, 'slices', 's001-x'), { recursive: true });
  writeFileSync(join(proj, 'slices', 's001-x', 'slice.md'), '# slice');

  return root;
}

describe('UC6 — composed read-layer server: every router mounted under one app', () => {
  let root;
  let app;
  let watcher;
  let server; // a real http listener, so the SSE probe drives the live stream

  beforeAll(async () => {
    root = makeRepo();
    ({ app, watcher } = buildServerApp({ repoRoot: root }));
    await watcher.ready();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (watcher) await watcher.stop();
    rmSync(root, { recursive: true, force: true });
  });

  // --- Live-mount probe: one endpoint per UC family responds through the
  // composed server (proves UC6 wiring, not the parsers). ---

  it('UC1: GET /api/projects → 200 array, GET /api/active → 200', async () => {
    const projects = await request(app).get('/api/projects');
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);
    const active = await request(app).get('/api/active');
    expect(active.status).toBe(200);
    expect(active.body).toEqual({ active: 'demo' });
  });

  it('UC2: GET /api/projects/:id/items + /queues/:q → 200', async () => {
    const items = await request(app).get('/api/projects/demo/items');
    expect(items.status).toBe(200);
    expect(items.body).toHaveLength(1);
    const queue = await request(app).get('/api/projects/demo/queues/intake');
    expect(queue.status).toBe(200);
    expect(queue.body).toHaveLength(1);
  });

  it('UC3: GET /api/dora/baseline + /dora/:artifact + /deps/:artifact → 200', async () => {
    const baseline = await request(app).get('/api/dora/baseline');
    expect(baseline.status).toBe(200);
    expect(baseline.body.content).toMatch(/baseline/);
    const flow = await request(app).get('/api/projects/demo/dora/flow');
    expect(flow.status).toBe(200);
    expect(flow.body.content).toMatch(/flow/);
    const deps = await request(app).get('/api/projects/demo/deps/class-deps.mmd');
    expect(deps.status).toBe(200);
    expect(deps.body.content).toMatch(/graph TD/);
  });

  it('UC4: GET /api/projects/:id/slices + /slices/:slug/:artifact → 200', async () => {
    const slices = await request(app).get('/api/projects/demo/slices');
    expect(slices.status).toBe(200);
    expect(slices.body).toContain('s001-x');
    const artifact = await request(app).get('/api/projects/demo/slices/s001-x/slice.md');
    expect(artifact.status).toBe(200);
    expect(artifact.body.content).toMatch(/slice/);
  });

  it('UC5: GET /api/events → 200 text/event-stream (mounted on composed app)', async () => {
    // /api/events is long-lived; drive it with a raw http GET against the real
    // listener, assert the stream headers, then destroy the socket cleanly so no
    // ECONNRESET leaks into the run (supertest buffers and would hang here).
    const { port } = server.address();
    await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
        try {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        } catch (e) {
          req.destroy();
          return reject(e);
        }
        res.resume(); // drain so the socket can close without a reset error
        req.destroy();
        resolve();
      });
      req.on('error', () => resolve()); // tidy destroy may surface a benign error
    });
  });

  // --- CORS (AC6.4, AC6.5 / T-READ-11): only http://localhost:5173 ---

  it('AC6.4: Origin http://localhost:5173 → ACAO echoes that origin', async () => {
    const res = await request(app).get('/api/projects').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('AC6.5: a disallowed origin → NO Access-Control-Allow-Origin header', async () => {
    const res = await request(app).get('/api/projects').set('Origin', 'http://evil.example.com');
    expect(res.status).toBe(200); // request still served; just no CORS grant
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('AC6.5: not a wildcard ACAO even for the allowed origin', async () => {
    const res = await request(app).get('/api/projects').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  // --- App-level read-only guard (AC6.2, AC6.3 / F7, T-READ-10) ---

  it('AC6.2/F7: POST /api/projects → 405 (write verb rejected app-wide)', async () => {
    const res = await request(app).post('/api/projects');
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toMatch(/GET/);
  });

  it('F7: POST /api/events → 405 (no write verb on SSE either)', async () => {
    const res = await request(app).post('/api/events');
    expect(res.status).toBe(405);
  });

  it('F7: PUT and DELETE on any route → 405', async () => {
    const put = await request(app).put('/api/active');
    const del = await request(app).delete('/api/projects/demo/items');
    expect(put.status).toBe(405);
    expect(del.status).toBe(405);
  });

  it('AC6.3/T-READ-10: GET and HEAD and OPTIONS are allowed (read methods pass the guard)', async () => {
    const head = await request(app).head('/api/projects');
    expect(head.status).toBe(200);
    const options = await request(app).options('/api/projects');
    // OPTIONS is the CORS preflight method — must NOT be rejected by the guard.
    expect([200, 204]).toContain(options.status);
  });
});
