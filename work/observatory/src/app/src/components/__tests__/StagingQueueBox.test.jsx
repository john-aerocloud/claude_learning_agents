// @covers def-012
// @covers StagingQueueBox
// DEFECT-012 — the staging buffer box: "Decomposed — awaiting triage". Between
// product's decompose completion and the flow-manager's triage sweep, produced
// items sit in queues/staging.csv; this box makes that handoff VISIBLE on the
// board (lean rule: every handoff is a buffer, and buffers are visible).
//
// Legibility pins (empty ≠ zero-confusion): depth is ALWAYS shown as
// "N awaiting triage"; at 0 an explicit empty-state line says the buffer is
// drained (the happy state) — never a blank box, never a bare "0".
// Rows render id + job (human-meaningful, not ids alone). The box adds NO
// focusable element (A11Y-3's decompose→ready Tab walk must stay intact) and
// no `stage-`/`data-metric` test hooks (the 10-node and SRC-1 guards count those).
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { StagingQueueBox } from '../StagingQueueBox.jsx';

const staged = {
  queue: 'staging',
  depth: 2,
  rows: [
    { item_id: 'UC-S015-1', parent: 'SLC-S015', job: 'WIP panel — show in-flight work', value: 'HIGH', cost: '2.0', produced_ts: '2026-06-10T15:50:00Z', producer_ref: 'REPLENISH-CHK6' },
    { item_id: 'UC-S015-2', parent: 'SLC-S015', job: 'Navigate views', value: 'MED', cost: '1.5', produced_ts: '2026-06-10T15:50:00Z', producer_ref: 'REPLENISH-CHK6' },
  ],
};

describe('StagingQueueBox (DEFECT-012)', () => {
  it('renders the staging buffer with its depth figure and "awaiting triage" wording', () => {
    render(<StagingQueueBox staging={staged} />);
    const box = screen.getByTestId('staging-buffer');
    expect(box).toHaveAttribute('data-depth', '2');
    expect(within(box).getByText(/Staging/i)).toBeInTheDocument();
    expect(within(box).getByTestId('staging-depth')).toHaveTextContent(/2 awaiting triage/i);
  });

  it('lists each staged item as id + job (human-meaningful, not ids alone)', () => {
    render(<StagingQueueBox staging={staged} />);
    const first = screen.getByTestId('staging-item-UC-S015-1');
    expect(first).toHaveTextContent('UC-S015-1');
    expect(first).toHaveTextContent(/WIP panel — show in-flight work/);
    expect(screen.getByTestId('staging-item-UC-S015-2')).toHaveTextContent(/Navigate views/);
  });

  it('caps the visible rows at 3 with a "+N more" chip; the depth figure keeps the full count', () => {
    const many = {
      depth: 5,
      rows: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ item_id: `UC-${id}`, job: `job ${id}` })),
    };
    render(<StagingQueueBox staging={many} />);
    expect(screen.getByTestId('staging-depth')).toHaveTextContent(/5 awaiting triage/i);
    expect(document.querySelectorAll('[data-testid^="staging-item-"]').length).toBe(3);
    expect(screen.getByTestId('staging-more')).toHaveTextContent(/\+2 more/);
  });

  it('depth 0 → explicit "0 awaiting triage" + drained empty-state text (empty ≠ missing data)', () => {
    render(<StagingQueueBox staging={{ queue: 'staging', depth: 0, rows: [] }} />);
    const box = screen.getByTestId('staging-buffer');
    expect(box).toHaveAttribute('data-depth', '0');
    expect(within(box).getByTestId('staging-depth')).toHaveTextContent(/0 awaiting triage/i);
    expect(within(box).getByTestId('staging-empty')).toHaveTextContent(/drained|no items|triaged/i);
    expect(within(box).queryByTestId('staging-items')).toBeNull();
  });

  it('null staging (fetch failed / not yet loaded) fails soft to the empty-buffer rendering', () => {
    render(<StagingQueueBox staging={null} />);
    expect(screen.getByTestId('staging-buffer')).toHaveAttribute('data-depth', '0');
    expect(screen.getByTestId('staging-depth')).toHaveTextContent(/0 awaiting triage/i);
  });

  it('carries the buffer meaning in the accessible name and adds NO focusable element (A11Y-3 stays intact)', () => {
    render(<StagingQueueBox staging={staged} />);
    const box = screen.getByRole('group', { name: /staging.*awaiting triage.*2/i });
    expect(box).toBeInTheDocument();
    // no tab stop inside the box — the decompose→ready Tab walk must not change
    expect(box.querySelectorAll('button, a[href], [tabindex]').length).toBe(0);
    // no `stage-` testid (the 10-node guard) and no data-metric (the SRC-1 guard)
    expect(box.getAttribute('data-testid').startsWith('stage-')).toBe(false);
    expect(box.querySelectorAll('[data-metric]').length).toBe(0);
  });
});
