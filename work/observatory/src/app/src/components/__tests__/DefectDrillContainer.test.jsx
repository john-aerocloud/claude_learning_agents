// @covers SPA_DEFECTDRILL
// @covers uc-s013-3
// UC-S013-3 — DefectDrillContainer: the drawer shell for the defect drill.
// REUSES the DEFECT-006 floating-drawer IDIOM (position:fixed, portalled to
// document.body, NON-modal, existing drawer tokens) — NOT the DetailPane
// component body (DetailPane.jsx is item-coupled + shared with UC-S005-3, a
// READ-ONLY reuse slot). Third consumer of the idiom after DetailPane +
// SteerPanel.
//
// Focus contract (S13-3-A11Y-2/3): on open focus MOVES to the drawer heading
// (layout effect — sha 0c2b49c lesson: deterministic, synchronous with the
// mount commit); Esc/× close AND focus RETURNS to the opener.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DefectDrillContainer } from '../DefectDrillContainer.jsx';

const REC = (over = {}) => ({
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
});

describe('DefectDrillContainer (UC-S013-3)', () => {
  it('defect=null → renders nothing (closed = absent, zero flow height)', () => {
    render(<DefectDrillContainer defect={null} onClose={() => {}} />);
    expect(screen.queryByTestId('defect-drill')).toBeNull();
  });

  it('open: a region named "Defect: <id>" portalled to document.body, with data-defect-id continuity from the row (S13-3-A11Y-4, selector contract)', () => {
    render(<DefectDrillContainer defect={REC()} onClose={() => {}} />);
    const drill = screen.getByRole('region', { name: /defect: DEFECT-001/i });
    expect(drill).toBe(screen.getByTestId('defect-drill'));
    expect(drill.getAttribute('data-defect-id')).toBe('DEFECT-001');
    // body-portalled (DEFECT-006 idiom): the drawer is a direct child of body
    expect(drill.parentElement).toBe(document.body);
    // NON-modal: no aria-modal, no dialog trap — the list stays operable
    expect(drill.getAttribute('aria-modal')).toBeNull();
  });

  it('open: focus moves to the drawer heading "<id> — <title>" (tabindex=-1) synchronously (S13-3-A11Y-2)', () => {
    render(<DefectDrillContainer defect={REC()} onClose={() => {}} />);
    const heading = screen.getByTestId('defect-drill-heading');
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe(
      'DEFECT-001 — UI shows 0 for everything while work is happening',
    );
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('composes DefectDetail then MttrCard as the body; close button is LAST in DOM (keyboard order heading → fields → MttrCard → close)', () => {
    render(<DefectDrillContainer defect={REC()} onClose={() => {}} />);
    const detail = screen.getByTestId('defect-detail');
    const card = screen.getByTestId('mttr-card');
    const close = screen.getByTestId('defect-drill-close');
    expect(
      detail.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      card.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('Esc fires onClose; the × close button is named "Close defect <id>" and fires onClose (S13-3-A11Y-3/4)', () => {
    const onClose = vi.fn();
    render(<DefectDrillContainer defect={REC()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('defect-drill'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    const close = screen.getByRole('button', { name: /close defect DEFECT-001/i });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('on close (unmount) focus RETURNS to the opener element (S13-3-A11Y-3)', () => {
    const opener = document.createElement('button');
    opener.textContent = 'row trigger';
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<DefectDrillContainer defect={REC()} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByTestId('defect-drill-heading'));
    rerender(<DefectDrillContainer defect={null} onClose={() => {}} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('passes the raw record fields through to MttrCard (pure projection — resolved DEFECT-001 figure "13 min")', () => {
    render(<DefectDrillContainer defect={REC()} onClose={() => {}} />);
    expect(screen.getByTestId('mttr-figure').textContent).toBe('13 min');
    expect(screen.getByTestId('mttr-card').getAttribute('data-source')).toBe(
      'process/dora/ledger.csv#ref=DEFECT-001',
    );
  });
});
