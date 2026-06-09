// @covers UC3 — HTTP adapter: DORA/flow/deps raw pass-through endpoints.
// Acceptance: AC3.1-AC3.7; F4 (missing → null), F5 (raw markdown/.mmd),
// T-READ-4 (fail soft), T-READ-12 (path-traversal allowlist guard).
//
// Mounted via the UC1 createApp extension seam (extraRouters) — UC3 does NOT
// edit app.js or server.js. UC6 wires this router into the live composition.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { createDoraRouter } from '../routes/dora.js';

const BASELINE = '# DORA baseline\n\nlead time: 1d\nconstraint: engineer\n';
const FLOW = '# flow — observatory\n\nqueue depths: ready=3\n';
const PERPROJECT = '# per-project expected vs actual\n\nUC-S001-3: on target\n';
const UCDEPS = 'graph TD\n  UC1-->UC6\n  UC3-->UC6\n';
const CLASSDEPS = 'graph TD\n  app-->dora\n  dora:::s001changed\n';
const EDGELEDGER = '# edge ledger\n\nUC3 owns dora.js + file-reader.js\n';

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'obs-dora-'));
  // process/dora/baseline.md
  mkdirSync(join(root, 'process', 'dora'), { recursive: true });
  writeFileSync(join(root, 'process', 'dora', 'baseline.md'), BASELINE);
  // work/observatory/dora/{flow,per-project}.md
  const proj = join(root, 'work', 'observatory');
  mkdirSync(join(proj, 'dora'), { recursive: true });
  writeFileSync(join(proj, 'dora', 'flow.md'), FLOW);
  writeFileSync(join(proj, 'dora', 'per-project.md'), PERPROJECT);
  // work/observatory/architecture/dependencies/*
  const deps = join(proj, 'architecture', 'dependencies');
  mkdirSync(deps, { recursive: true });
  writeFileSync(join(deps, 'use-case-deps.mmd'), UCDEPS);
  writeFileSync(join(deps, 'class-deps.mmd'), CLASSDEPS);
  writeFileSync(join(deps, 'edge-ledger.md'), EDGELEDGER);
  return root;
}

function app(root) {
  return createApp({ repoRoot: root, extraRouters: [createDoraRouter({ repoRoot: root })] });
}

describe('UC3 DORA/flow/deps endpoints — present files', () => {
  let root;
  beforeEach(() => { root = makeRoot(); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC3.1: GET /api/dora/baseline → 200, exact raw content', async () => {
    const res = await request(app(root)).get('/api/dora/baseline');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: BASELINE });
  });

  it('AC3.2: GET /api/projects/:id/dora/flow → raw, unaltered', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/dora/flow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: FLOW });
  });

  it('GET /api/projects/:id/dora/per-project → raw content', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/dora/per-project');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: PERPROJECT });
  });

  it('AC3.3: GET /api/projects/:id/deps/use-case-deps.mmd → raw mermaid, no parsing', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/deps/use-case-deps.mmd');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: UCDEPS });
  });

  it('GET /api/projects/:id/deps/class-deps.mmd → raw mermaid content', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/deps/class-deps.mmd');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: CLASSDEPS });
  });

  it('GET /api/projects/:id/deps/edge-ledger.md → raw markdown content', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/deps/edge-ledger.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: EDGELEDGER });
  });
});

describe('UC3 fail-soft on missing files (F4 / T-READ-4)', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'obs-dora-empty-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC3.4: missing process/dora/baseline.md → 200 { content: null }', async () => {
    const res = await request(app(root)).get('/api/dora/baseline');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('AC3.5: missing flow.md → 200 { content: null }', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/dora/flow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('AC3.6: missing class-deps.mmd → 200 { content: null }', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/deps/class-deps.mmd');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('missing per-project.md → 200 { content: null }', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/dora/per-project');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('nonexistent project id → 200 { content: null } (no crash)', async () => {
    const res = await request(app(root)).get('/api/projects/nope/dora/flow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });
});

describe('UC3 allowlist / path-traversal guard (AC3.7 / T-READ-12)', () => {
  let root;
  beforeEach(() => { root = makeRoot(); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC3.7: dora artifact off the allowlist → 400, no file read', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/dora/secrets');
    expect(res.status).toBe(400);
    expect(res.body.content).toBeUndefined();
  });

  it('AC3.7: deps artifact off the allowlist → 400', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/deps/passwd');
    expect(res.status).toBe(400);
  });

  it('AC3.7: encoded traversal in deps artifact → 400 or 404, never escapes root', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/deps/..%2F..%2Fetc%2Fpasswd');
    expect([400, 404]).toContain(res.status);
    expect(res.text).not.toMatch(/root:.*:0:0:/); // never leaked /etc/passwd
  });

  it('AC3.7: dot-segment in id does not let dora read outside the dora dir', async () => {
    const res = await request(app(root)).get('/api/projects/observatory/dora/..%2F..%2Fbaseline');
    expect([400, 404]).toContain(res.status);
  });
});

describe('UC3 read-only posture', () => {
  let root;
  beforeEach(() => { root = makeRoot(); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('POST /api/dora/baseline → 404/405 (no write verb registered)', async () => {
    const res = await request(app(root)).post('/api/dora/baseline');
    expect([404, 405]).toContain(res.status);
  });
});
