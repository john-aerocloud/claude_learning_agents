// @covers SPA_DEFECTSPANEL
// @covers SPA_DEFECTSHOOK
// @covers SPA_DEFECTDRILL
// @covers SPA_MARKDOWNLIB
// @covers uc-s013-3
// UC-S013-3 browser spec — a REAL browser driving the defect drill end to
// end: DefectRow activation → DefectDrillContainer (DEFECT-006 floating-drawer
// idiom) → DefectDetail (shared markdown transform) + MttrCard. Proves what
// jsdom cannot: real geometry (GEO-S013-3-1..4 — the no-reflow overlay, the
// on-screen anchor, the stacked record, the timeline order), real keyboard
// focus through row → heading → Esc-return, target sizes, and axe on the open
// drawer.
//
// Fixture (e2e/fixtures/repo, project demo):
//   DEFECT-001  CLOSED  mttr 815 s → "13 min"; actual carries **bold** md;
//               resolution carries shas abc1234, 9d8f7e6 (FIG-4/6 resolved path)
//   DEFECT-002  LEDGER-ONLY CLOSED → severity "—", source = ledger ref (FIG-5/7)
//   DEFECT-003  CONFIRMED OPEN (no recovery) → the OPEN MttrCard path
//               (S13-3-FIG-2 — NO live open instance exists; fixture-only)
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  await expect(page.getByTestId('inflight-engineer')).toBeVisible();
  await page.getByTestId('view-tab-defects').click();
  await expect(page.getByTestId('defects-panel')).toBeVisible();
  await expect(page.getByTestId('defect-row').first()).toBeVisible();
});

function row(page, id) {
  return page.locator(`[data-defect-id="${id}"][data-testid="defect-row"]`);
}

async function openDrill(page, id) {
  await row(page, id).getByTestId('defect-row-trigger').click();
  const drill = page.getByTestId('defect-drill');
  await expect(drill).toBeVisible();
  await expect(drill).toHaveAttribute('data-defect-id', id);
  // settle the 160ms slide-in before geometry/colour capture: a mid-animation
  // snapshot drifts x by translateX and dims colours via the animated opacity
  // (found by the live drive — the GEO/axe flake class this guard prevents)
  await drill.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return drill;
}

test('1 click: row activation opens the drawer; heading carries id — title; × closes (click-path budget, AC-S013-3-1)', async ({
  page,
}) => {
  const drill = await openDrill(page, 'DEFECT-001');
  await expect(page.getByTestId('defect-drill-heading')).toHaveText(
    'DEFECT-001 — Demo map shows zero for every figure',
  );
  await page.getByTestId('defect-drill-close').click();
  await expect(drill).toHaveCount(0);
});

test('S13-3-FIG-6/4 — markdown renders as real HTML (no literal **) and fix shas are <code> refs under the Fix label', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-001');
  const actual = page.locator('[data-field="actual"]');
  await expect(actual.locator('strong')).toHaveText('0 for everything');
  expect(await actual.textContent()).not.toContain('**');
  const shas = page.getByTestId('defect-fix-sha');
  await expect(shas).toHaveCount(2);
  await expect(shas.nth(0)).toHaveText('abc1234');
  await expect(shas.nth(1)).toHaveText('9d8f7e6');
  await expect(page.getByTestId('defect-fix')).toContainText('Fix');
});

test('S13-3-FIG-1/3 + GEO-S013-3-4 — resolved MttrCard: unit-bearing figure, human timestamps, reported precedes recovered geometrically', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-001');
  const card = page.getByTestId('mttr-card');
  await expect(card).toHaveAttribute('data-mttr-state', 'resolved');
  const figure = page.getByTestId('mttr-figure');
  await expect(figure).toHaveText('13 min');
  await expect(figure).toHaveAttribute('data-mttr-seconds', '815');
  await expect(page.getByTestId('mttr-reported')).toHaveText('2026-06-09 00:30:00 UTC');
  await expect(page.getByTestId('mttr-recovered')).toHaveText('2026-06-09 00:43:35 UTC');
  // order = meaning: the reported point sits above the recovered point
  const reported = await page.getByTestId('mttr-reported').boundingBox();
  const recovered = await page.getByTestId('mttr-recovered').boundingBox();
  expect(reported.y).toBeLessThan(recovered.y);
});

test('S13-3-FIG-2 — OPEN defect (fixture DEFECT-003): "Not yet resolved", elapsed figure NOT labelled MTTR, no console error', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await openDrill(page, 'DEFECT-003');
  const card = page.getByTestId('mttr-card');
  await expect(card).toHaveAttribute('data-mttr-state', 'open');
  await expect(page.getByTestId('mttr-recovered')).toHaveText('Not yet resolved');
  const figure = page.getByTestId('mttr-figure');
  await expect(figure).toHaveText(/^open for \d+\s*(h|min|s)/);
  expect(await figure.textContent()).not.toMatch(/^0|null/);
  // the label over the open running figure is NOT "MTTR" (DEFECT-007 lesson)
  const label = await figure.evaluate((dd) => dd.closest('div').querySelector('dt').textContent);
  expect(label).not.toMatch(/MTTR/);
  // open span carries no raw-seconds MTTR cross-check
  await expect(figure).not.toHaveAttribute('data-mttr-seconds', /.+/);
  // fix slot: no fabricated sha for an open defect
  await expect(page.getByTestId('defect-fix')).toContainText('—');
  expect(errors).toEqual([]);
});

