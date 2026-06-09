// @covers state-queues
// UC-S002-2 state layer tests (acceptance.md AC2.1–AC2.6 + ui-design QueueState
// shape). The data layer fetches the 4 queues + policy via the UC1 API client
// seam and derives a typed QueueState[] — one per queue — with starving /
// over-wip / ok status. The client is INJECTED (dependency-inversion) so these
// tests need no real :3001 server and assert the derivation against fixtures.
//
// status contract (acceptance AC2.1-2.3 + design/components.md QueueBox
// data-status): 'starving' when length < min_items; 'over-wip' when
// length >= wip_limit; 'ok' otherwise. Missing policy → thresholds undefined,
// status 'ok' (fail soft, AC2.4). Missing queue CSV → length 0 (AC2.5).
// No active project → empty-state result UC3 renders (AC2.6).
import { describe, it, expect, vi } from 'vitest';
import { initQueueState, QUEUE_NAMES } from '../queues.js';

// Build a fake API client matching the UC1 seam surface. Each map keys a queue
// name (or 'policy') to the QueueRecord[]/PolicyRecord[]/null the client returns.
function fakeClient({ active = 'observatory', queues = {}, policy = null } = {}) {
  return {
    getActive: vi.fn().mockResolvedValue(active),
    getQueues: vi.fn((project, q) => Promise.resolve(queues[q] ?? null)),
    getPolicy: vi.fn().mockResolvedValue(policy),
  };
}

// queue CSV records are raw §4 objects; the state layer only counts rows, so a
// row's content is irrelevant — n rows ⇒ length n.
const rows = (n) => Array.from({ length: n }, (_, i) => ({ item_id: `X-${i}` }));

// policy.csv real header is `queue,param,value` (raw string values).
const policyRow = (queue, param, value) => ({ queue, param, value: String(value) });

describe('initQueueState — shape and queue coverage', () => {
  it('returns exactly the four queues in flow order (intake, ready, deploy, rework)', async () => {
    const client = fakeClient({ queues: { intake: rows(0), ready: rows(0), deploy: rows(0), rework: rows(0) } });
    const state = await initQueueState({ client });
    expect(state.map((q) => q.name)).toEqual(['intake', 'ready', 'deploy', 'rework']);
  });

  it('exports QUEUE_NAMES in flow order for consumers', () => {
    expect(QUEUE_NAMES).toEqual(['intake', 'ready', 'deploy', 'rework']);
  });

  it('each QueueState carries name, length, min_items, wip_limit, status', async () => {
    const client = fakeClient({
      queues: { intake: rows(3), ready: rows(1), deploy: rows(0), rework: rows(2) },
      policy: [policyRow('ready', 'min_items', 3), policyRow('ready', 'wip_limit', 4)],
    });
    const state = await initQueueState({ client });
    const ready = state.find((q) => q.name === 'ready');
    expect(ready).toEqual({ name: 'ready', length: 1, min_items: 3, wip_limit: 4, status: 'starving' });
  });

  it('passes the active project id to the client queue/policy fetches', async () => {
    const client = fakeClient({ active: 'observatory', queues: { intake: rows(0) } });
    await initQueueState({ client });
    expect(client.getQueues).toHaveBeenCalledWith('observatory', 'intake');
    expect(client.getPolicy).toHaveBeenCalledWith('observatory');
  });

  it('accepts an explicit project id (skips getActive when project supplied)', async () => {
    const client = fakeClient({ queues: { intake: rows(0) } });
    await initQueueState({ client, project: 'other-proj' });
    expect(client.getActive).not.toHaveBeenCalled();
    expect(client.getQueues).toHaveBeenCalledWith('other-proj', 'intake');
  });
});

