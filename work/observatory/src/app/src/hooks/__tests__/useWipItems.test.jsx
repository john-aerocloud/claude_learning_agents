// @covers SPA_WIPHOOK
// @covers uc-s015-1
// UC-S015-1 — useWipItems: composes /stage-flow open_items (+ live horizon) with
// /items (job/value/cost) into the sorted WipItem[] the panel renders.
// Pure domain (composeWipItems, formatDwell, formatHorizon) tested directly;
// the hook (fetch + SSE re-fetch) through a probe component with injected loaders.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import {
  composeWipItems,
  formatDwell,
  formatHorizon,
  useWipItems,
} from '../useWipItems.js';

const HORIZON = 2 * 60 * 60 * 1000;

/** Minimal stage-flow stage with open_items (UC-S015-1 additive shape). */
function stage(stageId, label, openItems) {
  return {
    stage: stageId,
    label,
    wip_horizon_ms: HORIZON,
    open_items: openItems,
  };
}

const ITEMS = [
  { id: 'CHK-4', job: 'Tree and zoom chunk', value: 'HIGH', cost: 'M' },
  { id: 'UC-9', job: 'Validate the build', value: 'MED', cost: '2' },
];

describe('formatDwell (S15-1-FIG-1/3 — unit-bearing, unknown ≠ zero)', () => {
  it('renders "—" for null/unknown (never "0 s")', () => {
    expect(formatDwell(null)).toBe('—');
    expect(formatDwell(undefined)).toBe('—');
    expect(formatDwell(Number.NaN)).toBe('—');
  });
  it('renders seconds under a minute with a unit', () => {
    expect(formatDwell(53_000)).toBe('53 s');
    expect(formatDwell(0)).toBe('0 s');
  });
  it('renders minutes under an hour with a unit', () => {
    expect(formatDwell(28 * 60_000)).toBe('28 min');
  });
  it('renders hours + minutes ("2 h 14 min"); whole hours omit the minute part', () => {
    expect(formatDwell((2 * 60 + 14) * 60_000)).toBe('2 h 14 min');
    expect(formatDwell(3 * 60 * 60_000)).toBe('3 h');
  });
  it('never renders a bare number', () => {
    for (const ms of [0, 999, 53_000, 60_000, 3_599_000, 3_600_000, 8_040_000]) {
      expect(formatDwell(ms)).toMatch(/\d+\s*(h|min|s)/);
    }
  });
});

describe('formatHorizon (stale badge "over Nh" text)', () => {
  it('whole hours → "2h"', () => expect(formatHorizon(HORIZON)).toBe('2h'));
  it('non-whole hours → minutes', () => expect(formatHorizon(30 * 60_000)).toBe('30min'));
  it('invalid → empty string', () => expect(formatHorizon(null)).toBe(''));
});

describe('composeWipItems (UC-S015-1 domain)', () => {
  it('joins open_items with item records: id, job sentence, human stage label, value, cost (F-3/S15-1-FIG-2)', () => {
    const flow = [
      stage('engineer', 'Build / TDD (engineer)', [
        { item_id: 'CHK-4', note: 'build c', opened_at: 't', dwell_ms: 900_000, stale: false },
      ]),
    ];
    const { items } = composeWipItems(flow, ITEMS);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'CHK-4',
      job: 'Tree and zoom chunk',
      stage: 'engineer',
      stageLabel: 'Build / TDD (engineer)',
      value: 'HIGH',
      cost: 'M',
      dwellMs: 900_000,
      dwellText: '15 min',
      isStale: false,
    });
  });

  it('reads horizonMs from the stage-flow source, never a hard-coded literal (S15-1-WIP-1)', () => {
    const custom = 45 * 60_000; // a NON-default horizon must flow through
    const flow = [
      {
        stage: 'engineer',
        label: 'Build',
        wip_horizon_ms: custom,
        open_items: [
          { item_id: 'A', note: '', opened_at: 't', dwell_ms: custom + 1, stale: true },
        ],
      },
    ];
    const out = composeWipItems(flow, []);
    expect(out.horizonMs).toBe(custom);
    expect(out.items[0].isStale).toBe(true); // stale derived from the LIVE horizon
  });

  it('sorts longest-in-stage first; null dwell (unknown) sorts last (F-4)', () => {
    const flow = [
      stage('engineer', 'Build / TDD (engineer)', [
        { item_id: 'CHK-4', note: '', opened_at: 't', dwell_ms: 900_000, stale: false },
        { item_id: 'X-NULL', note: '', opened_at: 'bad', dwell_ms: null, stale: false },
      ]),
      stage('validate', 'Validate (tester)', [
        { item_id: 'UC-9', note: '', opened_at: 't', dwell_ms: 5 * 60 * 60_000, stale: true },
      ]),
    ];
    const { items } = composeWipItems(flow, ITEMS);
    expect(items.map((i) => i.id)).toEqual(['UC-9', 'CHK-4', 'X-NULL']);
    expect(items[0].dwellMs).toBeGreaterThanOrEqual(items[1].dwellMs);
  });

  it('a stale-open item is PRESENT and flagged, never dropped (S15-1-WIP-2)', () => {
    const flow = [
      stage('validate', 'Validate (tester)', [
        { item_id: 'UC-9', note: '', opened_at: 't', dwell_ms: 6 * 60 * 60_000, stale: true },
      ]),
    ];
    const { items } = composeWipItems(flow, ITEMS);
    expect(items).toHaveLength(1);
    expect(items[0].isStale).toBe(true);
  });

  it('null dwell renders "—" (unknown ≠ 0 — S15-1-FIG-3); missing record falls back to note then id; blank value/cost → "—"', () => {
    const flow = [
      stage('engineer', 'Build / TDD (engineer)', [
        { item_id: 'GHOST-1', note: 'a human note', opened_at: 'bad', dwell_ms: null, stale: false },
      ]),
    ];
    const { items } = composeWipItems(flow, []);
    expect(items[0].dwellText).toBe('—');
    expect(items[0].dwellText).not.toMatch(/^0/);
    expect(items[0].job).toBe('a human note');
    expect(items[0].value).toBe('—');
    expect(items[0].cost).toBe('—');
  });

  it('fails soft: null flow / null items → empty list, null horizon', () => {
    expect(composeWipItems(null, null)).toEqual({ horizonMs: null, items: [] });
  });
});

