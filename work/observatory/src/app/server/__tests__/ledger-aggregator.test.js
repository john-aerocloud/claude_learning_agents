// UC-S004-1 — ledger aggregator (domain) unit tests.
// (a) Controlled fixtures pin the aggregation MATH: throughput, dwell median,
//     WIP (incl. a half-open enter→WIP case), rework. Known rows → known numbers.
// (b) One test runs against the REAL process/dora/ledger.csv asserting non-empty,
//     plausible output (the real-data gate; fixture-only green is not done).
//
// @covers AGG (server/lib/ledgerAggregator.js)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateStageFlow, CANONICAL_STAGES, parseLedger } from '../lib/ledgerAggregator.js';

// From server/__tests__/ go up: server → app → src → observatory → work → repo root
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..', '..');

// Build a CSV the same way the real ledger is shaped (header + rows).
const HEADER =
  'timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue';
function csv(rows) {
  return [HEADER, ...rows.map((r) => r.join(','))].join('\n') + '\n';
}
// helper: a row as the 12 columns, defaulting blanks.
function row({ ts = '2026-06-01T00:00:00Z', project = 'p', agent, event, duration = '', outcome = '', ref = '', note = '', item = '', queue = '' }) {
  return [ts, project, '', '', agent, event, duration, outcome, ref, note, item, queue];
}

function byStage(result, key) {
  return result.find((s) => s.stage === key);
}

describe('parseLedger — tolerant line parser (real ledger is malformed CSV)', () => {
  it('parses fixed prefix + trailing item_id/queue with comma-rich note in the middle', () => {
    const text =
      HEADER +
      '\n2026-06-01T00:00:00Z,p,1,s1,engineer,task_start,238,pass,REF-1,note with, embedded, commas,UC-X,ready\n';
    const rows = parseLedger(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      timestamp: '2026-06-01T00:00:00Z',
      project: 'p',
      agent: 'engineer',
      event: 'task_start',
      duration_s: '238',
      outcome: 'pass',
      item_id: 'UC-X',
      queue: 'ready',
    });
    expect(rows[0].note).toContain('embedded');
  });

  it('strips CR (CRLF ledgers) and skips blank/short lines without throwing', () => {
    const text = HEADER + '\r\n2026-06-01T00:00:00Z,p,1,s1,tester,task_start,,,,n,UC-Y,\r\n\r\ngarbage\n';
    const rows = parseLedger(text);
    expect(rows.some((r) => r.agent === 'tester' && r.queue === '')).toBe(true);
  });

  it('recovers rows that the strict CSV parser would swallow via an unbalanced quote', () => {
    const text =
      HEADER +
      '\n2026-06-01T00:00:00Z,p,1,s1,engineer,task_end,100,pass,REF,commit 1715807",UC-A,\n' +
      '\n2026-06-01T00:05:00Z,p,1,s1,engineer,task_start,,na,,next build,UC-B,\n';
    const rows = parseLedger(text);
    const starts = rows.filter((r) => r.agent === 'engineer' && r.event === 'task_start');
    expect(starts).toHaveLength(1);
    expect(starts[0].item_id).toBe('UC-B');
  });
});

describe('aggregateStageFlow — shape contract', () => {
  it('returns one entry per canonical stage in flow order, all zeros when empty', () => {
    const out = aggregateStageFlow(csv([]), 'p');
    expect(out.map((s) => s.stage)).toEqual(CANONICAL_STAGES.map((s) => s.stage));
    for (const s of out) {
      expect(s).toMatchObject({
        stage: expect.any(String),
        label: expect.any(String),
        throughput: 0,
        dwell_median_s: 0,
        wip: 0,
        rework: 0,
      });
      expect(Array.isArray(s.source_rows)).toBe(true);
      expect(Array.isArray(s.wip_items)).toBe(true);
      // Historical fields are never null; queue fields are null on work stages
      // (DEFECT-004 — null = "not a queue"), so they are excluded from this sweep.
      const QUEUE_FIELDS = new Set(['queue_depth', 'queue_items']);
      for (const [k, v] of Object.entries(s)) {
        if (!QUEUE_FIELDS.has(k)) expect(v).not.toBeNull();
      }
    }
  });

  it('never throws on a missing / non-string ledger; returns all-zero stages', () => {
    expect(() => aggregateStageFlow(null, 'p')).not.toThrow();
    expect(() => aggregateStageFlow(undefined, 'p')).not.toThrow();
    expect(aggregateStageFlow('', 'p')).toHaveLength(CANONICAL_STAGES.length);
  });
});

