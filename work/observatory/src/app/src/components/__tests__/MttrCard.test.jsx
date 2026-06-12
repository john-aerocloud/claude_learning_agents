// @covers SPA_DEFECTDRILL
// @covers uc-s013-3
// UC-S013-3 — MttrCard: the reported→recovered timeline + MTTR figure (the
// one genuinely new leaf). The card owns the duration humanisation so the
// figure is correct at the leaf.
//
// HIGHEST-VALUE PIN (S13-3-FIG-2, DEFECT-007 dimension/name lesson): an OPEN
// defect's running elapsed figure is NEVER labelled "MTTR" — an MTTR is a
// CLOSED span; elapsed-open is a running clock. Open ≠ zero: the recovered
// slot reads "Not yet resolved", never "0"/"0 s"/"null".
//
// Resolved path is pinned against LIVE DEFECT-001 ground truth (mttr_s=815 →
// "13 min", reported 2026-06-10T06:17:47Z → recovered 06:31:22Z). The open
// path has NO live instance (all 12 live defects CLOSED) — exercised here and
// in the e2e fixture via a synthetic open record.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { MttrCard } from '../MttrCard.jsx';

const RESOLVED = {
  defectId: 'DEFECT-001',
  reportedTs: '2026-06-10T06:17:47Z',
  recoveredTs: '2026-06-10T06:31:22Z',
  mttrS: 815,
  mttrUnits: 's',
};

// fixture open record (no live instance exists — ui-design.md open-path note)
const OPEN = {
  defectId: 'DEFECT-099',
  reportedTs: '2026-06-11T10:00:00Z',
  recoveredTs: null,
  mttrS: null,
  mttrUnits: null,
  // injected "now": 13 min after report → deterministic elapsed figure
  now: Date.parse('2026-06-11T10:13:00Z'),
};

describe('MttrCard (UC-S013-3)', () => {
  it('is a labelled group named MTTR with data-mttr-state + ledger data-source (S13-3-A11Y-4, S13-3-FIG-7)', () => {
    render(<MttrCard {...RESOLVED} />);
    const card = screen.getByRole('group', { name: /MTTR/i });
    expect(card).toBe(screen.getByTestId('mttr-card'));
    expect(card.getAttribute('data-mttr-state')).toBe('resolved');
    expect(card.getAttribute('data-source')).toBe('process/dora/ledger.csv#ref=DEFECT-001');
  });

  it('resolved: the MTTR figure is a unit-bearing humanised duration, never bare "815" (S13-3-FIG-1)', () => {
    render(<MttrCard {...RESOLVED} />);
    const figure = screen.getByTestId('mttr-figure');
    expect(figure.textContent).toBe('13 min');
    expect(figure.textContent).toMatch(/\d+\s*(h|min|s)/);
    expect(figure.textContent).not.toBe('815');
    // raw-seconds cross-check rides data-mttr-seconds
    expect(figure.getAttribute('data-mttr-seconds')).toBe('815');
    // the figure's label IS "MTTR" for the closed span (dimension/name match)
    const dt = figure.closest('div').querySelector('dt');
    expect(dt.textContent).toMatch(/MTTR/);
  });

  it('resolved: reported + recovered timestamps render human-readable (date + UTC clock), reported precedes recovered in DOM (S13-3-FIG-3, GEO-S013-3-4 DOM half)', () => {
    render(<MttrCard {...RESOLVED} />);
    const reported = screen.getByTestId('mttr-reported');
    const recovered = screen.getByTestId('mttr-recovered');
    expect(reported.textContent).toBe('2026-06-10 06:17:47 UTC');
    expect(recovered.textContent).toBe('2026-06-10 06:31:22 UTC');
    // no raw epoch / opaque ISO "T" token in the visible text
    expect(reported.textContent).not.toMatch(/T\d{2}:/);
    // order = meaning: reported before recovered in document order
    expect(
      reported.compareDocumentPosition(recovered) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('every timestamp + the duration is a labelled dt/dd pair — no bare figure (S13-3-A11Y-4)', () => {
    render(<MttrCard {...RESOLVED} />);
    for (const tid of ['mttr-reported', 'mttr-recovered', 'mttr-figure']) {
      const dd = screen.getByTestId(tid);
      expect(dd.tagName).toBe('DD');
      expect(dd.closest('dl')).not.toBeNull();
    }
  });

  it('open: recovered slot reads "Not yet resolved" — visible TEXT, never "0"/"0 s"/"null" (S13-3-FIG-2, S13-3-A11Y-5)', () => {
    render(<MttrCard {...OPEN} />);
    const card = screen.getByTestId('mttr-card');
    expect(card.getAttribute('data-mttr-state')).toBe('open');
    expect(screen.getByTestId('mttr-recovered').textContent).toBe('Not yet resolved');
    expect(card.textContent).not.toMatch(/\b0 s\b/);
    expect(card.textContent).not.toMatch(/null/);
  });

  it('open: the running figure is an elapsed "open for …" value and is NOT labelled "MTTR" (S13-3-FIG-2, DEFECT-007 lesson)', () => {
    render(<MttrCard {...OPEN} />);
    const figure = screen.getByTestId('mttr-figure');
    expect(figure.textContent).toBe('open for 13 min');
    // the label over the open running figure must NOT be "MTTR"
    const dt = figure.closest('div').querySelector('dt');
    expect(dt.textContent).not.toMatch(/MTTR/);
    expect(dt.textContent).toMatch(/elapsed|open/i);
    // an open span has no raw-seconds MTTR cross-check
    expect(figure.hasAttribute('data-mttr-seconds')).toBe(false);
  });

  it('unknown (defensive, reportedTs null): "Reported time not recorded" + "—" figure, no crash (S13-3-FIG-5)', () => {
    render(
      <MttrCard defectId="DEFECT-098" reportedTs={null} recoveredTs={null} mttrS={null} mttrUnits={null} />,
    );
    const card = screen.getByTestId('mttr-card');
    expect(card.getAttribute('data-mttr-state')).toBe('unknown');
    expect(screen.getByTestId('mttr-reported').textContent).toMatch(/not recorded/i);
    expect(screen.getByTestId('mttr-figure').textContent).toBe('—');
  });
});
