// @covers def-012
// @covers R_STAGING
// DEFECT-012 — decomposed work invisible between product completion and
// flow-manager triage. The staging buffer (work/<id>/queues/staging.csv,
// header item_id,parent,job,value,cost,produced_ts,producer_ref) is a REAL
// handoff state and must be readable over HTTP:
//   GET /api/projects/:id/queues/staging → { queue:'staging', depth, rows }
// Empty staging is the HAPPY state: a missing or header-only file is
// depth 0 + rows [] (never null, never 4xx/5xx) so the board can render a
// truthful "0 awaiting triage" empty state.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from './helpers.js';

const STAGING_HEADER = 'item_id,parent,job,value,cost,produced_ts,producer_ref';

function writeStaging(root, project, body) {
  const dir = join(root, 'work', project, 'queues');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'staging.csv'), body);
}

describe('GET /api/projects/:id/queues/staging (DEFECT-012)', () => {
  let root;
  let server;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-staging-'));
    ({ server } = createTestServer({ repoRoot: root, skipWatcher: true }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('D12-AC-1: staging rows → 200 { depth: 2, rows } with raw-string records (the defect repro)', async () => {
    writeStaging(root, 'p', [
      STAGING_HEADER,
      'UC-S015-1,SLC-S015,WIP panel — show in-flight work,HIGH,2.0,2026-06-10T15:50:00Z,REPLENISH-CHK6',
      'UC-S015-2,SLC-S015,Navigate views,MED,1.5,2026-06-10T15:50:00Z,REPLENISH-CHK6',
    ].join('\n'));
    const res = await request(server).get('/api/projects/p/queues/staging');
    expect(res.status).toBe(200);
    expect(res.body.queue).toBe('staging');
    expect(res.body.depth).toBe(2);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0].item_id).toBe('UC-S015-1');
    expect(res.body.rows[0].job).toBe('WIP panel — show in-flight work');
    expect(res.body.rows[0].producer_ref).toBe('REPLENISH-CHK6');
    expect(typeof res.body.rows[0].cost).toBe('string'); // raw §4 strings, no casting
  });

  it('D12-AC-2: header-only staging.csv (drained — the happy state) → 200 depth 0, rows []', async () => {
    writeStaging(root, 'p', STAGING_HEADER + '\n');
    const res = await request(server).get('/api/projects/p/queues/staging');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queue: 'staging', depth: 0, rows: [] });
  });

  it('D12-AC-3: missing staging.csv → 200 depth 0, rows [] (fail-soft, never null/500)', async () => {
    mkdirSync(join(root, 'work', 'p', 'queues'), { recursive: true });
    const res = await request(server).get('/api/projects/p/queues/staging');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queue: 'staging', depth: 0, rows: [] });
  });

  it('D12-AC-4: nonexistent project → 200 depth 0 (same fail-soft posture as the other queues)', async () => {
    const res = await request(server).get('/api/projects/nope/queues/staging');
    expect(res.status).toBe(200);
    expect(res.body.depth).toBe(0);
  });

  it('existing queue routes are untouched: unknown queue still 404, ready still raw array', async () => {
    const dir = join(root, 'work', 'p', 'queues');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'ready.csv'),
      'item_id,enqueued_ts,value,cost,vc_ratio,position,reason\nUC-1,2026-01-01,HIGH,2,1.5,1,r\n',
    );
    const ready = await request(server).get('/api/projects/p/queues/ready');
    expect(ready.status).toBe(200);
    expect(Array.isArray(ready.body)).toBe(true); // ready keeps its bare-array shape
    const evil = await request(server).get('/api/projects/p/queues/evil');
    expect(evil.status).toBe(404);
  });
});
