// @covers uc-s013-1
// @covers R_DEFECTS — HTTP adapter: GET /api/projects/:id/defects (UC-S013-1)
// @covers LIB_DEFECTS — pure domain aggregation (md parse + ledger MTTR pairing)
//
// Defects read endpoint: union of work/<project>/defects/DEFECT-*.md records
// and ledger failure/recovery rows paired by ref (DEFECT-NNN). Ground truth
// for MTTR is the ledger span failure→first recovery; an unmatched failure is
// an OPEN defect, not an error. Acceptance: AC-S013-1-1 .. AC-S013-1-9.
//
// PARSER REUSE: the route uses the SHARED tolerant parseLedger from
// lib/ledgerAggregator.js (READ-ONLY reuse — that module is not modified).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from './helpers.js';

const HEADER =
  'timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue';

// Real repo root — 6 levels up: server/__tests__ → server → app → src → observatory → work → root
const REAL_ROOT = dirname(
  fileURLToPath(new URL('../../../../../../package.json', import.meta.url)),
);

function writeLedger(root, body) {
  mkdirSync(join(root, 'process', 'dora'), { recursive: true });
  writeFileSync(join(root, 'process', 'dora', 'ledger.csv'), body);
}

function writeDefect(root, project, filename, body) {
  const dir = join(root, 'work', project, 'defects');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), body);
}

// --- Fixture defect files (the three real structural shapes in the live set) ---

// Shape 1 (DEFECT-001..008/010 style): inline header line + ## Four fields bullets.
const DEFECT_001_MD = `# DEFECT-001 — UI shows zero everywhere

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** HIGH (core observe job)

## Resolution
Mounted the value-stream map as primary. Commits \`3d8c21c\`, \`82a622c\`.

## Four fields
- **Expected:** Opening the UI shows real, non-zero pipeline state.
- **Actual:** The UI shows 0 for everything.
- **Intent:** Watch the pipeline live.
- **Importance:** Core job fully blocked.

## Classification (§5a)
Our bug — product/UI design + incomplete slice.

## Root cause (latent)
Deployed primary view measures the wrong thing.
`;

// Shape 2 (DEFECT-012 style): own-line Status, no Severity, four fields as H2 sections.
const DEFECT_003_MD = `# DEFECT-003 — decomposed work invisible in handoff

**Reported:** 2026-06-10 (human)
**Status:** confirmed → fix scheduled (next pickup)

## Expected
Produced items appear somewhere visible immediately.

## Actual
The items appear nowhere until the sweep.

## Intent
See where every piece of work is at all times.

## Importance
Data-trust on the core job.
`;

// Shape 3 (DEFECT-009 style): header says CONFIRMED, later "## Status: CLOSED" heading.
const DEFECT_004_MD = `# DEFECT-004 — product WIP invisible

**Reported:** 2026-06-10 · **Status:** CONFIRMED · **Severity:** MED-HIGH (observe completeness)

## Four fields
- **Expected:** In-flight product work visible.
- **Actual:** Product WIP shows zero.
- **Intent:** Trust the WIP figure.
- **Importance:** Completeness of the map.

## Status: CLOSED (fixed + verified)
Recency-based WIP shipped.
`;

const FIXTURE_LEDGER =
  HEADER +
  '\n' +
  // DEFECT-001: failure → two recoveries (FIRST one closes the MTTR clock: 815 s)
  '2026-06-10T06:17:47Z,p,4,s,orchestrator,failure,,fail,DEFECT-001,UI shows 0 everywhere,UC-1,\n' +
  '2026-06-10T06:31:22Z,p,4,s,engineer,recovery,,pass,DEFECT-001,map mounted as primary,UC-1,\n' +
  '2026-06-10T09:00:00Z,p,4,s,cicd,recovery,,pass,DEFECT-001,second recovery row must be ignored,UC-1,\n' +
  // DEFECT-003: failure with NO recovery → open
  '2026-06-10T07:52:11Z,p,5,s,orchestrator,failure,,fail,DEFECT-003,handoff buffer invisible,UC-2,\n' +
  // DEFECT-002: ledger-only (no md file) failure → recovery
  '2026-06-10T08:00:00Z,p,5,s,orchestrator,failure,,fail,DEFECT-002,horizon hides long tasks,UC-3,\n' +
  '2026-06-10T08:11:07Z,p,5,s,engineer,recovery,,pass,DEFECT-002,horizon widened,UC-3,\n' +
  // Non-defect failure ref → must NOT appear as a defect
  '2026-06-10T08:30:00Z,p,5,s,orchestrator,failure,,fail,INFRA-STALL-3X,agents stalled at watchdog,,\n' +
  // Same defect id in ANOTHER project → must not bleed into p
  '2026-06-10T01:00:00Z,otherproj,1,s,orchestrator,failure,,fail,DEFECT-009,other project defect,,\n';

