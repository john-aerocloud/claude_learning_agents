// @covers SPA_DEFECTSPANEL
// @covers uc-s013-2
// UC-S013-2 — DefectsPanel + DefectRow: the defects view-region (grouped
// CONFIRMED-first list of labelled defect figures). Pure render of the
// useDefects view-model — mirrors the WipPanel idiom (heading focus on mount,
// polite live-region count, dt/dd labelled figures, §8 non-colour-redundant
// badges). Selector contracts per slices/s013-defects-view/ui-design.md.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { DefectsPanel } from '../DefectsPanel.jsx';

const VM = (over = {}) => ({
  id: 'DEFECT-001',
  title: 'UI shows 0 for everything while work is happening',
  status: 'CLOSED',
  statusLabel: 'CLOSED',
  isOpen: false,
  severity: 'HIGH',
  severityText: 'HIGH',
  mttrText: '13 min',
  ...over,
});

const OPEN = VM({
  id: 'DEFECT-012',
  title: 'Decomposed work is invisible between product completion and triage',
  status: 'CONFIRMED',
  statusLabel: 'OPEN',
  isOpen: true,
  severity: null,
  severityText: '—',
  mttrText: 'open',
});

const TWO_GROUPS = [OPEN, VM(), VM({ id: 'DEFECT-011', severity: null, severityText: '—', mttrText: '11 min' })];

function renderPanel(props = {}) {
  return render(
    <DefectsPanel defects={TWO_GROUPS} status="ready" openCount={1} {...props} />,
  );
}

