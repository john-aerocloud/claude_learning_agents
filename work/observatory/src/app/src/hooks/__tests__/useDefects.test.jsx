// @covers SPA_DEFECTSHOOK
// @covers uc-s013-2
// UC-S013-2 — useDefects: the defects-list view-model hook over the delivered
// GET /api/projects/:id/defects (UC-S013-1).
//
// PURE DOMAIN under test: composeDefects(records) — grouping (CONFIRMED open
// first, then CLOSED; each group id-ascending), status→operator-word mapping
// (CONFIRMED→"OPEN"), severity null→"—" (S13-2-FIG-4), MTTR humanisation
// (S13-2-FIG-1) with the open≠zero rule (S13-2-FIG-2): an OPEN defect's
// mttrText is "open" EVEN IF a recovery ledger row drifted in while the md
// status is still CONFIRMED (live drift pin — DEFECT-012 gained mttr_s=2635
// while CONFIRMED; isOpen wins, never a number, never "0").
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { composeDefects, formatMttr, useDefects, DEFECTS_SOURCE_REF } from '../useDefects.js';

const REC = (over = {}) => ({
  id: 'DEFECT-001',
  title: 'UI shows 0 for everything while work is happening',
  status: 'CLOSED',
  severity: 'HIGH',
  reported_ts: '2026-06-10T06:17:47Z',
  recovered_ts: '2026-06-10T06:31:22Z',
  mttr_s: 815,
  mttr_units: 's',
  ...over,
});

describe('formatMttr (S13-2-FIG-1 — unit-bearing duration, never a bare integer)', () => {
  it('humanises seconds with a time unit', () => {
    expect(formatMttr(815)).toBe('13 min');
    expect(formatMttr(53)).toBe('53 s');
    expect(formatMttr(4860)).toBe('1 h 21 min');
    expect(formatMttr(7200)).toBe('2 h');
  });

  it('null/undefined/negative → "—" (unknown ≠ 0, S13-2-FIG-2 defensive case)', () => {
    expect(formatMttr(null)).toBe('—');
    expect(formatMttr(undefined)).toBe('—');
    expect(formatMttr(-5)).toBe('—');
  });
});

describe('composeDefects (UC-S013-2 pure domain)', () => {
  it('groups CONFIRMED (open) first, then CLOSED; each group sorted id-ascending (GEO-S013-2-4 order source)', () => {
    const { defects } = composeDefects([
      REC({ id: 'DEFECT-003' }),
      REC({ id: 'DEFECT-012', status: 'CONFIRMED', recovered_ts: null, mttr_s: null }),
      REC({ id: 'DEFECT-001' }),
    ]);
    expect(defects.map((d) => d.id)).toEqual(['DEFECT-012', 'DEFECT-001', 'DEFECT-003']);
  });

  it('maps CONFIRMED → statusLabel "OPEN" + isOpen, CLOSED → "CLOSED" (S13-2-FIG-5)', () => {
    const { defects } = composeDefects([
      REC(),
      REC({ id: 'DEFECT-012', status: 'CONFIRMED', mttr_s: null }),
    ]);
    const open = defects.find((d) => d.id === 'DEFECT-012');
    const closed = defects.find((d) => d.id === 'DEFECT-001');
    expect(open.statusLabel).toBe('OPEN');
    expect(open.isOpen).toBe(true);
    expect(open.status).toBe('CONFIRMED'); // raw enum preserved for data-status
    expect(closed.statusLabel).toBe('CLOSED');
    expect(closed.isOpen).toBe(false);
  });

  it('an OPEN defect renders mttrText "open" — even when a recovery row drifted in (mttr_s set) (S13-2-FIG-2; live DEFECT-012 drift pin)', () => {
    const { defects } = composeDefects([
      REC({ id: 'DEFECT-012', status: 'CONFIRMED', mttr_s: 2635 }),
    ]);
    expect(defects[0].mttrText).toBe('open');
    expect(defects[0].mttrText).not.toMatch(/^0/);
  });

  it('a resolved defect gets a unit-bearing humanised MTTR; a closed record with null mttr_s gets "—" (S13-2-FIG-1/2)', () => {
    const { defects } = composeDefects([
      REC(), // 815 s
      REC({ id: 'DEFECT-002', mttr_s: null, recovered_ts: null }),
    ]);
    expect(defects.find((d) => d.id === 'DEFECT-001').mttrText).toBe('13 min');
    expect(defects.find((d) => d.id === 'DEFECT-002').mttrText).toBe('—');
  });

  it('null severity → severityText "—", never blank, never a defaulted LOW (S13-2-FIG-4; DEFECT-011 case)', () => {
    const { defects } = composeDefects([REC({ id: 'DEFECT-011', severity: null })]);
    expect(defects[0].severityText).toBe('—');
    expect(defects[0].severity).toBeNull();
  });

  it('counts the open defects (openCount feeds the "N defects, M open" line, S13-2-FIG-6)', () => {
    const { openCount } = composeDefects([
      REC(),
      REC({ id: 'DEFECT-002' }),
      REC({ id: 'DEFECT-012', status: 'CONFIRMED', mttr_s: null }),
    ]);
    expect(openCount).toBe(1);
  });

  it('attaches the RAW endpoint record to each VM — the drill is a pure projection of in-memory data, no extra fetch (UC-S013-3 build contract #1)', () => {
    const raw = REC();
    const { defects } = composeDefects([raw]);
    expect(defects[0].record).toBe(raw); // same object, not a copy/refetch shape
    expect(defects[0].record.fix_sha).toBeUndefined; // raw shape untouched
  });

  it('fail-soft: null/malformed input → empty model, no throw', () => {
    expect(composeDefects(null)).toEqual({ openCount: 0, defects: [] });
    expect(composeDefects([{ junk: true }, null])).toEqual({ openCount: 0, defects: [] });
  });
});

describe('useDefects (hook wiring)', () => {
  it('loads active project then defects and reports status ready with the composed model', async () => {
    const loadActive = vi.fn().mockResolvedValue('observatory');
    const loadDefects = vi.fn().mockResolvedValue([
      REC(),
      REC({ id: 'DEFECT-012', status: 'CONFIRMED', mttr_s: null }),
    ]);
    const { result } = renderHook(() => useDefects({ loadActive, loadDefects }));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(loadDefects).toHaveBeenCalledWith('observatory');
    expect(result.current.defects.map((d) => d.id)).toEqual(['DEFECT-012', 'DEFECT-001']);
    expect(result.current.openCount).toBe(1);
    expect(result.current.sourceRef).toBe(DEFECTS_SOURCE_REF);
  });

  it('no defects → status "empty" (labelled empty state, never a blank)', async () => {
    const loadActive = vi.fn().mockResolvedValue('observatory');
    const loadDefects = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useDefects({ loadActive, loadDefects }));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.defects).toEqual([]);
  });

  it('unreachable API (null) → fail-soft empty, no throw (AC1.6 convention)', async () => {
    const loadActive = vi.fn().mockResolvedValue('observatory');
    const loadDefects = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useDefects({ loadActive, loadDefects }));
    await waitFor(() => expect(result.current.status).toBe('empty'));
  });
});
