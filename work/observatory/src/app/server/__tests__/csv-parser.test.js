// @covers UC2 — CSV parser (domain): items.csv + queue CSVs → typed records.
// Acceptance: AC2.1, AC2.2, AC2.3, AC2.4-AC2.7 (header-only), AC2.8/AC2.9/AC2.11
// (missing → null), AC2.10 (extra column ignored). F3, F4; T-READ-3, T-READ-4,
// T-READ-6, T-READ-7, T-READ-8, T-READ-9.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv, readItems, readQueue } from '../parsers/csv.js';

const ITEMS_HEADER =
  'id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref';
const QUEUE_HEADER = 'item_id,enqueued_ts,value,cost,vc_ratio,position,reason';
const POLICY_HEADER =
  'queue,param,value,unit,owner,target_metric,last_tuned,experiment';

describe('parseCsv — pure string parser (domain)', () => {
  it('AC2.4-2.7 / F3: header-only CSV → [] (no crash)', () => {
    expect(parseCsv(QUEUE_HEADER + '\n')).toEqual([]);
    expect(parseCsv(ITEMS_HEADER)).toEqual([]); // even without trailing newline
  });

  it('AC2.1 / T-READ-6: items rows parse with all §4 columns as raw strings', () => {
    const csv = [
      ITEMS_HEADER,
      'CHK-1,chunk,REQ-X,UC-1|UC-2,Do the thing,in-progress,HIGH,M,HIGH/M,2026-06-09T00:10:00Z,,GATE-1',
      'UC-1,use-case,CHK-1,,A job,ready,HIGH,4,0.75,2026-06-09T00:20:00Z,,',
      'SLC-1,slice,CHK-1,,Slice job,done,MED,2,1.00,2026-06-09T00:30:00Z,2026-06-09T01:00:00Z,DORA-REF',
    ].join('\n');
    const recs = parseCsv(csv);
    expect(recs).toHaveLength(3);
    const r0 = recs[0];
    // every §4 column present (T-READ-6: no column silently dropped)
    expect(Object.keys(r0)).toEqual([
      'id', 'type', 'parent', 'children', 'job', 'state',
      'value', 'cost', 'vc_ratio', 'created_ts', 'done_ts', 'dora_ref',
    ]);
    expect(r0.id).toBe('CHK-1');
    expect(r0.type).toBe('chunk');
    expect(r0.state).toBe('in-progress');
    // raw strings — NO numeric casting (§4)
    expect(recs[1].cost).toBe('4');
    expect(recs[1].vc_ratio).toBe('0.75');
    expect(typeof recs[1].cost).toBe('string');
  });

  it('AC2.10 / T-READ-9: extra unknown column kept as a key, §4 columns still correct', () => {
    const csv = [ITEMS_HEADER + ',extra_col', 'X,chunk,,,,backlog,,,,,,,EXTRA'].join('\n');
    const recs = parseCsv(csv);
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe('X');
    expect(recs[0].type).toBe('chunk');
    expect(recs[0].extra_col).toBe('EXTRA');
  });

  it('quoted field containing commas is preserved as one value', () => {
    const csv = [QUEUE_HEADER, 'UC-1,2026-01-01,HIGH,4,0.75,1,"blocked, see note"'].join('\n');
    const recs = parseCsv(csv);
    expect(recs[0].reason).toBe('blocked, see note');
  });
});

describe('readItems / readQueue — file readers (fail soft, §8)', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-csv-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeItems(project, body) {
    const dir = join(root, 'work', project, 'items');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'items.csv'), body);
  }
  function writeQueue(project, q, body) {
    const dir = join(root, 'work', project, 'queues');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${q}.csv`), body);
  }

  it('AC2.1: readItems returns typed array for 3 rows', () => {
    writeItems('p', [
      ITEMS_HEADER,
      'CHK-1,chunk,,,job,in-progress,HIGH,M,HIGH/M,2026-01-01,,',
      'UC-1,use-case,CHK-1,,job,ready,HIGH,4,0.75,2026-01-02,,',
      'SLC-1,slice,CHK-1,,job,done,MED,2,1.00,2026-01-03,2026-01-04,',
    ].join('\n'));
    const recs = readItems(root, 'p');
    expect(recs).toHaveLength(3);
    expect(recs.map((r) => r.type)).toEqual(['chunk', 'use-case', 'slice']);
  });

  it('AC2.2 / T-READ-7: readQueue(intake) returns typed records, raw strings, position present', () => {
    writeQueue('p', 'intake', [
      QUEUE_HEADER,
      'UC-3,2026-01-01,HIGH,2,1.50,1,reason one',
      'UC-2,2026-01-02,HIGH,4,0.75,2,reason two',
    ].join('\n'));
    const recs = readQueue(root, 'p', 'intake');
    expect(recs).toHaveLength(2);
    expect(Object.keys(recs[0])).toEqual([
      'item_id', 'enqueued_ts', 'value', 'cost', 'vc_ratio', 'position', 'reason',
    ]);
    expect(recs[0].position).toBe('1');
    expect(recs[0].vc_ratio).toBe('1.50');
    expect(typeof recs[0].cost).toBe('string');
  });

  it('AC2.3 / T-READ-8: readQueue(policy) returns rows with §4 policy columns', () => {
    writeQueue('p', 'policy', [
      POLICY_HEADER,
      'ready,min_items,2,count,flow-manager,throughput,<created>,EXP-022',
      'ready,wip_limit,4,count,flow-manager,gross-lead-time,<created>,EXP-022',
    ].join('\n'));
    const recs = readQueue(root, 'p', 'policy');
    expect(recs).toHaveLength(2);
    expect(Object.keys(recs[0])).toEqual([
      'queue', 'param', 'value', 'unit', 'owner', 'target_metric', 'last_tuned', 'experiment',
    ]);
    expect(recs.map((r) => r.param)).toEqual(['min_items', 'wip_limit']);
  });

  it('AC2.4-2.7: header-only queue CSV → []', () => {
    for (const q of ['intake', 'ready', 'deploy', 'rework']) {
      writeQueue('p', q, QUEUE_HEADER + '\n');
      expect(readQueue(root, 'p', q)).toEqual([]);
    }
  });

  it('AC2.8 / T-READ-4: missing items.csv → null (no crash)', () => {
    mkdirSync(join(root, 'work', 'p'), { recursive: true });
    expect(readItems(root, 'p')).toBeNull();
  });

  it('AC2.9 / T-READ-4: missing policy.csv → null', () => {
    mkdirSync(join(root, 'work', 'p', 'queues'), { recursive: true });
    expect(readQueue(root, 'p', 'policy')).toBeNull();
  });

  it('AC2.11 / T-READ-4: nonexistent project → null for items and queue', () => {
    expect(readItems(root, 'nonexistent')).toBeNull();
    expect(readQueue(root, 'nonexistent', 'intake')).toBeNull();
  });

  it('rejects an unknown queue name as null (not a filesystem probe outside allowlist)', () => {
    expect(readQueue(root, 'p', 'evil')).toBeNull();
    expect(readQueue(root, 'p', '../../etc/passwd')).toBeNull();
  });
});
