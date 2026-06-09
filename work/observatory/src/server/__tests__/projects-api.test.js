// @covers UC1 — HTTP adapter: GET /api/projects, GET /api/active
// Acceptance: AC1.1–AC1.5 over HTTP; F1, F2; read-only posture (no write verbs).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';

function makeFixtureRoot({ active } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'obs-api-'));
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  mkdirSync(join(work, 'alpha'));
  writeFileSync(join(work, 'alpha', 'project.md'), '---\nstatus: active\ncreated: 2026-01-01\n---\n');
  mkdirSync(join(work, 'beta'));
  writeFileSync(join(work, 'beta', 'project.md'), '---\nstatus: stopped\ncreated: 2026-02-02\n---\n');
  mkdirSync(join(work, '_TEMPLATE'));
  if (active !== undefined) writeFileSync(join(work, 'ACTIVE'), active);
  return root;
}

describe('GET /api/projects + /api/active over HTTP', () => {
  let root;
  let app;
  beforeEach(() => {
    root = makeFixtureRoot({ active: 'alpha' });
    app = createApp({ repoRoot: root });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC1.1/AC1.5: GET /api/projects → 200, array of 2, _TEMPLATE absent', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    const ids = res.body.map((p) => p.id).sort();
    expect(ids).toEqual(['alpha', 'beta']);
  });

  it('AC1.2: matching project has active:true; others false', async () => {
    const res = await request(app).get('/api/projects');
    const byId = Object.fromEntries(res.body.map((p) => [p.id, p]));
    expect(byId.alpha.active).toBe(true);
    expect(byId.beta.active).toBe(false);
  });

  it('AC1.5: GET /api/active → 200 { active: "alpha" }', async () => {
    const res = await request(app).get('/api/active');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: 'alpha' });
  });

  it('AC1.3: ACTIVE="none" → GET /api/active 200 { active: null }', async () => {
    const r = makeFixtureRoot({ active: 'none' });
    const a = createApp({ repoRoot: r });
    const res = await request(a).get('/api/active');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: null });
    const list = await request(a).get('/api/projects');
    expect(list.body.every((p) => p.active === false)).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });

  it('AC1.4: ACTIVE absent → GET /api/active 200 { active: null }, no 500', async () => {
    const r = makeFixtureRoot({}); // no ACTIVE file
    const a = createApp({ repoRoot: r });
    const res = await request(a).get('/api/active');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: null });
    rmSync(r, { recursive: true, force: true });
  });
});

describe('read-only posture (UC1 scaffold; full enforcement is UC6)', () => {
  let app;
  let root;
  beforeEach(() => { root = makeFixtureRoot({ active: 'alpha' }); app = createApp({ repoRoot: root }); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('POST /api/projects → 404 (no write verb registered)', async () => {
    const res = await request(app).post('/api/projects');
    expect([404, 405]).toContain(res.status);
  });

  it('PUT /api/active → 404/405 (no write verb registered)', async () => {
    const res = await request(app).put('/api/active');
    expect([404, 405]).toContain(res.status);
  });
});
