// @covers StageNode
// @covers MetricSource
// UC-S004-5 — metric TRACEABILITY reveal specs (jsdom). Drives the MetricSource
// affordance that lets an operator see WHERE a figure came from (the ledger
// source_rows) so they can open ledger.csv and verify the claim independently.
//
// Pins (acceptance.md UC-S004-5 + A11Y-8/10 + SRC-1):
//   AC5.1 — focusing/Enter on a node reveals a source panel per metric with >=1 row ref.
//   AC5.2 — the source ref is non-empty when value>0 (real ledger row, not placeholder).
//   AC5.3 — value=0 shows "no events recorded", not a blank/broken panel.
//   A11Y-10 — reveal opens on focus+Enter (not hover-only), closes on Esc,
//             referenced by the metric via aria-describedby.
//   A11Y-8  — the trigger is keyboard-reachable (the focusable node).
//   SRC-1   — every [data-metric] keeps its non-empty data-source attribute.
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/preact';
import { StageNode } from '../StageNode.jsx';

const engineer = {
  stage: 'engineer',
  label: 'Build / TDD (engineer)',
  throughput: 7,
  dwell_median_s: 720,
  wip: 2,
  rework: 3,
  // DEFECT-005: source_rows kept for the data-source audit attr; the reveal
  // renders the readable source_events instead of bare row:N.
  source_rows: ['row:34', 'row:35'],
  source_events: [
    { ts: '2026-06-09T14:36:00Z', agent: 'engineer', event: 'stage_exit', item_id: 'UC-S001-1' },
    { ts: '2026-06-09T15:10:00Z', agent: 'engineer', event: 'task_start', item_id: 'UC-S002-3' },
  ],
  source_total: 2,
};

const zeroStage = {
  stage: 'ready',
  label: 'Ready (queue)',
  throughput: 0,
  dwell_median_s: 0,
  wip: 0,
  rework: 0,
  source_rows: [],
  source_events: [],
  source_total: 0,
};

function renderNode(data) {
  // StageNode is normally rendered inside a <dl>/lane; wrap so the <dt>/<dd>
  // figures are valid and queryable.
  return render(<StageNode data={data} />);
}

describe('StageNode metric traceability (UC-S004-5)', () => {
  it('keeps a non-empty data-source on every [data-metric] (SRC-1)', () => {
    renderNode(engineer);
    const metrics = document.querySelectorAll('[data-metric]');
    expect(metrics.length).toBeGreaterThan(0);
    metrics.forEach((m) => expect(m.getAttribute('data-source')).toBeTruthy());
  });

  it('hides the source panels until revealed (no premature reveal)', () => {
    renderNode(engineer);
    // panels exist in the DOM for aria-describedby wiring but are hidden by default
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel).toHaveAttribute('hidden');
  });

  it('each metric value is wired to its source panel via aria-describedby (A11Y-10)', () => {
    renderNode(engineer);
    const value = within(screen.getByTestId('metric-engineer-throughput')).getByTestId(
      'metric-value-engineer-throughput',
    );
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(value.getAttribute('aria-describedby')).toBe(panel.id);
    expect(panel.id).toBeTruthy();
  });

  it('reveals the source rows on focus+Enter of the node (A11Y-10, not hover-only) — AC5.1/5.2', () => {
    renderNode(engineer);
    const node = screen.getByTestId('stage-engineer');
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel).not.toHaveAttribute('hidden');
    // DEFECT-005: readable contributing EVENTS, not bare row:N
    expect(panel).toHaveTextContent('stage_exit');
    expect(panel).toHaveTextContent('UC-S001-1');
    expect(panel).toHaveTextContent('task_start');
    expect(panel.textContent).not.toMatch(/\brow:\d+/);
    // names the source file so the operator can open it
    expect(panel).toHaveTextContent('process/dora/ledger.csv');
    // the visible "source" affordance carries text, not colour-only
    expect(panel).toHaveTextContent(/source/i);
  });

  it('closes the reveal on Esc (A11Y-10 dismissible)', () => {
    renderNode(engineer);
    const node = screen.getByTestId('stage-engineer');
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(screen.getByTestId('metric-source-engineer-throughput')).not.toHaveAttribute('hidden');
    fireEvent.keyDown(node, { key: 'Escape' });
    expect(screen.getByTestId('metric-source-engineer-throughput')).toHaveAttribute('hidden');
  });

  it('reveals on hover (mouseenter) as an alternative to keyboard (AC5.1 click-or-hover)', () => {
    renderNode(engineer);
    const node = screen.getByTestId('stage-engineer');
    fireEvent.mouseEnter(node);
    expect(screen.getByTestId('metric-source-engineer-throughput')).not.toHaveAttribute('hidden');
    fireEvent.mouseLeave(node);
    expect(screen.getByTestId('metric-source-engineer-throughput')).toHaveAttribute('hidden');
  });

  it('shows "no events recorded" for a zero metric instead of a blank/broken panel (AC5.3)', () => {
    renderNode(zeroStage);
    const node = screen.getByTestId('stage-ready');
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    const panel = screen.getByTestId('metric-source-ready-throughput');
    expect(panel).toHaveTextContent(/no events recorded/i);
  });

  it('the source panel has role="tooltip" so it is announced as the metric description (A11Y-10)', () => {
    renderNode(engineer);
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel).toHaveAttribute('role', 'tooltip');
  });
});
