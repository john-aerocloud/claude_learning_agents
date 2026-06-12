// @covers SPA_DEFECTSPANEL
// @covers SPA_DEFECTSHOOK
// @covers SPA_DEFECTDRILL
// @covers uc-s013-3
// UC-S013-3 — wiring the reserved DefectRow drill slot (delivered UC-S013-2):
// the row becomes ACTIVATABLE (click + Enter/Space → onSelectDefect(id)),
// exposes the open state (data-active / aria-expanded), and the
// DefectsPanelContainer composes the DefectDrillContainer over the SAME
// in-memory record the list hook already holds — NO extra fetch (pure
// projection, ui-design.md build contract #1).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import { DefectsPanel, DefectsPanelContainer } from '../DefectsPanel.jsx';

const VM = (over = {}) => ({
  id: 'DEFECT-001',
  title: 'UI shows 0 for everything while work is happening',
  status: 'CLOSED',
  statusLabel: 'CLOSED',
  isOpen: false,
  severity: 'HIGH',
  severityText: 'HIGH',
  mttrText: '13 min',
  record: RAW(),
  ...over,
});

function RAW(over = {}) {
  return {
    id: 'DEFECT-001',
    title: 'UI shows 0 for everything while work is happening',
    status: 'CLOSED',
    severity: 'HIGH',
    expected: 'Real, non-zero pipeline state.',
    actual: 'The UI shows **0 for everything**.',
    intent: 'Watch the pipeline live.',
    importance: 'Core job fully blocked.',
    classification: 'Our bug.',
    root_cause: 'Wrong primary measure.',
    resolution_text: 'Mounted the value-stream map as primary.',
    fix_sha: '3d8c21c, 82a622c',
    reported_ts: '2026-06-10T06:17:47Z',
    recovered_ts: '2026-06-10T06:31:22Z',
    mttr_s: 815,
    mttr_units: 's',
    source: { file: 'DEFECT-001-ui-shows-zero.md' },
    ...over,
  };
}

function trigger(id) {
  const row = screen
    .getAllByTestId('defect-row')
    .find((r) => r.getAttribute('data-defect-id') === id);
  return within(row).getByTestId('defect-row-trigger');
}

describe('DefectRow drill slot (UC-S013-3)', () => {
  it('the row exposes an activatable role=button whose accessible name carries the human defect reference (S13-3-A11Y-1, FIG §3)', () => {
    render(<DefectsPanel defects={[VM()]} status="ready" openCount={0} onSelectDefect={() => {}} />);
    const btn = screen.getByRole('button', { name: /DEFECT-001.*UI shows 0 for everything/ });
    expect(btn).toBe(trigger('DEFECT-001'));
    expect(btn.getAttribute('tabindex')).toBe('0');
  });

  it('click fires onSelectDefect(id)', () => {
    const onSelectDefect = vi.fn();
    render(
      <DefectsPanel defects={[VM()]} status="ready" openCount={0} onSelectDefect={onSelectDefect} />,
    );
    fireEvent.click(trigger('DEFECT-001'));
    expect(onSelectDefect).toHaveBeenCalledWith('DEFECT-001');
  });

  it('Enter AND Space fire onSelectDefect(id) — keyboard-openable, not pointer-only (S13-3-A11Y-1)', () => {
    const onSelectDefect = vi.fn();
    render(
      <DefectsPanel defects={[VM()]} status="ready" openCount={0} onSelectDefect={onSelectDefect} />,
    );
    const btn = trigger('DEFECT-001');
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ' });
    expect(onSelectDefect).toHaveBeenCalledTimes(2);
  });

  it('the active row carries data-active="true" + aria-expanded="true"; inactive rows "false" (selector contract)', () => {
    render(
      <DefectsPanel
        defects={[VM(), VM({ id: 'DEFECT-002', record: RAW({ id: 'DEFECT-002' }) })]}
        status="ready"
        openCount={0}
        activeDefectId="DEFECT-001"
        onSelectDefect={() => {}}
      />,
    );
    const rows = screen.getAllByTestId('defect-row');
    const active = rows.find((r) => r.getAttribute('data-defect-id') === 'DEFECT-001');
    const inactive = rows.find((r) => r.getAttribute('data-defect-id') === 'DEFECT-002');
    expect(active.getAttribute('data-active')).toBe('true');
    expect(within(active).getByTestId('defect-row-trigger').getAttribute('aria-expanded')).toBe('true');
    expect(inactive.getAttribute('data-active')).toBe('false');
    expect(within(inactive).getByTestId('defect-row-trigger').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('DefectsPanelContainer drill composition (UC-S013-3)', () => {
  function mount() {
    const loadActive = vi.fn().mockResolvedValue('observatory');
    const loadDefects = vi.fn().mockResolvedValue([RAW()]);
    render(<DefectsPanelContainer loadActive={loadActive} loadDefects={loadDefects} />);
    return { loadActive, loadDefects };
  }

  it('activating a row opens the drill as a PURE PROJECTION of the in-memory record — no extra fetch (build contract #1)', async () => {
    const { loadDefects } = mount();
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    fireEvent.click(trigger('DEFECT-001'));
    const drill = await screen.findByTestId('defect-drill');
    expect(drill.getAttribute('data-defect-id')).toBe('DEFECT-001');
    // markdown of the raw record rendered (FIG-6 path through the drill)
    expect(
      document.querySelector('[data-field="actual"]').querySelector('strong'),
    ).not.toBeNull();
    // MttrCard fed from the same in-memory record
    expect(screen.getByTestId('mttr-figure').textContent).toBe('13 min');
    // the ONE list fetch — the drill added none
    expect(loadDefects).toHaveBeenCalledTimes(1);
  });

  it('open → row marked active; close (×) → drill gone, focus RETURNS to the originating row trigger (S13-3-A11Y-3)', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    const btn = trigger('DEFECT-001');
    fireEvent.click(btn);
    await screen.findByTestId('defect-drill');
    expect(
      screen.getByTestId('defect-row').getAttribute('data-active'),
    ).toBe('true');
    fireEvent.click(screen.getByTestId('defect-drill-close'));
    await waitFor(() => expect(screen.queryByTestId('defect-drill')).toBeNull());
    expect(screen.getByTestId('defect-row').getAttribute('data-active')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });

  it('Esc closes the drill and returns focus to the originating row trigger (S13-3-A11Y-3)', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('defect-row')).toHaveLength(1));
    const btn = trigger('DEFECT-001');
    fireEvent.click(btn);
    const drill = await screen.findByTestId('defect-drill');
    fireEvent.keyDown(drill, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('defect-drill')).toBeNull());
    expect(document.activeElement).toBe(btn);
  });
});
