// @covers ValueStreamMap
// @covers StageNode
// @covers GateMarker
// @covers ReworkLoopConnector
// @covers InFlightBadge
// UC-S004-2/3/4 render specs (jsdom). Drives the value-stream map STRUCTURE,
// accessible names, gate/rework topology, the four labelled figures, the
// non-colour-redundant in-flight badge, and the all-zeros skeleton — BEFORE the
// Playwright GEO/live drive. This is the DEFECT-001 fix surface: it must render
// the REAL per-stage throughput + in-flight WIP from getStageFlow, never 0s
// (the queue-depth view did).
//
// Pins: AC2.2 (10 stages, flow order), AC2.3 (gates distinct), AC2.4 (rework
// loop labelled), AC2.6 (all-zeros skeleton), AC3.1 (four labelled figures),
// AC3.2/3.3 (integer throughput, humanised dwell), AC4.1/4.3 (wip>0 in-flight
// badge w/ "in-flight" text + glyph; wip=0 no badge), A11Y-2 (node name carries
// figures), A11Y-4 (in-flight in accessible name + visible text), A11Y-6 (rework
// text label outside aria-hidden SVG), SRC-1 (every metric has data-source).
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { ValueStreamMap } from '../ValueStreamMap.jsx';

// A stage-flow array as the endpoint returns it — 11 entries (10 nodes + rework
// loop entry). engineer throughput 7 + wip 2 mirrors the live data the defect
// re-check must show non-zero.
// DEFECT-004: dwell renders humanised only with >= 2 completed pairs (else "—"),
// so rows whose humanised dwell is asserted carry dwell_pairs: 2.
const flow = [
  { stage: 'intake', label: 'Intake (gate)', throughput: 5, dwell_median_s: 30, dwell_pairs: 2, wip: 0, rework: 0, source_rows: ['r1'] },
  { stage: 'decompose', label: 'Decompose (product)', throughput: 4, dwell_median_s: 120, dwell_pairs: 2, wip: 0, rework: 1, source_rows: ['r2'] },
  { stage: 'ready', label: 'Ready (queue)', throughput: 4, dwell_median_s: 0, dwell_pairs: 0, wip: 0, rework: 0, source_rows: ['r3'] },
  { stage: 'capabilities', label: 'Capabilities (cicd)', throughput: 3, dwell_median_s: 600, dwell_pairs: 2, wip: 0, rework: 0, source_rows: ['r4'] },
  { stage: 'ui-design', label: 'UI-Design', throughput: 3, dwell_median_s: 300, dwell_pairs: 2, wip: 1, rework: 0, source_rows: ['r5'] },
  { stage: 'engineer', label: 'Build / TDD (engineer)', throughput: 7, active_days: 2, throughput_per_active_day: 3.5, dwell_median_s: 720, dwell_pairs: 5, wip: 2, rework: 3, source_rows: ['r6', 'r7'], wip_items: [{ item_id: 'UC-X', since_ts: 't1' }, { item_id: 'UC-Y', since_ts: 't2' }] },
  { stage: 'ui-validate', label: 'UI-Validate', throughput: 2, dwell_median_s: 90, dwell_pairs: 2, wip: 0, rework: 0, source_rows: ['r8'] },
  { stage: 'deploy', label: 'Deploy (gate)', throughput: 6, dwell_median_s: 45, dwell_pairs: 2, wip: 0, rework: 0, source_rows: ['r9'] },
  { stage: 'validate', label: 'Validate (tester)', throughput: 5, dwell_median_s: 3600, dwell_pairs: 2, wip: 1, rework: 2, source_rows: ['r10'] },
  { stage: 'done', label: 'Done', throughput: 5, dwell_median_s: 0, dwell_pairs: 0, wip: 0, rework: 0, source_rows: ['r11'] },
  { stage: 'rework', label: 'Rework (loop)', throughput: 0, dwell_median_s: 0, dwell_pairs: 0, wip: 0, rework: 6, source_rows: ['r12'] },
];

const TEN = ['intake', 'decompose', 'ready', 'capabilities', 'ui-design', 'engineer', 'ui-validate', 'deploy', 'validate', 'done'];

const allZeros = TEN.concat('rework').map((stage) => ({
  stage, label: stage, throughput: 0, dwell_median_s: 0, wip: 0, rework: 0, source_rows: [],
}));

