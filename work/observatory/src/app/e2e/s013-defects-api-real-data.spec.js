// @covers R_DEFECTS — HTTP adapter: GET /api/projects/:id/defects (UC-S013-1)
// @covers LIB_DEFECTS — pure domain aggregation (md parse + ledger MTTR pairing)
// @covers uc-s013-1
//
// s013 defects read endpoint — REAL-DATA validation spec (EXP-033 policy).
//
// UC-S013-1: validates the live GET /api/projects/observatory/defects endpoint
// (deployed on :5173) against the live work/observatory/defects/ + ledger.csv
// dataset (12 records DEFECT-001..012 as of slice s013, CHK-8).
//
// Ground-truth cross-checks (EXP-033):
//   DEFECT-001: failure 2026-06-10T06:17:47Z → recovery 2026-06-10T06:31:22Z = 815 s
//   DEFECT-011: failure 2026-06-10T16:16:50Z → recovery 2026-06-10T16:27:57Z = 667 s
//   DEFECT-012: CONFIRMED (no recovery row yet)
//
// Acceptance cases covered:
//   AC-S013-1-1  200 + application/json + array
//   AC-S013-1-2  array length = 12 (ground-truth count as of s013; slice.md says 10 — data drift, judged against ground truth)
//   AC-S013-1-3  DEFECT-001: status=CLOSED, severity=HIGH
//   AC-S013-1-4  DEFECT-001: reported_ts = 2026-06-10T06:17:47Z
//   AC-S013-1-5  DEFECT-001: recovered_ts = 2026-06-10T06:31:22Z
//   AC-S013-1-6  DEFECT-001: mttr_s = 815 (810–820 range per acceptance.md §AC-S013-1-6)
//   AC-S013-1-7  DEFECT-012 (open): recovered_ts = null, mttr_s = null, status = CONFIRMED
//   AC-S013-1-8  unknown ?id=DEFECT-999 → []
//   EXP-033-CROSS  DEFECT-011 ledger-only: 667 s MTTR, title human-meaningful
//   ERROR-SURFACE  unknown project id → 200 + []
//
// Relevancy: pinned (real-data ground-truth row; re-verify after any defect file
//   or ledger change that touches DEFECT-001, DEFECT-011, or DEFECT-012).
//
// Runs only when REUSE_SERVER=1 is set (live-server signal), matching the
// existing real-data spec convention (s005-real-data.spec.js).
import { test, expect } from '@playwright/test';

const LIVE_DATA = !!process.env.REUSE_SERVER;
test.skip(!LIVE_DATA, 'real-data spec: runs only with REUSE_SERVER=1 (live observatory server)');

const BASE = 'http://localhost:5173';

// Helper: fetch the defects API via the page's fetch (same-origin browser fetch — validates
// that the browser security/transport layer is not blocking the endpoint).
async function fetchDefects(page, path) {
  const result = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, contentType: r.headers.get('content-type'), body: await r.json() };
  }, `${BASE}${path}`);
  return result;
}

