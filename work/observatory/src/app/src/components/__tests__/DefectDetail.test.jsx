// @covers SPA_DEFECTDRILL
// @covers SPA_MARKDOWNLIB
// @covers uc-s013-3
// UC-S013-3 — DefectDetail: the labelled record body inside the drill drawer.
// Four fields + Classification + Root cause + Resolution + fix shas, in fixed
// reading order; every markdown-bearing value renders through the SHARED
// lib/markdown.js transform (S13-3-FIG-6 — never raw **, never a second
// renderer). Fixture mirrors the live DEFECT-001 record shape (17 fields).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { DefectDetail } from '../DefectDetail.jsx';

const REC = (over = {}) => ({
  id: 'DEFECT-001',
  title: 'UI shows 0 for everything while work is happening',
  status: 'CLOSED',
  severity: 'HIGH',
  expected: 'Opening the Observatory UI shows real, non-zero pipeline state.',
  actual: 'The UI shows **0 for everything**, even while the dev loop is actively building.',
  intent: 'Watch the pipeline live.',
  importance: 'Core job fully blocked.',
  classification: 'Our bug — product/UI design + incomplete slice.',
  root_cause: 'The deployed primary view measures the wrong thing.',
  resolution_text: 'Built + mounted the value-stream map as the PRIMARY view.',
  fix_sha: '3d8c21c, 82a622c',
  reported_ts: '2026-06-10T06:17:47Z',
  recovered_ts: '2026-06-10T06:31:22Z',
  mttr_s: 815,
  mttr_units: 's',
  source: { file: 'DEFECT-001-ui-shows-zero.md' },
  ...over,
});

const FIELD_ORDER = [
  'expected',
  'actual',
  'intent',
  'importance',
  'classification',
  'root-cause',
  'resolution',
];

describe('DefectDetail (UC-S013-3)', () => {
  it('renders every field section as an <h3> in fixed reading order, with the value body carrying data-field (selector contract, GEO-S013-3-3 DOM half)', () => {
    render(<DefectDetail defect={REC()} />);
    const headings = FIELD_ORDER.map((n) => screen.getByTestId(`defect-field-${n}`));
    for (const h of headings) expect(h.tagName).toBe('H3');
    // fixed reading order: each heading precedes the next in document order
    for (let i = 1; i < headings.length; i += 1) {
      expect(
        headings[i - 1].compareDocumentPosition(headings[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    for (const n of FIELD_ORDER) {
      expect(document.querySelector(`[data-field="${n}"]`)).not.toBeNull();
    }
  });

  it('markdown renders as HTML — DEFECT-001 actual shows real <strong>, no literal ** in visible text (S13-3-FIG-6 — the highest-value red)', () => {
    render(<DefectDetail defect={REC()} />);
    const actual = document.querySelector('[data-field="actual"]');
    expect(actual.querySelector('strong')).not.toBeNull();
    expect(actual.querySelector('strong').textContent).toBe('0 for everything');
    expect(actual.textContent).not.toContain('**');
    expect(actual.querySelector('p')).not.toBeNull(); // real HTML elements
  });

  it('fix shas: each comma-separated token renders as a <code data-testid="defect-fix-sha"> under the Fix label (S13-3-FIG-4)', () => {
    render(<DefectDetail defect={REC()} />);
    const shas = screen.getAllByTestId('defect-fix-sha');
    expect(shas.map((s) => s.textContent)).toEqual(['3d8c21c', '82a622c']);
    for (const s of shas) expect(s.tagName).toBe('CODE');
    // the sha rides under a "Fix" label — never an orphan hash
    expect(screen.getByTestId('defect-fix').textContent).toMatch(/Fix/);
  });

  it('fix_sha=null → the fix slot renders "—", never blank, never a fabricated sha (S13-3-FIG-4; DEFECT-009/011/012 case)', () => {
    render(<DefectDetail defect={REC({ fix_sha: null })} />);
    expect(screen.queryAllByTestId('defect-fix-sha')).toHaveLength(0);
    expect(screen.getByTestId('defect-fix').textContent).toMatch(/—/);
  });

  it('null fields render "—", never blank/raw "null"/a throw (S13-3-FIG-5; DEFECT-011 severity=null case)', () => {
    render(
      <DefectDetail
        defect={REC({ severity: null, root_cause: null, resolution_text: null })}
      />,
    );
    expect(screen.getByTestId('defect-detail-severity').textContent).toBe('—');
    expect(document.querySelector('[data-field="root-cause"]').textContent).toBe('—');
    expect(document.querySelector('[data-field="resolution"]').textContent).toBe('—');
    expect(screen.getByTestId('defect-detail').textContent).not.toMatch(/null/);
  });

  it('status + severity meta are labelled dt/dd pairs (no bare badge)', () => {
    render(<DefectDetail defect={REC()} />);
    const severity = screen.getByTestId('defect-detail-severity');
    expect(severity.tagName).toBe('DD');
    expect(severity.textContent).toBe('HIGH');
    expect(screen.getByTestId('defect-detail-status').textContent).toBe('CLOSED');
  });

  it('file-backed record: data-source names the .md file and a visible "↗ source" caption names it (S13-3-FIG-7)', () => {
    render(<DefectDetail defect={REC()} />);
    const body = screen.getByTestId('defect-detail');
    expect(body.getAttribute('data-source')).toBe(
      'work/<project>/defects/DEFECT-001-ui-shows-zero.md',
    );
    const caption = screen.getByTestId('defect-detail-source');
    expect(caption.textContent).toMatch(/source/i);
    expect(caption.textContent).toContain('DEFECT-001-ui-shows-zero.md');
  });

  it('ledger-only record (source.file=null): data-source + caption fall back to the ledger ref (S13-3-FIG-7; DEFECT-011 case)', () => {
    render(<DefectDetail defect={REC({ id: 'DEFECT-011', source: { file: null } })} />);
    expect(screen.getByTestId('defect-detail').getAttribute('data-source')).toBe(
      'process/dora/ledger.csv#ref=DEFECT-011',
    );
    expect(screen.getByTestId('defect-detail-source').textContent).toContain(
      'process/dora/ledger.csv#ref=DEFECT-011',
    );
  });
});
