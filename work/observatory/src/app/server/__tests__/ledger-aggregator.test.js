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

  // DEFECT (found by D7-AC-7 on the live ledger, 2026-06-12): active_days was
  // derived from ALL contributing rows (incl. stage_enter/task_end), so a
  // stage_enter on a calendar date with NO task_start inflated the denominator
  // and broke basis coherence with dora.py (which counts task_start dates).
  // Pin: the denominator is the distinct UTC dates of the THROUGHPUT in-events
  // (task_start for the engineer stage) — other row kinds never add a day.
  it('D7-AC-7 (basis coherence): a stage_enter on a new date does NOT add an active day', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T08:00:00Z', agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ ts: '2026-06-01T20:00:00Z', agent: 'engineer', event: 'task_start', item: 'B' }),
        // a resumed stage on a later date — WIP in-event, NOT a throughput in-event
        row({ ts: '2026-06-02T09:00:00Z', agent: 'engineer', event: 'stage_enter', item: 'B' }),
        // and a close on a third date — also not a throughput in-event
        row({ ts: '2026-06-03T10:00:00Z', agent: 'engineer', event: 'task_end', item: 'A' }),
      ]),
      'p',
    );
    const eng = byStage(out, 'engineer');
    expect(eng.throughput).toBe(2); // task_start only (AC1.4 — unchanged)
    expect(eng.active_days).toBe(1); // 2026-06-01 only — the task_start basis
    expect(eng.throughput_per_active_day).toBeCloseTo(2, 2);
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

describe('aggregateStageFlow — WIP recency-only + history (DEFECT-002 → DEFECT-009 → DEFECT-010)', () => {
  // DEFECT-010 ruling (recency-only): the items.csv terminal SECONDARY check is
  // DROPPED entirely. A recent open with no close IS WIP regardless of the item's
  // registry state. Recency alone excludes the DEFECT-002 phantoms (hours old).
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

  it('DEFECT-010: recent open for a TERMINAL item (done/dropped/cancelled) IS WIP (terminal check dropped)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-DONE', note: 'd' }),
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-DROPPED', note: 'x' }),
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-CANCELLED', note: 'c' }),
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-LIVE', note: 'live' }),
    ]);
    const items = itemsCsv([
      { id: 'UC-DONE', state: 'done' },
      { id: 'UC-DROPPED', state: 'dropped' },
      { id: 'UC-CANCELLED', state: 'cancelled' },
      { id: 'UC-LIVE', state: 'ready' },
    ]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(4);
    expect(eng.wip_items).toEqual([
      { item_id: 'UC-DONE', note: 'd' },
      { item_id: 'UC-DROPPED', note: 'x' },
      { item_id: 'UC-CANCELLED', note: 'c' },
      { item_id: 'UC-LIVE', note: 'live' },
    ]);
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

  // D9-AC-c ("a recent open whose item went terminal is NOT WIP") is OVERTURNED
  // by the DEFECT-010 ruling (recency-only) and is intentionally removed here.
  // Its replacement is D10-AC-a / D10-AC-d below (terminal item → recent open IS WIP).

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

  // DEFECT-011: horizon raised 30 min → 2 h (the 30-min premise was falsified
  // by real 29–32-min tasks). Boundary re-pinned at 120/121 min.
  it('priority: an open exactly at the horizon boundary (120 min) is still WIP; 121 min is stale', () => {
    const recent = csv([row({ ts: minsAgo(120), agent: 'engineer', event: 'task_start', item: 'CHK-EDGE' })]);
    const stale = csv([row({ ts: minsAgo(121), agent: 'engineer', event: 'task_start', item: 'CHK-EDGE' })]);
    expect(byStage(aggregateStageFlow(recent, 'p', null, { now: NOW }), 'engineer').wip).toBe(1);
    expect(byStage(aggregateStageFlow(stale, 'p', null, { now: NOW }), 'engineer').wip).toBe(0);
  });
});

