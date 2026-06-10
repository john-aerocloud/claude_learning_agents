// @covers ItemHistoryPanel
// UC-S005-5 — the item-history sub-panel mounted in the detail pane's
// item-history-slot. It renders the item's ledger rows (from
// GET /api/projects/:id/ledger?item_id=<id>, newest-first) as READABLE lines —
// the SAME human-readable style as the DEFECT-005 source reveal
// ("HH:MM · agent · event · outcome"), NOT raw row indices.
//
// Pins (acceptance.md):
//   - AC-S005-5-3 each row shows timestamp, event, agent (and outcome/duration when present)
//   - AC-S005-5-2 rows render newest-first (data-timestamp on each row)
//   - AC-S005-5-4 empty history → "no history" placeholder, no crash
//   - GEO-S005-2 rows are role=list items (vertical stack)
//   - never shows a bare "row:N" index to the operator
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { ItemHistoryPanel } from '../ItemHistoryPanel.jsx';

const rows = [
  {
    timestamp: '2026-06-09T15:10:00Z',
    agent: 'engineer',
    event: 'task_end',
    duration_s: '300',
    outcome: 'success',
    note: 'done',
    item_id: 'UC-S001-1',
  },
  {
    timestamp: '2026-06-09T14:36:00Z',
    agent: 'engineer',
    event: 'task_start',
    outcome: 'na',
    note: 'started',
    item_id: 'UC-S001-1',
  },
];

describe('ItemHistoryPanel readable ledger history (UC-S005-5)', () => {
  it('renders one readable row per ledger row: agent · event · outcome', () => {
    render(<ItemHistoryPanel rows={rows} itemId="UC-S001-1" />);
    const panel = screen.getByTestId('item-history');
    expect(panel).toHaveTextContent('engineer');
    expect(panel).toHaveTextContent('task_end');
    expect(panel).toHaveTextContent('success');
    expect(panel).toHaveTextContent('task_start');
    // a time fragment HH:MM is present (timezone-dependent, assert shape)
    expect(panel.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it('AC-S005-5-3 each row shows timestamp + event + agent', () => {
    render(<ItemHistoryPanel rows={rows} itemId="UC-S001-1" />);
    const list = within(screen.getByTestId('item-history')).getAllByTestId('history-row');
    expect(list).toHaveLength(2);
    list.forEach((r) => {
      expect(r.getAttribute('data-timestamp')).toBeTruthy();
      expect(r.textContent).toMatch(/engineer/);
    });
  });

  it('AC-S005-5-2 rows render newest-first (first data-timestamp >= last)', () => {
    render(<ItemHistoryPanel rows={rows} itemId="UC-S001-1" />);
    const list = within(screen.getByTestId('item-history')).getAllByTestId('history-row');
    const first = Date.parse(list[0].getAttribute('data-timestamp'));
    const last = Date.parse(list[list.length - 1].getAttribute('data-timestamp'));
    expect(first).toBeGreaterThanOrEqual(last);
  });

  it('is a labelled region with a role=list of rows (GEO-S005-2)', () => {
    render(<ItemHistoryPanel rows={rows} itemId="UC-S001-1" />);
    const panel = screen.getByTestId('item-history');
    expect(panel).toHaveAttribute('role', 'region');
    expect(panel.getAttribute('aria-label')).toMatch(/UC-S001-1/);
    expect(within(panel).getByRole('list')).toBeTruthy();
  });

  it('carries a data-source naming the ledger file + item id', () => {
    render(<ItemHistoryPanel rows={rows} itemId="UC-S001-1" />);
    const panel = screen.getByTestId('item-history');
    expect(panel.getAttribute('data-source')).toMatch(/process\/dora\/ledger\.csv/);
    expect(panel.getAttribute('data-source')).toMatch(/UC-S001-1/);
  });

  it('AC-S005-5-4 empty history → "no history" placeholder, no crash', () => {
    render(<ItemHistoryPanel rows={[]} itemId="CHK-4" />);
    const panel = screen.getByTestId('item-history');
    expect(panel).toHaveTextContent(/no history/i);
    expect(within(panel).queryAllByTestId('history-row')).toHaveLength(0);
  });

  it('handles null rows without crashing (treats as empty)', () => {
    render(<ItemHistoryPanel rows={null} itemId="CHK-4" />);
    expect(screen.getByTestId('item-history')).toHaveTextContent(/no history/i);
  });

  it('never shows a bare "row:N" index to the operator', () => {
    render(<ItemHistoryPanel rows={rows} itemId="UC-S001-1" />);
    expect(screen.getByTestId('item-history').textContent).not.toMatch(/\brow:\d+/);
  });
});
