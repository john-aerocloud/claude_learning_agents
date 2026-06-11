// @covers AGG_LEDGER
// @covers uc-s015-1
// UC-S015-1 — ADDITIVE stage-flow fields for the WIP navigation panel:
//   wip_horizon_ms : the live recency horizon (S15-1-WIP-1 — the panel must read
//                    it from the source, never hard-code 2h client-side)
//   open_items     : ALL unmatched open in-events for the stage, REGARDLESS of
//                    age — {item_id, note, opened_at, dwell_ms, stale}. The WIP
//                    headline (wip/wip_items) stays recency-only (DEFECT-010/011
//                    unchanged); the NAVIGATION panel is precisely where stale
//                    opens must NOT vanish (S15-1-WIP-2), so they ship here with
//                    a stale flag instead of being dropped.
// Purely additive — no existing field changes, no aggregator restructure.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from './helpers.js';
import {
  aggregateStageFlow,
  CANONICAL_STAGES,
  WIP_STALENESS_HORIZON_MS,
} from '../lib/ledgerAggregator.js';

const HEADER =
  'timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue';

const NOW = Date.parse('2026-06-11T12:00:00Z');

describe('aggregateStageFlow — open_items + wip_horizon_ms (UC-S015-1, additive)', () => {
  it('exports the live horizon and stamps it on every stage (S15-1-WIP-1)', () => {
    const out = aggregateStageFlow(HEADER + '\n', 'p', null, { now: NOW });
    expect(WIP_STALENESS_HORIZON_MS).toBe(2 * 60 * 60 * 1000); // DEFECT-011 source of truth
    expect(out).toHaveLength(CANONICAL_STAGES.length);
    for (const s of out) {
      expect(s.wip_horizon_ms).toBe(WIP_STALENESS_HORIZON_MS);
      expect(Array.isArray(s.open_items)).toBe(true);
    }
  });

  it('a RECENT open task_start appears in BOTH wip_items and open_items (stale=false, dwell_ms = now-open)', () => {
    const ledger =
      HEADER +
      '\n2026-06-11T11:45:00Z,p,1,s,engineer,task_start,,na,,build x,UC-1,engineer\n';
    const eng = aggregateStageFlow(ledger, 'p', null, { now: NOW }).find(
      (s) => s.stage === 'engineer',
    );
    expect(eng.wip).toBe(1);
    expect(eng.open_items).toEqual([
      {
        item_id: 'UC-1',
        note: 'build x',
        opened_at: '2026-06-11T11:45:00Z',
        dwell_ms: 15 * 60 * 1000,
        stale: false,
      },
    ]);
  });

  it('an open OLDER than the horizon is DROPPED from wip_items but PRESENT in open_items with stale=true (S15-1-WIP-2)', () => {
    const ledger =
      HEADER +
      '\n2026-06-11T06:00:00Z,p,1,s,engineer,task_start,,na,,build old,CHK-9,engineer\n';
    const eng = aggregateStageFlow(ledger, 'p', null, { now: NOW }).find(
      (s) => s.stage === 'engineer',
    );
    expect(eng.wip).toBe(0); // recency headline unchanged (DEFECT-010/011)
    expect(eng.open_items).toEqual([
      {
        item_id: 'CHK-9',
        note: 'build old',
        opened_at: '2026-06-11T06:00:00Z',
        dwell_ms: 6 * 60 * 60 * 1000,
        stale: true,
      },
    ]);
  });

  it('a CLOSED pair never appears in open_items', () => {
    const ledger =
      HEADER +
      '\n2026-06-11T11:00:00Z,p,1,s,engineer,task_start,,na,,build,UC-2,engineer' +
      '\n2026-06-11T11:30:00Z,p,1,s,engineer,task_end,1800,success,,build done,UC-2,engineer\n';
    const eng = aggregateStageFlow(ledger, 'p', null, { now: NOW }).find(
      (s) => s.stage === 'engineer',
    );
    expect(eng.open_items).toEqual([]);
  });

  it('an open row with an unparseable-for-dwell timestamp fails soft to dwell_ms=null, stale=false (FIG-3 source case)', () => {
    // parseLedger requires a leading ISO date to accept the line, so drive the
    // domain directly with a NaN `now` — dwell becomes uncomputable → null.
    const ledger =
      HEADER +
      '\n2026-06-11T11:45:00Z,p,1,s,engineer,task_start,,na,,build x,UC-1,engineer\n';
    const eng = aggregateStageFlow(ledger, 'p', null, { now: Number.NaN }).find(
      (s) => s.stage === 'engineer',
    );
    expect(eng.open_items).toHaveLength(1);
    expect(eng.open_items[0].dwell_ms).toBeNull();
    expect(eng.open_items[0].stale).toBe(false);
  });
});

describe('GET /api/projects/:id/stage-flow — additive fields over HTTP (UC-S015-1)', () => {
  let root;
  let server;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-openitems-'));
    ({ server } = createTestServer({ repoRoot: root, skipWatcher: true }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('every stage object carries wip_horizon_ms + open_items; a stale open ships flagged, not dropped', async () => {
    mkdirSync(join(root, 'process', 'dora'), { recursive: true });
    writeFileSync(
      join(root, 'process', 'dora', 'ledger.csv'),
      HEADER +
        '\n2026-06-11T06:00:00Z,p,1,s,tester,task_start,,na,,validate stuck,UC-OLD,validate\n',
    );
    const prev = process.env.OBSERVATORY_NOW;
    process.env.OBSERVATORY_NOW = '2026-06-11T12:00:00Z';
    try {
      const res = await request(server).get('/api/projects/p/stage-flow');
      expect(res.status).toBe(200);
      for (const s of res.body) {
        expect(s.wip_horizon_ms).toBe(WIP_STALENESS_HORIZON_MS);
        expect(Array.isArray(s.open_items)).toBe(true);
      }
      const validate = res.body.find((s) => s.stage === 'validate');
      expect(validate.wip).toBe(0); // headline recency unchanged
      expect(validate.open_items.map((o) => o.item_id)).toEqual(['UC-OLD']);
      expect(validate.open_items[0].stale).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OBSERVATORY_NOW;
      else process.env.OBSERVATORY_NOW = prev;
    }
  });
});
