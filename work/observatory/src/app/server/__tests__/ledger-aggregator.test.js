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
      // DEFECT-007: throughput_per_active_day is null when active_days=0 (the
      // empty case here) — that null is intentional ("—"), not a missing number.
      const QUEUE_FIELDS = new Set(['queue_depth', 'queue_items', 'throughput_per_active_day']);
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

// DEFECT-007 — throughput is a RATE: items per active-day.
// active_days = distinct UTC calendar dates of the stage's contributing rows;
// throughput_per_active_day = throughput / active_days (null when active_days=0).
describe('aggregateStageFlow — throughput rate (DEFECT-007 D7-AC-2/AC-3)', () => {
  it('D7-AC-3: active_days = distinct UTC dates of contributing rows', () => {
    // 3 engineer task_starts across 2 distinct UTC calendar dates
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T08:00:00Z', agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ ts: '2026-06-01T20:00:00Z', agent: 'engineer', event: 'task_start', item: 'B' }),
        row({ ts: '2026-06-02T09:00:00Z', agent: 'engineer', event: 'task_start', item: 'C' }),
      ]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    expect(eng.throughput).toBe(3);
    expect(eng.active_days).toBe(2);
  });

  it('D7-AC-2: throughput_per_active_day = throughput / active_days (float)', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T08:00:00Z', agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ ts: '2026-06-01T20:00:00Z', agent: 'engineer', event: 'task_start', item: 'B' }),
        row({ ts: '2026-06-02T09:00:00Z', agent: 'engineer', event: 'task_start', item: 'C' }),
      ]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    expect(eng.throughput_per_active_day).toBeCloseTo(3 / 2, 2); // 1.5
  });

  it('D7-AC-3: active_days=0 and throughput_per_active_day=null when the stage has no events', () => {
    const out = aggregateStageFlow(csv([]), 'p');
    for (const s of out) {
      expect(s.active_days).toBe(0);
      expect(s.throughput_per_active_day).toBeNull();
    }
  });

  it('keeps the raw integer throughput count alongside the rate', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T08:00:00Z', agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ ts: '2026-06-01T20:00:00Z', agent: 'engineer', event: 'task_start', item: 'B' }),
      ]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    expect(eng.throughput).toBe(2); // integer count preserved
    expect(eng.active_days).toBe(1);
    expect(eng.throughput_per_active_day).toBeCloseTo(2, 2);
  });
});

describe('aggregateStageFlow — WIP (half-open enter = in-flight, AC1.5)', () => {
  // DEFECT-009: WIP is recency-based, so an OPEN in-event must be RECENT relative
  // to the request `now`. We pin a `now` and place the open just minutes before it.
  const NOW = Date.parse('2026-06-10T12:00:00Z');
  const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
  it('counts an item with a RECENT in-event and no matching out-event as WIP', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: minsAgo(15), agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ ts: minsAgo(10), agent: 'engineer', event: 'task_end', item: 'A' }),
        row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'B', note: 'building B' }),
      ]),
      'p',
      null,
      { now: NOW },
    );
    const eng = byStage(out, 'engineer');
    expect(eng.wip).toBe(1);
    expect(eng.wip_items).toEqual([{ item_id: 'B', note: 'building B' }]);
  });

  it('an enter then exit for the same item is NOT WIP', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: minsAgo(9), agent: 'engineer', event: 'stage_enter', item: 'B' }),
        row({ ts: minsAgo(1), agent: 'engineer', event: 'stage_exit', item: 'B' }),
      ]),
      'p',
      null,
      { now: NOW },
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

