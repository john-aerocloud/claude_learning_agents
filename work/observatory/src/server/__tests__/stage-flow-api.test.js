// @covers R_STAGEFLOW — HTTP adapter: GET /api/projects/:id/stage-flow (UC-S004-1)
// Acceptance over HTTP: AC1.1-AC1.3, AC1.7, AC1.8, AC1.9, CC1, CC2.
//
// Independence (§39): the router is injected via createApp's extraRouters seam
// (the UC1/UC2 pattern). This test touches no other router file and does not
// depend on compose.js. It writes a throwaway ledger under a temp repoRoot so it
// never reads or mutates the real process/dora/ledger.csv (read-only posture).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { createStageFlowRouter } from '../routes/stageFlow.js';
import { CANONICAL_STAGES } from '../lib/ledgerAggregator.js';

const HEADER =
  'timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue';

function makeApp(root) {
  return createApp({ repoRoot: root, extraRouters: [createStageFlowRouter({ repoRoot: root })] });
}
function writeLedger(root, body) {
  mkdirSync(join(root, 'process', 'dora'), { recursive: true });
  writeFileSync(join(root, 'process', 'dora', 'ledger.csv'), body);
}

describe('GET /api/projects/:id/stage-flow', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-stageflow-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC1.1 returns 200 + application/json', async () => {
    writeLedger(root, HEADER + '\n');
    const res = await request(makeApp(root)).get('/api/projects/p/stage-flow');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('AC1.2/AC1.3 returns one object per canonical stage with the full shape', async () => {
    writeLedger(
      root,
      HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,,build,UC-1,\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/stage-flow');
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
    const res = await request(makeApp(root)).get('/api/projects/p/stage-flow');
    const eng = res.body.find((s) => s.stage === 'engineer');
    expect(eng.throughput).toBe(1);
    expect(eng.source_rows.length).toBeGreaterThan(0);
  });

  it('AC1.8 unknown project returns 200 with all stages present, all zeros', async () => {
    writeLedger(
      root,
      HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,,build,UC-1,\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/nonexistent/stage-flow');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(CANONICAL_STAGES.length);
    for (const s of res.body) {
      expect(s.throughput).toBe(0);
      expect(s.wip).toBe(0);
      expect(s.rework).toBe(0);
    }
  });

  it('CC1 absent ledger file returns all-zeros without a 500', async () => {
    // no ledger written at all
    const res = await request(makeApp(root)).get('/api/projects/p/stage-flow');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(CANONICAL_STAGES.length);
    expect(res.body.every((s) => s.throughput === 0)).toBe(true);
  });

  it('AC1.9/CC2 reads only process/dora/ledger.csv and writes nothing', async () => {
    writeLedger(root, HEADER + '\n');
    const before = JSON.stringify(snapshot(root));
    await request(makeApp(root)).get('/api/projects/p/stage-flow');
    expect(JSON.stringify(snapshot(root))).toBe(before); // no write side-effect
  });

  it('path-traversal in :id cannot escape — still 200 all-zeros, never reads out', async () => {
    writeLedger(root, HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,,b,UC-1,\n');
    const res = await request(makeApp(root)).get(
      '/api/projects/' + encodeURIComponent('../../etc') + '/stage-flow',
    );
    expect(res.status).toBe(200);
    expect(res.body.every((s) => s.throughput === 0)).toBe(true);
  });
});

// Shallow snapshot of the temp repo tree (names only) to assert read-only.
function snapshot(root) {
  const dora = join(root, 'process', 'dora');
  return existsSync(dora) ? readdirSync(dora).sort() : [];
}