describe('DefectsPanel (UC-S013-2)', () => {
  it('renders a region named "Defects" with a visible h2 that takes focus on mount (S13-2-A11Y-2/5)', () => {
    renderPanel();
    const region = screen.getByRole('region', { name: 'Defects' });
    expect(region).toBe(screen.getByTestId('defects-panel'));
    expect(region.getAttribute('data-source')).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 2, name: 'Defects' });
    expect(document.activeElement).toBe(heading);
  });

  it('count line is a polite role=status live region reading "N defects, M open" (S13-2-A11Y-7, S13-2-FIG-6)', () => {
    renderPanel();
    const count = screen.getByTestId('defects-count');
    expect(count.getAttribute('role')).toBe('status');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.textContent).toMatch(/3 defects/);
    expect(count.textContent).toMatch(/1 open/);
  });

  it('groups: open heading leads, present iff ≥1 CONFIRMED row; both group headings are h3 (S13-2-A11Y-6, GEO-S013-2-4 DOM half)', () => {
    renderPanel();
    const open = screen.getByTestId('defects-group-open');
    const closed = screen.getByTestId('defects-group-closed');
    expect(open.tagName).toBe('H3');
    expect(closed.tagName).toBe('H3');
    expect(open.textContent).toMatch(/Open — needs attention/);
    expect(closed.textContent).toMatch(/Closed/);
    // open group renders BEFORE the closed group in document order
    expect(open.compareDocumentPosition(closed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // exactly one h2; group headings one level below (no skipped levels)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('zero open defects → the open-group heading is ABSENT (no empty "Open (0)" broken state)', () => {
    render(<DefectsPanel defects={[VM()]} status="ready" openCount={0} />);
    expect(screen.queryByTestId('defects-group-open')).toBeNull();
    expect(screen.getByTestId('defects-group-closed')).toBeTruthy();
  });

  it('rows are listitems inside role=list groups, disambiguated by data-defect-id — NOT data-item-id (drill slot for UC-S013-3)', () => {
    renderPanel();
    const rows = screen.getAllByTestId('defect-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.getAttribute('role') || row.tagName === 'LI').toBeTruthy();
      expect(row.getAttribute('data-defect-id')).toMatch(/^DEFECT-\d+$/);
      expect(row.hasAttribute('data-item-id')).toBe(false); // tree/WIP contract stays unique
    }
    expect(screen.getAllByRole('list')).toHaveLength(2); // one per group
  });

  it('open row: visible "OPEN" badge text + aria-hidden ⚠ glyph + data-open/data-status — never colour alone (S13-2-A11Y-3, S13-2-FIG-5)', () => {
    renderPanel();
    const row = screen.getAllByTestId('defect-row').find(
      (r) => r.getAttribute('data-defect-id') === 'DEFECT-012',
    );
    expect(row.getAttribute('data-open')).toBe('true');
    expect(row.getAttribute('data-status')).toBe('CONFIRMED');
    const badge = within(row).getByTestId('defect-status-badge');
    expect(badge.textContent).toMatch(/OPEN/);
    const glyph = badge.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph.textContent).toBe('⚠');
  });

  it('closed row: visible "CLOSED" badge text, data-open="false", data-status="CLOSED" (S13-2-A11Y-3)', () => {
    renderPanel();
    const row = screen.getAllByTestId('defect-row').find(
      (r) => r.getAttribute('data-defect-id') === 'DEFECT-001',
    );
    expect(row.getAttribute('data-open')).toBe('false');
    expect(row.getAttribute('data-status')).toBe('CLOSED');
    expect(within(row).getByTestId('defect-status-badge').textContent).toMatch(/CLOSED/);
  });

  it('figures are labelled dt/dd pairs: id, title, status, severity, MTTR — no bare numbers (S13-2-FIG-3 layout half)', () => {
    renderPanel();
    const row = screen.getAllByTestId('defect-row')[1]; // DEFECT-001
    for (const tid of ['defect-id', 'defect-title', 'defect-severity', 'defect-mttr']) {
      const dd = within(row).getByTestId(tid);
      expect(dd.tagName).toBe('DD');
      expect(dd.closest('dl')).not.toBeNull();
    }
    expect(within(row).getByTestId('defect-id').textContent).toBe('DEFECT-001');
    expect(within(row).getByTestId('defect-title').textContent).toMatch(/\w+\s+\w+/); // multi-word sentence
    expect(within(row).getByTestId('defect-mttr').textContent).toBe('13 min');
  });

  it('open row MTTR cell shows "open"; null-severity row shows "—" badge (S13-2-FIG-2/4)', () => {
    renderPanel();
    const rows = screen.getAllByTestId('defect-row');
    const open = rows.find((r) => r.getAttribute('data-defect-id') === 'DEFECT-012');
    expect(within(open).getByTestId('defect-mttr').textContent).toBe('open');
    const ledgerOnly = rows.find((r) => r.getAttribute('data-defect-id') === 'DEFECT-011');
    expect(within(ledgerOnly).getByTestId('defect-severity-badge').textContent).toBe('—');
    expect(ledgerOnly.getAttribute('data-severity')).toBe('');
  });

  it('row accessible name carries id + title + status + severity + MTTR (S13-2-A11Y-5)', () => {
    renderPanel();
    const open = screen.getAllByTestId('defect-row').find(
      (r) => r.getAttribute('data-defect-id') === 'DEFECT-012',
    );
    const name = open.getAttribute('aria-label');
    expect(name).toMatch(/DEFECT-012/);
    expect(name).toMatch(/Decomposed work is invisible/);
    expect(name).toMatch(/status open/i);
    expect(name).toMatch(/severity unknown/i);
    expect(name).toMatch(/MTTR open/i);
  });

  it('no raw ledger row refs leak into any row (S13-2-FIG-3)', () => {
    renderPanel();
    for (const row of screen.getAllByTestId('defect-row')) {
      expect(row.textContent).not.toMatch(/row:\d+/);
    }
  });

  it('empty state: "No defects recorded" with a labelled zero count, never a blank (status=empty)', () => {
    render(<DefectsPanel defects={[]} status="empty" openCount={0} />);
    expect(screen.getByTestId('defects-empty').textContent).toMatch(/No defects recorded/);
    const count = screen.getByTestId('defects-count');
    expect(count.textContent).toMatch(/0 defects/);
  });

  it('loading state: region + heading render immediately with a loading count line', () => {
    render(<DefectsPanel defects={[]} status="loading" openCount={0} />);
    expect(screen.getByRole('region', { name: 'Defects' })).toBeTruthy();
    expect(screen.getByTestId('defects-count').textContent).toMatch(/Loading/i);
    expect(screen.queryByTestId('defects-empty')).toBeNull();
  });
});
