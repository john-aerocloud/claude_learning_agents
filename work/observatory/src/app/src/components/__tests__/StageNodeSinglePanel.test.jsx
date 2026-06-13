// @covers def-014
// @covers StageNode
// @covers MetricSource
// DEFECT-014 — hovering a queue/stage node opened ALL FOUR metric-source panels
// absolutely positioned into an overlapping stack ("4 identical panels").
// UI-designer ruling (b): the node-scoped reveal opens ONE composite panel
// containing all four metrics SECTIONED. These specs pin the ruling's testable
// conditions D14-AC-1..6 at the unit (jsdom) level; the geometry half of
// D14-AC-5 lives in e2e/metric-source-single-panel.spec.js.
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent, createEvent } from '@testing-library/preact';
import { StageNode } from '../StageNode.jsx';

const engineer = {
  stage: 'engineer',
  label: 'Build / TDD (engineer)',
  throughput: 7,
  throughput_per_active_day: 3.5,
  active_days: 2,
  dwell_median_s: 720,
  dwell_pairs: 3,
  wip: 2,
  rework: 3,
  source_rows: ['row:34', 'row:35'],
  source_events: [
    { ts: '2026-06-09T14:36:00Z', agent: 'engineer', event: 'stage_exit', item_id: 'UC-S001-1' },
    { ts: '2026-06-09T15:10:00Z', agent: 'engineer', event: 'task_start', item_id: 'UC-S002-3' },
  ],
  source_total: 2,
};

const readyQueue = {
  stage: 'ready',
  label: 'Ready (queue)',
  throughput: 0,
  dwell_median_s: 0,
  wip: 0,
  rework: 0,
  queue_depth: 1,
  queue_items: [{ item_id: 'D-4', wait_s: 120 }],
  source_rows: [],
  source_events: [],
  source_total: 0,
};

const zeroStage = {
  stage: 'deploy',
  label: 'Deploy (gate)',
  throughput: 0,
  dwell_median_s: 0,
  wip: 0,
  rework: 0,
  source_rows: [],
  source_events: [],
  source_total: 0,
};

function visibleTooltips(node) {
  return node.querySelectorAll('[role="tooltip"]:not([hidden])');
}