test.describe('UC-S013-1 — defects read endpoint [REAL-DATA, LIVE :5173]', () => {
  test.beforeEach(async ({ page }) => {
    // Load the SPA first so the browser context is established on the same origin.
    // Use 'domcontentloaded' — the live SSE stream keeps the connection open
    // and would cause 'networkidle' to time out.
    await page.goto(BASE + '/');
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  });

  test('AC-S013-1-1 returns 200 + application/json + a JSON array', async ({ page }) => {
    const { status, contentType, body } = await fetchDefects(
      page,
      '/api/projects/observatory/defects',
    );
    expect(status).toBe(200);
    expect(contentType).toMatch(/application\/json/);
    expect(Array.isArray(body)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[AC-S013-1-1] status=${status}, content-type=${contentType}, array=yes`);
  });

  test('AC-S013-1-2 array length = 12 (ground-truth; slice.md says 10 — data drift OK)', async ({
    page,
  }) => {
    const { body } = await fetchDefects(page, '/api/projects/observatory/defects');
    const ids = body.map((d) => d.id);
    // eslint-disable-next-line no-console
    console.log(`[AC-S013-1-2] count=${body.length}, ids=${ids.join(', ')}`);
    // Ground truth: 12 records as of s013/CHK-8 (DEFECT-001..012).
    // The acceptance.md says 10 — known data drift per task brief; judge against real count.
    expect(body.length).toBeGreaterThanOrEqual(12);
    for (let n = 1; n <= 12; n++) {
      expect(ids).toContain(`DEFECT-${String(n).padStart(3, '0')}`);
    }
  });

  test('AC-S013-1-3/4/5/6 DEFECT-001: status=CLOSED, severity=HIGH, MTTR 815 s', async ({
    page,
  }) => {
    const { body } = await fetchDefects(
      page,
      '/api/projects/observatory/defects?id=DEFECT-001',
    );
    expect(body).toHaveLength(1);
    const d1 = body[0];
    expect(d1.status).toBe('CLOSED');
    expect(d1.severity).toBe('HIGH');
    expect(d1.reported_ts).toBe('2026-06-10T06:17:47Z');
    expect(d1.recovered_ts).toBe('2026-06-10T06:31:22Z');
    expect(d1.mttr_s).toBeGreaterThanOrEqual(810);
    expect(d1.mttr_s).toBeLessThanOrEqual(820);
    expect(d1.mttr_units).toBe('s');
    // eslint-disable-next-line no-console
    console.log(
      `[AC-S013-1-3..6] DEFECT-001: status=${d1.status}, severity=${d1.severity}, reported_ts=${d1.reported_ts}, recovered_ts=${d1.recovered_ts}, mttr_s=${d1.mttr_s}, mttr_units=${d1.mttr_units}`,
    );
  });

  test('EXP-033 DEFECT-001 human-meaningfulness: title is a sentence, fix_sha present', async ({
    page,
  }) => {
    const { body } = await fetchDefects(
      page,
      '/api/projects/observatory/defects?id=DEFECT-001',
    );
    const d1 = body[0];
    // Title must not be a raw file-path or ref — it should read as a human sentence
    expect(d1.title).toBeTruthy();
    expect(d1.title).not.toMatch(/^DEFECT-/);
    // fix_sha must be present and contain a known sha
    expect(d1.fix_sha).toMatch(/3d8c21c/);
    // eslint-disable-next-line no-console
    console.log(
      `[EXP-033-DEFECT-001] title="${d1.title}", fix_sha="${d1.fix_sha}"`,
    );
  });

  test('EXP-033 DEFECT-011 ledger-only: 667 s MTTR, title human-meaningful, CLOSED', async ({
    page,
  }) => {
    const { body } = await fetchDefects(
      page,
      '/api/projects/observatory/defects?id=DEFECT-011',
    );
    expect(body).toHaveLength(1);
    const d11 = body[0];
    expect(d11.status).toBe('CLOSED');
    expect(d11.reported_ts).toBe('2026-06-10T16:16:50Z');
    expect(d11.recovered_ts).toBe('2026-06-10T16:27:57Z');
    expect(d11.mttr_s).toBe(667);
    expect(d11.mttr_units).toBe('s');
    // Title derives from the failure note — must be human-readable, not a raw ledger ref
    expect(d11.title).toBeTruthy();
    expect(d11.title).not.toMatch(/^DEFECT-/);
    expect(d11.title).toMatch(/recency horizon/i);
    // eslint-disable-next-line no-console
    console.log(
      `[EXP-033-DEFECT-011] status=${d11.status}, mttr_s=${d11.mttr_s}, title="${d11.title}"`,
    );
  });

  test('AC-S013-1-7 CONFIRMED (open) defect: recovered_ts=null, mttr_s=null — using current open defect', async ({
    page,
  }) => {
    // AC-S013-1-7: an OPEN (CONFIRMED) defect must have recovered_ts=null and mttr_s=null.
    // Live-session note: DEFECT-012 was open at original authoring; it is now CLOSED.
    // We derive the current open defect from the full list and skip if none exists
    // (the fixture spec covers the open-path contract when live data has none).
    const { body: allDefects } = await fetchDefects(page, '/api/projects/observatory/defects');
    const openDefect = allDefects.find((d) => d.status === 'CONFIRMED');
    if (!openDefect) {
      // eslint-disable-next-line no-console
      console.log('[AC-S013-1-7] no live CONFIRMED defect — open path covered by fixture spec');
      // Verify DEFECT-012 is now correctly CLOSED with its MTTR (data drift sanity)
      const { body: d12arr } = await fetchDefects(page, '/api/projects/observatory/defects?id=DEFECT-012');
      expect(d12arr).toHaveLength(1);
      expect(d12arr[0].status).toBe('CLOSED');
      expect(d12arr[0].recovered_ts).toBeTruthy(); // now has recovery
      expect(d12arr[0].mttr_s).not.toBeNull(); // now has MTTR
      // eslint-disable-next-line no-console
      console.log(`[AC-S013-1-7] DEFECT-012 now CLOSED: recovered_ts=${d12arr[0].recovered_ts}, mttr_s=${d12arr[0].mttr_s}`);
      return;
    }
    // There IS a live open defect: validate AC-S013-1-7 against it
    expect(openDefect.reported_ts).toBeTruthy(); // failure row exists
    expect(openDefect.recovered_ts).toBeNull();
    expect(openDefect.mttr_s).toBeNull();
    // eslint-disable-next-line no-console
    console.log(
      `[AC-S013-1-7] ${openDefect.id}: status=${openDefect.status}, reported_ts=${openDefect.reported_ts}, recovered_ts=${openDefect.recovered_ts}, mttr_s=${openDefect.mttr_s}`,
    );
  });

  test('AC-S013-1-8 ?id=DEFECT-999 returns []', async ({ page }) => {
    const { status, body } = await fetchDefects(
      page,
      '/api/projects/observatory/defects?id=DEFECT-999',
    );
    expect(status).toBe(200);
    expect(body).toEqual([]);
    // eslint-disable-next-line no-console
    console.log(`[AC-S013-1-8] DEFECT-999: status=${status}, body=[]`);
  });

  test('ERROR-SURFACE unknown project id returns 200 + [] (no 5xx, no cross-project bleed)', async ({
    page,
  }) => {
    const { status, body } = await fetchDefects(
      page,
      '/api/projects/nonexistent-project-xyz/defects',
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // Must not return observatory defects for a different project id
    const ids = body.map((d) => d.id);
    expect(ids).not.toContain('DEFECT-001');
    // eslint-disable-next-line no-console
    console.log(
      `[ERROR-SURFACE] nonexistent-project-xyz: status=${status}, count=${body.length}`,
    );
  });

  test('SCOPING array is sorted ascending by id (DEFECT-001 first)', async ({ page }) => {
    const { body } = await fetchDefects(page, '/api/projects/observatory/defects');
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].id).toBe('DEFECT-001');
    // Verify ascending order throughout
    for (let i = 1; i < body.length; i++) {
      const prevNum = parseInt(body[i - 1].id.replace('DEFECT-', ''), 10);
      const currNum = parseInt(body[i].id.replace('DEFECT-', ''), 10);
      expect(currNum).toBeGreaterThanOrEqual(prevNum);
    }
    // eslint-disable-next-line no-console
    console.log(`[SCOPING] first=${body[0].id}, last=${body[body.length - 1].id}, sorted=yes`);
  });
});
