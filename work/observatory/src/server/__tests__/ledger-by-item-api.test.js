// @covers R_LEDGER — HTTP adapter: GET /api/projects/:id/ledger?item_id=<id> (UC-S005-1)
// Acceptance over HTTP: AC-S005-1-1 .. AC-S005-1-6.
//
// Independence (§39): the router is injected via createApp's extraRouters seam
// (the UC1/UC2/stage-flow pattern). This test touches no other router file and
// does not depend on compose.js. It writes throwaway ledgers under a temp
// repoRoot for the fixture cases (read-only posture, never mutates the real
// process/dora/ledger.csv).
//
// PARSER REUSE (AC-S005-1-6, OI-S004): the route imports the SHARED tolerant
// parseLedger from lib/ledgerAggregator.js — NOT the strict parsers/csv.js. A
// strict csv parser swallows rows whose `note` carries an unescaped comma/quote
// (e.g. UC-S001-1's parallel_dispatch row), undercounting real history.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { createLedgerRouter } from '../routes/ledger.js';

const HEADER =
  'timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue';

// Absolute path to the REAL ledger, resolved relative to this test file so it
// works regardless of CWD. __tests__ → server → src → observatory → work → root,
// then process/dora/ledger.csv (five levels up).
const REAL_LEDGER = join(
  fileURLToPath(new URL('../../../../../process/dora/ledger.csv', import.meta.url)),
);

function makeApp(root) {
  return createApp({ repoRoot: root, extraRouters: [createLedgerRouter({ repoRoot: root })] });
}
function writeLedger(root, body) {
  mkdirSync(join(root, 'process', 'dora'), { recursive: true });
  writeFileSync(join(root, 'process', 'dora', 'ledger.csv'), body);
}

describe('GET /api/projects/:id/ledger?item_id=<id>', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-ledger-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-S005-1-1 known item returns 200 + JSON array of typed rows', async () => {
    writeLedger(
      root,
      HEADER +
        '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,REF,started,UC-1,build\n' +
        '2026-06-01T00:05:00Z,p,1,s,engineer,task_end,300,success,REF,done,UC-1,build\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=UC-1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    for (const row of res.body) {
      expect(typeof row.timestamp).toBe('string');
      expect(typeof row.event).toBe('string');
      expect(typeof row.agent).toBe('string');
      expect(typeof row.outcome).toBe('string');
      expect(row.item_id).toBe('UC-1');
    }
  });

  it('AC-S005-1-2 unknown item returns 200 with [] (not 404, not 500)', async () => {
    writeLedger(
      root,
      HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,REF,n,UC-1,build\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=NONEXISTENT-999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('AC-S005-1-2b absent item_id query param returns 200 with []', async () => {
    writeLedger(
      root,
      HEADER + '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,REF,n,UC-1,build\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/ledger');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('AC-S005-1-3 rows ordered newest-first', async () => {
    writeLedger(
      root,
      HEADER +
        '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,R,oldest,UC-1,build\n' +
        '2026-06-03T00:00:00Z,p,1,s,engineer,task_end,,success,R,newest,UC-1,build\n' +
        '2026-06-02T00:00:00Z,p,1,s,tester,note,,na,R,middle,UC-1,build\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=UC-1');
    const ts = res.body.map((r) => r.timestamp);
    expect(ts).toEqual([
      '2026-06-03T00:00:00Z',
      '2026-06-02T00:00:00Z',
      '2026-06-01T00:00:00Z',
    ]);
  });

  it('AC-S005-1-4 tolerant parser — comment/blank lines do not crash or appear as rows', async () => {
    writeLedger(
      root,
      '# a leading comment line\n' +
        HEADER +
        '\n\n' +
        '2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,R,n,UC-1,build\n' +
        '# trailing comment\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=UC-1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('AC-S005-1-4b malformed note (unescaped comma + quote) does not drop the row', async () => {
    writeLedger(
      root,
      HEADER +
        '\n2026-06-01T00:00:00Z,p,1,s,flow-manager,parallel_dispatch,,na,R,"batch=UC-1 achieved=1, max=1 (scaffold)",UC-1,ready\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=UC-1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].item_id).toBe('UC-1');
  });

  it('AC-S005-1-5 header-only ledger returns [] without a 5xx', async () => {
    writeLedger(root, HEADER + '\n');
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=UC-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('missing ledger file (soft) returns 200 with []', async () => {
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=UC-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rows are scoped to the :id project (does not bleed across projects)', async () => {
    writeLedger(
      root,
      HEADER +
        '\n2026-06-01T00:00:00Z,p,1,s,engineer,task_start,,na,R,n,UC-1,build\n' +
        '2026-06-01T00:00:00Z,other,1,s,engineer,task_start,,na,R,n,UC-1,build\n',
    );
    const res = await request(makeApp(root)).get('/api/projects/p/ledger?item_id=UC-1');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].project).toBe('p');
  });

  it('AC-S005-1-1 [REAL-DATA] live ledger: item_id=UC-S001-1 returns >= 1 row newest-first', async () => {
    const raw = readFileSync(REAL_LEDGER, 'utf8');
    // Drive the route against a repoRoot that points at the REAL ledger.
    const realRoot = mkdtempSync(join(tmpdir(), 'obs-ledger-real-'));
    writeLedger(realRoot, raw);
    const res = await request(makeApp(realRoot)).get(
      '/api/projects/observatory/ledger?item_id=UC-S001-1',
    );
    rmSync(realRoot, { recursive: true, force: true });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    for (const r of res.body) expect(r.item_id).toBe('UC-S001-1');
    // newest-first: timestamps are non-increasing
    const times = res.body.map((r) => Date.parse(r.timestamp));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });
});

// AC-S005-1-6 — no second ledger parser introduced. Static assertion on source.
describe('AC-S005-1-6 no second ledger parser', () => {
  it('routes/ledger.js imports the shared tolerant parser, not csv.js / csv-parse', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../routes/ledger.js', import.meta.url)),
      'utf8',
    );
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(imports.some((l) => /ledgerAggregator/.test(l))).toBe(true);
    expect(imports.some((l) => /parsers\/csv/.test(l))).toBe(false);
    expect(imports.some((l) => /csv-parse/.test(l))).toBe(false);
  });
});
