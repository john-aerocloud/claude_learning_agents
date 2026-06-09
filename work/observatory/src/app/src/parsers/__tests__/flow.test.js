// @covers parseFlow
// UC-S003-1 — flow.md time-thief + queue table parser (pure domain, node/jsdom
// string logic). Fixture is copied VERBATIM from the real
// work/observatory/dora/flow.md so the §8 fidelity contract (F3) is pinned
// against the actual computed artifact. Fail soft: null / no table → empty
// arrays, never a throw.
import { describe, it, expect } from 'vitest';
import { parseFlow } from '../flow.js';

// Verbatim copy of the relevant sections of the real work/observatory/dora/flow.md.
const REAL_FLOW = `# Flow view — observatory

_Generated 2026-06-09T16:16:04Z from ledger.csv + queues/policy.csv. Do not hand-edit._

## Queues — buffer control + statistical metrics

Buffer control per queue = **min_items** (replenish floor) + **WIP limit** (cap). Metrics: **length** (now), **throughput** (dequeues/active-day), **dwell** (enqueue→dequeue, the time to be taken off the queue — the queue's slice of GLT), **rework rate** (re-entries ÷ items).

| Queue | min_items | WIP limit | length | throughput /day | dwell median (s) | rework rate | items through |
|-------|-----------|-----------|--------|-----------------|------------------|-------------|---------------|
| intake | 2 | 10 | 5 | — | — | 0.00 | 0 |
| ready | 2 | 4 | 1 | — | — | 0.00 | 0 |

## Time thieves (wall-clock not spent doing the work)

| Thief | Value | Source |
|-------|-------|--------|
| Queue dwell (all queues) | 0 s | enqueue->dequeue pairs = the wait part of GLT |
| Hidden-edge collisions | 1 | declared independence proven false (s13) |
| Parallelism efficiency | 1.00 | achieved / max independent set |

### Collisions (-> correct the dependency tree)

| when | item | other (ref) | shared seam (note) |
|------|------|-------------|--------------------|
| 2026-06-09T01:48:05Z | UC-S002-4 | UC-S002-4 | UC4+UC5 both claim PipelineMap.jsx seam |
`;

describe('parseFlow — time thieves (UC-S003-1)', () => {
  it('AC1.9: 3 thief rows; first row name + value exact', () => {
    const { timeThieves } = parseFlow(REAL_FLOW);
    expect(timeThieves).toHaveLength(3);
    expect(timeThieves[0]).toEqual({
      name: 'Queue dwell (all queues)',
      value: '0 s',
      source: 'enqueue->dequeue pairs = the wait part of GLT',
    });
  });

  it('second + third thief rows preserved exactly (fidelity F3)', () => {
    const { timeThieves } = parseFlow(REAL_FLOW);
    expect(timeThieves[1]).toEqual({
      name: 'Hidden-edge collisions',
      value: '1',
      source: 'declared independence proven false (s13)',
    });
    expect(timeThieves[2]).toEqual({
      name: 'Parallelism efficiency',
      value: '1.00',
      source: 'achieved / max independent set',
    });
  });
});

describe('parseFlow — queues (UC-S003-1)', () => {
  it('parses the queue table rows with raw string fidelity', () => {
    const { queues } = parseFlow(REAL_FLOW);
    expect(queues).toHaveLength(2);
    expect(queues[0]).toEqual({
      queue: 'intake',
      minItems: '2',
      wipLimit: '10',
      length: '5',
      throughput: '—',
      dwellMedian: '—',
      reworkRate: '0.00',
      itemsThrough: '0',
    });
    expect(queues[1].queue).toBe('ready');
    expect(queues[1].wipLimit).toBe('4');
  });
});

describe('parseFlow — sourceRef + fail-soft (§8 R2)', () => {
  it('reports the canonical sourceRef', () => {
    expect(parseFlow(REAL_FLOW).sourceRef).toBe('work/observatory/dora/flow.md');
    expect(parseFlow(null).sourceRef).toBe('work/observatory/dora/flow.md');
  });

  it('AC1.10: null input → no throw; timeThieves + queues empty', () => {
    const r = parseFlow(null);
    expect(r.timeThieves).toEqual([]);
    expect(r.queues).toEqual([]);
  });

  it('markdown with no thieves table → empty timeThieves; no throw', () => {
    const r = parseFlow('# Flow\n\nsome prose, no tables');
    expect(r.timeThieves).toEqual([]);
    expect(r.queues).toEqual([]);
  });

  it('undefined / non-string input → no throw', () => {
    expect(() => parseFlow(undefined)).not.toThrow();
    expect(() => parseFlow(99)).not.toThrow();
    expect(parseFlow(undefined).timeThieves).toEqual([]);
  });

  it('thieves table present but queues table absent → thieves set, queues empty', () => {
    const partial = `## Time thieves

| Thief | Value | Source |
|-------|-------|--------|
| Queue dwell (all queues) | 0 s | the wait part of GLT |
`;
    const r = parseFlow(partial);
    expect(r.timeThieves).toHaveLength(1);
    expect(r.queues).toEqual([]);
  });
});