test('S13-3-FIG-5/7 — ledger-only DEFECT-002: null fields render "—"; provenance falls back to the ledger ref', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-002');
  await expect(page.getByTestId('defect-detail-severity')).toHaveText('—');
  await expect(page.locator('[data-field="expected"]')).toHaveText('—');
  await expect(page.locator('[data-field="root-cause"]')).toHaveText('—');
  const detail = page.getByTestId('defect-detail');
  await expect(detail).toHaveAttribute(
    'data-source',
    'process/dora/ledger.csv#ref=DEFECT-002',
  );
  await expect(page.getByTestId('defect-detail-source')).toContainText(
    'process/dora/ledger.csv#ref=DEFECT-002',
  );
  // file-backed record names its .md file (FIG-7 contrast case)
  await page.getByTestId('defect-drill-close').click();
  await openDrill(page, 'DEFECT-001');
  await expect(page.getByTestId('defect-detail-source')).toContainText(
    'DEFECT-001-map-zero-figures.md',
  );
});

test('GEO-S013-3-1/2 — the drawer is a PURE OVERLAY: panel + rail bboxes and page scrollHeight byte-identical open vs closed; drawer on-screen', async ({
  page,
}) => {
  const panelBefore = await page.getByTestId('defects-panel').boundingBox();
  const railBefore = await page.getByTestId('work-item-tree').boundingBox();
  const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
  const drill = await openDrill(page, 'DEFECT-001');
  expect(await page.getByTestId('defects-panel').boundingBox()).toEqual(panelBefore);
  expect(await page.getByTestId('work-item-tree').boundingBox()).toEqual(railBefore);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(heightBefore);
  // on-screen, no horizontal scroll introduced
  const box = await drill.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  const hScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hScroll).toBe(false);
});

test('GEO-S013-3-3 — the record sections STACK: monotonic heading tops, shared left offset', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-001');
  const boxes = [];
  for (const name of [
    'expected',
    'actual',
    'intent',
    'importance',
    'classification',
    'root-cause',
    'resolution',
  ]) {
    boxes.push(await page.getByTestId(`defect-field-${name}`).boundingBox());
  }
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    expect(Math.abs(boxes[i].x - boxes[0].x)).toBeLessThanOrEqual(1);
  }
});

test('@a11y S13-3-A11Y-1/2/3 — keyboard-only: Enter on the focused row opens, focus lands on the heading, Esc closes and returns focus to the row', async ({
  page,
}) => {
  const trigger = row(page, 'DEFECT-001').getByTestId('defect-row-trigger');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('defect-drill')).toBeVisible();
  await expect(page.getByTestId('defect-drill-heading')).toBeFocused();
  // the open state is exposed on the originating row
  await expect(row(page, 'DEFECT-001')).toHaveAttribute('data-active', 'true');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('defect-drill')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(row(page, 'DEFECT-001')).toHaveAttribute('data-active', 'false');
  // Space opens too (not Enter-only)
  await page.keyboard.press(' ');
  await expect(page.getByTestId('defect-drill')).toBeVisible();
});

test('@a11y S13-3-A11Y-3 (non-modal) — the defects list stays operable while the drawer is open: no focus trap, another row can be activated', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-001');
  // NO focus trap: keyboard can leave the drawer and activate ANOTHER row
  // (keyboard, not pointer — the floating drawer legitimately overlays the
  // right end of the rows, the DEFECT-006 float-over idiom)
  const otherTrigger = row(page, 'DEFECT-003').getByTestId('defect-row-trigger');
  await otherTrigger.focus();
  await expect(otherTrigger).toBeFocused(); // focus escaped the open drawer
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('defect-drill')).toHaveAttribute(
    'data-defect-id',
    'DEFECT-003',
  );
});

test('@a11y S13-3-A11Y-4/6 — axe zero violations on the open drawer; close + trigger targets ≥ 24px', async ({
  page,
}) => {
  await openDrill(page, 'DEFECT-001');
  const closeBox = await page.getByTestId('defect-drill-close').boundingBox();
  expect(closeBox.width).toBeGreaterThanOrEqual(24);
  expect(closeBox.height).toBeGreaterThanOrEqual(24);
  const triggerBox = await row(page, 'DEFECT-001')
    .getByTestId('defect-row-trigger')
    .boundingBox();
  expect(triggerBox.height).toBeGreaterThanOrEqual(24);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .include('[data-testid="defect-drill"]')
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
