// @covers parseBaseline
// UC-S003-1 — baseline.md four-metric + per-agent task-time parser (pure domain,
// jsdom/node string logic). Fixtures are copied VERBATIM from the real
// process/dora/baseline.md so the string-equality fidelity contract (§8 F1-F4)
// is pinned against the actual computed artifact. parseBaseline COMPOSES the
// existing parseConstraint (UC-S002-5) — it does not duplicate constraint logic.
import { describe, it, expect } from 'vitest';
import { parseBaseline } from '../baseline.js';

// Verbatim copy of the real process/dora/baseline.md (2026-06-09 computed form).
const REAL_BASELINE = `# DORA Baseline (computed)

_Generated 2026-06-09T16:16:04Z from ledger.csv. Do not hand-edit._

## Four key metrics (whole pipeline)

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3092 s | 20 slice(s) |
| Deployment frequency | 8 /active-day | 6 day(s) |
| Change failure rate | 24 % | 46 deploy(s) |
| MTTR (median) | 2033 s | 8 failure(s) |

## Per-agent task completion (seconds)

| Agent | n | modal | median | mean |
|-------|---|-------|--------|------|
| product | 7 | 120 | 180 | 233 |
| solution-architect | 14 | 1200 | 420 | 568 |
| cicd | 12 | 207 | 224 | 375 |
| engineer | 52 | 720 | 699 | 984 |
| ui-designer | 3 | 540 | 540 | 737 |
| tester | 13 | 1200 | 1059 | 1448 |
| documenter | 12 | 60 | 60 | 168 |
| orchestrator | 1 | 900 | 900 | 900 |
| flow-manager | 0 | — | — | — |

## Theory-of-Constraints read

- Constraint (slowest median step): **tester**
- Recommended exploit/subordinate action: _(orchestrator fills in)_
`;

describe('parseBaseline — four key metrics (UC-S003-1)', () => {
  it('AC1.1: gross lead time value + window preserved exactly', () => {
    const { metrics } = parseBaseline(REAL_BASELINE);
    expect(metrics.grossLeadTimeMedian).toEqual({ value: '3092 s', window: '20 slice(s)' });
  });

  it('AC1.2: deployment frequency value preserved exactly', () => {
    const { metrics } = parseBaseline(REAL_BASELINE);
    expect(metrics.deployFrequency.value).toBe('8 /active-day');
    expect(metrics.deployFrequency.window).toBe('6 day(s)');
  });

  it('AC1.3: change failure rate value preserved exactly', () => {
    const { metrics } = parseBaseline(REAL_BASELINE);
    expect(metrics.changeFailureRate.value).toBe('24 %');
    expect(metrics.changeFailureRate.window).toBe('46 deploy(s)');
  });

  it('AC1.4: MTTR value preserved exactly', () => {
    const { metrics } = parseBaseline(REAL_BASELINE);
    expect(metrics.mttr.value).toBe('2033 s');
    expect(metrics.mttr.window).toBe('8 failure(s)');
  });
});

describe('parseBaseline — per-agent task times (UC-S003-1)', () => {
  it('AC1.5: 9 agent rows; engineer row exact (n=52, modal/median/mean)', () => {
    const { agentTimes } = parseBaseline(REAL_BASELINE);
    expect(agentTimes).toHaveLength(9);
    const eng = agentTimes.find((a) => a.agent === 'engineer');
    expect(eng).toEqual({ agent: 'engineer', n: 52, modal: '720', median: '699', mean: '984' });
  });

  it('AC1.6: no-data flow-manager row preserved with dashes (not dropped)', () => {
    const { agentTimes } = parseBaseline(REAL_BASELINE);
    const fm = agentTimes.find((a) => a.agent === 'flow-manager');
    expect(fm).toEqual({ agent: 'flow-manager', n: 0, modal: '—', median: '—', mean: '—' });
  });

  it('preserves source order of agent rows', () => {
    const { agentTimes } = parseBaseline(REAL_BASELINE);
    expect(agentTimes.map((a) => a.agent)).toEqual([
      'product', 'solution-architect', 'cicd', 'engineer', 'ui-designer',
      'tester', 'documenter', 'orchestrator', 'flow-manager',
    ]);
  });
});

describe('parseBaseline — constraint composition + sourceRef (UC-S003-1)', () => {
  it('composes parseConstraint: real baseline names the agent "tester"', () => {
    expect(parseBaseline(REAL_BASELINE).constraint).toBe('tester');
  });

  it('always reports the canonical sourceRef', () => {
    expect(parseBaseline(REAL_BASELINE).sourceRef).toBe('process/dora/baseline.md');
    expect(parseBaseline(null).sourceRef).toBe('process/dora/baseline.md');
  });
});

describe('parseBaseline — fail-soft resilience (§8 R1/R3)', () => {
  it('AC1.7: null input → no throw; metrics all null; agentTimes empty', () => {
    const r = parseBaseline(null);
    expect(r.metrics).toEqual({
      grossLeadTimeMedian: null, deployFrequency: null, changeFailureRate: null, mttr: null,
    });
    expect(r.agentTimes).toEqual([]);
    expect(r.constraint).toBeNull();
  });

  it('AC1.8: markdown with no tables → no throw; metrics null; agentTimes empty', () => {
    const r = parseBaseline('# Some other markdown\nNo tables here');
    expect(r.metrics.grossLeadTimeMedian).toBeNull();
    expect(r.metrics.mttr).toBeNull();
    expect(r.agentTimes).toEqual([]);
  });

  it('undefined / non-string input → no throw', () => {
    expect(() => parseBaseline(undefined)).not.toThrow();
    expect(() => parseBaseline(42)).not.toThrow();
    expect(parseBaseline(undefined).agentTimes).toEqual([]);
  });

  it('partial content (only constraint line present) → metrics null, constraint set', () => {
    const r = parseBaseline('## Theory-of-Constraints read\n\n- Constraint (slowest median step): **tester**\n');
    expect(r.metrics.grossLeadTimeMedian).toBeNull();
    expect(r.agentTimes).toEqual([]);
    expect(r.constraint).toBe('tester');
  });

  it('metric table present but agent table absent → metrics set, agentTimes empty', () => {
    const partial = `## Four key metrics

| Metric | Value | Window |
|--------|-------|--------|
| Gross lead time (median) | 3092 s | 20 slice(s) |
`;
    const r = parseBaseline(partial);
    expect(r.metrics.grossLeadTimeMedian.value).toBe('3092 s');
    expect(r.agentTimes).toEqual([]);
  });
});