// DEFECT-010 — RECENCY-ONLY WIP: the items.csv terminal/registry exclusion is
// DROPPED from the WIP path entirely. A recent open in-event (no matching close)
// IS in-flight regardless of the item's registry state. Recency alone excludes
// the DEFECT-002 phantoms (they are hours/days old).
// Ruling: work/observatory/slices/s012-wip-recency-only/ruling.md (D10-AC-a..h).
// @covers AGG (server/lib/ledgerAggregator.js)
describe('aggregateStageFlow — WIP recency-only rule (DEFECT-010)', () => {
  const NOW = Date.parse('2026-06-10T12:00:00Z');
  const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
  const ITEMS_HEADER =
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
  function itemsCsv(rows) {
    return [ITEMS_HEADER, ...rows.map((r) => `${r.id},use-case,CHK,,job,${r.state},,,,,,`)].join('\n') + '\n';
  }

  it('D10-AC-a: recent open on a DONE item IS WIP=1 (the DEFECT-010 regression case)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-S004-5', note: 'rework on delivered UC' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S004-5', state: 'done' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(1);
    expect(eng.wip_items).toEqual([{ item_id: 'UC-S004-5', note: 'rework on delivered UC' }]);
  });

  // DEFECT-011: stale threshold is now the 2 h horizon — ages here sit past it.
  it('D10-AC-b: a STALE open (>2 h) on ANY item is NOT WIP (DEFECT-002 regression guard)', () => {
    const ledger = csv([
      row({ ts: minsAgo(180), agent: 'engineer', event: 'stage_enter', item: 'UC-S003-2' }),
      row({ ts: minsAgo(121), agent: 'product', event: 'task_start', item: 'CHK-2' }),
    ]);
    const items = itemsCsv([{ id: 'CHK-2', state: 'done' }]); // UC-S003-2 absent
    const out = aggregateStageFlow(ledger, 'p', items, { now: NOW });
    expect(byStage(out, 'engineer').wip).toBe(0);
    expect(byStage(out, 'decompose').wip).toBe(0);
    expect(byStage(out, 'engineer').wip_items.map((w) => w.item_id)).not.toContain('UC-S003-2');
  });

  it('D10-AC-c: recent product open on a chunk IS Decompose WIP=1 (DEFECT-009 regression guard)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'product', event: 'task_start', item: 'CHK-2', note: 'slice-next' }),
    ]);
    const items = itemsCsv([{ id: 'CHK-2', state: 'done' }]); // terminal — must still count
    const dec = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'decompose');
    expect(dec.wip).toBe(1);
    expect(dec.wip_items).toEqual([{ item_id: 'CHK-2', note: 'slice-next' }]);
  });

  it('D10-AC-d: recent engineer open on a DONE UC IS build WIP=1', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-S004-5', note: 'build' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S004-5', state: 'done' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(1);
    expect(eng.wip_items.map((w) => w.item_id)).toContain('UC-S004-5');
  });

  it('D10-AC-e: recent cicd open on a DONE chunk IS capabilities WIP=1', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'cicd', event: 'task_start', item: 'CHK-1', note: 'allowlist' }),
    ]);
    const items = itemsCsv([{ id: 'CHK-1', state: 'done' }]);
    const cap = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'capabilities');
    expect(cap.wip).toBe(1);
    expect(cap.wip_items).toEqual([{ item_id: 'CHK-1', note: 'allowlist' }]);
  });

  it('D10-AC-f: a recent open with a matching close is NOT WIP (regardless of item state)', () => {
    const ledger = csv([
      row({ ts: minsAgo(9), agent: 'engineer', event: 'task_start', item: 'UC-S004-5' }),
      row({ ts: minsAgo(2), agent: 'engineer', event: 'task_end', item: 'UC-S004-5' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S004-5', state: 'done' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(0);
    expect(eng.wip_items.map((w) => w.item_id)).not.toContain('UC-S004-5');
  });

  it('D10-AC-g: no items.csv / itemRegistry arg → recent open counts, no error (fail-soft)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-S004-5', note: 'no registry' }),
    ]);
    expect(() => aggregateStageFlow(ledger, 'p', null, { now: NOW })).not.toThrow();
    const eng = byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(1);
    expect(eng.wip_items).toEqual([{ item_id: 'UC-S004-5', note: 'no registry' }]);
  });

  it('D10-AC-h: wip_items entries are {item_id, note} (note from open row, "" when blank)', () => {
    const ledger = csv([
      row({ ts: minsAgo(2), agent: 'engineer', event: 'task_start', item: 'UC-S004-5', note: '' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S004-5', state: 'done' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.wip_items).toHaveLength(1);
    const entry = eng.wip_items[0];
    expect(entry).toEqual({ item_id: 'UC-S004-5', note: '' });
    expect(typeof entry.item_id).toBe('string');
    expect(typeof entry.note).toBe('string');
  });
});

// DEFECT-011 — the staleness horizon itself was too short. The 30-min value was
// justified by "real agent tasks complete in single-digit minutes" — FALSIFIED:
// a product task (REPLENISH-CHK6) ran past 30 min and vanished from Decompose
// WIP while genuinely still running; the engineer task alongside it ran 29 min
// and would have vanished at minute 30 too. The horizon must comfortably exceed
// REAL task durations (observed max ~29 min, growing) while still excluding the
// hours-old DEFECT-002 phantoms. Horizon is now 2 HOURS. Recency stays the ONLY
// gate (EXP-035 craft rule: no new exclusions).
// @covers AGG (server/lib/ledgerAggregator.js)
describe('aggregateStageFlow — WIP horizon covers real task durations (DEFECT-011)', () => {
  const NOW = Date.parse('2026-06-10T16:14:00Z');
  const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();

  it('D11-AC-a: a 32-min-old product task_start with no close IS Decompose WIP=1 (the reported case)', () => {
    // Repro of the live evidence: task_start REPLENISH-CHK6/CHK-6 at 15:42:04Z,
    // still running at ~16:14Z (32 min) — dashboard showed WIP=0.
    const ledger = csv([
      row({ ts: minsAgo(32), agent: 'product', event: 'task_start', item: 'CHK-6', note: 'REPLENISH-CHK6' }),
    ]);
    const dec = byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'decompose');
    expect(dec.wip).toBe(1);
    expect(dec.wip_items).toEqual([{ item_id: 'CHK-6', note: 'REPLENISH-CHK6' }]);
  });

  it('D11-AC-b: a 90-min-old engineer open with no close IS build WIP=1 (long real task, within horizon)', () => {
    const ledger = csv([
      row({ ts: minsAgo(90), agent: 'engineer', event: 'task_start', item: 'UC-LONG', note: 'long build' }),
    ]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(1);
  });

  it('D11-AC-c: an hours-old orphan open is STILL NOT WIP (DEFECT-002 stays fixed)', () => {
    const ledger = csv([
      row({ ts: minsAgo(180), agent: 'engineer', event: 'stage_enter', item: 'UC-S003-2' }),
    ]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'engineer');
    expect(eng.wip).toBe(0);
    expect(eng.wip_items.map((w) => w.item_id)).not.toContain('UC-S003-2');
  });

  it('D11-AC-d: horizon boundary — exactly 120 min is WIP; 121 min is stale', () => {
    const recent = csv([row({ ts: minsAgo(120), agent: 'engineer', event: 'task_start', item: 'CHK-EDGE' })]);
    const stale = csv([row({ ts: minsAgo(121), agent: 'engineer', event: 'task_start', item: 'CHK-EDGE' })]);
    expect(byStage(aggregateStageFlow(recent, 'p', null, { now: NOW }), 'engineer').wip).toBe(1);
    expect(byStage(aggregateStageFlow(stale, 'p', null, { now: NOW }), 'engineer').wip).toBe(0);
  });
});

// DEFECT-013 — the board SELF-SURFACES registry/ledger drift instead of waiting
// for a human report. A RECENT open in-event (within the WIP horizon) whose
// item_id maps to an items.csv record in a NOT-being-worked state (planned/
// ready), or to no record at all where one is expected (UC-/DEF-/CHK-/SLC-
// prefixed), or is not item-shaped at all (a slice slug — EXP-040 item_id
// discipline violated), extends that stage's coherence_warning with a terse
// human-meaningful reason. This is a WARNING ONLY: the WIP count stays
// recency-only (DEFECT-009/010/011 — no new exclusions, EXP-035).
// @covers AGG (server/lib/ledgerAggregator.js)
describe('aggregateStageFlow — registry-coherence warning on recent opens (DEFECT-013)', () => {
  const NOW = Date.parse('2026-06-12T16:25:00Z');
  const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
  const ITEMS_HEADER =
    'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
  function itemsCsv(rows) {
    return [ITEMS_HEADER, ...rows.map((r) => `${r.id},use-case,CHK,,job,${r.state},,,,,,`)].join('\n') + '\n';
  }

  it('D13-AC-1: recent open whose items.csv state is planned ⇒ warning text, WIP UNCHANGED (the live repro)', () => {
    // Repro of 2026-06-12 16:2x: tester validating UC-S014-4 in prod while the
    // registry still said planned — drift was silent until a human grepped.
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'tester', event: 'stage_enter', item: 'UC-S014-4', note: 'validation start' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S014-4', state: 'planned' }]);
    const val = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'validate');
    expect(val.coherence_warning).toBe(true);
    expect(val.coherence_warnings).toContain('UC-S014-4 open in validate but registry says planned');
    // WARNING, not exclusion — recency-only stays the headline gate.
    expect(val.wip).toBe(1);
    expect(val.wip_items).toEqual([{ item_id: 'UC-S014-4', note: 'validation start' }]);
  });

  it('D13-AC-2: recent open whose items.csv state is ready ⇒ warning (registry claims not-being-worked)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-S013-3', note: 'build' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S013-3', state: 'ready' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.coherence_warning).toBe(true);
    expect(eng.coherence_warnings).toContain('UC-S013-3 open in engineer but registry says ready');
    expect(eng.wip).toBe(1);
  });

  it('D13-AC-3: recent open keyed by a slice SLUG (not a work item) ⇒ slug warning, WIP unchanged (the live repro)', () => {
    // Repro: tester self-recorded its validate stage_enter against the slice
    // slug s014-steer-prompt-handoff instead of UC-S014-4 (EXP-040 violation).
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'tester', event: 'stage_enter', item: 's014-steer-prompt-handoff', note: 'validation start' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S014-4', state: 'in-flight' }]);
    const val = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'validate');
    expect(val.coherence_warning).toBe(true);
    expect(val.coherence_warnings).toContain(
      's014-steer-prompt-handoff open in validate: open event keyed by slug, not a work item',
    );
    expect(val.wip).toBe(1);
  });

  it('D13-AC-4: recent open on an item-shaped id (UC-/DEF-/CHK-/SLC-) ABSENT from items.csv ⇒ absent warning', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'DEF-099', note: 'defect fix' }),
    ]);
    const items = itemsCsv([{ id: 'UC-OTHER', state: 'in-flight' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.coherence_warning).toBe(true);
    expect(eng.coherence_warnings).toContain('DEF-099 open in engineer but absent from items.csv');
    expect(eng.wip).toBe(1);
  });

  it('D13-AC-5: coherent case — recent open whose registry state is in-flight ⇒ NO warning', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-S013-3', note: 'build' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S013-3', state: 'in-flight' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.coherence_warning).toBe(false);
    expect(eng.coherence_warnings).toEqual([]);
    expect(eng.wip).toBe(1);
  });

  it('D13-AC-6: recent open on a DONE item ⇒ NO drift warning (DEFECT-010 — rework on delivered is legitimate)', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-S004-5', note: 'rework' }),
    ]);
    const items = itemsCsv([{ id: 'UC-S004-5', state: 'done' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.coherence_warning).toBe(false);
    expect(eng.coherence_warnings).toEqual([]);
    expect(eng.wip).toBe(1); // DEFECT-010 stays fixed
  });

  it('D13-AC-7: a STALE open (>2 h) on a planned item ⇒ NO warning (the recency horizon gates the check too)', () => {
    const ledger = csv([
      row({ ts: minsAgo(180), agent: 'engineer', event: 'stage_enter', item: 'UC-OLD' }),
    ]);
    const items = itemsCsv([{ id: 'UC-OLD', state: 'planned' }]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', items, { now: NOW }), 'engineer');
    expect(eng.coherence_warning).toBe(false);
    expect(eng.coherence_warnings).toEqual([]);
    expect(eng.wip).toBe(0);
  });

  it('D13-AC-8: no items.csv ⇒ no drift warnings (fail-soft), WIP unchanged', () => {
    const ledger = csv([
      row({ ts: minsAgo(5), agent: 'engineer', event: 'stage_enter', item: 'UC-X', note: 'no registry' }),
    ]);
    const eng = byStage(aggregateStageFlow(ledger, 'p', null, { now: NOW }), 'engineer');
    expect(eng.coherence_warning).toBe(false);
    expect(eng.coherence_warnings).toEqual([]);
    expect(eng.wip).toBe(1);
  });

  it('D13-AC-9: DEFECT-004 queue mismatch now also carries a readable reason in coherence_warnings', () => {
    const items = itemsCsv([{ id: 'UC-R1', state: 'ready' }, { id: 'UC-R2', state: 'ready' }]);
    const queues = { ready: 'item_id,enqueued_ts,value,cost,note\nUC-R1,2026-06-12T16:00:00Z,,,\n' };
    const ready = byStage(aggregateStageFlow(csv([]), 'p', items, { now: NOW, queues }), 'ready');
    expect(ready.coherence_warning).toBe(true);
    expect(ready.coherence_warnings.length).toBeGreaterThan(0);
    expect(ready.coherence_warnings[0]).toContain('ready');
  });

  it('D13-AC-10: every stage carries coherence_warnings as an array (empty when coherent)', () => {
    const out = aggregateStageFlow(csv([]), 'p');
    for (const s of out) expect(s.coherence_warnings).toEqual([]);
  });
});
