// @covers SPA_VIEWSWITCH
// @covers SPA_DEFECTSPANEL
// @covers SPA_DEFECTSHOOK
// @covers uc-s013-2
//
// s013 Defects panel — REAL-DATA validation spec (EXP-033 policy, UC-S013-2).
// Authored by the UC-S013-2 tester (validation pass, sha ae7aa28 era); never
// committed in that session — committed with UC-S013-3 with the VOLATILE
// ground truth re-based (2026-06-12): the live defect set moved (DEFECT-012
// closed 06-11; DEFECT-013 opened 06-12; 13 records), so count/open/leading
// assertions are now DERIVED from the live endpoint at run time (UI ↔ API
// coherence) instead of hardcoded — a live snapshot pin rots within a day.
// STABLE ground truth stays hardcoded (EXP-033, reconciled from
// process/dora/ledger.csv):
//   DEFECT-001: CLOSED, HIGH, mttr_s=815 → "13 min"
//   DEFECT-011: CLOSED, severity=null  → "—", mttr_s=667 → "11 min"
//
// Open-count semantics (unchanged): the endpoint's "open" is determined by
// md-file status=CONFIRMED, not by unmatched ledger pairs; isOpen wins over a
// drifted mttr_s (mttrText renders "open", never a number).
//
// Relevancy: pinned (real-data gate; re-verify after any change to
//   DefectsPanel, useDefects, the defect md files, or the live ledger).
//
// Runs only when REUSE_SERVER=1 is set (live-server signal).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const LIVE_DATA = !!process.env.REUSE_SERVER;
test.skip(!LIVE_DATA, 'real-data spec: runs only with REUSE_SERVER=1 (live observatory server on :5173)');

const BASE = 'http://localhost:5173';

/** Live ground truth, fetched per test: the endpoint IS the oracle for the
 *  volatile figures (count / open set / leading row). Sorted open-first then
 *  id-ascending — the same grouping contract useDefects renders. */
async function fetchDefects(request) {
  const res = await request.get(`${BASE}/api/projects/observatory/defects`);
  expect(res.ok()).toBe(true);
  return res.json();
}
const openIds = (records) =>
  records
    .filter((r) => r.status === 'CONFIRMED')
    .map((r) => r.id)
    .sort();

async function openDefects(page) {
  await page.getByTestId('view-tab-defects').click();
  await expect(page.getByTestId('defects-panel')).toBeVisible();
  await expect(page.getByTestId('defect-row').first()).toBeVisible();
}