describe('ValueStreamMap render (UC-S004-2/3/4)', () => {
  it('renders a labelled "Value-stream map" region with an h2 (A11Y-1)', () => {
    render(<ValueStreamMap stages={flow} />);
    expect(screen.getByRole('region', { name: /value-stream map/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /value-stream map/i })).toBeInTheDocument();
  });

  it('renders exactly 10 stage nodes (rework is a loop, not an 11th node) in canonical DOM order (AC2.2)', () => {
    render(<ValueStreamMap stages={flow} />);
    const nodes = document.querySelectorAll('[data-testid^="stage-"]');
    expect(nodes.length).toBe(10);
    const order = [...nodes].map((n) => n.getAttribute('data-testid'));
    expect(order).toEqual(TEN.map((s) => `stage-${s}`));
    // no stage node for rework — it is the loop
    expect(screen.queryByTestId('stage-rework')).toBeNull();
  });

  it('renders three labelled lanes queue/build/release (A11Y-1)', () => {
    render(<ValueStreamMap stages={flow} />);
    for (const lane of ['queue', 'build', 'release']) {
      expect(screen.getByTestId(`vsm-lane-${lane}`)).toBeInTheDocument();
    }
  });

  it('shows each stage label as the node heading', () => {
    render(<ValueStreamMap stages={flow} />);
    expect(within(screen.getByTestId('stage-engineer')).getByText(/Build \/ TDD/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-done')).getByText(/^Done$/)).toBeInTheDocument();
  });

  it('marks intake and deploy AS gates with visible "gate" text + ◇ glyph, not colour-only (AC2.3 / A11Y-5)', () => {
    render(<ValueStreamMap stages={flow} />);
    for (const g of ['intake', 'deploy']) {
      const node = screen.getByTestId(`stage-${g}`);
      expect(node).toHaveAttribute('data-stage-kind', 'gate');
      const marker = within(node).getByTestId(`gate-${g}`);
      expect(marker).toHaveTextContent(/gate/i);
      const glyph = marker.querySelector('[aria-hidden="true"]');
      expect(glyph).not.toBeNull();
      expect(glyph.textContent).toContain('◇');
    }
    // a work node is NOT a gate
    expect(screen.getByTestId('stage-engineer')).toHaveAttribute('data-stage-kind', 'work');
    expect(within(screen.getByTestId('stage-engineer')).queryByTestId('gate-engineer')).toBeNull();
  });

  it('renders the rework loop with a visible "Rework" text node OUTSIDE the aria-hidden SVG (AC2.4 / A11Y-6)', () => {
    render(<ValueStreamMap stages={flow} />);
    const loop = screen.getByTestId('rework-loop');
    expect(loop).toHaveAttribute('data-from', 'validate');
    expect(loop).toHaveAttribute('data-to', 'engineer');
    // the visible label text is a real DOM node not inside the aria-hidden svg
    const label = within(loop).getByText(/rework/i);
    expect(label.closest('svg')).toBeNull();
    // the svg path itself is decorative
    expect(loop.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows all four labelled figures per node (AC3.1) with throughput RATE + humanised dwell (DEFECT-007 / AC3.3)', () => {
    render(<ValueStreamMap stages={flow} />);
    const eng = screen.getByTestId('stage-engineer');
    // DEFECT-007: throughput headline is the RATE (7 / 2 active days = 3.5 items/day)
    expect(within(eng).getByTestId('metric-engineer-throughput')).toHaveTextContent(/Throughput/i);
    expect(within(eng).getByTestId('metric-value-engineer-throughput')).toHaveTextContent('3.5 items/day');
    // dwell 720s → 12m
    expect(within(eng).getByTestId('metric-engineer-dwell')).toHaveTextContent(/12m/);
    // rework 3
    expect(within(eng).getByTestId('metric-engineer-rework')).toHaveTextContent('3');
    // intake dwell 30 → 30s ; validate dwell 3600 → 1h
    expect(within(screen.getByTestId('stage-intake')).getByTestId('metric-intake-dwell')).toHaveTextContent(/30s/);
    expect(within(screen.getByTestId('stage-validate')).getByTestId('metric-validate-dwell')).toHaveTextContent(/1h/);
  });

  it('promotes wip>0 to a prominent in-flight badge with ● glyph + literal "in-flight" text (AC4.1 / A11Y-4)', () => {
    render(<ValueStreamMap stages={flow} />);
    const eng = screen.getByTestId('stage-engineer');
    expect(eng).toHaveAttribute('data-wip-active', 'true');
    expect(eng).toHaveAttribute('data-wip', '2');
    const badge = within(eng).getByTestId('inflight-engineer');
    expect(badge).toHaveAttribute('data-inflight', '2');
    expect(badge).toHaveTextContent(/2 in-flight/i);
    const glyph = badge.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph.textContent).toContain('●');
  });

  it('carries the in-flight signal as TEXT in the node accessible name (A11Y-2 / A11Y-4)', () => {
    render(<ValueStreamMap stages={flow} />);
    // node name carries figures incl. ", 2 in-flight"
    const eng = screen.getByRole('group', { name: /Build \/ TDD.*throughput 3\.5 items\/day.*WIP.*2 in-flight.*rework 3/i });
    expect(eng).toBeInTheDocument();
  });

  it('renders NO in-flight badge on a wip=0 node — no false positives (AC4.3)', () => {
    render(<ValueStreamMap stages={flow} />);
    const ready = screen.getByTestId('stage-ready');
    expect(ready).toHaveAttribute('data-wip-active', 'false');
    expect(within(ready).queryByTestId('inflight-ready')).toBeNull();
    // wip is still shown as a plain "WIP 0" figure
    expect(within(ready).getByTestId('metric-ready-wip')).toHaveTextContent(/WIP/i);
    expect(within(ready).getByTestId('metric-ready-wip')).toHaveTextContent('0');
  });

  it('every metric carries a non-empty data-source (SRC-1)', () => {
    render(<ValueStreamMap stages={flow} />);
    const metrics = document.querySelectorAll('[data-metric]');
    expect(metrics.length).toBeGreaterThan(0);
    metrics.forEach((m) => {
      expect(m.getAttribute('data-source')).toBeTruthy();
    });
  });

  it('renders the full 10-node labelled skeleton at all-zeros without crashing (AC2.6 / GEO-8)', () => {
    render(<ValueStreamMap stages={allZeros} />);
    expect(screen.getByRole('region', { name: /value-stream map/i })).toBeInTheDocument();
    const nodes = document.querySelectorAll('[data-testid^="stage-"]');
    expect(nodes.length).toBe(10);
    // all four zero figures still present on each node; no in-flight badge anywhere
    // (DEFECT-014: the raw count lives in the node panel's throughput summary)
    expect(within(screen.getByTestId('stage-engineer')).getByTestId('metric-source-summary-engineer-throughput')).toHaveTextContent('0 items');
    expect(document.querySelectorAll('[data-testid^="inflight-"]').length).toBe(0);
  });

  // ── DEFECT-012: the staging buffer between Decompose and Ready ────────────
  // @covers def-012 @covers StagingQueueBox
  it('renders the staging buffer box BETWEEN stage-decompose and stage-ready in the queue lane (DEFECT-012)', () => {
    const staging = {
      queue: 'staging', depth: 2,
      rows: [
        { item_id: 'UC-S015-1', job: 'WIP panel' },
        { item_id: 'UC-S015-2', job: 'Navigate views' },
      ],
    };
    render(<ValueStreamMap stages={flow} staging={staging} />);
    const lane = screen.getByTestId('vsm-lane-queue');
    const box = within(lane).getByTestId('staging-buffer');
    expect(box).toHaveAttribute('data-depth', '2');
    // DOM order carries the flow meaning: decompose → staging buffer → ready
    const decompose = screen.getByTestId('stage-decompose');
    const ready = screen.getByTestId('stage-ready');
    expect(decompose.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(ready) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the connectors route THROUGH the buffer (decompose→staging, staging→ready)
    expect(lane.querySelector('[data-from="decompose"][data-to="staging"]')).not.toBeNull();
    expect(lane.querySelector('[data-from="staging"][data-to="ready"]')).not.toBeNull();
    expect(lane.querySelector('[data-from="decompose"][data-to="ready"]')).toBeNull();
  });

  it('the staging buffer is ALWAYS visible — no staging prop → depth 0 drained empty state (buffers are visible)', () => {
    render(<ValueStreamMap stages={flow} />);
    const box = within(screen.getByTestId('vsm-lane-queue')).getByTestId('staging-buffer');
    expect(box).toHaveAttribute('data-depth', '0');
    expect(within(box).getByTestId('staging-depth')).toHaveTextContent(/0 awaiting triage/i);
    expect(within(box).getByTestId('staging-empty')).toBeInTheDocument();
  });

  it('the staging box keeps the existing guards intact: still exactly 10 stage-* nodes, no new data-metric (DEFECT-012)', () => {
    render(<ValueStreamMap stages={flow} staging={{ depth: 1, rows: [{ item_id: 'UC-X', job: 'j' }] }} />);
    expect(document.querySelectorAll('[data-testid^="stage-"]').length).toBe(10);
    const box = screen.getByTestId('staging-buffer');
    expect(box.querySelectorAll('[data-metric]').length).toBe(0);
    expect(box.querySelectorAll('button, a[href], [tabindex]').length).toBe(0);
  });

  it('renders a graceful skeleton when stages is null/empty (fail-soft from getStageFlow null)', () => {
    render(<ValueStreamMap stages={null} />);
    // region still present; 10 zeroed nodes rendered as the skeleton, never blank/crash
    expect(screen.getByRole('region', { name: /value-stream map/i })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="stage-"]').length).toBe(10);
  });
});
