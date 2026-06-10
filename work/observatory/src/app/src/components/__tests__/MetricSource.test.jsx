// @covers MetricSource
// DEFECT-005 — the traceability reveal must show READABLE contributing ledger
// EVENTS (HH:MM · agent · event · item_id), name the source file, and handle
// many events (most recent ~8 + "…and N more") — never a bare list of "row:N".
//
// Pins:
//   - value>0 → readable lines, one per event (no "row:N" visible to the operator)
//   - names the source file "process/dora/ledger.csv" at the top of the reveal
//   - many events → shows MAX_EVENTS_SHOWN most recent + "…and N more"
//   - value=0 / no events → "no events recorded" (AC5.3 preserved)
//   - keeps role="tooltip" + a per-line data-source-row audit attribute
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { MetricSource } from '../MetricSource.jsx';

const events = [
  { ts: '2026-06-09T14:36:00Z', agent: 'engineer', event: 'stage_exit', item_id: 'UC-S001-1' },
  { ts: '2026-06-09T15:10:00Z', agent: 'engineer', event: 'task_start', item_id: 'UC-S002-3' },
];

function renderSource(props) {
  return render(
    <MetricSource id="src-engineer-throughput" stage="engineer" kind="throughput" open {...props} />,
  );
}

describe('MetricSource readable traceability (DEFECT-005)', () => {
  it('renders one readable line per event: HH:MM · agent · event · item_id', () => {
    renderSource({ sourceEvents: events, sourceTotal: 2 });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    // local HH:MM rendering is timezone-dependent, so assert the stable parts
    expect(panel).toHaveTextContent('engineer');
    expect(panel).toHaveTextContent('stage_exit');
    expect(panel).toHaveTextContent('UC-S001-1');
    expect(panel).toHaveTextContent('task_start');
    expect(panel).toHaveTextContent('UC-S002-3');
    // a time fragment HH:MM is present
    expect(panel.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it('names the source file at the top of the reveal', () => {
    renderSource({ sourceEvents: events, sourceTotal: 2 });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel).toHaveTextContent('process/dora/ledger.csv');
  });

  it('NEVER shows a bare "row:N" to the operator', () => {
    renderSource({ sourceEvents: events, sourceTotal: 2 });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel.textContent).not.toMatch(/\brow:\d+/);
  });

  it('shows the most recent ~8 events and "…and N more" when there are many', () => {
    const many = [];
    for (let i = 0; i < 30; i++) {
      many.push({ ts: `2026-06-09T14:${String(i % 60).padStart(2, '0')}:00Z`, agent: 'engineer', event: 'task_start', item_id: `UC-${i}` });
    }
    renderSource({ sourceEvents: many, sourceTotal: 85 });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    const lines = within(panel).getAllByTestId('source-event');
    expect(lines.length).toBeLessThanOrEqual(8);
    // 85 total, 8 shown → 77 more
    expect(panel).toHaveTextContent(/and\s+77\s+more/i);
  });

  it('does not show "…and N more" when all events fit', () => {
    renderSource({ sourceEvents: events, sourceTotal: 2 });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel.textContent).not.toMatch(/and\s+\d+\s+more/i);
  });

  it('keeps "no events recorded" for the empty case (AC5.3)', () => {
    renderSource({ sourceEvents: [], sourceTotal: 0 });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel).toHaveTextContent(/no events recorded/i);
  });

  it('keeps role="tooltip" and a per-line data-source-row audit attribute', () => {
    renderSource({ sourceEvents: events, sourceTotal: 2 });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel).toHaveAttribute('role', 'tooltip');
    const lines = within(panel).getAllByTestId('source-event');
    lines.forEach((l) => expect(l.getAttribute('data-source-row')).toBeTruthy());
  });

  it('DEFECT-008: renders the note after the item_id (HH:MM · agent · event · item_id — note)', () => {
    renderSource({
      sourceEvents: [
        { ts: '2026-06-09T14:50:00Z', agent: 'product', event: 'task_start', item_id: 'SLC-vision', note: 'Gate-1 vision: JTBD + success measures authored' },
      ],
      sourceTotal: 1,
    });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    const line = within(panel).getByTestId('source-event');
    expect(line.textContent).toContain('SLC-vision');
    expect(line.textContent).toContain('Gate-1 vision: JTBD + success measures authored');
    // an em-dash separates the id from its note
    expect(line.textContent).toMatch(/SLC-vision\s+—\s+Gate-1 vision/);
  });

  it('DEFECT-008: ellipsises a very long note so the reveal line does not blow out', () => {
    const longNote = 'x'.repeat(300);
    renderSource({
      sourceEvents: [
        { ts: '2026-06-09T14:50:00Z', agent: 'product', event: 'task_start', item_id: 'SLC-vision', note: longNote },
      ],
      sourceTotal: 1,
    });
    const line = within(screen.getByTestId('metric-source-engineer-throughput')).getByTestId('source-event');
    // truncated well below the raw length, ending with an ellipsis
    expect(line.textContent.length).toBeLessThan(200);
    expect(line.textContent).toContain('…');
  });

  it('DEFECT-008: empty note → no trailing em-dash (falls back cleanly to the id)', () => {
    renderSource({
      sourceEvents: [
        { ts: '2026-06-09T14:50:00Z', agent: 'engineer', event: 'task_start', item_id: 'UC-Y', note: '' },
      ],
      sourceTotal: 1,
    });
    const line = within(screen.getByTestId('metric-source-engineer-throughput')).getByTestId('source-event');
    expect(line.textContent).toContain('UC-Y');
    expect(line.textContent).not.toContain('—');
  });

  it('DEFECT-008: the audit ref still carries the ledger fields and never row:N', () => {
    renderSource({
      sourceEvents: [
        { ts: '2026-06-09T14:50:00Z', agent: 'product', event: 'task_start', item_id: 'SLC-vision', note: 'Gate-1 vision' },
      ],
      sourceTotal: 1,
    });
    const line = within(screen.getByTestId('metric-source-engineer-throughput')).getByTestId('source-event');
    const ref = line.getAttribute('data-source-row');
    expect(ref).toContain('SLC-vision');
    expect(ref).not.toMatch(/\brow:\d+/);
  });

  it('stays hidden until open', () => {
    const { container } = render(
      <MetricSource id="x" stage="engineer" kind="throughput" sourceEvents={events} sourceTotal={2} />,
    );
    expect(container.querySelector('[data-testid="metric-source-engineer-throughput"]')).toHaveAttribute('hidden');
  });

  it('never leaks row:N even if only the legacy source_rows shape is passed (defensive)', () => {
    renderSource({ sourceRows: ['row:34', 'row:35'], sourceEvents: undefined, sourceTotal: undefined });
    const panel = screen.getByTestId('metric-source-engineer-throughput');
    expect(panel.textContent).not.toMatch(/\brow:\d+/);
    expect(panel).toHaveTextContent(/no events recorded/i);
  });
});