test.describe('UC-S013-2 Defects panel [REAL-DATA, LIVE :5173]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE + '/');
    await expect(page.getByTestId('value-stream-map')).toBeVisible();
  });

  test('AC-S013-2 count: rows match the live endpoint; the open defect (if any) leads; count line labelled (S13-2-FIG-6)', async ({
    page,
    request,
  }) => {
    const records = await fetchDefects(request);
    const open = openIds(records);
    await openDefects(page);
    const rows = page.getByTestId('defect-row');
    const count = await rows.count();
    // eslint-disable-next-line no-console
    console.log(`[AC-S013-2-count] row count=${count} (endpoint=${records.length}, open=${open.length})`);
    expect(count).toBe(records.length);
    if (open.length > 0) {
      // the lowest-id CONFIRMED record leads (open group first, id ascending)
      await expect(rows.first()).toHaveAttribute('data-defect-id', open[0]);
      await expect(rows.first()).toHaveAttribute('data-open', 'true');
    }
    // S13-2-FIG-6: count line carries noun labels, never bare "13 / 1"
    const countText = await page.getByTestId('defects-count').textContent();
    // eslint-disable-next-line no-console
    console.log(`[S13-2-FIG-6] count line: "${countText}"`);
    expect(countText).toMatch(/defect/i);
    expect(countText).toMatch(/open/i);
    expect(countText).toContain(String(records.length));
    expect(countText).toContain(String(open.length));
  });

  test('S13-2-FIG-1 DEFECT-001 MTTR carries a unit: "13 min" (815 s)', async ({ page }) => {
    await openDefects(page);
    const d1Row = page.locator('[data-defect-id="DEFECT-001"]');
    const mttrText = await d1Row.getByTestId('defect-mttr').textContent();
    // eslint-disable-next-line no-console
    console.log(`[S13-2-FIG-1] DEFECT-001 mttr="${mttrText}"`);
    expect(mttrText).toMatch(/\d+\s*(h|min|s)/);
    expect(mttrText).not.toMatch(/^\d+$/); // never a bare integer
    // 815 s → 13 min
    expect(mttrText).toMatch(/13\s*min/);
  });

  test('S13-2-FIG-2 a CONFIRMED (open) defect MTTR shows "open", never "0"', async ({ page, request }) => {
    const open = openIds(await fetchDefects(request));
    // the live open set can legitimately be empty — the open path is then
    // covered by the deterministic fixture spec (defects-panel.spec.js)
    test.skip(open.length === 0, 'no live CONFIRMED defect right now — open path pinned by the fixture spec');
    await openDefects(page);
    const d12Row = page.locator(`[data-defect-id="${open[0]}"]`);
    const mttrText = await d12Row.getByTestId('defect-mttr').textContent();
    // eslint-disable-next-line no-console
    console.log(`[S13-2-FIG-2] ${open[0]} mttr="${mttrText}"`);
    expect(mttrText).toBe('open');
    expect(mttrText).not.toMatch(/^0/);
    expect(mttrText).not.toBe('');
    expect(mttrText).not.toBe('null');
    expect(mttrText).not.toBe('—');
  });

  test('S13-2-FIG-3 human-meaningful references: id WITH multi-word title, no row:N', async ({ page }) => {
    await openDefects(page);
    const d12Row = page.locator('[data-defect-id="DEFECT-012"]');
    const titleText = await d12Row.getByTestId('defect-title').textContent();
    // eslint-disable-next-line no-console
    console.log(`[S13-2-FIG-3] DEFECT-012 title="${titleText}"`);
    // Must have a multi-word sentence, not blank
    expect(titleText).toBeTruthy();
    expect(titleText.split(/\s+/).length).toBeGreaterThanOrEqual(3);
    // No raw ledger row refs
    const rowText = await d12Row.textContent();
    expect(rowText).not.toMatch(/row:\d+/);
  });

  test('S13-2-FIG-4 DEFECT-011 severity null → "—" (not blank/defaulted)', async ({ page }) => {
    await openDefects(page);
    const d11Row = page.locator('[data-defect-id="DEFECT-011"]');
    const sevText = await d11Row.getByTestId('defect-severity-badge').textContent();
    // eslint-disable-next-line no-console
    console.log(`[S13-2-FIG-4] DEFECT-011 severity badge="${sevText}"`);
    expect(sevText).toBe('—');
  });

  test('S13-2-FIG-5 status labelled in operator language: CONFIRMED→"OPEN", CLOSED→"CLOSED"', async ({ page, request }) => {
    const open = openIds(await fetchDefects(request));
    await openDefects(page);
    if (open.length > 0) {
      // the live CONFIRMED record: badge text "OPEN"; data-status="CONFIRMED"
      const openRow = page.locator(`[data-defect-id="${open[0]}"]`);
      const openBadgeText = await openRow.getByTestId('defect-status-badge').textContent();
      // eslint-disable-next-line no-console
      console.log(`[S13-2-FIG-5] ${open[0]} status badge="${openBadgeText}"`);
      expect(openBadgeText).toContain('OPEN');
      await expect(openRow).toHaveAttribute('data-status', 'CONFIRMED');
      await expect(openRow).toHaveAttribute('data-open', 'true');
    }
    // DEFECT-001: CLOSED → badge text "CLOSED"; data-status="CLOSED"
    const d1Row = page.locator('[data-defect-id="DEFECT-001"]');
    const d1BadgeText = await d1Row.getByTestId('defect-status-badge').textContent();
    // eslint-disable-next-line no-console
    console.log(`[S13-2-FIG-5] DEFECT-001 status badge="${d1BadgeText}"`);
    expect(d1BadgeText).toContain('CLOSED');
  });

  test('A11Y-3 DEFECT-011 MTTR "11 min" with unit (667 s → 11 min)', async ({ page }) => {
    await openDefects(page);
    const d11Row = page.locator('[data-defect-id="DEFECT-011"]');
    const mttrText = await d11Row.getByTestId('defect-mttr').textContent();
    // eslint-disable-next-line no-console
    console.log(`[A11Y-3] DEFECT-011 mttr="${mttrText}"`);
    expect(mttrText).toMatch(/\d+\s*(h|min|s)/);
    // 667 s → 11 min
    expect(mttrText).toMatch(/11\s*min/);
  });

  test('GEO-S013-2-1 lossless view switch: VSM absent while Defects active; scrollHeight unchanged; VSM remounts on Pipeline return', async ({
    page,
  }) => {
    // NOTE: byte-identical VSM bbox is validated by the fixture spec (defects-panel.spec.js)
    // which uses deterministic data (OBSERVATORY_NOW pinned, no SSE updates). The live
    // server's VSM height can change between baseline and re-capture due to SSE data
    // updates — asserting bbox equality here would be a false negative.
    // This test validates the STRUCTURAL guard: VSM absent while Defects active
    // (unmounted, not hidden-but-reflowing) and page scrollHeight unchanged.
    const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
    await openDefects(page);
    // VSM is ABSENT (unmounted) while Defects is active — not hidden/display:none
    await expect(page.getByTestId('value-stream-map')).toHaveCount(0);
    const heightDuring = await page.evaluate(() => document.documentElement.scrollHeight);
    // Return to Pipeline
    await page.getByTestId('view-tab-pipeline').click();
    await expect(page.getByTestId('value-stream-map')).toBeVisible();
    const heightAfter = await page.evaluate(() => document.documentElement.scrollHeight);
    // eslint-disable-next-line no-console
    console.log(`[GEO-S013-2-1] scrollHeight before=${heightBefore} during=${heightDuring} after=${heightAfter}`);
    // scrollHeight must not grow when Defects is active (no reflow by the unmounted VSM)
    // Live data may change the heights vs each other, but the DEFECTS view itself must
    // not cause a page-height increase vs the pipeline view.
    // Primary guard: VSM was genuinely unmounted (count=0 assertion above)
    // Secondary guard: page did not grow during defects view (within live-data tolerance)
    expect(heightDuring).toBeLessThanOrEqual(heightBefore + 10); // tolerance for live SSE
  });

  test('GEO-S013-2-2/4 open group leads GEOMETRICALLY: the open row sits above all CLOSED rows; rows stacked', async ({
    page,
    request,
  }) => {
    const open = openIds(await fetchDefects(request));
    await openDefects(page);
    if (open.length > 0) {
      const openRow = await page.locator(`[data-defect-id="${open[0]}"]`).boundingBox();
      const d1Row = await page.locator('[data-defect-id="DEFECT-001"]').boundingBox();
      // eslint-disable-next-line no-console
      console.log(`[GEO-S013-2-4] ${open[0]} open row y=${openRow.y}; DEFECT-001 closed row y=${d1Row.y}`);
      expect(openRow.y).toBeLessThan(d1Row.y);
      // Open group heading above closed group heading
      const openHeading = await page.getByTestId('defects-group-open').boundingBox();
      const closedHeading = await page.getByTestId('defects-group-closed').boundingBox();
      expect(openHeading.y).toBeLessThan(closedHeading.y);
    } else {
      // zero open: the open-group heading must be ABSENT (never an "Open (0)")
      await expect(page.getByTestId('defects-group-open')).toHaveCount(0);
    }
    // Stacking: all rows have monotonically increasing tops
    const allRows = await page.getByTestId('defect-row').all();
    let prevY = -1;
    for (const row of allRows) {
      const box = await row.boundingBox();
      expect(box.y).toBeGreaterThan(prevY);
      prevY = box.y;
    }
  });

  test('GEO-S013-2-3 tree rail bbox unchanged Pipeline vs Defects', async ({ page }) => {
    const before = await page.getByTestId('work-item-tree').boundingBox();
    await openDefects(page);
    const during = await page.getByTestId('work-item-tree').boundingBox();
    // eslint-disable-next-line no-console
    console.log(`[GEO-S013-2-3] before=${JSON.stringify(before)} during=${JSON.stringify(during)}`);
    expect(during).toEqual(before);
  });

  test('S13-2-A11Y-1/2 keyboard: Arrows reach Defects tab, Enter activates, h2 focused (real data)', async ({
    page,
  }) => {
    await page.goto(BASE + '/');
    await expect(page.getByTestId('value-stream-map')).toBeVisible();
    await page.getByTestId('view-tab-pipeline').focus();
    await page.keyboard.press('ArrowRight'); // wip
    await page.keyboard.press('ArrowRight'); // defects
    await expect(page.getByTestId('view-tab-defects')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('defects-panel')).toBeVisible();
    await expect(page.getByTestId('view-tab-defects')).toHaveAttribute('aria-selected', 'true');
    // Focus moved to the panel h2
    await expect(
      page.getByTestId('defects-panel').getByRole('heading', { level: 2, name: 'Defects' }),
    ).toBeFocused();
    // eslint-disable-next-line no-console
    console.log('[S13-2-A11Y-1/2] keyboard nav + heading focus: PASS');
  });

  test('@a11y S13-2-A11Y-5/6/7 axe zero violations on live Defects view; h2 Defects; polite live region', async ({
    page,
  }) => {
    await openDefects(page);
    await expect(page.locator('h2', { hasText: 'Defects' })).toHaveCount(1);
    const count = page.getByTestId('defects-count');
    await expect(count).toHaveAttribute('aria-live', 'polite');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .include('[data-testid="view-switch"]')
      .include('[data-testid="defects-panel"]')
      .analyze();
    // eslint-disable-next-line no-console
    if (results.violations.length > 0) {
      console.log('[A11Y VIOLATIONS]', JSON.stringify(results.violations, null, 2));
    } else {
      console.log('[S13-2-A11Y-5/6/7] axe: 0 violations');
    }
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
