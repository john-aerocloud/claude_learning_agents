// @covers api-client
// API client unit tests (UC-S002-1 / AC1.3–AC1.6). The client is the shared
// seam UC2-UC6 import; these pin the URL the helpers build, the parse of the
// response, and the fail-soft (null) behaviour on network error. fetch is
// mocked — no real :3001 server needed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  API_BASE,
  getActive,
  getProjects,
  getQueues,
  getPolicy,
  getBaseline,
  getFlow,
  getStageFlow,
  getItems,
  fetchQueues,
  fetchPolicy,
  fetchBaseline,
  fetchFlow,
  subscribeEvents,
} from '../client.js';

function mockFetchJson(value, { status = 200 } = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
  });
}

describe('api/client URL construction + parsing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('API_BASE is empty string — same-origin relative URLs (SPA and API share one server)', () => {
    expect(API_BASE).toBe('');
  });

  it('getActive() GETs /api/active and returns the active id (AC: active project)', async () => {
    const f = mockFetchJson({ active: 'observatory' });
    vi.stubGlobal('fetch', f);
    const active = await getActive();
    expect(f).toHaveBeenCalledWith('/api/active');
    expect(active).toBe('observatory');
  });

  it('getActive() returns null when no active project ({active:null})', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ active: null }));
    expect(await getActive()).toBeNull();
  });

  it('getProjects() GETs /api/projects and returns the array', async () => {
    const rows = [{ id: 'observatory', active: true, status: 'running' }];
    const f = mockFetchJson(rows);
    vi.stubGlobal('fetch', f);
    const projects = await getProjects();
    expect(f).toHaveBeenCalledWith('/api/projects');
    expect(projects).toEqual(rows);
  });

  it('getQueues(project, queue) builds /api/projects/:id/queues/:queue and returns typed QueueRecord[] (AC1.3)', async () => {
    const fixture = [{ id: 'I-1', title: 'a' }, { id: 'I-2', title: 'b' }];
    const f = mockFetchJson(fixture);
    vi.stubGlobal('fetch', f);
    const rows = await getQueues('observatory', 'ready');
    expect(f).toHaveBeenCalledWith('/api/projects/observatory/queues/ready');
    expect(rows).toEqual(fixture);
  });

  it('getStageFlow(project) builds /api/projects/:id/stage-flow and returns the RAW array (no {content} envelope) (UC-S004-1/2)', async () => {
    const fixture = [
      { stage: 'engineer', label: 'Build / TDD', throughput: 7, dwell_median_s: 357, wip: 4, rework: 0, source_rows: ['r:1'] },
    ];
    const f = mockFetchJson(fixture);
    vi.stubGlobal('fetch', f);
    const rows = await getStageFlow('observatory');
    expect(f).toHaveBeenCalledWith('/api/projects/observatory/stage-flow');
    expect(rows).toEqual(fixture);
  });

  it('getStageFlow encodes the project segment', async () => {
    const f = mockFetchJson([]);
    vi.stubGlobal('fetch', f);
    await getStageFlow('a/b');
    expect(f).toHaveBeenCalledWith('/api/projects/a%2Fb/stage-flow');
  });

  it('getStageFlow fails soft to null on a network/HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getStageFlow('observatory')).toBeNull();
  });

  it('getItems(project) builds /api/projects/:id/items and returns the RAW array (no envelope) (UC-S005-2)', async () => {
    const fixture = [
      { id: 'REQ-OBSERVATORY', type: 'requirement', parent: '', children: 'CHK-1', job: 'Observe', state: 'active', value: 'HIGH', cost: 'XL', vc_ratio: 'HIGH/XL' },
    ];
    const f = mockFetchJson(fixture);
    vi.stubGlobal('fetch', f);
    const rows = await getItems('observatory');
    expect(f).toHaveBeenCalledWith('/api/projects/observatory/items');
    expect(rows).toEqual(fixture);
  });

  it('getItems encodes the project segment', async () => {
    const f = mockFetchJson([]);
    vi.stubGlobal('fetch', f);
    await getItems('a/b');
    expect(f).toHaveBeenCalledWith('/api/projects/a%2Fb/items');
  });

  it('getItems fails soft to null on a network/HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getItems('observatory')).toBeNull();
  });

  it('getQueues encodes path segments (defends against malformed project ids)', async () => {
    const f = mockFetchJson([]);
    vi.stubGlobal('fetch', f);
    await getQueues('a/b', 'ready');
    expect(f).toHaveBeenCalledWith('/api/projects/a%2Fb/queues/ready');
  });

  it('getPolicy(project) builds the policy queue URL and returns PolicyRecord[] (AC1.4)', async () => {
    const fixture = [{ queue: 'ready', key: 'min_items', value: '3' }];
    const f = mockFetchJson(fixture);
    vi.stubGlobal('fetch', f);
    const rows = await getPolicy('observatory');
    expect(f).toHaveBeenCalledWith('/api/projects/observatory/queues/policy');
    expect(rows).toEqual(fixture);
  });

  it('getBaseline() GETs /api/dora/baseline and returns the raw content string unmodified (AC1.5)', async () => {
    const raw = '# Baseline\nConstraint: ready\n';
    const f = mockFetchJson({ content: raw });
    vi.stubGlobal('fetch', f);
    const content = await getBaseline();
    expect(f).toHaveBeenCalledWith('/api/dora/baseline');
    expect(content).toBe(raw);
  });

  it('getBaseline() returns null when content is null (missing file)', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ content: null }));
    expect(await getBaseline()).toBeNull();
  });

  it('getFlow(project) GETs /api/projects/:id/dora/flow and returns raw content (UC-S003-1)', async () => {
    const raw = '# Flow view — observatory\n\n## Time thieves\n';
    const f = mockFetchJson({ content: raw });
    vi.stubGlobal('fetch', f);
    const content = await getFlow('observatory');
    expect(f).toHaveBeenCalledWith('/api/projects/observatory/dora/flow');
    expect(content).toBe(raw);
  });

  it('getFlow() encodes the project segment', async () => {
    const f = mockFetchJson({ content: null });
    vi.stubGlobal('fetch', f);
    await getFlow('a/b');
    expect(f).toHaveBeenCalledWith('/api/projects/a%2Fb/dora/flow');
  });

  it('getFlow() returns null when content is null (missing flow.md)', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ content: null }));
    expect(await getFlow('observatory')).toBeNull();
  });

  it('AC-named aliases fetchQueues/fetchPolicy/fetchBaseline/fetchFlow exist and match the seam helpers', async () => {
    expect(fetchQueues).toBe(getQueues);
    expect(fetchPolicy).toBe(getPolicy);
    expect(fetchBaseline).toBe(getBaseline);
    expect(fetchFlow).toBe(getFlow);
  });
});

