// @covers R_STAGEFLOW — HTTP adapter: GET /api/projects/:id/stage-flow (UC-S004-1)
// Acceptance over HTTP: AC1.1-AC1.3, AC1.7, AC1.8, AC1.9, CC1, CC2.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from './helpers.js';
import { CANONICAL_STAGES } from '../lib/ledgerAggregator.js';

const HEADER =
  'timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue';

function writeLedger(root, body) {
  mkdirSync(join(root, 'process', 'dora'), { recursive: true });
  writeFileSync(join(root, 'process', 'dora', 'ledger.csv'), body);
}

describe('GET /api/projects/:id/stage-flow', () => {
  let root;
  let server;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-stageflow-'));
    ({ server } = createTestServer({ repoRoot: root, skipWatcher: true }));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC1.1 returns 200 + application/json', async () => {
    writeLedger(root, HEADER + '\n');
    const res = await request(server).get('/api/projects/p/stage-flow');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('AC1.2/AC1.3 returns one object per canonical stage with the full shape', async () => {
    writeLedger(
      root,
      HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,,build,UC-1,\n',
    );
    const res = await request(server).get('/api/projects/p/stage-flow');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((s) => s.stage)).toEqual(CANONICAL_STAGES.map((s) => s.stage));
    for (const s of res.body) {
      expect(typeof s.stage).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(typeof s.throughput).toBe('number');
      expect(typeof s.dwell_median_s).toBe('number');
      expect(typeof s.wip).toBe('number');
      expect(typeof s.rework).toBe('number');
      expect(Array.isArray(s.source_rows)).toBe(true);
      expect(Array.isArray(s.wip_items)).toBe(true);
    }
  });

  it('AC1.7 engineer source_rows is non-empty when throughput > 0', async () => {
    writeLedger(
      root,
      HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,,build,UC-1,\n',
    );
    const res = await request(server).get('/api/projects/p/stage-flow');
    const eng = res.body.find((s) => s.stage === 'engineer');
    expect(eng.throughput).toBe(1);
    expect(eng.source_rows.length).toBeGreaterThan(0);
  });

  it('AC1.8 unknown project returns 200 with all stages present, all zeros', async () => {
    writeLedger(
      root,
      HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,,build,UC-1,\n',
    );
    const res = await request(server).get('/api/projects/nonexistent/stage-flow');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(CANONICAL_STAGES.length);
    for (const s of res.body) {
      expect(s.throughput).toBe(0);
      expect(s.wip).toBe(0);
      expect(s.rework).toBe(0);
    }
  });

  it('CC1 absent ledger file returns all-zeros without a 500', async () => {
    const res = await request(server).get('/api/projects/p/stage-flow');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(CANONICAL_STAGES.length);
    expect(res.body.every((s) => s.throughput === 0)).toBe(true);
  });

  it('AC1.9/CC2 reads only ledger, writes nothing', async () => {
    writeLedger(root, HEADER + '\n');
    const before = JSON.stringify(snapshot(root));
    await request(server).get('/api/projects/p/stage-flow');
    expect(JSON.stringify(snapshot(root))).toBe(before);
  });

  it('path-traversal in :id → 400 or 200-zeros, never reads outside root (AC1.9)', async () => {
    // The middleware rejects traversal-shaped ids via isSafeSegment → 400.
    // Either 400 (rejected early) or 200 all-zeros (matched nothing in ledger)
    // is acceptable — both are safe. Crucially: no 500, no leaked content.
    writeLedger(root, HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,,b,UC-1,\n');
    const res = await request(server).get(
      '/api/projects/' + encodeURIComponent('../../etc') + '/stage-flow',
    );
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.every((s) => s.throughput === 0)).toBe(true);
    }
    // Must never leak /etc contents
    expect(res.text ?? '').not.toMatch(/root:.*:0:0:/);
  });
});

describe('GET /api/projects/:id/stage-flow — queue current-state (DEFECT-004)', () => {
  let root;
  let server;
  const QUEUE_HEADER = 'item_id,enqueued_ts,value,cost,vc_ratio,position,reason';
  const ITEMS_HEADER =
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-stageflow-q-'));
    ({ server } = createTestServer({ repoRoot: root, skipWatcher: true }));
    writeLedger(root, HEADER + '\n');
    mkdirSync(join(root, 'work', 'p', 'items'), { recursive: true });
    mkdirSync(join(root, 'work', 'p', 'queues'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('surfaces queue_depth + queue_items for the ready buffer stage; null on work stages (AC-3)', async () => {
    writeFileSync(
      join(root, 'work', 'p', 'items', 'items.csv'),
      ITEMS_HEADER + '\nUC-A,use-case,CHK,,job,ready,,,,,,\nUC-B,use-case,CHK,,job,ready,,,,,,\n',
    );
    writeFileSync(
      join(root, 'work', 'p', 'queues', 'ready.csv'),
      QUEUE_HEADER +
        '\nUC-A,2026-06-10T08:00:00Z,HIGH,2,1.5,1,r\nUC-B,2026-06-10T07:00:00Z,MED,2,1.0,2,r\n',
    );
    const res = await request(server).get('/api/projects/p/stage-flow');
    const ready = res.body.find((s) => s.stage === 'ready');
    expect(ready.queue_depth).toBe(2);
    expect(ready.queue_items.map((q) => q.item_id).sort()).toEqual(['UC-A', 'UC-B']);
    expect(ready.queue_items.every((q) => typeof q.wait_s === 'number' && q.wait_s > 0)).toBe(true);
    const eng = res.body.find((s) => s.stage === 'engineer');
    expect(eng.queue_depth).toBeNull();
    expect(eng.queue_items).toBeNull();
  });

  it('excludes a stale queue entry (items.csv state=done) from depth + items (AC-4)', async () => {
    writeFileSync(
      join(root, 'work', 'p', 'items', 'items.csv'),
      ITEMS_HEADER + '\nUC-DONE,use-case,CHK,,job,done,,,,,,\nUC-LIVE,use-case,CHK,,job,ready,,,,,,\n',
    );
    writeFileSync(
      join(root, 'work', 'p', 'queues', 'ready.csv'),
      QUEUE_HEADER +
        '\nUC-DONE,2026-06-10T14:00:00Z,HIGH,2,1.5,1,r\nUC-LIVE,2026-06-10T14:00:00Z,MED,2,1.0,2,r\n',
    );
    const res = await request(server).get('/api/projects/p/stage-flow');
    const ready = res.body.find((s) => s.stage === 'ready');
    expect(ready.queue_depth).toBe(1);
    expect(ready.queue_items.map((q) => q.item_id)).toEqual(['UC-LIVE']);
  });
});

function snapshot(root) {
  const dora = join(root, 'process', 'dora');
  return existsSync(dora) ? readdirSync(dora).sort() : [];
}
