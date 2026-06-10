// @covers StageNode
// DEFECT-004 (parts 2+3) — units/labels on every figure + queue current-state.
// Pins the product ruling ACs:
//   AC-1 throughput visible text matches /\d+ items?/ (never bare integer)
//   AC-2 dwell shows "—" when < 2 completed pairs (dwell_pairs < 2)
//   AC-3 queue (buffer) stages show "N queued" labelled "Depth" (not WIP)
//   AC-5 each queued item shows id + humanised accruing wait (data-wait-s)
//   AC-6 coherence_warning → visible "queue count mismatch" + data-coherence
//   AC-7 accessible name carries units (no bare metric number)
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { StageNode } from '../StageNode.jsx';

const workStage = {
  stage: 'engineer',
  label: 'Build / TDD (engineer)',
  throughput: 7,
  dwell_median_s: 720,
  dwell_pairs: 5,
  wip: 2,
  rework: 3,
  source_rows: ['row:34'],
  queue_depth: null,
  queue_items: null,
  coherence_warning: false,
};

const readyStage = {
  stage: 'ready',
  label: 'Ready (queue)',
  throughput: 3,
  dwell_median_s: 0,
  dwell_pairs: 0,
  wip: 0,
  rework: 0,
  source_rows: ['row:10'],
  queue_depth: 2,
  queue_items: [
    { item_id: 'UC-S005-5', enqueued_at: '2026-06-10T08:00:00Z', wait_s: 7200 },
    { item_id: 'UC-S005-4', enqueued_at: '2026-06-10T07:00:00Z', wait_s: 10800 },
  ],
  coherence_warning: false,
};

describe('StageNode — throughput unit (AC-1)', () => {
  it('renders throughput as "N items" (plural)', () => {
    render(<StageNode data={workStage} />);
    const v = screen.getByTestId('metric-value-engineer-throughput');
    expect(v.textContent).toMatch(/\d+ items?/);
    expect(v.textContent).toBe('7 items');
  });

  it('uses the singular "1 item"', () => {
    render(<StageNode data={{ ...workStage, throughput: 1 }} />);
    expect(screen.getByTestId('metric-value-engineer-throughput').textContent).toBe('1 item');
  });

  it('renders "0 items" (never a bare 0)', () => {
    render(<StageNode data={{ ...workStage, throughput: 0 }} />);
    expect(screen.getByTestId('metric-value-engineer-throughput').textContent).toBe('0 items');
  });
});

describe('StageNode — dwell "—" when insufficient data (AC-2)', () => {
  it('shows "—" when dwell_pairs < 2', () => {
    render(<StageNode data={{ ...workStage, dwell_pairs: 1, dwell_median_s: 50 }} />);
    expect(screen.getByTestId('metric-value-engineer-dwell').textContent).toBe('—');
  });

  it('shows "—" when dwell_pairs is 0', () => {
    render(<StageNode data={{ ...workStage, dwell_pairs: 0, dwell_median_s: 0 }} />);
    expect(screen.getByTestId('metric-value-engineer-dwell').textContent).toBe('—');
  });

  it('shows the humanised dwell when dwell_pairs >= 2', () => {
    render(<StageNode data={{ ...workStage, dwell_pairs: 5, dwell_median_s: 720 }} />);
    expect(screen.getByTestId('metric-value-engineer-dwell').textContent).toBe('12m');
  });
});

describe('StageNode — rework label (AC, per-figure unit table)', () => {
  it('renders rework as "N rework"', () => {
    render(<StageNode data={workStage} />);
    expect(screen.getByTestId('metric-value-engineer-rework').textContent).toBe('3 rework');
  });
});