describe('api/client fail-soft (AC1.6)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('getActive returns null when fetch throws a network error; no unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getActive()).resolves.toBeNull();
  });

  it('getQueues returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getQueues('observatory', 'ready')).resolves.toBeNull();
  });

  it('getBaseline returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getBaseline()).resolves.toBeNull();
  });

  it('getFlow returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getFlow('observatory')).resolves.toBeNull();
  });

  it('a non-ok HTTP status (5xx) resolves to null rather than throwing (fail soft)', async () => {
    vi.stubGlobal('fetch', mockFetchJson({}, { status: 500 }));
    await expect(getQueues('observatory', 'ready')).resolves.toBeNull();
  });
});

describe('api/client subscribeEvents seam', () => {
  afterEach(() => vi.restoreAllMocks());

  it('subscribeEvents opens an EventSource on /api/events and forwards change frames', () => {
    const handlers = {};
    const close = vi.fn();
    const FakeES = vi.fn(function (url) {
      this.url = url;
      this.close = close;
      this.addEventListener = (name, fn) => {
        handlers[name] = fn;
      };
    });
    vi.stubGlobal('EventSource', FakeES);

    const onChange = vi.fn();
    const unsubscribe = subscribeEvents(onChange);

    expect(FakeES).toHaveBeenCalledWith('/api/events');
    // simulate a server change frame
    handlers.message({ data: JSON.stringify({ type: 'change', path: 'work/observatory/queues/ready.csv' }) });
    expect(onChange).toHaveBeenCalledWith({ type: 'change', path: 'work/observatory/queues/ready.csv' });

    // returned unsubscribe closes the connection
    unsubscribe();
    expect(close).toHaveBeenCalled();
  });

  it('subscribeEvents ignores an unparseable frame without throwing', () => {
    const handlers = {};
    const FakeES = vi.fn(function () {
      this.close = vi.fn();
      this.addEventListener = (name, fn) => {
        handlers[name] = fn;
      };
    });
    vi.stubGlobal('EventSource', FakeES);
    const onChange = vi.fn();
    subscribeEvents(onChange);
    expect(() => handlers.message({ data: 'not-json' })).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  // DEFECT-003 — the client must surface CONNECTION state (open/error) so the
  // container can show a disconnected/stale cue and re-fetch on reconnect.
  it('subscribeEvents forwards EventSource open/error to onOpen/onError callbacks (DEFECT-003)', () => {
    const handlers = {};
    const FakeES = vi.fn(function () {
      this.close = vi.fn();
      this.addEventListener = (name, fn) => {
        handlers[name] = fn;
      };
    });
    vi.stubGlobal('EventSource', FakeES);

    const onChange = vi.fn();
    const onOpen = vi.fn();
    const onError = vi.fn();
    subscribeEvents(onChange, { onOpen, onError });

    handlers.open({});
    expect(onOpen).toHaveBeenCalledTimes(1);

    handlers.error({});
    expect(onError).toHaveBeenCalledTimes(1);
    // a connection event is NOT a data frame — onChange stays untouched
    expect(onChange).not.toHaveBeenCalled();
  });

  it('subscribeEvents stays back-compatible: works with no options object (DEFECT-003)', () => {
    const handlers = {};
    const FakeES = vi.fn(function () {
      this.close = vi.fn();
      this.addEventListener = (name, fn) => { handlers[name] = fn; };
    });
    vi.stubGlobal('EventSource', FakeES);
    const onChange = vi.fn();
    // no second argument; open/error must not throw
    subscribeEvents(onChange);
    expect(() => handlers.open && handlers.open({})).not.toThrow();
    expect(() => handlers.error && handlers.error({})).not.toThrow();
  });
});
