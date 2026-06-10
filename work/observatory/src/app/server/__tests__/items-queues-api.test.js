// @covers UC2 — HTTP adapter: GET /api/projects/:id/items + /api/projects/:id/queues/:queue
// Acceptance over HTTP: AC2.1-AC2.11; F3, F4; T-READ-3, T-READ-4, T-READ-7, T-READ-8.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from './helpers.js';

const ITEMS_HEADER =
  'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
const QUEUE_HEADER = 'item_id,enqueued_ts,value,cost,vc_ratio,position,reason';
const POLICY_HEADER =
  'queue,param,value,unit,owner,target_metric,last_tuned,experiment';

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
  let server;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-iq-'));
    ({ server } = createTestServer({ repoRoot: root, skipWatcher: true }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC2.1 / T-READ-6: 3 rows → 200 array of 3, typed fields, raw strings', async () => {
    writeItems(root, 'p', [
      ITEMS_HEADER,
      'CHK-1,chunk,,,job,in-progress,HIGH,M,HIGH/M,2026-01-01,,',
      'UC-1,use-case,CHK-1,,job,ready,HIGH,4,0.75,2026-01-02,,',
      'SLC-1,slice,CHK-1,,job,done,MED,2,1.00,2026-01-03,2026-01-04,',
    ].join('\n'));
    const res = await request(server).get('/api/projects/p/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((r) => r.type)).toEqual(['chunk', 'use-case', 'slice']);
    expect(typeof res.body[1].cost).toBe('string'); // raw strings, no casting
  });

  it('AC2.8 / T-READ-4: missing items.csv → 200 null (no crash, no 500)', async () => {
    mkdirSync(join(root, 'work', 'p'), { recursive: true });
    const res = await request(server).get('/api/projects/p/items');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('AC2.11: nonexistent project → 200 null', async () => {
    const res = await request(server).get('/api/projects/nonexistent/items');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe('GET /api/projects/:id/queues/:queue', () => {
  let root;
  let server;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-iq-q-'));
    ({ server } = createTestServer({ repoRoot: root, skipWatcher: true }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC2.2 / T-READ-7: intake CSV → typed records, raw strings', async () => {
    writeQueue(root, 'p', 'intake', [
      QUEUE_HEADER,
      'UC-3,2026-01-01,HIGH,2,1.50,1,reason one',
      'UC-2,2026-01-02,HIGH,4,0.75,2,reason two',
    ].join('\n'));
    const res = await request(server).get('/api/projects/p/queues/intake');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].position).toBe('1');
    expect(typeof res.body[0].cost).toBe('string');
  });

  it('AC2.3 / T-READ-8: policy CSV → typed records', async () => {
    writeQueue(root, 'p', 'policy', [
      POLICY_HEADER,
      'ready,min_items,2,count,flow-manager,throughput,<created>,EXP-022',
    ].join('\n'));
    const res = await request(server).get('/api/projects/p/queues/policy');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].param).toBe('min_items');
  });

  it('AC2.4-2.7: header-only queue → 200 []', async () => {
    writeQueue(root, 'p', 'ready', QUEUE_HEADER + '\n');
    const res = await request(server).get('/api/projects/p/queues/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('AC2.9: missing policy.csv → 200 null', async () => {
    mkdirSync(join(root, 'work', 'p', 'queues'), { recursive: true });
    const res = await request(server).get('/api/projects/p/queues/policy');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('unknown queue name → 404 with error body', async () => {
    const res = await request(server).get('/api/projects/p/queues/evil');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
