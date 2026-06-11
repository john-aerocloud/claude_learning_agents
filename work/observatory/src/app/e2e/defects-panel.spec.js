// @covers SPA_VIEWSWITCH
// @covers SPA_DEFECTSPANEL
// @covers SPA_DEFECTSHOOK
// @covers uc-s013-2
// UC-S013-2 browser spec — a REAL browser driving the FULL path: three-tab
// view-switch → DefectsPanel fed by GET /api/projects/:id/defects (UC-S013-1).
// Proves what jsdom cannot: real geometry (GEO-S013-2-1..5 — the lossless view
// switch, the stacked grouped list, the untouched rail, open-group-leads as
// GEOMETRY, the aligned figure line), real keyboard focus through the tablist,
// target sizes, and axe on the rendered Defects view.
//
// Fixture (e2e/fixtures/repo, project demo — mirrors the live 12-record shape
// in miniature):
//   DEFECT-001  md+ledger  CLOSED  HIGH  mttr 815 s → "13 min"
//   DEFECT-002  LEDGER-ONLY CLOSED null  mttr 660 s → severity "—" (FIG-4)
//   DEFECT-003  md         CONFIRMED MED open → leads; MTTR "open" (FIG-2)
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  // the engineer in-flight badge proves stage-flow data is fully rendered —
  // GEO baselines must never be captured against a half-loaded map
  await expect(page.getByTestId('inflight-engineer')).toBeVisible();
});

async function openDefects(page) {
  await page.getByTestId('view-tab-defects').click();
  await expect(page.getByTestId('defects-panel')).toBeVisible();
  await expect(page.getByTestId('defect-row').first()).toBeVisible();
}

test('1-click nav → grouped list: open leads, labelled count, 1 click back (click-path budget)', async ({
  page,
}) => {
  await openDefects(page);
  const rows = page.getByTestId('defect-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-defect-id', 'DEFECT-003'); // open leads
  // S13-2-FIG-6: both numbers carry a noun, never bare "3 / 1"
  await expect(page.getByTestId('defects-count')).toHaveText('3 defects, 1 open');
  await page.getByTestId('view-tab-pipeline').click();
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
});

test('S13-2-FIG-1/2/3/4/5 — figure legibility on real rendered rows', async ({ page }) => {
  await openDefects(page);
  const open = page.locator('[data-defect-id="DEFECT-003"]');
  const closed = page.locator('[data-defect-id="DEFECT-001"]');
  const ledgerOnly = page.locator('[data-defect-id="DEFECT-002"]');
  // FIG-1: MTTR carries a unit, never a bare integer / raw seconds
  await expect(closed.getByTestId('defect-mttr')).toHaveText('13 min');
  await expect(ledgerOnly.getByTestId('defect-mttr')).toHaveText('11 min');
  // FIG-2: open ≠ zero — the open defect's MTTR cell reads "open"
  await expect(open.getByTestId('defect-mttr')).toHaveText('open');
  // FIG-3: id WITH a multi-word human title; no raw ledger row refs
  await expect(open.getByTestId('defect-title')).toContainText('Validation stays open');
  expect(await open.textContent()).not.toMatch(/row:\d+/);
  // FIG-4: ledger-only null severity renders "—", never blank/defaulted
  await expect(ledgerOnly.getByTestId('defect-severity-badge')).toHaveText('—');
  // FIG-5 / A11Y-3: status in the operator's language, text + data-attrs
  await expect(open.getByTestId('defect-status-badge')).toContainText('OPEN');
  await expect(open).toHaveAttribute('data-status', 'CONFIRMED');
  await expect(open).toHaveAttribute('data-open', 'true');
  await expect(closed.getByTestId('defect-status-badge')).toContainText('CLOSED');
  // shape cue: aria-hidden glyph inside the open badge
  await expect(open.getByTestId('defect-status-badge').locator('[aria-hidden="true"]')).toHaveText(
    '⚠',
  );
});

