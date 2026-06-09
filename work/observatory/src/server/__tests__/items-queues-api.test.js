// @covers UC2 — HTTP adapter: GET /api/projects/:id/items + /api/projects/:id/queues/:queue
// Acceptance over HTTP: AC2.1-AC2.11; F3, F4; T-READ-3, T-READ-4, T-READ-7, T-READ-8.
//
// Independence (§39): the router is tested by injecting it via createApp's
// extraRouters seam (the UC1 pattern) — this test touches NO UC1/UC3/UC4 file
// and does NOT depend on server.js (the UC6 mount point).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { createItemsQueuesRouter } from '../routes/items-queues.js';

const ITEMS_HEADER =
  'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
const QUEUE_HEADER = 'item_id,enqueued_ts,value,cost,vc_ratio,position,reason';
const POLICY_HEADER =
  'queue,param,value,unit,owner,target_metric,last_tuned,experiment';

function makeApp(root) {
  return createApp({ repoRoot: root, extraRouters: [createItemsQueuesRouter({ repoRoot: root })] });
}
function writeItems(root, project, body) {
  const dir = join(root, 'work', project, 'items');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'items.csv'), body);
}
function writeQueue(root, project, q, body) {
  const dir = join(root, 'work', project, 'queues');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${q}.csv`), body);
}

describe('GET /api/projects/:id/items', () => {
  let root;
  let app;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'obs-iq-')); app = makeApp(root); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC2.1 / T-READ-6: 3 rows → 200 array of 3, typed fields, raw strings', async () => {
    writeItems(root, 'p', [
      ITEMS_HEADER,
      'CHK-1,chunk,,,job,in-progress,HIGH,M,HIGH/M,2026-01-01,,',
      'UC-1,use-case,CHK-1,,job,ready,HIGH,4,0.75,2026-01-02,,',
      'SLC-1,slice,CHK-1,,job,done,MED,2,1.00,2026-01-03,2026-01-04,',
    ].join('\n'));
    const res = await request(app).get('/api/projects/p/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((r) => r.type)).toEqual(['chunk', 'use-case', 'slice']);
    expect(res.body[1].cost).toBe('4'); // raw string, no cast
  });

  it('AC2.8 / T-READ-4: missing items.csv → 200 null', async () => {
    mkdirSync(join(root, 'work', 'p'), { recursive: true });
    const res = await request(app).get('/api/projects/p/items');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('AC2.11 / T-READ-4: nonexistent project → 200 null', async () => {
    const res = await request(app).get('/api/projects/nonexistent/items');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe('GET /api/projects/:id/queues/:queue', () => {
  let root;
  let app;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'obs-iq-')); app = makeApp(root); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC2.2 / T-READ-7: intake 2 rows → 200 array of 2, position present, raw strings', async () => {
    writeQueue(root, 'p', 'intake', [
      QUEUE_HEADER,
      'UC-3,2026-01-01,HIGH,2,1.50,1,reason one',
      'UC-2,2026-01-02,HIGH,4,0.75,2,reason two',
    ].join('\n'));
    const res = await request(app).get('/api/projects/p/queues/intake');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].position).toBe('1');
    expect(res.body[0].vc_ratio).toBe('1.50');
  });

  it('AC2.3 / T-READ-8: policy rows → 200, param values exact', async () => {
    writeQueue(root, 'p', 'policy', [
      POLICY_HEADER,
      'ready,min_items,2,count,flow-manager,throughput,<created>,EXP-022',
      'ready,wip_limit,4,count,flow-manager,gross-lead-time,<created>,EXP-022',
    ].join('\n'));
    const res = await request(app).get('/api/projects/p/queues/policy');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.param)).toEqual(['min_items', 'wip_limit']);
  });

  it('AC2.4-2.7: header-only intake/ready/deploy/rework → 200 []', async () => {
    for (const q of ['intake', 'ready', 'deploy', 'rework']) {
      writeQueue(root, 'p', q, QUEUE_HEADER + '\n');
      const res = await request(app).get(`/api/projects/p/queues/${q}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it('AC2.9 / T-READ-4: missing policy.csv → 200 null', async () => {
    mkdirSync(join(root, 'work', 'p', 'queues'), { recursive: true });
    const res = await request(app).get('/api/projects/p/queues/policy');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('unknown queue name → 404 (not on allowlist; never reads outside the queues dir)', async () => {
    const res = await request(app).get('/api/projects/p/queues/evil');
    expect(res.status).toBe(404);
  });

  it('read-only posture: POST to items/queue → 404/405 (no write verb registered)', async () => {
    const a = await request(app).post('/api/projects/p/items');
    expect([404, 405]).toContain(a.status);
    const b = await request(app).post('/api/projects/p/queues/intake');
    expect([404, 405]).toContain(b.status);
  });
});
