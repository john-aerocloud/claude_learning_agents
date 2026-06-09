// @covers UC4 — HTTP adapter: GET /api/projects/:id/slices (list)
// @covers UC4 — HTTP adapter: GET /api/projects/:id/slices/:slug/:artifact (raw pass-through)
// Acceptance: AC4.1–AC4.4; F4 (missing optional → null, 200); T-READ-4, T-READ-13.
// Built independently of UC2/UC3: router is exercised via createApp's extraRouters
// seam (UC1 pattern). Does NOT edit app.js / server.js / other UCs' files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { createSlicesRouter } from '../routes/slices.js';

const SLICE_TEXT = '# slice\n\nKnown fixture body — line two.\n';
const ACCEPTANCE_TEXT = '## acceptance\n- AC: present\n';

function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'obs-slices-'));
  const slices = join(root, 'work', 'observatory', 'slices');
  // s001-read-layer: has slice.md + acceptance.md, but NO result.md, NO ui-design.md
  const s1 = join(slices, 's001-read-layer');
  mkdirSync(s1, { recursive: true });
  writeFileSync(join(s1, 'slice.md'), SLICE_TEXT);
  writeFileSync(join(s1, 'acceptance.md'), ACCEPTANCE_TEXT);
  // s002-write-layer: only a slice.md (different file presence)
  const s2 = join(slices, 's002-write-layer');
  mkdirSync(s2, { recursive: true });
  writeFileSync(join(s2, 'slice.md'), '# s002\n');
  return root;
}

function appFor(root) {
  return createApp({ repoRoot: root, extraRouters: [createSlicesRouter({ repoRoot: root })] });
}

describe('GET /api/projects/:id/slices (list slice directories)', () => {
  let root;
  let app;
  beforeEach(() => { root = makeFixtureRoot(); app = appFor(root); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists slice directory slugs under work/<id>/slices', async () => {
    const res = await request(app).get('/api/projects/observatory/slices');
    expect(res.status).toBe(200);
    expect(res.body.sort()).toEqual(['s001-read-layer', 's002-write-layer']);
  });

  it('returns [] (200) when project has no slices dir — no crash', async () => {
    const res = await request(app).get('/api/projects/nonexistent/slices');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/projects/:id/slices/:slug/:artifact (raw pass-through)', () => {
  let root;
  let app;
  beforeEach(() => { root = makeFixtureRoot(); app = appFor(root); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC4.1: present artifact → 200 { content: "<exact text>" }', async () => {
    const res = await request(app).get('/api/projects/observatory/slices/s001-read-layer/slice.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: SLICE_TEXT });
  });

  it('AC4.1: a second present artifact is returned byte-for-byte', async () => {
    const res = await request(app).get('/api/projects/observatory/slices/s001-read-layer/acceptance.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: ACCEPTANCE_TEXT });
  });

  it('AC4.2: absent optional artifact (result.md) → 200 { content: null }, no 500', async () => {
    const res = await request(app).get('/api/projects/observatory/slices/s001-read-layer/result.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('F4: absent optional ui-design.md (non-UI slice) → 200 { content: null }', async () => {
    const res = await request(app).get('/api/projects/observatory/slices/s001-read-layer/ui-design.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('AC4.3 / T-READ-13: artifact not on allowlist → 400', async () => {
    const res = await request(app).get('/api/projects/observatory/slices/s001-read-layer/malicious.sh');
    expect(res.status).toBe(400);
  });

  it('AC4.4: slice dir does not exist → 200 { content: null } for a valid artifact', async () => {
    const res = await request(app).get('/api/projects/observatory/slices/no-such-slice/slice.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('AC4.4: project dir does not exist → 200 { content: null }', async () => {
    const res = await request(app).get('/api/projects/nope/slices/s001-read-layer/slice.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('T-READ-13: a path-traversal artifact name is rejected (not on allowlist) → 400', async () => {
    const res = await request(app).get('/api/projects/observatory/slices/s001-read-layer/..%2f..%2fpackage.json');
    expect([400, 404]).toContain(res.status);
  });

  it('read-only posture: POST to the artifact route → 404/405', async () => {
    const res = await request(app).post('/api/projects/observatory/slices/s001-read-layer/slice.md');
    expect([404, 405]).toContain(res.status);
  });
});
