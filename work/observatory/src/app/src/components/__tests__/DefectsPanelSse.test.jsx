// @covers uc-s013-4
// @covers SPA_DEFECTSPANEL
// @covers SPA_DEFECTSHOOK
// @covers SPA_DEFECTDRILL
// UC-S013-4 — SSE refresh THROUGH the container, and the drill's
// PROMPT-FREEZE-style discipline (EXP-036, the steer-prompt idiom): an open
// drawer's content NEVER silently mutates underneath the operator.
//
// CHOSEN behaviour (the smaller honest option, stated per the design note):
// the container SNAPSHOTS the record at activation; when an SSE refresh
// changes the underlying record the drawer stays open, its content stays
// FROZEN, and a ContextRefreshCue-idiom cue flips to `updated` ("Record
// updated — re-open to refresh"); content refreshes only on an EXPLICIT
// re-activation of the row (no new interactive control added — the
// originating row trigger, already focused by the return-focus contract, IS
// the refresh affordance). AC-S013-4-3 is pinned as: drawer does not close,
// does not crash, announces the divergence, and shows current data after the
// explicit re-open.
//
// LIST-LEVEL (no drawer): the grouped list + polite count line update in
// place (S13-2-A11Y-7 live region built in UC-S013-2).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import { DefectsPanelContainer } from '../DefectsPanel.jsx';

function RAW(over = {}) {
  return {
    id: 'DEFECT-001',
    title: 'UI shows 0 for everything while work is happening',
    status: 'CLOSED',
    severity: 'HIGH',
    expected: 'Real, non-zero pipeline state.',
    actual: 'The UI shows zero for everything.',
    intent: 'Watch the pipeline live.',
    importance: 'Core job fully blocked.',
    classification: 'Our bug.',
    root_cause: 'Wrong primary measure.',
    resolution_text: 'Mounted the value-stream map as primary.',
    fix_sha: '3d8c21c',
    reported_ts: '2026-06-10T06:17:47Z',
    recovered_ts: '2026-06-10T06:31:22Z',
    mttr_s: 815,
    mttr_units: 's',
    ...over,
  };
}

function trigger(id) {
  const row = screen
    .getAllByTestId('defect-row')
    .find((r) => r.getAttribute('data-defect-id') === id);
  return within(row).getByTestId('defect-row-trigger');
}

/** Mount the container with a mutable record set + captured SSE callback. */
function mount(initialRows) {
  let rows = initialRows;
  let onChange;
  const loadDefects = vi.fn(() => Promise.resolve(rows));
  render(
    <DefectsPanelContainer
      loadActive={() => Promise.resolve('demo')}
      loadDefects={loadDefects}
      subscribe={(cb) => { onChange = cb; return () => {}; }}
      debounceMs={0}
    />,
  );
  return {
    loadDefects,
    setRows: (r) => { rows = r; },
    fire: (path = 'work/demo/defects/DEFECT-001-x.md') =>
      onChange({ type: 'change', path }),
  };
}

describe('DefectsPanelContainer — list-level SSE refresh (AC-S013-4-1/2 DOM path)', () => {
  it('an added record updates rows + the polite count line in place; a removed one shrinks it back', async () => {
    const { setRows, fire } = mount([RAW()]);
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    expect(screen.getByTestId('defects-count').textContent).toBe('1 defect, 0 open');

    setRows([RAW(), RAW({ id: 'DEFECT-011', status: 'CONFIRMED', recovered_ts: null, mttr_s: null })]);
    fire('work/demo/defects/DEFECT-011-test.md');
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(2));
    expect(screen.getByTestId('defects-count').textContent).toBe('2 defects, 1 open');

    setRows([RAW()]);
    fire('work/demo/defects/DEFECT-011-test.md');
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    expect(screen.getByTestId('defects-count').textContent).toBe('1 defect, 0 open');
  });
});

describe('DefectsPanelContainer — drill freeze discipline (AC-S013-4-3 / EXP-036)', () => {
  it('drawer open + record changed underneath: drawer STAYS open, content FROZEN, cue flips to updated', async () => {
    const { setRows, fire } = mount([RAW()]);
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    fireEvent.click(trigger('DEFECT-001'));
    const drill = await screen.findByTestId('defect-drill');
    expect(screen.getByTestId('defect-drill-cue').getAttribute('data-state')).toBe('live');

    setRows([RAW({ actual: 'The UI shows zero for everything. (updated)' })]);
    fire();
    // the list re-fetched (count line stays coherent) …
    await waitFor(() =>
      expect(screen.getByTestId('defect-drill-cue').getAttribute('data-state')).toBe('updated'),
    );
    // … but the OPEN drawer did not close and its content did NOT move
    expect(screen.getByTestId('defect-drill')).toBe(drill);
    expect(document.querySelector('[data-field="actual"]').textContent).not.toMatch(/\(updated\)/);
    // the cue is the honest signal — human sentence, polite status region
    const cue = screen.getByTestId('defect-drill-cue');
    expect(cue.textContent).toMatch(/record updated — re-open to refresh/i);
    expect(cue.getAttribute('role')).toBe('status');
  });

  it('an EXPLICIT re-activation of the row refreshes the drawer content; cue returns to live', async () => {
    const { setRows, fire } = mount([RAW()]);
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    fireEvent.click(trigger('DEFECT-001'));
    await screen.findByTestId('defect-drill');

    setRows([RAW({ actual: 'The UI shows zero for everything. (updated)' })]);
    fire();
    await waitFor(() =>
      expect(screen.getByTestId('defect-drill-cue').getAttribute('data-state')).toBe('updated'),
    );

    fireEvent.click(trigger('DEFECT-001')); // explicit re-open
    await waitFor(() =>
      expect(document.querySelector('[data-field="actual"]').textContent).toMatch(/\(updated\)/),
    );
    expect(screen.getByTestId('defect-drill-cue').getAttribute('data-state')).toBe('live');
    expect(screen.getByTestId('defect-drill')).not.toBeNull();
  });

  it('a refresh with the record UNCHANGED (other defect moved) keeps the cue live — no false stale cue', async () => {
    const { setRows, fire } = mount([RAW()]);
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    fireEvent.click(trigger('DEFECT-001'));
    await screen.findByTestId('defect-drill');

    setRows([RAW(), RAW({ id: 'DEFECT-011', status: 'CONFIRMED', recovered_ts: null, mttr_s: null })]);
    fire('work/demo/defects/DEFECT-011-test.md');
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(2));
    expect(screen.getByTestId('defect-drill-cue').getAttribute('data-state')).toBe('live');
    expect(screen.getByTestId('defect-drill')).not.toBeNull();
  });

  it('a refresh that DROPS the selected defect closes the drill gracefully (existing pin, kept)', async () => {
    const { setRows, fire } = mount([RAW(), RAW({ id: 'DEFECT-011', status: 'CONFIRMED', recovered_ts: null, mttr_s: null })]);
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(2));
    fireEvent.click(trigger('DEFECT-011'));
    await screen.findByTestId('defect-drill');

    setRows([RAW()]);
    fire('work/demo/defects/DEFECT-011-test.md');
    await waitFor(() => expect(screen.queryByTestId('defect-drill')).toBeNull());
    // no crash; the list is still rendered
    expect(screen.getAllByTestId('defect-row')).toHaveLength(1);
  });
});
