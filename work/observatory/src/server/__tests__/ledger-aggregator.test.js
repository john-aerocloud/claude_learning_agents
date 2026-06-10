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

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..');

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
    // A stray double-quote in one note must NOT consume the following rows.
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
      // No field null/undefined.
      for (const v of Object.values(s)) expect(v).not.toBeNull();
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
        // A: completed pair → not WIP
        row({ ts: '2026-06-01T00:00:00Z', agent: 'engineer', event: 'task_start', item: 'A' }),
        row({ ts: '2026-06-01T00:10:00Z', agent: 'engineer', event: 'task_end', item: 'A' }),
        // B: half-open → WIP (in-flight, pulled but not done — the key fix)
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
    expect(byStage(out, 'engineer').dwell_median_s).toBe(200); // median(100,300)
  });

  it('computes dwell from timestamps when duration_s is absent', () => {
    const out = aggregateStageFlow(
      csv([
        row({ ts: '2026-06-01T00:00:00Z', agent: 'engineer', event: 'stage_enter', item: 'A' }),
        row({ ts: '2026-06-01T00:01:00Z', agent: 'engineer', event: 'stage_exit', item: 'A' }),
      ]),
      'p',
    );
    expect(byStage(out, 'engineer').dwell_median_s).toBe(60); // 1 minute
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
    expect(byStage(out, 'done').throughput).toBe(1); // deploy outcome=success
    expect(byStage(out, 'intake').throughput).toBe(1); // enqueue queue=intake
    expect(byStage(out, 'ready').throughput).toBe(1); // enqueue queue=ready
  });

  it('tolerates ragged rows (comma-shifted note) without throwing', () => {
    const raw =
      HEADER +
      '\n2026-06-01T00:00:00Z,p,,,engineer,task_end,238,,,"start:check exit 0; scaffold, seam",,\n';
    expect(() => aggregateStageFlow(raw, 'p')).not.toThrow();
  });
});

describe('aggregateStageFlow — REAL ledger (real-data gate, not a fixture)', () => {
  const realLedger = readFileSync(join(repoRoot, 'process', 'dora', 'ledger.csv'), 'utf8');

  it('returns non-empty plausible build throughput for observatory (>= UCs delivered)', () => {
    const out = aggregateStageFlow(realLedger, 'observatory');
    const eng = byStage(out, 'engineer');
    // Hand-count of engineer task_start rows for observatory grows as slices are
    // delivered; assert >= 8 (current count at time of writing). The tolerant
    // parser must recover all rows despite malformed/unbalanced-quote rows.
    expect(eng.throughput).toBeGreaterThanOrEqual(8); // >= CHK-3 UCs delivered (plausibility)
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
