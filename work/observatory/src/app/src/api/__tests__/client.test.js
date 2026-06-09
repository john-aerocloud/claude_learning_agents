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
  fetchQueues,
  fetchPolicy,
  fetchBaseline,
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

  it('API_BASE points at the :3001 read layer', () => {
    expect(API_BASE).toBe('http://localhost:3001');
  });

  it('getActive() GETs /api/active and returns the active id (AC: active project)', async () => {
    const f = mockFetchJson({ active: 'observatory' });
    vi.stubGlobal('fetch', f);
    const active = await getActive();
    expect(f).toHaveBeenCalledWith('http://localhost:3001/api/active');
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
    expect(f).toHaveBeenCalledWith('http://localhost:3001/api/projects');
    expect(projects).toEqual(rows);
  });

  it('getQueues(project, queue) builds /api/projects/:id/queues/:queue and returns typed QueueRecord[] (AC1.3)', async () => {
    const fixture = [{ id: 'I-1', title: 'a' }, { id: 'I-2', title: 'b' }];
    const f = mockFetchJson(fixture);
    vi.stubGlobal('fetch', f);
    const rows = await getQueues('observatory', 'ready');
    expect(f).toHaveBeenCalledWith('http://localhost:3001/api/projects/observatory/queues/ready');
    expect(rows).toEqual(fixture);
  });

  it('getQueues encodes path segments (defends against malformed project ids)', async () => {
    const f = mockFetchJson([]);
    vi.stubGlobal('fetch', f);
    await getQueues('a/b', 'ready');
    expect(f).toHaveBeenCalledWith('http://localhost:3001/api/projects/a%2Fb/queues/ready');
  });

  it('getPolicy(project) builds the policy queue URL and returns PolicyRecord[] (AC1.4)', async () => {
    const fixture = [{ queue: 'ready', key: 'min_items', value: '3' }];
    const f = mockFetchJson(fixture);
    vi.stubGlobal('fetch', f);
    const rows = await getPolicy('observatory');
    expect(f).toHaveBeenCalledWith('http://localhost:3001/api/projects/observatory/queues/policy');
    expect(rows).toEqual(fixture);
  });

  it('getBaseline() GETs /api/dora/baseline and returns the raw content string unmodified (AC1.5)', async () => {
    const raw = '# Baseline\nConstraint: ready\n';
    const f = mockFetchJson({ content: raw });
    vi.stubGlobal('fetch', f);
    const content = await getBaseline();
    expect(f).toHaveBeenCalledWith('http://localhost:3001/api/dora/baseline');
    expect(content).toBe(raw);
  });

  it('getBaseline() returns null when content is null (missing file)', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ content: null }));
    expect(await getBaseline()).toBeNull();
  });

  it('AC-named aliases fetchQueues/fetchPolicy/fetchBaseline exist and match the seam helpers', async () => {
    expect(fetchQueues).toBe(getQueues);
    expect(fetchPolicy).toBe(getPolicy);
    expect(fetchBaseline).toBe(getBaseline);
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

    expect(FakeES).toHaveBeenCalledWith('http://localhost:3001/api/events');
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
});
