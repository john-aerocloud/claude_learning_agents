// @covers uc-s018-1
// @covers IntakeWizard
// @covers IntakeLauncher
// UC-S018-1 — intake wizard shell + JTBD step 1, in a REAL browser.
//
// What jsdom cannot prove, pinned here:
//   - GEO-S018-1-1: ZERO reflow — the value-stream map bbox and the main
//     column height are byte-identical wizard-open vs closed (the wizard is a
//     body-portalled position:fixed overlay; the DEFECT-006 guard family).
//   - GEO-S018-1-2: the open wizard sits fully on-screen; no horizontal
//     scrollbar introduced.
//   - GEO-S018-1-3: the launcher and the ViewSwitch tablist share a header
//     ROW (approximately-equal tops); the tablist stays left-anchored.
//   - AC-S018-1-4: console error-free on open and on all three field inputs.
//   - NOWRITE-S018-1-1: the full step-1 interaction issues ZERO write-method
//     network requests (step 1 is pure client-side).
// Stable selectors only (role+name / data-testid) — the ui-design.md contract.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('view-switch')).toBeVisible();
});

test('GEO-S018-1-1/2 + AC-S018-1-3 — opening the wizard reflows NOTHING and stays on-screen', async ({ page }) => {
  await expect(page.getByTestId('value-stream-map')).toBeVisible();
  const mapClosed = await page.getByTestId('value-stream-map').boundingBox();
  const closed = await page.evaluate(() => ({
    col: document.querySelector('.observatory-main-col').scrollHeight,
    scroll: document.documentElement.scrollHeight,
    scrollW: document.documentElement.scrollWidth,
  }));

  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();

  const mapOpen = await page.getByTestId('value-stream-map').boundingBox();
  const open = await page.evaluate(() => ({
    col: document.querySelector('.observatory-main-col').scrollHeight,
    scroll: document.documentElement.scrollHeight,
    scrollW: document.documentElement.scrollWidth,
  }));

  // zero reflow: identical map bbox + identical column/page heights
  expect(mapOpen).toEqual(mapClosed);
  expect(open.col).toBe(closed.col);
  expect(open.scroll).toBe(closed.scroll);
  // no horizontal scrollbar introduced; wizard fully within the viewport
  expect(open.scrollW).toBe(closed.scrollW);
  const wiz = await page.getByTestId('intake-wizard').boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  expect(wiz.x).toBeGreaterThanOrEqual(0);
  expect(wiz.x + wiz.width).toBeLessThanOrEqual(vw + 1);
});

test('GEO-S018-1-3 — the launcher shares the header ROW with the tablist; tablist stays left-anchored', async ({ page }) => {
  const tablist = await page.getByTestId('view-switch').boundingBox();
  const launcher = await page.getByTestId('intake-launcher').boundingBox();
  const col = await page.evaluate(() => {
    const r = document.querySelector('.observatory-main-col').getBoundingClientRect();
    return { left: r.left };
  });
  // a row, not stacked: approximately-equal tops
  expect(Math.abs(launcher.y - tablist.y)).toBeLessThanOrEqual(8);
  // tablist keeps the column's left edge (pre-s018 position); launcher rides right of it
  expect(Math.abs(tablist.x - col.left)).toBeLessThanOrEqual(2);
  expect(launcher.x).toBeGreaterThan(tablist.x + tablist.width - 1);
});

test('AC-S018-1-1/2/4 — one click opens the wizard; typing builds the live sentence; console error-free', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.getByRole('button', { name: 'New Work' }).click();
  const wizard = page.getByRole('dialog', { name: /new work|intake/i });
  await expect(wizard).toBeVisible();
  // focus lands on the heading (A11Y-S018-1-3)
  await expect(page.getByTestId('intake-wizard-heading')).toBeFocused();

  await page.getByRole('textbox', { name: /situation/i }).fill('the loop starves');
  await page.getByRole('textbox', { name: /motivation/i }).fill('see the empty queue');
  await page.getByRole('textbox', { name: /outcome/i }).fill('replenish in time');
  await expect(page.getByTestId('job-sentence-preview')).toHaveText(
    'When the loop starves, I want to see the empty queue, so I can replenish in time.',
  );
  expect(errors).toEqual([]);
});

test('A11Y-S018-1-4 — Esc closes the wizard and focus returns to the launcher', async ({ page }) => {
  await page.getByRole('button', { name: 'New Work' }).click();
  await expect(page.getByTestId('intake-wizard')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('intake-wizard')).toHaveCount(0);
  await expect(page.getByTestId('intake-launcher')).toBeFocused();
});

test('NOWRITE-S018-1-1 — open + type + Next + Back issues ZERO write-method requests', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) {
      writes.push(`${req.method()} ${req.url()}`);
    }
  });
  await page.getByRole('button', { name: 'New Work' }).click();
  const wizard = page.getByTestId('intake-wizard');
  await expect(wizard).toBeVisible();
  await wizard.getByRole('textbox', { name: /situation/i }).fill('s');
  await wizard.getByRole('textbox', { name: /motivation/i }).fill('m');
  await wizard.getByRole('textbox', { name: /outcome/i }).fill('o');
  // NAV-S018-1-1: Next is planned-not-dead — placeholder, no crash, no write
  await wizard.getByRole('button', { name: /next/i }).click();
  await expect(page.getByTestId('wizard-step-placeholder')).toContainText(/cost-of-delay signals/i);
  await expect(page.getByTestId('wizard-step-2')).toHaveAttribute('data-step-state', 'current');
  // NAV-S018-1-2: Back preserves the draft (wizard-scoped — /back/i would also
  // match a steer trigger's "…slice-backed…" aria-label outside the dialog)
  await wizard.getByRole('button', { name: /back/i }).click();
  await expect(page.getByTestId('jtbd-situation')).toHaveValue('s');
  expect(writes).toEqual([]);
});
