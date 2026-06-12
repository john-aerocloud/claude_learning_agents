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

// DEFECT-007 — throughput headline now shows the RATE (items/day), so fixtures
// carry the new rate fields. throughput stays as the raw count (numerator).
const workStage = {
  stage: 'engineer',
  label: 'Build / TDD (engineer)',
  throughput: 13,
  active_days: 2,
  throughput_per_active_day: 6.5,
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
  active_days: 3,
  throughput_per_active_day: 1,
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

// DEFECT-007 — D7-AC-1/AC-5: the headline throughput figure is a RATE with a
// per-time unit (/day), never a bare count. Format rules per ruling §3.
describe('StageNode — throughput RATE headline (DEFECT-007 D7-AC-1/AC-5)', () => {
  it('renders the rate with the /day unit (non-integer → 1 dp)', () => {
    render(<StageNode data={workStage} />);
    const v = screen.getByTestId('metric-value-engineer-throughput');
    expect(v.textContent).toBe('6.5 items/day');
    expect(v.textContent).toMatch(/[\d.]+ items?\/day/);
  });

  it('D7-AC-5: rate exactly 1.0 → singular "1 item/day"', () => {
    render(<StageNode data={{ ...workStage, throughput: 3, active_days: 3, throughput_per_active_day: 1 }} />);
    expect(screen.getByTestId('metric-value-engineer-throughput').textContent).toBe('1 item/day');
  });

  it('integer rate > 1 drops the trailing .0 → "6 items/day"', () => {
    render(<StageNode data={{ ...workStage, throughput: 12, active_days: 2, throughput_per_active_day: 6 }} />);
    expect(screen.getByTestId('metric-value-engineer-throughput').textContent).toBe('6 items/day');
  });

  it('rate < 1 keeps the decimal, never "<1" → "0.3 items/day"', () => {
    render(<StageNode data={{ ...workStage, throughput: 3, active_days: 10, throughput_per_active_day: 0.3 }} />);
    const t = screen.getByTestId('metric-value-engineer-throughput').textContent;
    expect(t).toBe('0.3 items/day');
    expect(t).not.toMatch(/<1/);
  });

  it('D7-AC-5: null rate (0 active days) → "—"', () => {
    render(<StageNode data={{ ...workStage, throughput: 0, active_days: 0, throughput_per_active_day: null }} />);
    expect(screen.getByTestId('metric-value-engineer-throughput').textContent).toBe('—');
  });

  it('D7-AC-1: headline is never a bare count (no /^\\d+ items?$/)', () => {
    render(<StageNode data={workStage} />);
    const t = screen.getByTestId('metric-value-engineer-throughput').textContent.trim();
    expect(t).not.toMatch(/^\d+ items?$/);
    expect(t).toMatch(/[\d.]+ items?\/day|—/);
  });
});

// DEFECT-007 — D7-AC-4: the raw COUNT is demoted to the source/hover line, not lost.
describe('StageNode — throughput source line keeps the count (D7-AC-4)', () => {
  it('source panel reveals "<count> items over <d> active days (<rate>)"', () => {
    render(<StageNode data={workStage} />);
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel.textContent).toMatch(/13 items over 2 active days/);
    expect(panel.textContent).toMatch(/\d+ items? over \d+ active days?/);
    expect(panel.textContent).toContain('6.5 items/day');
  });

  it('source panel shows "0 items (no active days in window)" when active_days=0', () => {
    render(<StageNode data={{ ...workStage, throughput: 0, active_days: 0, throughput_per_active_day: null }} />);
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel.textContent).toMatch(/0 items \(no active days in window\)/);
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

// DEFECT-013 — the API now sends READABLE drift reasons (coherence_warnings).
// The stage box shows the reason itself (registry drift on a WORK stage must
// not masquerade as a queue-count problem); the boolean-only legacy payload
// keeps the AC-6 fallback text. Non-colour cue: visible role=status text +
// data-coherence attribute (both already non-colour; AC-6 heritage).
describe('StageNode — readable coherence reasons (DEFECT-013)', () => {
  it('renders each coherence_warnings reason verbatim on the stage box', () => {
    render(
      <StageNode
        data={{
          ...workStage,
          coherence_warning: true,
          coherence_warnings: ['UC-S014-4 open in engineer but registry says planned'],
        }}
      />,
    );
    const node = screen.getByTestId('stage-engineer');
    expect(node.getAttribute('data-coherence')).toBe('warning');
    const status = screen.getByTestId('coherence-engineer');
    expect(status.textContent).toContain('UC-S014-4 open in engineer but registry says planned');
    // a registry-drift reason must NOT be mislabelled as a queue-count problem
    expect(status.textContent).not.toMatch(/queue count mismatch/i);
  });

  it('falls back to the AC-6 queue text when the warning is boolean-only (no reasons)', () => {
    render(<StageNode data={{ ...readyStage, coherence_warning: true, coherence_warnings: [] }} />);
    expect(screen.getByTestId('coherence-ready').textContent).toMatch(/queue count mismatch/i);
  });

  it('no reasons and no boolean → no status element at all', () => {
    render(<StageNode data={{ ...workStage, coherence_warnings: [] }} />);
    expect(screen.queryByTestId('coherence-engineer')).toBeNull();
  });
});

describe('StageNode — accessible name carries the throughput RATE (DEFECT-007 D7-AC-6)', () => {
  // Ruling D7-AC-6 pattern (supersedes D4-AC-7 for throughput): the rate token
  // carries the /day unit. Queue branch admits the optional "(longest wait …)".
  const pat = /.+ stage, throughput ([\d.]+ items?\/day|—), dwell .+, (depth \d+ queued[^,]*|WIP \d+(, \d+ in-flight)?), rework \d+ rework/;

  it('work stage aria-label carries "throughput N items/day"', () => {
    render(<StageNode data={workStage} />);
    const name = screen.getByTestId('stage-engineer').getAttribute('aria-label');
    expect(name).toMatch(pat);
    expect(name).toContain('throughput 6.5 items/day');
    expect(name).toContain('WIP');
    expect(name).toContain('rework 3 rework');
  });

  it('queue stage aria-label uses the rate + "depth N queued"', () => {
    render(<StageNode data={readyStage} />);
    const name = screen.getByTestId('stage-ready').getAttribute('aria-label');
    expect(name).toMatch(pat);
    expect(name).toContain('depth 2 queued');
    expect(name).toContain('throughput 1 item/day');
  });

  it('null rate → accessible name reads "throughput —"', () => {
    render(<StageNode data={{ ...workStage, throughput: 0, active_days: 0, throughput_per_active_day: null }} />);
    const name = screen.getByTestId('stage-engineer').getAttribute('aria-label');
    expect(name).toMatch(/throughput —/);
  });

  it('no bare metric number in any [data-metric] visible text', () => {
    render(<StageNode data={readyStage} />);
    for (const el of document.querySelectorAll('[data-metric]')) {
      // every metric value carries a unit word or em-dash, never a lone integer
      expect(el.textContent.trim()).not.toMatch(/^\d+$/);
    }
  });
});