test('GEO-S013-2-1 — the view switch is LOSSLESS: VSM bbox + scrollHeight byte-identical after Defects→back; VSM absent while Defects active', async ({
  page,
}) => {
  const before = await page.getByTestId('value-stream-map').boundingBox();
  const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
  await openDefects(page);
  await expect(page.getByTestId('value-stream-map')).toHaveCount(0); // unmounted, not hidden
  await page.getByTestId('view-tab-pipeline').click();
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('inflight-engineer')).toBeVisible(); // fully re-rendered
  const after = await page.getByTestId('value-stream-map').boundingBox();
  const heightAfter = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(after).toEqual(before);
  expect(heightAfter).toBe(heightBefore);
});

test('GEO-S013-2-2/4 — rows STACK (monotonic tops, shared lefts) and the open group leads GEOMETRICALLY', async ({
  page,
}) => {
  await openDefects(page);
  const boxes = [];
  for (const row of await page.getByTestId('defect-row').all()) {
    boxes.push(await row.boundingBox());
  }
  // stacked list, not a line: tops strictly increase, lefts shared
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    expect(Math.abs(boxes[i].x - boxes[0].x)).toBeLessThanOrEqual(1);
  }
  // open group heading above the closed group heading; the open row above
  // EVERY closed row (order carries meaning — attention-first)
  const openHeading = await page.getByTestId('defects-group-open').boundingBox();
  const closedHeading = await page.getByTestId('defects-group-closed').boundingBox();
  expect(openHeading.y).toBeLessThan(closedHeading.y);
  const openRow = await page.locator('[data-defect-id="DEFECT-003"]').boundingBox();
  for (const id of ['DEFECT-001', 'DEFECT-002']) {
    const closedRow = await page.locator(`[data-defect-id="${id}"]`).boundingBox();
    expect(openRow.y).toBeLessThan(closedRow.y);
  }
});

test('GEO-S013-2-3 — the tree rail persists unchanged across the switch', async ({ page }) => {
  const before = await page.getByTestId('work-item-tree').boundingBox();
  await openDefects(page);
  const during = await page.getByTestId('work-item-tree').boundingBox();
  expect(during).toEqual(before);
});

test('GEO-S013-2-5 — within one row the figure <dd>s share a top band (one scannable line)', async ({
  page,
}) => {
  await openDefects(page);
  const row = page.locator('[data-defect-id="DEFECT-001"]');
  const tops = [];
  for (const tid of ['defect-id', 'defect-title', 'defect-status', 'defect-severity', 'defect-mttr']) {
    const box = await row.getByTestId(tid).boundingBox();
    tops.push(box.y);
  }
  const min = Math.min(...tops);
  const max = Math.max(...tops);
  expect(max - min).toBeLessThanOrEqual(2); // small tolerance
});

test('@a11y S13-2-A11Y-1/2 — keyboard-only: Arrows reach the Defects tab, Enter activates, focus lands on the panel heading', async ({
  page,
}) => {
  const defectsTab = page.getByTestId('view-tab-defects');
  await expect(defectsTab).toHaveAttribute('tabindex', '-1');
  await page.getByTestId('view-tab-pipeline').focus();
  await page.keyboard.press('ArrowRight'); // wip
  await page.keyboard.press('ArrowRight'); // defects
  await expect(defectsTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('defects-panel')).toBeVisible();
  await expect(defectsTab).toHaveAttribute('aria-selected', 'true');
  // S13-2-A11Y-2: focus moved into the panel — on its visible <h2>
  await expect(
    page.getByTestId('defects-panel').getByRole('heading', { level: 2, name: 'Defects' }),
  ).toBeFocused();
});

test('@a11y S13-2-A11Y-4 — the Defects tab hit box ≥ 24×24 CSS px', async ({ page }) => {
  const box = await page.getByTestId('view-tab-defects').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
});

test('@a11y S13-2-A11Y-5/6/7 — axe zero violations on the Defects view; one h2; h3 groups; polite live-region count', async ({
  page,
}) => {
  await openDefects(page);
  await expect(page.locator('h2', { hasText: 'Defects' })).toHaveCount(1);
  await expect(page.getByTestId('defects-group-open')).toHaveText('Open — needs attention');
  const count = page.getByTestId('defects-count');
  await expect(count).toHaveAttribute('aria-live', 'polite');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .include('[data-testid="view-switch"]')
    .include('[data-testid="defects-panel"]')
    .analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
});