describe('status derivation (AC2.1–AC2.3)', () => {
  it('AC2.1: ready length 1, min_items 3 → starving', async () => {
    const client = fakeClient({
      queues: { ready: rows(1) },
      policy: [policyRow('ready', 'min_items', 3)],
    });
    const ready = (await initQueueState({ client })).find((q) => q.name === 'ready');
    expect(ready.length).toBe(1);
    expect(ready.min_items).toBe(3);
    expect(ready.status).toBe('starving');
  });

  it('AC2.2: intake length 5, wip_limit 5 → over-wip (>= boundary)', async () => {
    const client = fakeClient({
      queues: { intake: rows(5) },
      policy: [policyRow('intake', 'wip_limit', 5)],
    });
    const intake = (await initQueueState({ client })).find((q) => q.name === 'intake');
    expect(intake.length).toBe(5);
    expect(intake.wip_limit).toBe(5);
    expect(intake.status).toBe('over-wip');
  });

  it('AC2.3: deploy length 2, min_items 1, wip_limit 4 → ok', async () => {
    const client = fakeClient({
      queues: { deploy: rows(2) },
      policy: [policyRow('deploy', 'min_items', 1), policyRow('deploy', 'wip_limit', 4)],
    });
    const deploy = (await initQueueState({ client })).find((q) => q.name === 'deploy');
    expect(deploy.status).toBe('ok');
  });

  it('over-wip takes precedence at the cap even if a min is also set', async () => {
    const client = fakeClient({
      queues: { ready: rows(4) },
      policy: [policyRow('ready', 'min_items', 2), policyRow('ready', 'wip_limit', 4)],
    });
    const ready = (await initQueueState({ client })).find((q) => q.name === 'ready');
    expect(ready.status).toBe('over-wip');
  });

  it('length exactly at min_items is ok (boundary: starving is strictly below)', async () => {
    const client = fakeClient({
      queues: { ready: rows(3) },
      policy: [policyRow('ready', 'min_items', 3), policyRow('ready', 'wip_limit', 9)],
    });
    const ready = (await initQueueState({ client })).find((q) => q.name === 'ready');
    expect(ready.status).toBe('ok');
  });

  it('reads policy keyed by `param` (real policy.csv header) and casts value to number', async () => {
    const client = fakeClient({
      queues: { intake: rows(2) },
      policy: [policyRow('intake', 'min_items', '2'), policyRow('intake', 'wip_limit', '10')],
    });
    const intake = (await initQueueState({ client })).find((q) => q.name === 'intake');
    expect(intake.min_items).toBe(2);
    expect(intake.wip_limit).toBe(10);
    expect(intake.status).toBe('ok');
  });

  it('also tolerates policy keyed by `key` (UC1 fixture alias)', async () => {
    const client = fakeClient({
      queues: { ready: rows(1) },
      policy: [{ queue: 'ready', key: 'min_items', value: '3' }],
    });
    const ready = (await initQueueState({ client })).find((q) => q.name === 'ready');
    expect(ready.min_items).toBe(3);
    expect(ready.status).toBe('starving');
  });
});

describe('fail-soft (AC2.4–AC2.6)', () => {
  it('AC2.4: policy null → thresholds undefined, all status ok, no throw', async () => {
    const client = fakeClient({
      queues: { intake: rows(5), ready: rows(1), deploy: rows(0), rework: rows(2) },
      policy: null,
    });
    const state = await initQueueState({ client });
    for (const q of state) {
      expect(q.min_items).toBeUndefined();
      expect(q.wip_limit).toBeUndefined();
      expect(q.status).toBe('ok');
    }
  });

  it('AC2.5: a queue CSV null → that queue length 0, status ok, no throw', async () => {
    const client = fakeClient({
      queues: { intake: rows(2), ready: rows(1), deploy: rows(0), rework: null },
      policy: [policyRow('rework', 'min_items', 1)],
    });
    const rework = (await initQueueState({ client })).find((q) => q.name === 'rework');
    expect(rework.length).toBe(0);
    // length 0 < min_items 1 would be starving — AC2.5 asserts no-crash + length 0;
    // status follows the rule (0 < 1 ⇒ starving) which is correct, not a crash.
    expect(rework.status).toBe('starving');
  });

  it('AC2.5b: queue null AND no policy → length 0, status ok', async () => {
    const client = fakeClient({ queues: { rework: null }, policy: null });
    const rework = (await initQueueState({ client })).find((q) => q.name === 'rework');
    expect(rework.length).toBe(0);
    expect(rework.status).toBe('ok');
  });

  it('AC2.6: no active project (getActive null) → empty array (empty-state for UC3)', async () => {
    const client = fakeClient({ active: null });
    const state = await initQueueState({ client });
    expect(state).toEqual([]);
    expect(client.getQueues).not.toHaveBeenCalled();
  });

  it('AC2.6b: explicit project null also yields the empty state', async () => {
    const client = fakeClient();
    const state = await initQueueState({ client, project: null });
    expect(state).toEqual([]);
  });

  it('a malformed policy value (non-numeric) is treated as no threshold, status ok, no throw', async () => {
    const client = fakeClient({
      queues: { ready: rows(1) },
      policy: [policyRow('ready', 'min_items', 'abc')],
    });
    const ready = (await initQueueState({ client })).find((q) => q.name === 'ready');
    expect(ready.min_items).toBeUndefined();
    expect(ready.status).toBe('ok');
  });
});