describe('aggregateStageFlow — throughput (engineer = task_start count, AC1.4)', () => {
  it('counts engineer task_start rows as build throughput', () => {
    const out = aggregateStageFlow(
      csv([
        row({ agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ agent: 'engineer', event: 'task_start', item: 'B' }),
        row({ agent: 'engineer', event: 'stage_enter', item: 'C' }), // not a throughput in-event
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').throughput).toBe(2);
  });

  it('filters by project — other projects do not contribute', () => {
    const out = aggregateStageFlow(
      csv([
        row({ project: 'p', agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ project: 'other', agent: 'engineer', event: 'task_start', item: 'X' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').throughput).toBe(1);
  });
});

describe('aggregateStageFlow — WIP (half-open enter = in-flight, AC1.5)', () => {
  it('counts an item with an in-event and no matching out-event as WIP', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T00:00:00Z', agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ ts: '2026-06-01T00:10:00Z', agent: 'engineer', event: 'task_end', item: 'A' }),
        row({ ts: '2026-06-01T00:05:00Z', agent: 'engineer', event: 'stage_enter', item: 'B' }),
      ]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    expect(eng.wip).toBe(1);
    expect(eng.wip_items).toEqual(['B']);
  });

  it('an enter then exit for the same item is NOT WIP', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T00:00:00Z', agent: 'engineer', event: 'stage_enter', item: 'B' }),
        row({ ts: '2026-06-01T00:09:00Z', agent: 'engineer', event: 'stage_exit', item: 'B' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').wip).toBe(0);
    expect(byStage(out, 'engineer').wip_items).toEqual([]);
  });
});

describe('aggregateStageFlow — dwell median (AC1.6)', () => {
  it('medians completed-pair durations from duration_s when present', () => {
    const out = aggregateStageFlow(
      csv([
        row({ agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ agent: 'engineer', event: 'task_end', item: 'A', duration: '100' }),
        row({ agent: 'engineer', event: 'task_start', item: 'B' }),
        row({ agent: 'engineer', event: 'task_end', item: 'B', duration: '300' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').dwell_median_s).toBe(200);
  });

  it('computes dwell from timestamps when duration_s is absent', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T00:00:00Z', agent: 'engineer', event: 'stage_enter', item: 'A' }),
        row({ ts: '2026-06-01T00:01:00Z', agent: 'engineer', event: 'stage_exit', item: 'A' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').dwell_median_s).toBe(60);
  });

  it('odd-count median is the middle value', () => {
    const out = aggregateStageFlow(
      csv([
        row({ agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ agent: 'engineer', event: 'task_end', item: 'A', duration: '10' }),
        row({ agent: 'engineer', event: 'task_start', item: 'B' }),
        row({ agent: 'engineer', event: 'task_end', item: 'B', duration: '50' }),
        row({ agent: 'engineer', event: 'task_start', item: 'C' }),
        row({ agent: 'engineer', event: 'task_end', item: 'C', duration: '90' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').dwell_median_s).toBe(50);
  });
});

describe('aggregateStageFlow — rework (failure/recovery, AC, may be 0)', () => {
  it('counts failure and recovery events for the stage', () => {
    const out = aggregateStageFlow(
      csv([
        row({ agent: 'engineer', event: 'failure', item: 'A' }),
        row({ agent: 'engineer', event: 'recovery', item: 'A' }),
        row({ agent: 'engineer', event: 'task_start', item: 'A' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').rework).toBe(2);
  });
});

describe('aggregateStageFlow — other stage mappings', () => {
  it('maps decompose→product, validate→tester, capabilities→cicd, deploy→deploy events', () => {
    const out = aggregateStageFlow(
      csv([
        row({ agent: 'product', event: 'task_start', item: 'A' }),
        row({ agent: 'tester', event: 'task_start', item: 'A' }),
        row({ agent: 'cicd', event: 'task_start', item: 'A' }),
        row({ agent: 'orchestrator', event: 'deploy', outcome: 'success', item: 'A' }),
        row({ agent: 'flow-manager', event: 'enqueue', queue: 'intake', item: 'A' }),
        row({ agent: 'flow-manager', event: 'enqueue', queue: 'ready', item: 'A' }),
      ]),
      'p',
    );
    expect(byStage(out, 'decompose').throughput).toBe(1);
    expect(byStage(out, 'validate').throughput).toBe(1);
    expect(byStage(out, 'capabilities').throughput).toBe(1);
    expect(byStage(out, 'deploy').throughput).toBe(1);
    expect(byStage(out, 'done').throughput).toBe(1);
    expect(byStage(out, 'intake').throughput).toBe(1);
    expect(byStage(out, 'ready').throughput).toBe(1);
  });

  it('tolerates ragged rows (comma-shifted note) without throwing', () => {
    const raw =
      HEADER +
      '\n2026-06-01T00:00:00Z,p,,,engineer,task_end,238,,,"start:check exit 0; scaffold, seam",,\n';
    expect(() => aggregateStageFlow(raw, 'p')).not.toThrow();
  });
});

describe('aggregateStageFlow — WIP reconciliation against items.csv (DEFECT-002)', () => {
  const ITEMS_HEADER =
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
  function itemsCsv(rows) {
    return [ITEMS_HEADER, ...rows.map((r) => `${r.id},use-case,CHK,,job,${r.state},,,,,,`)].join('\n') + '\n';
  }

  it('open enter for an item ABSENT from items.csv is NOT WIP (phantom dropped work)', () => {
    const ledger = csv([
      row({ agent: 'engineer', event: 'stage_enter', item: 'UC-S003-2' }),
      row({ agent: 'engineer', event: 'stage_enter', item: 'UC-LIVE' }),
    ]);
    const items = itemsCsv([{ id: 'UC-LIVE', state: 'in-progress' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items), 'engineer');
    expect(eng.wip_items).toEqual(['UC-LIVE']);
    expect(eng.wip).toBe(1);
  });

  it('open enter for a TERMINAL item (done/dropped/cancelled) is NOT WIP', () => {
    const ledger = csv([
      row({ agent: 'engineer', event: 'stage_enter', item: 'UC-DONE' }),
      row({ agent: 'engineer', event: 'stage_enter', item: 'UC-DROPPED' }),
      row({ agent: 'engineer', event: 'stage_enter', item: 'UC-CANCELLED' }),
      row({ agent: 'engineer', event: 'stage_enter', item: 'UC-LIVE' }),
    ]);
    const items = itemsCsv([
      { id: 'UC-DONE', state: 'done' },
      { id: 'UC-DROPPED', state: 'dropped' },
      { id: 'UC-CANCELLED', state: 'cancelled' },
      { id: 'UC-LIVE', state: 'ready' },
    ]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items), 'engineer');
    expect(eng.wip_items).toEqual(['UC-LIVE']);
  });

  it('open enter for a present, non-terminal item IS WIP', () => {
    const ledger = csv([row({ agent: 'engineer', event: 'stage_enter', item: 'UC-A' })]);
    const items = itemsCsv([{ id: 'UC-A', state: 'active' }]);
    expect(byStage(aggregateStageFlow(ledger, 'p', items), 'engineer').wip_items).toEqual(['UC-A']);
  });

  it('missing/empty items.csv → fall back to raw open-enter (fail-soft, never throw)', () => {
    const ledger = csv([row({ agent: 'engineer', event: 'stage_enter', item: 'UC-A' })]);
    expect(() => aggregateStageFlow(ledger, 'p', null)).not.toThrow();
    expect(byStage(aggregateStageFlow(ledger, 'p', null), 'engineer').wip_items).toEqual(['UC-A']);
    expect(byStage(aggregateStageFlow(ledger, 'p'), 'engineer').wip_items).toEqual(['UC-A']);
  });

  it('throughput/dwell/rework are historical and NOT reconciled (only WIP is "now")', () => {
    const ledger = csv([
      row({ ts: '2026-06-01T00:00:00Z', agent: 'engineer', event: 'task_start', item: 'UC-DROPPED' }),
      row({ ts: '2026-06-01T00:10:00Z', agent: 'engineer', event: 'task_end', item: 'UC-DROPPED', duration: '600' }),
    ]);
    const items = itemsCsv([{ id: 'UC-DROPPED', state: 'dropped' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items), 'engineer');
    expect(eng.throughput).toBe(1);
    expect(eng.dwell_median_s).toBe(600);
    expect(eng.wip).toBe(0);
  });
});

describe('aggregateStageFlow — queue current-state (DEFECT-004 §3/§4)', () => {
  const ITEMS_HEADER =
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
  function itemsCsv(rows) {
    return [ITEMS_HEADER, ...rows.map((r) => `${r.id},use-case,CHK,,job,${r.state},,,,,,`)].join('\n') + '\n';
  }
  const QUEUE_HEADER = 'item_id,enqueued_ts,value,cost,vc_ratio,position,reason';
  function queueCsv(rows) {
    return [QUEUE_HEADER, ...rows.map((r) => `${r.id},${r.enqueued_ts},MED,2,1.00,1,reason`)].join('\n') + '\n';
  }
  // 2026-06-10T15:00:00Z as the request "now" so wait_s is deterministic.
  const NOW = Date.parse('2026-06-10T15:00:00Z');

  it('work stages carry queue_depth=null and queue_items=null (not a queue)', () => {
    const out = aggregateStageFlow(csv([]), 'p', null, { now: NOW });
    const eng = byStage(out, 'engineer');
    expect(eng.queue_depth).toBeNull();
    expect(eng.queue_items).toBeNull();
  });

  it('buffer stage with no queue data → queue_depth 0, queue_items []', () => {
    const out = aggregateStageFlow(csv([]), 'p', null, { now: NOW });
    const ready = byStage(out, 'ready');
    expect(ready.queue_depth).toBe(0);
    expect(ready.queue_items).toEqual([]);
  });

  it('queue_depth counts live queue rows; queue_items carry id/enqueued_at/wait_s (AC-3/AC-5)', () => {
    const items = itemsCsv([
      { id: 'UC-A', state: 'ready' },
      { id: 'UC-B', state: 'ready' },
    ]);
    const queues = {
      ready: queueCsv([
        { id: 'UC-A', enqueued_ts: '2026-06-10T14:00:00Z' }, // 1h wait
        { id: 'UC-B', enqueued_ts: '2026-06-10T13:00:00Z' }, // 2h wait
      ]),
    };
    const ready = byStage(aggregateStageFlow(csv([]), 'p', items, { queues, now: NOW }), 'ready');
    expect(ready.queue_depth).toBe(2);
    expect(ready.queue_items.map((q) => q.item_id)).toEqual(['UC-A', 'UC-B']);
    const a = ready.queue_items.find((q) => q.item_id === 'UC-A');
    expect(a.enqueued_at).toBe('2026-06-10T14:00:00Z');
    expect(a.wait_s).toBe(3600);
    expect(ready.queue_items.find((q) => q.item_id === 'UC-B').wait_s).toBe(7200);
  });

  it('STALE queue entry (items.csv state done) is excluded from depth AND queue_items (AC-4)', () => {
    const items = itemsCsv([
      { id: 'UC-DONE', state: 'done' },
      { id: 'UC-LIVE', state: 'ready' },
    ]);
    const queues = {
      ready: queueCsv([
        { id: 'UC-DONE', enqueued_ts: '2026-06-10T14:00:00Z' },
        { id: 'UC-LIVE', enqueued_ts: '2026-06-10T14:00:00Z' },
      ]),
    };
    const ready = byStage(aggregateStageFlow(csv([]), 'p', items, { queues, now: NOW }), 'ready');
    expect(ready.queue_depth).toBe(1);
    expect(ready.queue_items.map((q) => q.item_id)).toEqual(['UC-LIVE']);
  });

  it('coherence_warning false when queue depth equals items.csv ready-count for the stage (AC-6)', () => {
    const items = itemsCsv([
      { id: 'UC-A', state: 'ready' },
      { id: 'UC-B', state: 'ready' },
    ]);
    const queues = {
      ready: queueCsv([
        { id: 'UC-A', enqueued_ts: '2026-06-10T14:00:00Z' },
        { id: 'UC-B', enqueued_ts: '2026-06-10T14:00:00Z' },
      ]),
    };
    const ready = byStage(aggregateStageFlow(csv([]), 'p', items, { queues, now: NOW }), 'ready');
    expect(ready.coherence_warning).toBe(false);
  });

  it('coherence_warning true when items.csv has a ready item NOT in the queue CSV (AC-6 mismatch)', () => {
    // 3 ready in items.csv, only 2 queued → mismatch surfaced, not hidden.
    const items = itemsCsv([
      { id: 'UC-A', state: 'ready' },
      { id: 'UC-B', state: 'ready' },
      { id: 'UC-C', state: 'ready' },
    ]);
    const queues = {
      ready: queueCsv([
        { id: 'UC-A', enqueued_ts: '2026-06-10T14:00:00Z' },
        { id: 'UC-B', enqueued_ts: '2026-06-10T14:00:00Z' },
      ]),
    };
    const ready = byStage(aggregateStageFlow(csv([]), 'p', items, { queues, now: NOW }), 'ready');
    expect(ready.queue_depth).toBe(2);
    expect(ready.coherence_warning).toBe(true);
  });

  it('never throws when queues option is malformed/absent (fail-soft)', () => {
    expect(() => aggregateStageFlow(csv([]), 'p', null, { queues: { ready: null } })).not.toThrow();
    expect(() => aggregateStageFlow(csv([]), 'p', null, {})).not.toThrow();
    expect(() => aggregateStageFlow(csv([]), 'p')).not.toThrow();
  });
});

describe('aggregateStageFlow — REAL ledger (real-data gate, not a fixture)', () => {
  const realLedger = readFileSync(join(repoRoot, 'process', 'dora', 'ledger.csv'), 'utf8');
  const realItems = readFileSync(
    join(repoRoot, 'work', 'observatory', 'items', 'items.csv'),
    'utf8',
  );

  it('DEFECT-002: UC-S003-2/3/4 (absent from items.csv) are NOT in engineer.wip_items', () => {
    const out = aggregateStageFlow(realLedger, 'observatory', realItems);
    const eng = byStage(out, 'engineer');
    for (const phantom of ['UC-S003-2', 'UC-S003-3', 'UC-S003-4']) {
      expect(eng.wip_items).not.toContain(phantom);
    }
    const live = new Set(
      realItems
        .split('\n')
        .slice(1)
        .map((l) => l.split(','))
        .filter((c) => c.length > 5 && !['done', 'dropped', 'cancelled'].includes(c[5]))
        .map((c) => c[0]),
    );
    for (const id of eng.wip_items) expect(live.has(id)).toBe(true);
  });

  it('returns non-empty plausible build throughput for observatory (>= UCs delivered)', () => {
    const out = aggregateStageFlow(realLedger, 'observatory');
    const eng = byStage(out, 'engineer');
    expect(eng.throughput).toBeGreaterThanOrEqual(8);
    expect(eng.source_rows.length).toBeGreaterThan(0);
  });

  it('every canonical stage is present even on the real ledger', () => {
    const out = aggregateStageFlow(realLedger, 'observatory');
    expect(out.map((s) => s.stage)).toEqual(CANONICAL_STAGES.map((s) => s.stage));
  });

  it('wip is a non-negative integer (in-flight items countable, not an error)', () => {
    const out = aggregateStageFlow(realLedger, 'observatory');
    for (const s of out) {
      expect(Number.isInteger(s.wip)).toBe(true);
      expect(s.wip).toBeGreaterThanOrEqual(0);
    }
  });
});