describe('GET /api/projects/:id/defects (UC-S013-1)', () => {
  let root;
  let server;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-defects-'));
    writeLedger(root, FIXTURE_LEDGER);
    writeDefect(root, 'p', 'DEFECT-001-ui-shows-zero.md', DEFECT_001_MD);
    writeDefect(root, 'p', 'DEFECT-003-handoff-invisible.md', DEFECT_003_MD);
    writeDefect(root, 'p', 'DEFECT-004-product-wip.md', DEFECT_004_MD);
    ({ server } = createTestServer({ repoRoot: root, skipWatcher: true }));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-S013-1-1 returns 200 + application/json + a JSON array', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('unions md files with ledger-only defect refs, sorted ascending by id', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    // 3 md files (001, 003, 004) + 1 ledger-only (002); INFRA-STALL excluded.
    expect(res.body.map((d) => d.id)).toEqual([
      'DEFECT-001',
      'DEFECT-002',
      'DEFECT-003',
      'DEFECT-004',
    ]);
  });

  it('AC-S013-1-3 parses status, severity, title and four fields from the md record', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    const d1 = res.body.find((d) => d.id === 'DEFECT-001');
    expect(d1.status).toBe('CLOSED');
    expect(d1.severity).toBe('HIGH');
    expect(d1.title).toBe('UI shows zero everywhere');
    expect(d1.expected).toMatch(/non-zero pipeline state/);
    expect(d1.actual).toMatch(/shows 0 for everything/);
    expect(d1.intent).toMatch(/Watch the pipeline live/);
    expect(d1.importance).toMatch(/Core job fully blocked/);
    expect(d1.classification).toMatch(/Our bug/);
    expect(d1.root_cause).toMatch(/wrong thing/);
    expect(d1.resolution_text).toMatch(/Mounted the value-stream map/);
  });

  it('extracts fix shas from the resolution as a human-readable list', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    const d1 = res.body.find((d) => d.id === 'DEFECT-001');
    expect(d1.fix_sha).toBe('3d8c21c, 82a622c');
  });

  it('AC-S013-1-4/5/6 joins ledger: reported_ts, FIRST recovery, mttr_s with units field', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    const d1 = res.body.find((d) => d.id === 'DEFECT-001');
    expect(d1.reported_ts).toBe('2026-06-10T06:17:47Z');
    expect(d1.recovered_ts).toBe('2026-06-10T06:31:22Z'); // first recovery, not the 09:00 one
    expect(d1.mttr_s).toBe(815);
    expect(d1.mttr_units).toBe('s');
  });

  it('AC-S013-1-7 unmatched failure is an OPEN defect: recovered_ts/mttr_s are null, not 0', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    const d3 = res.body.find((d) => d.id === 'DEFECT-003');
    expect(d3.status).toBe('CONFIRMED'); // own-line "confirmed → fix scheduled"
    expect(d3.reported_ts).toBe('2026-06-10T07:52:11Z');
    expect(d3.recovered_ts).toBeNull();
    expect(d3.mttr_s).toBeNull();
  });

  it('parses four fields from H2-section shape (DEFECT-012 style); missing severity is null', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    const d3 = res.body.find((d) => d.id === 'DEFECT-003');
    expect(d3.severity).toBeNull();
    expect(d3.expected).toMatch(/visible immediately/);
    expect(d3.actual).toMatch(/appear nowhere/);
    expect(d3.intent).toMatch(/every piece of work/);
    expect(d3.importance).toMatch(/Data-trust/);
  });

  it('a later "## Status: CLOSED" heading overrides the header status (DEFECT-009 shape)', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    const d4 = res.body.find((d) => d.id === 'DEFECT-004');
    expect(d4.status).toBe('CLOSED');
    expect(d4.severity).toBe('MED-HIGH');
  });

  it('a ledger-only defect (no md file) appears with ledger-derived status and note as title', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    const d2 = res.body.find((d) => d.id === 'DEFECT-002');
    expect(d2.status).toBe('CLOSED'); // recovery row exists
    expect(d2.title).toBe('horizon hides long tasks'); // failure note, human-meaningful
    expect(d2.reported_ts).toBe('2026-06-10T08:00:00Z');
    expect(d2.recovered_ts).toBe('2026-06-10T08:11:07Z');
    expect(d2.mttr_s).toBe(667);
    // file-derived fields degrade to null, not undefined / 5xx
    expect(d2.expected).toBeNull();
    expect(d2.resolution_text).toBeNull();
  });

  it('non-DEFECT failure refs (INFRA-STALL-3X) are not defects', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    expect(res.body.some((d) => /INFRA/.test(d.id))).toBe(false);
  });

  it('ledger rows are scoped to the :id project (no cross-project bleed)', async () => {
    const res = await request(server).get('/api/projects/p/defects');
    expect(res.body.some((d) => d.id === 'DEFECT-009')).toBe(false);
  });

  it('AC-S013-1-8 ?id= filter: unknown defect id returns [], known id returns just that one', async () => {
    const missing = await request(server).get('/api/projects/p/defects?id=DEFECT-999');
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual([]);
    const one = await request(server).get('/api/projects/p/defects?id=DEFECT-001');
    expect(one.body).toHaveLength(1);
    expect(one.body[0].id).toBe('DEFECT-001');
  });

  it('AC-S013-1-9 malformed/minimal stub file degrades to nulls; other records intact; no 5xx', async () => {
    writeDefect(root, 'p', 'DEFECT-099-stub.md', 'not even a heading\n');
    const res = await request(server).get('/api/projects/p/defects');
    expect(res.status).toBe(200);
    const stub = res.body.find((d) => d.id === 'DEFECT-099');
    expect(stub).toBeDefined();
    expect(stub.status).toBeNull(); // no status anywhere: file silent, no ledger rows
    expect(stub.severity).toBeNull();
    expect(res.body.find((d) => d.id === 'DEFECT-001').status).toBe('CLOSED');
  });

  it('missing defects dir AND missing ledger returns 200 with [] (fail soft)', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'obs-defects-bare-'));
    const { server: bareServer } = createTestServer({ repoRoot: bare, skipWatcher: true });
    const res = await request(bareServer).get('/api/projects/p/defects');
    rmSync(bare, { recursive: true, force: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// --- EXP-033: real-data pins against the LIVE repo (read-only). Only immutable
// historical ledger rows / closed records are asserted, so appends cannot break these.
describe('GET /api/projects/observatory/defects [REAL-DATA]', () => {
  let server;
  beforeEach(() => {
    ({ server } = createTestServer({ repoRoot: REAL_ROOT, skipWatcher: true }));
  });

  it('live DEFECT-001: CLOSED, HIGH, ledger MTTR 815 s (06:17:47Z → 06:31:22Z)', async () => {
    const res = await request(server).get('/api/projects/observatory/defects?id=DEFECT-001');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const d1 = res.body[0];
    expect(d1.status).toBe('CLOSED');
    expect(d1.severity).toBe('HIGH');
    expect(d1.reported_ts).toBe('2026-06-10T06:17:47Z');
    expect(d1.recovered_ts).toBe('2026-06-10T06:31:22Z');
    expect(d1.mttr_s).toBeGreaterThanOrEqual(810);
    expect(d1.mttr_s).toBeLessThanOrEqual(820);
    expect(d1.fix_sha).toMatch(/3d8c21c/);
  });

  it('live DEFECT-011 (ledger-only, no md file): present with MTTR 667 s', async () => {
    const res = await request(server).get('/api/projects/observatory/defects?id=DEFECT-011');
    expect(res.body).toHaveLength(1);
    const d11 = res.body[0];
    expect(d11.status).toBe('CLOSED');
    expect(d11.reported_ts).toBe('2026-06-10T16:16:50Z');
    expect(d11.recovered_ts).toBe('2026-06-10T16:27:57Z');
    expect(d11.mttr_s).toBe(667);
    expect(d11.title).toMatch(/recency horizon/i); // failure note, not a bare ref
  });

  it('live lineage: DEFECT-001..DEFECT-012 all present', async () => {
    const res = await request(server).get('/api/projects/observatory/defects');
    const ids = res.body.map((d) => d.id);
    for (let n = 1; n <= 12; n++) {
      expect(ids).toContain(`DEFECT-${String(n).padStart(3, '0')}`);
    }
    expect(res.body.length).toBeGreaterThanOrEqual(12);
  });
});