describe('aggregateStageFlow — dwell_pairs (DEFECT-004 AC-2 "—" signal)', () => {
  it('reports the count of completed dwell pairs so the UI can show "—" when < 2', () => {
    const out = aggregateStageFlow(
      csv([
        row({ agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ agent: 'engineer', event: 'task_end', item: 'A', duration: '100' }),
      ]),
      'p',
    );
    // one completed pair → dwell_pairs 1 (UI renders "—" since < 2)
    expect(byStage(out, 'engineer').dwell_pairs).toBe(1);
  });

  it('dwell_pairs is 0 when no pairs complete (open task only)', () => {
    const out = aggregateStageFlow(
      csv([row({ agent: 'engineer', event: 'task_start', item: 'A' })]),
      'p',
    );
    expect(byStage(out, 'engineer').dwell_pairs).toBe(0);
  });

  it('dwell_pairs counts each completed pair (>=2 → real dwell shown)', () => {
    const out = aggregateStageFlow(
      csv([
        row({ agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ agent: 'engineer', event: 'task_end', item: 'A', duration: '100' }),
        row({ agent: 'engineer', event: 'task_start', item: 'B' }),
        row({ agent: 'engineer', event: 'task_end', item: 'B', duration: '300' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').dwell_pairs).toBe(2);
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

describe('aggregateStageFlow — WIP terminal secondary-check + history (DEFECT-002 → DEFECT-009)', () => {
  // DEFECT-009 reframes DEFECT-002: recency is the PRIMARY gate, the items.csv
  // terminal check is a SECONDARY confirming signal. Opens here are RECENT (a
  // pinned `now`); membership-absence no longer excludes, but terminal still does.
  const NOW = Date.parse('2026-06-10T12:00:00Z');
  const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
  const ITEMS_HEADER =
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
  function itemsCsv(rows) {
    return [ITEMS_HEADER, ...rows.map((r) => `${r.id},use-case,CHK,,job,${r.state},,,,,,`)].join('\n') + '\n';
  }

  it('DEFECT-009: a RECENT open for an item ABSENT from items.csv IS WIP (membership no longer disqualifies)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'CHK-ABSENT', note: 'chunk work' }),
      row({ ts: minsAgo(4), agent: 'engineer', event: 'stage_enter', item: 'UC-LIVE', note: 'uc work' }),
    ]);
    const items = itemsCsv([{ id: 'UC-LIVE', state: 'in-progress' }]); // CHK-ABSENT absent
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip_items).toEqual([
      { item_id: 'CHK-ABSENT', note: 'chunk work' },
      { item_id: 'UC-LIVE', note: 'uc work' },
    ]);
    expect(eng.wip).toBe(2);
  });

  it('recent open for a TERMINAL item (done/dropped/cancelled) is NOT WIP (secondary check)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-DONE' }),
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-DROPPED' }),
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-CANCELLED' }),
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-LIVE', note: 'live' }),
    ]);
    const items = itemsCsv([
      { id: 'UC-DONE', state: 'done' },
      { id: 'UC-DROPPED', state: 'dropped' },
      { id: 'UC-CANCELLED', state: 'cancelled' },
      { id: 'UC-LIVE', state: 'ready' },
    ]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip_items).toEqual([{ item_id: 'UC-LIVE', note: 'live' }]);
  });

  it('recent open for a present, non-terminal item IS WIP', () => {
    const ledger = csv([row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-A', note: 'a' })]);
    const items = itemsCsv([{ id: 'UC-A', state: 'active' }]);
    expect(byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer').wip_items)
      .toEqual([{ item_id: 'UC-A', note: 'a' }]);
  });

  it('missing/empty items.csv → recency-only path (fail-soft, never throw)', () => {
    const ledger = csv([row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-A', note: 'a' })]);
    expect(() => aggregateStageFlow(ledger, 'p', null, { now: NOW })).not.toThrow();
    expect(byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'engineer').wip_items)
      .toEqual([{ item_id: 'UC-A', note: 'a' }]);
  });

  it('throughput/dwell/rework are historical and NOT reconciled (only WIP is "now")', () => {
    const ledger = csv([
      row({ ts: '2026-06-01T00:00:00Z', agent: 'engineer', event: 'task_start', item: 'UC-DROPPED' }),
      row({ ts: '2026-06-01T00:10:00Z', agent: 'engineer', event: 'task_end', item: 'UC-DROPPED', duration: '600' }),
    ]);
    const items = itemsCsv([{ id: 'UC-DROPPED', state: 'dropped' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
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

describe('aggregateStageFlow — source_events (DEFECT-005 readable traceability)', () => {
  it('emits a readable source_event {ts,agent,event,item_id} per contributing row alongside source_rows', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-09T14:36:00Z', agent: 'engineer', event: 'task_start', item: 'UC-S001-1' }),
        row({ ts: '2026-06-09T14:50:00Z', agent: 'engineer', event: 'task_end', item: 'UC-S001-1', duration: '840' }),
      ]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    expect(Array.isArray(eng.source_events)).toBe(true);
    // the task_start (throughput in-event) AND its closing task_end both contribute
    expect(eng.source_events.length).toBeGreaterThanOrEqual(2);
    const start = eng.source_events.find((e) => e.event === 'task_start');
    expect(start).toMatchObject({
      ts: '2026-06-09T14:36:00Z',
      agent: 'engineer',
      event: 'task_start',
      item_id: 'UC-S001-1',
    });
    // source_rows is still present (audit hook / existing tests rely on it)
    expect(Array.isArray(eng.source_rows)).toBe(true);
    expect(eng.source_rows.length).toBe(eng.source_events.length);
    // source_total mirrors how many contributing events exist
    expect(eng.source_total).toBe(eng.source_events.length);
  });

  it('DEFECT-008: source_events carry the ledger note (the human "why"), not just the id', () => {
    const out = aggregateStageFlow(
      csv([
        row({
          ts: '2026-06-09T14:50:00Z',
          agent: 'product',
          event: 'task_start',
          item: 'SLC-vision',
          note: 'Gate-1 vision: JTBD + success measures authored',
        }),
      ]),
      'p',
    );
    const dec = byStage(out, 'decompose');
    const e = dec.source_events.find((x) => x.item_id === 'SLC-vision');
    expect(e).toMatchObject({
      ts: '2026-06-09T14:50:00Z',
      agent: 'product',
      event: 'task_start',
      item_id: 'SLC-vision',
      note: 'Gate-1 vision: JTBD + success measures authored',
    });
  });

  it('DEFECT-008: a comma-rich note survives into the source_event note field', () => {
    const out = aggregateStageFlow(
      csv([
        row({
          ts: '2026-06-09T14:50:00Z',
          agent: 'engineer',
          event: 'task_start',
          item: 'UC-X',
          note: 'note with, embedded, commas',
        }),
      ]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    const e = eng.source_events.find((x) => x.item_id === 'UC-X');
    expect(e.note).toBe('note with, embedded, commas');
  });

  it('DEFECT-008: an empty note yields note "" (never undefined) so the UI can fall back', () => {
    const out = aggregateStageFlow(
      csv([row({ ts: '2026-06-09T14:50:00Z', agent: 'engineer', event: 'task_start', item: 'UC-Y' })]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    const e = eng.source_events.find((x) => x.item_id === 'UC-Y');
    expect(e.note).toBe('');
  });

  it('empty stage → source_events [] and source_total 0 (never null)', () => {
    const out = aggregateStageFlow(csv([]), 'p');
    for (const s of out) {
      expect(Array.isArray(s.source_events)).toBe(true);
      expect(s.source_events).toEqual([]);
      expect(s.source_total).toBe(0);
    }
  });

  it('source_events carry NO bare "row:N" content — the values are real ledger fields', () => {
    const out = aggregateStageFlow(
      csv([row({ ts: '2026-06-09T14:36:00Z', agent: 'engineer', event: 'task_start', item: 'UC-X' })]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    for (const e of eng.source_events) {
      expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof e.agent).toBe('string');
      expect(typeof e.event).toBe('string');
      expect(String(e.event)).not.toMatch(/^row:/);
    }
  });

  it('caps source_events at the server cap but reports the true source_total when capped', () => {
    const rows = [];
    for (let i = 0; i < 85; i++) {
      rows.push(row({ ts: `2026-06-09T14:${String(i % 60).padStart(2, '0')}:00Z`, agent: 'engineer', event: 'task_start', item: `UC-${i}` }));
    }
    const eng = byStage(aggregateStageFlow(csv(rows), 'p'), 'engineer');
    expect(eng.throughput).toBe(85);
    expect(eng.source_total).toBe(85);
    expect(eng.source_events.length).toBeLessThanOrEqual(50);
  });
});

describe('aggregateStageFlow — REAL ledger (real-data gate, not a fixture)', () => {
  const realLedger = readFileSync(join(repoRoot, 'process', 'dora', 'ledger.csv'), 'utf8');
  const realItems = readFileSync(
    join(repoRoot, 'work', 'observatory', 'items', 'items.csv'),
    'utf8',
  );

  it('DEFECT-002/009: stale orphans UC-S003-2/3/4 are NOT in engineer.wip_items (excluded by recency)', () => {
    // Pass a realistic request `now` (well after the real ledger rows were written).
    const out = aggregateStageFlow(realLedger, 'observatory', realItems, { now: Date.now() });
    const eng = byStage(out, 'engineer');
    const wipIds = eng.wip_items.map((w) => w.item_id);
    for (const phantom of ['UC-S003-2', 'UC-S003-3', 'UC-S003-4']) {
      expect(wipIds).not.toContain(phantom);
    }
    // DEFECT-009: WIP is recency-bounded — every wip entry must be a recent open.
    // Each entry is a {item_id, note} object (DEFECT-008 shape).
    for (const w of eng.wip_items) {
      expect(typeof w.item_id).toBe('string');
      expect(typeof w.note).toBe('string');
    }
  });

  it('returns non-empty plausible build throughput for observatory (>= UCs delivered)', () => {
    const out = aggregateStageFlow(realLedger, 'observatory');
    const eng = byStage(out, 'engineer');
    expect(eng.throughput).toBeGreaterThanOrEqual(8);
    expect(eng.source_rows.length).toBeGreaterThan(0);
  });

  it('DEFECT-005: real engineer source_events are readable ledger fields (not row:N), capped with a true total', () => {
    const eng = byStage(aggregateStageFlow(realLedger, 'observatory'), 'engineer');
    expect(eng.source_events.length).toBeGreaterThan(0);
    expect(eng.source_total).toBeGreaterThanOrEqual(eng.source_events.length);
    for (const e of eng.source_events) {
      expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(e.agent).toBe('engineer');
      expect(typeof e.event).toBe('string');
      expect(String(e.event)).not.toMatch(/^row:/);
    }
  });

  it('DEFECT-008: real source_events carry a populated note for at least some events', () => {
    const out = aggregateStageFlow(realLedger, 'observatory');
    const allEvents = out.flatMap((s) => s.source_events);
    expect(allEvents.length).toBeGreaterThan(0);
    // every source_event has a string note field (never undefined)
    for (const e of allEvents) expect(typeof e.note).toBe('string');
    // and at least one carries real human context
    expect(allEvents.some((e) => e.note.trim().length > 0)).toBe(true);
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

  // DEFECT-007 D7-AC-7 — basis coherence: the engineer-stage active_days denominator
  // MUST equal the number of distinct UTC calendar dates of task_start rows for
  // agent=engineer in the live ledger (same basis dora.py uses for deploy-frequency).
  it('D7-AC-7: engineer active_days == distinct UTC dates of engineer task_start rows', () => {
    const eng = byStage(aggregateStageFlow(realLedger, 'observatory'), 'engineer');
    const distinctDates = new Set(
      realLedger
        .split('\n')
        .filter((l) => l.includes(',observatory,') && l.includes(',engineer,task_start,'))
        .map((l) => l.split(',')[0].slice(0, 10)),
    );
    expect(eng.active_days).toBe(distinctDates.size);
    expect(eng.active_days).toBeGreaterThanOrEqual(1);
    // and the rate is the count divided by that denominator
    expect(eng.throughput_per_active_day).toBeCloseTo(eng.throughput / eng.active_days, 2);
  });
});

// DEFECT-009 — WIP is recency-based, NOT items.csv-membership-based.
// Ruling: work/observatory/slices/s009-wip-recency/ruling.md (ACs a-f).
// @covers AGG (server/lib/ledgerAggregator.js)
describe('aggregateStageFlow — WIP recency rule (DEFECT-009)', () => {
  const NOW = Date.parse('2026-06-10T12:00:00Z');
  // age helpers relative to NOW
  const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
  const ITEMS_HEADER =
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
  function itemsCsv(rows) {
    return [ITEMS_HEADER, ...rows.map((r) => `${r.id},use-case,CHK,,job,${r.state},,,,,,`)].join('\n') + '\n';
  }

  it('D9-AC-a: recent product task_start on a chunk/slice/meta id (absent from items.csv) IS Decompose WIP', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'product', event: 'task_start', item: 'CHK-2', note: 'slice-next: s009 wip-recency' }),
    ]);
    const items = itemsCsv([{ id: 'UC-OTHER', state: 'ready' }]); // CHK-2 absent
    const dec = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'decompose');
    expect(dec.wip).toBe(1);
    expect(dec.wip_items).toEqual([{ item_id: 'CHK-2', note: 'slice-next: s009 wip-recency' }]);
  });

  it('D9-AC-b: a stale orphan stage_enter (3h old, DEFECT-002 pattern) is NOT WIP', () => {
    const ledger = csv([
      row({ ts: minsAgo(180), agent: 'engineer', event: 'stage_enter', item: 'UC-S003-2' }),
    ]);
    const items = itemsCsv([]); // UC-S003-2 absent (removed when CHK-3 dropped)
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(0);
    expect(eng.wip_items.map((w) => w.item_id)).not.toContain('UC-S003-2');
  });

  it('D9-AC-c: a recent open whose item went terminal (state=done) is NOT WIP', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'task_start', item: 'UC-X-1' }),
    ]);
    const items = itemsCsv([{ id: 'UC-X-1', state: 'done' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(0);
    expect(eng.wip_items.map((w) => w.item_id)).not.toContain('UC-X-1');
  });

  it('D9-AC-d: a recent engineer task_start IS engineer WIP=1 (regression guard)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'task_start', item: 'UC-LIVE', note: 'build cycle' }),
    ]);
    const items = itemsCsv([{ id: 'UC-LIVE', state: 'ready' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(1);
    expect(eng.wip_items).toEqual([{ item_id: 'UC-LIVE', note: 'build cycle' }]);
  });

  it('D9-AC-e: no items.csv → recency-only path, recent open counts, no error', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'task_start', item: 'CHK-9', note: 'chunk work' }),
    ]);
    expect(() => aggregateStageFlow(ledger, 'p', null, { now: NOW })).not.toThrow();
    const eng = byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(1);
    expect(eng.wip_items).toEqual([{ item_id: 'CHK-9', note: 'chunk work' }]);
  });

  it('D9-AC-f: wip_items entries are {item_id, note} objects (note from open row, "" when blank)', () => {
    const ledger = csv([
      row({ ts: minsAgo(2), agent: 'engineer', event: 'task_start', item: 'CHK-1', note: '' }),
    ]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'engineer');
    expect(eng.wip_items).toHaveLength(1);
    const entry = eng.wip_items[0];
    expect(entry).toEqual({ item_id: 'CHK-1', note: '' });
    expect(typeof entry.item_id).toBe('string');
    expect(typeof entry.note).toBe('string');
  });

  it('priority: an open exactly at the horizon boundary (30 min) is still WIP; 31 min is stale', () => {
    const recent = csv([row({ ts: minsAgo(30), agent: 'engineer', event: 'task_start', item: 'CHK-EDGE' })]);
    const stale = csv([row({ ts: minsAgo(31), agent: 'engineer', event: 'task_start', item: 'CHK-EDGE' })]);
    expect(byStage(aggregateStageFlow(recent, 'p', null, { now: NOW }), 'engineer').wip).toBe(1);
    expect(byStage(aggregateStageFlow(stale, 'p', null, { now: NOW }), 'engineer').wip).toBe(0);
  });
});