describe('DEFECT-014 — single composite MetricSource panel per node', () => {
  it('D14-AC-1 — open node shows EXACTLY ONE visible tooltip; closed shows ZERO', () => {
    render(<StageNode data={engineer} />);
    const node = screen.getByTestId('stage-engineer');
    // closed: zero visible
    expect(visibleTooltips(node).length).toBe(0);
    // hover-open: exactly one — never four (the reproduction)
    fireEvent.mouseEnter(node);
    expect(visibleTooltips(node).length).toBe(1);
    fireEvent.mouseLeave(node);
    expect(visibleTooltips(node).length).toBe(0);
  });

  it('D14-AC-5 (DOM half) — the panel is rendered ONCE per node, not once per figure', () => {
    render(<StageNode data={engineer} />);
    const node = screen.getByTestId('stage-engineer');
    // a single role=tooltip element exists at all (open OR closed) — the
    // four-per-node render that caused the y=381/381/432/483 stack is gone
    expect(node.querySelectorAll('[role="tooltip"]').length).toBe(1);
    // and it is the node-scoped container (no -<kind> suffix)
    const panel = screen.getByTestId('metric-source-engineer');
    expect(panel).toHaveAttribute('role', 'tooltip');
  });

  it('D14-AC-2 — the one panel contains a labelled section per metric, content intact', () => {
    render(<StageNode data={engineer} />);
    fireEvent.mouseEnter(screen.getByTestId('stage-engineer'));
    const panel = screen.getByTestId('metric-source-engineer');
    expect(panel).not.toHaveAttribute('hidden');
    // a section for EACH metric the node renders, INSIDE the one panel,
    // keeping the old per-kind testid (selector contract)
    for (const kind of ['throughput', 'dwell', 'wip', 'rework']) {
      const section = within(panel).getByTestId(`metric-source-engineer-${kind}`);
      // labelled (the metric name is visible in the section)
      expect(section.textContent).toMatch(new RegExp(kind === 'wip' ? 'WIP' : kind, 'i'));
      // names the source file (selector unchanged)
      expect(within(section).getByTestId(`source-file-engineer-${kind}`)).toHaveTextContent(
        'process/dora/ledger.csv',
      );
    }
    // DEFECT-005 readable event lines still render (never row:N)
    const tpSection = within(panel).getByTestId('metric-source-engineer-throughput');
    expect(tpSection).toHaveTextContent('stage_exit');
    expect(tpSection).toHaveTextContent('UC-S001-1');
    expect(tpSection.textContent).not.toMatch(/\brow:\d+/);
    // DEFECT-007 throughput summary renders VERBATIM in its section
    expect(
      within(tpSection).getByTestId('metric-source-summary-engineer-throughput'),
    ).toHaveTextContent('7 items over 2 active days (3.5 items/day)');
  });

  it('D14-AC-2 — a queue node sections Depth (not WIP); empty metrics keep "no events recorded"', () => {
    render(<StageNode data={readyQueue} />);
    fireEvent.mouseEnter(screen.getByTestId('stage-ready'));
    const panel = screen.getByTestId('metric-source-ready');
    expect(within(panel).getByTestId('metric-source-ready-depth')).toBeTruthy();
    expect(within(panel).queryByTestId('metric-source-ready-wip')).toBeNull();
    // zero-event sections show the AC5.3 empty state, not blank/broken
    const tp = within(panel).getByTestId('metric-source-ready-throughput');
    expect(tp).toHaveTextContent(/no events recorded/i);
  });

  it('D14-AC-2 — a zero work stage shows the empty state in every section', () => {
    render(<StageNode data={zeroStage} />);
    fireEvent.mouseEnter(screen.getByTestId('stage-deploy'));
    const panel = screen.getByTestId('metric-source-deploy');
    for (const kind of ['throughput', 'dwell', 'wip', 'rework']) {
      expect(within(panel).getByTestId(`metric-source-deploy-${kind}`)).toHaveTextContent(
        /no events recorded/i,
      );
    }
  });

  it('D14-AC-3 — keyboard (focus + Enter) reaches the SAME exactly-one-visible state as hover', () => {
    render(<StageNode data={engineer} />);
    const node = screen.getByTestId('stage-engineer');
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(visibleTooltips(node).length).toBe(1);
    expect(screen.getByTestId('metric-source-engineer')).not.toHaveAttribute('hidden');
  });

  it('D14-AC-3 — Space opens too (keyboard parity, not downgraded)', () => {
    render(<StageNode data={engineer} />);
    const node = screen.getByTestId('stage-engineer');
    node.focus();
    fireEvent.keyDown(node, { key: ' ' });
    expect(visibleTooltips(node).length).toBe(1);
  });

  it('D14-AC-4 — Esc, mouse-leave AND blur each close the panel (count → 0)', () => {
    render(<StageNode data={engineer} />);
    const node = screen.getByTestId('stage-engineer');

    fireEvent.keyDown(node, { key: 'Enter' });
    expect(visibleTooltips(node).length).toBe(1);
    fireEvent.keyDown(node, { key: 'Escape' });
    expect(visibleTooltips(node).length).toBe(0);

    fireEvent.mouseEnter(node);
    expect(visibleTooltips(node).length).toBe(1);
    fireEvent.mouseLeave(node);
    expect(visibleTooltips(node).length).toBe(0);

    fireEvent.mouseEnter(node);
    expect(visibleTooltips(node).length).toBe(1);
    // preact/compat (loaded via the SteerMenu portal chain) maps onBlur to a
    // bubbling focusout listener, so a focusout event is the faithful blur
    // simulation in jsdom (fireEvent.blur dispatches a bare `blur` the compat
    // listener never sees; the real browser fires focusout natively).
    fireEvent(node, createEvent.focusOut(node));
    expect(visibleTooltips(node).length).toBe(0);
  });

  it('D14-AC-6 — every metric value/badge aria-describedby resolves to a section INSIDE the one panel', () => {
    render(<StageNode data={engineer} />);
    const node = screen.getByTestId('stage-engineer');
    const panel = screen.getByTestId('metric-source-engineer');
    const metrics = node.querySelectorAll('[data-metric]');
    expect(metrics.length).toBeGreaterThan(0);
    metrics.forEach((m) => {
      const id = m.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      const target = document.getElementById(id);
      expect(target).toBeTruthy();
      // the value→provenance relationship survives: the described-by target
      // lives inside the shared role=tooltip panel
      expect(panel.contains(target)).toBe(true);
    });
  });

  it('D14-AC-6 — the panel keeps the .metric-source overlay class (pointer-events:none in CSS)', () => {
    // jsdom does not apply external CSS; the computed pointer-events assertion
    // lives in the browser spec. Here we pin the class the rule targets.
    render(<StageNode data={engineer} />);
    const panel = screen.getByTestId('metric-source-engineer');
    expect(panel.classList.contains('metric-source')).toBe(true);
  });

  it('node state attr unchanged — data-source-open mirrors the open state', () => {
    render(<StageNode data={engineer} />);
    const node = screen.getByTestId('stage-engineer');
    expect(node).toHaveAttribute('data-source-open', 'false');
    fireEvent.mouseEnter(node);
    expect(node).toHaveAttribute('data-source-open', 'true');
  });
});