/** Probe component exposing the hook state as data-attrs. */
function Probe(props) {
  const s = useWipItems(props);
  return (
    <div
      data-testid="probe"
      data-status={s.status}
      data-horizon={String(s.horizonMs)}
      data-count={String(s.items.length)}
      data-first={s.items[0]?.id ?? ''}
    />
  );
}

describe('useWipItems (hook: fetch + SSE re-fetch)', () => {
  const FLOW = [
    stage('engineer', 'Build / TDD (engineer)', [
      { item_id: 'CHK-4', note: 'build c', opened_at: 't', dwell_ms: 900_000, stale: false },
    ]),
  ];

  it('loading → ready with composed items + live horizon', async () => {
    render(
      <Probe
        loadActive={() => Promise.resolve('demo')}
        loadFlow={() => Promise.resolve(FLOW)}
        loadItems={() => Promise.resolve(ITEMS)}
        subscribe={() => () => {}}
      />,
    );
    expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('loading');
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('ready'),
    );
    const probe = screen.getByTestId('probe');
    expect(probe.getAttribute('data-count')).toBe('1');
    expect(probe.getAttribute('data-first')).toBe('CHK-4');
    expect(probe.getAttribute('data-horizon')).toBe(String(HORIZON));
  });

  it('zero open items → status "empty" (F-5)', async () => {
    render(
      <Probe
        loadActive={() => Promise.resolve('demo')}
        loadFlow={() => Promise.resolve([stage('engineer', 'Build', [])])}
        loadItems={() => Promise.resolve([])}
        subscribe={() => () => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('empty'),
    );
  });

  it('fails soft on null flow (unreachable API) → empty, no crash', async () => {
    render(
      <Probe
        loadActive={() => Promise.resolve('demo')}
        loadFlow={() => Promise.resolve(null)}
        loadItems={() => Promise.resolve(null)}
        subscribe={() => () => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('empty'),
    );
  });

  it('a ledger.csv SSE change frame triggers a debounced re-fetch (S15-1-A11Y-7 data path)', async () => {
    let onChange;
    const subscribe = vi.fn((cb) => {
      onChange = cb;
      return () => {};
    });
    let flowNow = FLOW;
    render(
      <Probe
        loadActive={() => Promise.resolve('demo')}
        loadFlow={() => Promise.resolve(flowNow)}
        loadItems={() => Promise.resolve(ITEMS)}
        subscribe={subscribe}
        debounceMs={0}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-count')).toBe('1'),
    );
    flowNow = [
      stage('engineer', 'Build / TDD (engineer)', [
        { item_id: 'CHK-4', note: 'build c', opened_at: 't', dwell_ms: 900_000, stale: false },
        { item_id: 'UC-9', note: 'v', opened_at: 't', dwell_ms: 60_000, stale: false },
      ]),
    ];
    onChange({ type: 'change', path: 'process/dora/ledger.csv' });
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-count')).toBe('2'),
    );
  });

  it('an IRRELEVANT change frame does not re-fetch', async () => {
    let onChange;
    const loadFlow = vi.fn(() => Promise.resolve(FLOW));
    render(
      <Probe
        loadActive={() => Promise.resolve('demo')}
        loadFlow={loadFlow}
        loadItems={() => Promise.resolve(ITEMS)}
        subscribe={(cb) => {
          onChange = cb;
          return () => {};
        }}
        debounceMs={0}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('probe').getAttribute('data-count')).toBe('1'),
    );
    onChange({ type: 'change', path: 'work/demo/slices/s004/slice.md' });
    await new Promise((r) => setTimeout(r, 20));
    expect(loadFlow).toHaveBeenCalledTimes(1);
  });
});