describe('StageNode — queue (buffer) stage current state (AC-3/AC-5)', () => {
  it('shows a Depth figure "N queued" labelled "Depth" (NOT WIP)', () => {
    render(<StageNode data={readyStage} />);
    const depth = screen.getByTestId('metric-ready-depth');
    expect(within(depth).getByText('Depth')).toBeTruthy();
    expect(screen.getByTestId('metric-value-ready-depth').textContent).toBe('2 queued');
    // a buffer stage must NOT render the plain WIP metric
    expect(screen.queryByTestId('metric-ready-wip')).toBeNull();
  });

  it('lists each queued item with id + humanised accruing wait + data-wait-s (AC-5)', () => {
    render(<StageNode data={readyStage} />);
    const row5 = screen.getByTestId('queued-item-ready-UC-S005-5');
    expect(row5.textContent).toContain('UC-S005-5');
    expect(row5.textContent).toContain('2h');
    expect(row5.getAttribute('data-wait-s')).toBe('7200');
    const row4 = screen.getByTestId('queued-item-ready-UC-S005-4');
    expect(row4.textContent).toContain('3h');
  });

  it('shows "0 queued" with no item rows when queue is empty', () => {
    render(<StageNode data={{ ...readyStage, queue_depth: 0, queue_items: [] }} />);
    expect(screen.getByTestId('metric-value-ready-depth').textContent).toBe('0 queued');
    expect(screen.queryByTestId('queued-item-ready-UC-S005-5')).toBeNull();
  });

  it('truncates to first 3 items + "... +N more" while depth shows full count', () => {
    const many = {
      ...readyStage,
      queue_depth: 5,
      queue_items: [1, 2, 3, 4, 5].map((n) => ({
        item_id: `UC-${n}`,
        enqueued_at: '2026-06-10T08:00:00Z',
        wait_s: 60 * n,
      })),
    };
    render(<StageNode data={many} />);
    expect(screen.getByTestId('metric-value-ready-depth').textContent).toBe('5 queued');
    expect(screen.getByTestId('queued-item-ready-UC-1')).toBeTruthy();
    expect(screen.getByTestId('queued-item-ready-UC-3')).toBeTruthy();
    expect(screen.queryByTestId('queued-item-ready-UC-4')).toBeNull();
    expect(screen.getByTestId('queue-more-ready').textContent).toMatch(/\+2 more/);
  });
});

describe('StageNode — coherence warning (AC-6)', () => {
  it('shows visible "queue count mismatch" text + data-coherence=warning when set', () => {
    render(<StageNode data={{ ...readyStage, coherence_warning: true }} />);
    const node = screen.getByTestId('stage-ready');
    expect(node.getAttribute('data-coherence')).toBe('warning');
    expect(node.textContent).toMatch(/queue count mismatch/i);
  });

  it('no warning text or attribute when coherent', () => {
    render(<StageNode data={readyStage} />);
    const node = screen.getByTestId('stage-ready');
    expect(node.getAttribute('data-coherence')).not.toBe('warning');
    expect(node.textContent).not.toMatch(/queue count mismatch/i);
  });
});

describe('StageNode — accessible name carries units (AC-7)', () => {
  // Ruling AC-7 pattern; the queue branch admits the optional "(longest wait …)" suffix.
  const pat = /.+ stage, throughput \d+ items?, dwell .+, (depth \d+ queued[^,]*|WIP \d+(, \d+ in-flight)?), rework \d+ rework/;

  it('work stage aria-label matches the unit pattern with WIP', () => {
    render(<StageNode data={workStage} />);
    const name = screen.getByTestId('stage-engineer').getAttribute('aria-label');
    expect(name).toMatch(pat);
    expect(name).toContain('throughput 7 items');
    expect(name).toContain('WIP');
    expect(name).toContain('rework 3 rework');
  });

  it('queue stage aria-label uses "depth N queued"', () => {
    render(<StageNode data={readyStage} />);
    const name = screen.getByTestId('stage-ready').getAttribute('aria-label');
    expect(name).toMatch(pat);
    expect(name).toContain('depth 2 queued');
    expect(name).toContain('throughput 3 items');
  });

  it('no bare metric number in any [data-metric] visible text', () => {
    render(<StageNode data={readyStage} />);
    for (const el of document.querySelectorAll('[data-metric]')) {
      // every metric value carries a unit word or em-dash, never a lone integer
      expect(el.textContent.trim()).not.toMatch(/^\d+$/);
    }
  });
});
